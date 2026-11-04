import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BillStatus, InvoiceStatus, VoucherType } from '@ai-accounting/shared';
import { TdsDeposit, TdsDepositDocument } from './schemas/tds-deposit.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { AccountsService } from '../gl/accounts.service';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { AuditService } from '../gl/audit.service';
import { TDS_SECTIONS, TdsSection, tdsDueDate } from '../gl/tds';
import { rupees } from '../gl/note-amounts';
import { financialYearRange } from '../reports/reports.service';
import { withOrg } from '../database/tenant.plugin';

export interface TdsPayableRow {
  billId: string;
  billNumber: string | null;
  billDate: string;
  vendorName: string;
  pan: string | null;
  section: string;
  rateBps: number;
  taxablePaise: number;
  tdsPaise: number;
  depositId: string | null;
}

export interface TdsMonth {
  month: string;
  section: string;
  sectionLabel: string;
  deductedPaise: number;
  depositedPaise: number;
  pendingPaise: number;
  dueDate: string;
  /** Pending past its due date: interest runs at 1.5% a month from here. */
  overdue: boolean;
}

export interface DepositInput {
  month: string;
  section: string;
  paidOn: string;
  challanNumber: string;
}

/**
 * TDS deducted from vendors, and the deposits that pay it over.
 *
 * Every bill with TDS is a row; rows group by the month the TDS was deducted
 * in and its section, which is how it is deposited (one challan each) and due
 * (the 7th of the next month, 30 April for March).
 */
import { Quarter, build26q } from './form26q';
import { todayIst } from '../automation/schedule';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
@Injectable()
export class TdsService {
  private readonly logger = new Logger(TdsService.name);

  constructor(
    @InjectModel(TdsDeposit.name) private depositModel: Model<TdsDepositDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    private accountsService: AccountsService,
    private postingService: PostingService,
    private auditService: AuditService,
    // Optional so specs that build this by hand need not register it.
    @Optional() @InjectModel(OrgSettings.name) private settingsModel?: Model<OrgSettingsDocument>,
  ) {}

  async payable(orgId: string, financialYear: string): Promise<{ rows: TdsPayableRow[]; months: TdsMonth[] }> {
    const { start, end } = financialYearRange(financialYear);
    const bills = await withOrg(orgId, () =>
      this.billModel
        .find({
          status: { $in: [BillStatus.POSTED, BillStatus.PAID] },
          'tds.amountPaise': { $gt: 0 },
          billDate: { $gte: start, $lte: end },
        })
        .sort({ billDate: 1 })
        .lean()
        .exec(),
    );
    const vendors = await withOrg(orgId, () =>
      this.vendorModel.find({ _id: { $in: bills.map((b) => b.vendorId) } }).select('name pan gstin').lean().exec(),
    );
    const vendorById = new Map(vendors.map((v) => [String(v._id), v]));

    const rows: TdsPayableRow[] = bills.map((b) => {
      const vendor = vendorById.get(String(b.vendorId));
      return {
        billId: String(b._id),
        billNumber: b.billNumber,
        billDate: b.billDate,
        vendorName: vendor?.name ?? 'Unknown',
        pan: vendor?.pan ?? null,
        section: b.tds!.section,
        rateBps: b.tds!.rateBps,
        taxablePaise: b.amountsPaise.taxableValue,
        tdsPaise: b.tds!.amountPaise,
        depositId: b.tds!.depositId ? String(b.tds!.depositId) : null,
      };
    });

    const today = new Date().toISOString().slice(0, 10);
    const byKey = new Map<string, TdsMonth>();
    for (const r of rows) {
      const month = r.billDate.slice(0, 7);
      const key = `${month}|${r.section}`;
      const m =
        byKey.get(key) ??
        {
          month,
          section: r.section,
          sectionLabel: TDS_SECTIONS[r.section as TdsSection]?.label ?? r.section,
          deductedPaise: 0,
          depositedPaise: 0,
          pendingPaise: 0,
          dueDate: tdsDueDate(month),
          overdue: false,
        };
      m.deductedPaise += r.tdsPaise;
      if (r.depositId) m.depositedPaise += r.tdsPaise;
      else m.pendingPaise += r.tdsPaise;
      m.overdue = m.pendingPaise > 0 && today > m.dueDate;
      byKey.set(key, m);
    }
    const months = [...byKey.values()].sort((a, b) => a.month.localeCompare(b.month) || a.section.localeCompare(b.section));
    return { rows, months };
  }

