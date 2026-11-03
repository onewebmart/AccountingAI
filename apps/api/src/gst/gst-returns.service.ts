import { partyAsIssued } from '../gl/party-as-issued';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BillStatus, InvoiceStatus } from '@ai-accounting/shared';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { CreditNote, CreditNoteDocument } from '../sales/schemas/credit-note.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { DebitNote, DebitNoteDocument } from '../purchase/schemas/debit-note.schema';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import {
  buildGstr1,
  buildGstr3b,
  gstr1PortalJson,
  gstr3bPortalJson,
  Gstr1,
  Gstr3b,
  PurchaseIn,
  SaleIn,
} from './gst-returns';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Dates are stored as YYYY-MM-DD strings, so a month is a string range. */
function inPeriod(period: string) {
  return { $gte: `${period}-01`, $lte: `${period}-31` };
}

const ids = (values: Array<{ toString(): string }>) => [...new Set(values.map((v) => v.toString()))].map((id) => new Types.ObjectId(id));

/**
 * The month's GSTR-1 and GSTR-3B, worked out from posted documents.
 *
 * Only what reached the ledger counts: posted and paid invoices and bills, and
 * credit and debit notes not since reversed. A reversed invoice goes back to
 * draft, so it drops out of the return with its entry. The filing rules live in
 * gst-returns.ts; this only loads the month.
 */
@Injectable()
export class GstReturnsService {
  constructor(
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(CreditNote.name) private creditNoteModel: Model<CreditNoteDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(DebitNote.name) private debitNoteModel: Model<DebitNoteDocument>,
    @InjectModel(OrgSettings.name) private settingsModel: Model<OrgSettingsDocument>,
  ) {}

  async gstr1(orgId: string, period: string): Promise<Gstr1> {
    this.checkPeriod(period);
    const [org, invoices, unpostedCount, notes] = await Promise.all([
      this.org(orgId),
      this.invoiceModel
        .find({ orgId, invoiceDate: inPeriod(period), isOpeningBalance: { $ne: true }, status: { $in: [InvoiceStatus.POSTED, InvoiceStatus.PAID] } })
        .sort({ invoiceDate: 1 })
        .lean()
        .exec(),
      this.invoiceModel
        .countDocuments({ orgId, invoiceDate: inPeriod(period), status: { $in: [InvoiceStatus.DRAFT, InvoiceStatus.SENT] } })
        .exec(),
      this.creditNoteModel.find({ orgId, noteDate: inPeriod(period), status: 'posted' }).sort({ noteDate: 1 }).lean().exec(),
    ]);

    // A note's invoice can be from an earlier month; its place and lines decide where the note goes.
    const noteInvoices = await this.invoiceModel.find({ orgId, _id: { $in: ids(notes.map((n) => n.invoiceId)) } }).lean().exec();
    const customers = await this.customerModel
      .find({ orgId, _id: { $in: ids([...invoices, ...noteInvoices].map((i) => i.customerId)) } })
      .lean()
      .exec();
    const customerById = new Map(customers.map((c) => [c._id.toString(), c]));
    const sale = (inv: (typeof invoices)[number]): SaleIn => {
      const customer = partyAsIssued(inv, customerById.get(inv.customerId.toString()), 'Unknown customer');
      return {
        id: inv._id.toString(),
        number: inv.invoiceNumber,
        date: inv.invoiceDate,
        customerName: customer.name,
        customerGstin: customer.gstin,
        customerState: customer.stateCode,
        amounts: inv.amountsPaise,
        lines: inv.lineItems ?? [],
      };
    };
    const noteInvoiceById = new Map(noteInvoices.map((i) => [i._id.toString(), i]));

    const result = buildGstr1({
      period,
      orgGstin: org.gstin,
      orgState: org.stateCode ?? '',
      invoices: invoices.map(sale),
      creditNotes: notes.flatMap((n) => {
        const inv = noteInvoiceById.get(n.invoiceId.toString());
        if (!inv) return [];
        return [{ id: n._id.toString(), number: n.noteNumber, date: n.noteDate, amounts: n.amountsPaise, invoice: sale(inv) }];
      }),
      unpostedCount,
    });
    if (!org.stateCode) {
      result.issues.unshift({ level: 'block', message: 'Set your GST state in Settings — every place of supply is judged against it.' });
    }
    return result;
  }

  async gstr3b(orgId: string, period: string): Promise<Gstr3b> {
    const gstr1 = await this.gstr1(orgId, period);
    const org = await this.org(orgId);
    const [bills, notes] = await Promise.all([
      this.billModel
        .find({ orgId, billDate: inPeriod(period), isOpeningBalance: { $ne: true }, status: { $in: [BillStatus.POSTED, BillStatus.PAID] } })
        .lean()
        .exec(),
      this.debitNoteModel.find({ orgId, noteDate: inPeriod(period), status: 'posted' }).lean().exec(),
    ]);
    const noteBills = await this.billModel.find({ orgId, _id: { $in: ids(notes.map((n) => n.billId)) } }).lean().exec();
    const vendors = await this.vendorModel
      .find({ orgId, _id: { $in: ids([...bills, ...noteBills].map((b) => b.vendorId)) } })
      .lean()
      .exec();
    const vendorById = new Map(vendors.map((v) => [v._id.toString(), v]));
    const purchase = (bill: (typeof bills)[number]): PurchaseIn => {
      const vendor = partyAsIssued(bill, vendorById.get(bill.vendorId.toString()), 'Unknown vendor');
      return {
        id: bill._id.toString(),
        number: bill.billNumber,
        vendorName: vendor.name,
        vendorGstin: vendor.gstin,
        isReverseCharge: bill.isReverseCharge ?? false,
        amounts: bill.amountsPaise,
      };
    };
    const noteBillById = new Map(noteBills.map((b) => [b._id.toString(), b]));

    return buildGstr3b({
      gstr1,
      orgState: org.stateCode ?? '',
      bills: bills.map(purchase),
      debitNotes: notes.flatMap((n) => {
        const bill = noteBillById.get(n.billId.toString());
        return bill ? [{ id: n._id.toString(), amounts: n.amountsPaise, bill: purchase(bill) }] : [];
      }),
    });
  }

  async gstr1Json(orgId: string, period: string): Promise<Record<string, unknown>> {
    return gstr1PortalJson(await this.gstr1(orgId, period));
  }

  async gstr3bJson(orgId: string, period: string): Promise<Record<string, unknown>> {
    return gstr3bPortalJson(await this.gstr3b(orgId, period));
  }

  /** The org's GSTIN and state; the GSTIN's first two digits win over a picked state. */
  private async org(orgId: string): Promise<{ gstin: string | null; stateCode: string | null }> {
    const settings = await this.settingsModel.findOne({ orgId }).lean().exec();
    const gstin = settings?.gstin?.trim().toUpperCase() || null;
    return { gstin, stateCode: gstin?.slice(0, 2) ?? settings?.stateCode ?? null };
  }

  private checkPeriod(period: string) {
    if (!PERIOD.test(period ?? '')) throw new BadRequestException('period must be a month like 2026-09');
  }
}
