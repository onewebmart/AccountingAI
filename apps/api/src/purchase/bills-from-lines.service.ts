import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccountType } from '@ai-accounting/shared';
import { isMoneyAccount } from '../gl/money-accounts';
import { LedgerAccount, LedgerAccountDocument, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { ItemsService } from '../items/items.service';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import { DiscountInput, DocLineInput, isInterState, lineAmount, lineProblem, priceDoc, text } from '../orders/doc-lines';
import { isPaymentTerms, termsDueDate } from '../gl/party-profile';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { PurchaseBillsService } from './purchase-bills.service';
import { PurchaseBillDocument } from './schemas/purchase-bill.schema';
import { Vendor, VendorDocument } from './schemas/vendor.schema';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface BillLineInput extends DocLineInput {
  projectId?: string | null;
  /** The account the line is booked to: rent to Rent, a laptop to Computers. The item's, or Purchases, when left out. */
  accountId?: string | null;
  /** This line's own discount ("at line item level"): a percent of the line, or an amount. Not with a discount on the whole bill. */
  discount?: DiscountInput | null;
  /** The customer this cost is for; billable marks it to be billed on to them. */
  customerId?: string | null;
  billable?: boolean;
}

/** Asset accounts a bill line may be booked to that the chart itself keeps: prepaid costs and stock. */
const BOOKABLE_ASSET_KEYS = new Set<string>([SystemAccountKey.PREPAID_EXPENSES, SystemAccountKey.INVENTORY]);

/**
 * What a typed bill line may be booked to: an expense, or an asset bought
 * (equipment, a prepaid cost). Never a group, a deactivated account, or one
 * the books keep themselves: payables, receivables, tax, bank or cash.
 */
export function bookableForBill(a: { type: string; isGroup?: boolean | null; isActive?: boolean | null; systemKey?: string | null; name: string }): boolean {
  if (a.isGroup || a.isActive === false) return false;
  if (a.type === AccountType.EXPENSE) return true;
  if (a.type !== AccountType.ASSETS) return false;
  if (a.systemKey) return BOOKABLE_ASSET_KEYS.has(a.systemKey);
  return !isMoneyAccount(a);
}

export interface BillFromLinesInput {
  vendorId: string;
  billNumber?: string | null;
  billDate: string;
  /** Blank: what the payment terms give, else none. */
  dueDate?: string | null;
  lines: BillLineInput[];
  notes?: string | null;
  /** GST on this purchase is ours to pay (reverse charge). */
  isReverseCharge?: boolean;
  /** Overrides the vendor's TDS section; 'none' deducts nothing. */
  tdsSection?: string;
  tdsRateBps?: number;
  /** A discount on the whole bill, before tax, spread over its lines ("at transaction level"). Not with discounts on the lines. */
  discount?: DiscountInput | null;
  /** After tax, not taxed, at most ₹99.99 either way: posted to Round Off. */
  adjustment?: { label?: string | null; paise?: number | null } | null;
  /** Our purchase order's number, or the reference the vendor quoted. */
  orderNumber?: string | null;
  subject?: string | null;
  /** due_on_receipt, net_<days>, end_of_month, end_of_next_month: the due date when none is typed. */
  paymentTerms?: string | null;
  /** Set when a recurring template drafts this bill. */
  recurringTemplateId?: string | null;
}

/**
 * A bill typed line by line. The server prices it: each line's amount from
 * its quantity and rate, less its discount (its own, or its share of the
 * bill's), the tax on what is left at its slab, CGST and SGST or IGST from
 * where the vendor is registered against where we are, and the adjustment
 * after tax. The browser's own arithmetic is only a preview. The bill is a
 * draft, posted as any bill is.
 */
@Injectable()
export class BillsFromLinesService {
  constructor(
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(OrgSettings.name) private settingsModel: Model<OrgSettingsDocument>,
    @InjectModel(LedgerAccount.name) private accountModel: Model<LedgerAccountDocument>,
    private items: ItemsService,
    private bills: PurchaseBillsService,
    // Optional so specs that build this without customers need not: a line naming a customer is then refused.
    @Optional() @InjectModel(Customer.name) private customerModel?: Model<CustomerDocument>,
  ) {}

  async create(orgId: string, actorId: string, input: BillFromLinesInput): Promise<PurchaseBillDocument> {
    const { lineItems, amountsPaise, priced, terms } = await this.price(orgId, input);
    return this.bills.create({
      orgId,
      actorId,
      vendorId: input.vendorId,
      billNumber: input.billNumber?.trim() || null,
      billDate: input.billDate,
      dueDate: input.dueDate || termsDueDate(terms, input.billDate),
      amountsPaise,
      lineItems,
      notes: input.notes?.trim() || null,
      isReverseCharge: input.isReverseCharge ?? false,
      tdsSection: input.tdsSection,
      tdsRateBps: input.tdsRateBps,
      discount: priced.discount,
      discountLevel: priced.discountLevel,
      adjustment: priced.adjustment,
      orderNumber: text(input.orderNumber, 60),
      subject: text(input.subject, 250),
      paymentTerms: terms,
      recurringTemplateId: input.recurringTemplateId ?? null,
    });
  }

  /**
   * A bill's lines and amounts as the server prices them, without saving
   * anything: checked, filled from their items, booked to their accounts,
   * discounted, taxed and adjusted. A recurring bill is checked with it when
   * it is set up, and each one it drafts is made by create(), the same way.
   */
  async price(orgId: string, input: BillFromLinesInput) {
    if (!DATE.test(input.billDate ?? '')) throw new BadRequestException('billDate must be a date like 2026-11-04');
    if (input.dueDate && (!DATE.test(input.dueDate) || input.dueDate < input.billDate)) {
      throw new BadRequestException('The due date is a date on or after the bill date.');
    }
    const terms = input.paymentTerms?.trim() || null;
    if (terms && !isPaymentTerms(terms)) throw new BadRequestException('Payment terms are due on receipt, net 7 to net 90 or a number of days, or the end of the month.');
    const vendor = Types.ObjectId.isValid(input.vendorId) ? await this.vendorModel.findOne({ _id: input.vendorId, orgId }).lean().exec() : null;
    if (!vendor) throw new NotFoundException('Vendor not found');
    const typed = (input.lines ?? []).filter((l) => l.description?.trim());
    if (typed.length === 0) throw new BadRequestException('Add at least one line.');
    typed.forEach((l, i) => {
      const problem = lineProblem(l, i);
      if (problem) throw new BadRequestException(problem);
    });

    // An item fills the line's HSN/SAC, unit and expense account; the project is checked to be this org's.
    const resolved = await this.items.resolveLines(
      orgId,
      typed.map((l) => ({
        description: l.description.trim(),
        itemId: l.itemId ?? null,
        hsnSac: l.hsnSac?.trim() || null,
        uqc: l.uqc ?? null,
        qty: l.qty,
        ratePaise: l.ratePaise,
        amountPaise: lineAmount(l),
        taxRatePct: l.taxRatePct,
        projectId: l.projectId ?? null,
      })),
      'purchase',
    );
    // An account chosen on the line wins over the item's.
    const chosen = await this.chosenAccounts(orgId, typed);
    const customers = await this.chosenCustomers(orgId, typed);

    const settings = await this.settingsModel.findOne({ orgId }).lean().exec();
    const ours = settings?.gstin?.slice(0, 2) ?? settings?.stateCode ?? null;
    // The discount comes off before tax, on each line or spread over them; the adjustment after.
    const priced = priceDoc(
      resolved.map((l) => ({ ...l, qty: l.qty ?? 1, taxRatePct: l.taxRatePct ?? 0 })),
      isInterState(ours, vendor.gstin?.slice(0, 2) ?? null),
      { discount: input.discount, adjustment: input.adjustment, lineDiscounts: typed.map((l) => l.discount ?? null) },
    );
    const amountsPaise = priced.amounts;
    if (amountsPaise.total <= 0) throw new BadRequestException('A bill needs an amount.');
    const lineItems = priced.lines.map((l, i) => ({
      ...l,
      ...(chosen[i] ? { accountId: chosen[i] } : {}),
      customerId: customers[i],
      billable: !!customers[i] && !!typed[i].billable,
    }));
    return { lineItems, amountsPaise, priced, terms };
  }

  /** Each line's customer, checked to be this org's; null where none. Billable needs a customer. */
  private async chosenCustomers(orgId: string, lines: BillLineInput[]): Promise<Array<Types.ObjectId | null>> {
    lines.forEach((l, i) => {
      if (l.billable && !l.customerId) throw new BadRequestException(`Line ${i + 1}: choose the customer to bill it on to.`);
    });
    const ids = [...new Set(lines.map((l) => l.customerId).filter((id): id is string => !!id))];
    if (ids.length === 0) return lines.map(() => null);
    if (!this.customerModel || ids.some((id) => !Types.ObjectId.isValid(id))) throw new BadRequestException('That customer is not one of yours.');
    const found = await this.customerModel.find({ orgId, _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }, { _id: 1 }).lean().exec();
    const known = new Set(found.map((c) => String(c._id)));
    return lines.map((l, i) => {
      if (!l.customerId) return null;
      if (!known.has(l.customerId)) throw new BadRequestException(`Line ${i + 1}: that customer is not one of yours.`);
      return new Types.ObjectId(l.customerId);
    });
  }

  /** Each line's chosen account, checked to be this org's and one a bill can be booked to; null where none was chosen. */
  private async chosenAccounts(orgId: string, lines: BillLineInput[]): Promise<Array<Types.ObjectId | null>> {
    const ids = [...new Set(lines.map((l) => l.accountId).filter((id): id is string => !!id))];
    if (ids.length === 0) return lines.map(() => null);
    if (ids.some((id) => !Types.ObjectId.isValid(id))) throw new BadRequestException('That account is not one of yours.');
    const found = await this.accountModel.find({ orgId, _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }).lean().exec();
    const byId = new Map(found.map((a) => [String(a._id), a]));
    return lines.map((l, i) => {
      if (!l.accountId) return null;
      const a = byId.get(l.accountId);
      if (!a) throw new BadRequestException(`Line ${i + 1}: that account is not one of yours.`);
      if (!bookableForBill(a)) throw new BadRequestException(`Line ${i + 1}: a bill line cannot be booked to ${a.name}. Pick an expense account, or an asset such as equipment.`);
      return a._id as Types.ObjectId;
    });
  }
}