  /**
   * Pay over a month's TDS under one section: Dr TDS Payable / Cr Bank for
   * everything deducted and not yet deposited, and mark those bills as
   * covered — one transaction.
   */
  async deposit(orgId: string, actorId: string, input: DepositInput): Promise<TdsDepositDocument> {
    if (!/^\d{4}-\d{2}$/.test(input.month)) throw new BadRequestException('month must look like 2026-10');
    if (input.paidOn.slice(0, 7) < input.month) {
      throw new BadRequestException('TDS cannot be deposited before the month it was deducted in');
    }
    return this.postingService.inTransaction(async (session) => {
      const bills = await withOrg(orgId, () =>
        this.billModel
          .find({
            status: { $in: [BillStatus.POSTED, BillStatus.PAID] },
            'tds.section': input.section,
            'tds.depositId': null,
            'tds.amountPaise': { $gt: 0 },
            billDate: { $regex: `^${input.month}` },
          })
          .session(session)
          .exec(),
      );
      const amount = bills.reduce((s, b) => s + b.tds!.amountPaise, 0);
      if (amount === 0) {
        throw new BadRequestException(`No undeposited ${input.section} TDS for ${input.month}`);
      }

      const accounts = await this.accountsService.resolveSystemAccounts(orgId, [
        SystemAccountKey.TDS_PAYABLE,
        SystemAccountKey.BANK,
      ]);
      const tdsPayable = accounts.get(SystemAccountKey.TDS_PAYABLE)!;
      const bank = accounts.get(SystemAccountKey.BANK)!;
      const journal = await this.postingService.post(
        {
          orgId,
          voucherType: VoucherType.PAYMENT,
          financialYear: financialYearOf(input.paidOn),
          date: input.paidOn,
          narration: `TDS deposit — ${input.section} — ${input.month} — challan ${input.challanNumber}`,
          postedBy: actorId,
          lines: [
            { accountId: tdsPayable._id.toString(), description: tdsPayable.name, debitPaise: amount, creditPaise: 0 },
            { accountId: bank._id.toString(), description: bank.name, debitPaise: 0, creditPaise: amount },
          ],
        },
        session,
      );

      const depositId = new Types.ObjectId();
      const [deposit] = await this.depositModel.create(
        [
          {
            _id: depositId,
            orgId,
            month: input.month,
            section: input.section,
            amountPaise: amount,
            paidOn: input.paidOn,
            challanNumber: input.challanNumber,
            journalId: journal._id,
            billIds: bills.map((b) => b._id),
            createdBy: actorId,
          },
        ],
        { session },
      );
      // Guarded on still being undeposited: a deposit racing this one fails here.
      const marked = await withOrg(orgId, () =>
        this.billModel
          .updateMany(
            { _id: { $in: bills.map((b) => b._id) }, 'tds.depositId': null },
            { $set: { 'tds.depositId': depositId } },
            { session },
          )
          .exec(),
      );
      if (marked.modifiedCount !== bills.length) {
        throw new BadRequestException('Some of this TDS was deposited meanwhile — refresh and try again');
      }

      await this.auditService.record(
        {
          orgId,
          entityType: 'TdsDeposit',
          entityId: String(depositId),
          action: 'DEPOSIT',
          performedBy: actorId,
          after: { month: input.month, section: input.section, amountPaise: amount, challanNumber: input.challanNumber, bills: bills.length },
        },
        session,
      );
      this.logger.log(`TDS ${input.section} ${input.month}: ${rupees(amount)} deposited, challan ${input.challanNumber}`);
      return deposit;
    });
  }

  async deposits(orgId: string): Promise<TdsDepositDocument[]> {
    return withOrg(orgId, () => this.depositModel.find().sort({ paidOn: -1 }).limit(200).exec());
  }

  /**
   * TDS customers deducted from what they paid us — to match against Form 26AS
   * before claiming it.
   */
  /** The quarter's Form 26Q, checked, with what each vendor's Form 16A will show. */
  async form26q(orgId: string, financialYear: string, quarter: Quarter, today = todayIst()) {
    if (!['Q1', 'Q2', 'Q3', 'Q4'].includes(quarter)) throw new BadRequestException('quarter is Q1, Q2, Q3 or Q4');
    const [{ rows }, deposits, settings] = await Promise.all([
      this.payable(orgId, financialYear),
      this.deposits(orgId),
      this.settingsModel?.findOne({ orgId }).lean().exec() ?? null,
    ]);
    return build26q({
      financialYear,
      quarter,
      deductor: { name: settings?.displayName?.trim() || 'Your business', tan: settings?.tan?.trim().toUpperCase() || null, pan: settings?.pan?.trim().toUpperCase() || null },
      rows,
      deposits: deposits
        .filter((d) => d.status === 'posted')
        .map((d) => ({ id: String(d._id), month: d.month, section: d.section, amountPaise: d.amountPaise, paidOn: d.paidOn, challanNumber: d.challanNumber })),
      today,
    });
  }

  async receivable(orgId: string, financialYear: string) {
    const { start, end } = financialYearRange(financialYear);
    const invoices = await withOrg(orgId, () =>
      this.invoiceModel
        .find({ status: { $in: [InvoiceStatus.POSTED, InvoiceStatus.PAID] }, 'payments.tdsPaise': { $gt: 0 } })
        .lean()
        .exec(),
    );
    const customers = await withOrg(orgId, () =>
      this.customerModel.find({ _id: { $in: invoices.map((i) => i.customerId) } }).select('name gstin').lean().exec(),
    );
    const name = new Map(customers.map((c) => [String(c._id), c.name]));
    return invoices
      .flatMap((inv) =>
        (inv.payments ?? [])
          .filter((p) => (p.tdsPaise ?? 0) > 0 && p.paidOn >= start && p.paidOn <= end)
          .map((p) => ({
            invoiceId: String(inv._id),
            invoiceNumber: inv.invoiceNumber,
            customerName: name.get(String(inv.customerId)) ?? 'Unknown',
            paidOn: p.paidOn,
            receivedPaise: p.amountPaise,
            tdsPaise: p.tdsPaise,
            journalId: String(p.journalId),
          })),
      )
      .sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  }
}
