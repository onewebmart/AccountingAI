import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { CreditNote, CreditNoteDocument } from '../sales/schemas/credit-note.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { DebitNote, DebitNoteDocument } from '../purchase/schemas/debit-note.schema';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { PartyPayment, PartyPaymentDocument } from '../payments/schemas/party-payment.schema';
import { DirectExpense, DirectExpenseDocument } from '../direct-expenses/schemas/direct-expense.schema';

export interface VoucherContact {
  id: string;
  name: string;
  kind: 'customer' | 'vendor';
}

type Ref = { id: string; kind: 'customer' | 'vendor' };
const oid = (v: unknown) => (v ? String(v) : null);

/**
 * Who a voucher was with. A journal line carries no customer or vendor; the
 * document that posted the voucher does: an invoice or bill and the receipts
 * and payments settling it, a credit or debit note, a receipt or payment with
 * the vouchers that applied or refunded it, an expense. Read only.
 */
@Injectable()
export class VoucherContactsService {
  constructor(
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(CreditNote.name) private creditNoteModel: Model<CreditNoteDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(DebitNote.name) private debitNoteModel: Model<DebitNoteDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(PartyPayment.name) private paymentModel: Model<PartyPaymentDocument>,
    @InjectModel(DirectExpense.name) private expenseModel: Model<DirectExpenseDocument>,
  ) {}

  /** Every customer and vendor of the org, by name, to filter by. */
  async list(orgId: string): Promise<VoucherContact[]> {
    const [customers, vendors] = await Promise.all([
      this.customerModel.find({ orgId }, { name: 1 }).sort({ name: 1 }).limit(5000).lean().exec(),
      this.vendorModel.find({ orgId }, { name: 1 }).sort({ name: 1 }).limit(5000).lean().exec(),
    ]);
    return [
      ...customers.map((c) => ({ id: String(c._id), name: c.name, kind: 'customer' as const })),
      ...vendors.map((v) => ({ id: String(v._id), name: v.name, kind: 'vendor' as const })),
    ].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The org's customer or vendor with this id, or null. */
  async contact(orgId: string, id: string): Promise<VoucherContact | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const _id = new Types.ObjectId(id);
    const customer = await this.customerModel.findOne({ orgId, _id }, { name: 1 }).lean().exec();
    if (customer) return { id, name: customer.name, kind: 'customer' };
    const vendor = await this.vendorModel.findOne({ orgId, _id }, { name: 1 }).lean().exec();
    return vendor ? { id, name: vendor.name, kind: 'vendor' } : null;
  }

  /** The vouchers a contact's documents posted. */
  async journalIdsOf(orgId: string, contactId: string): Promise<Types.ObjectId[]> {
    const c = new Types.ObjectId(contactId);
    const [invoices, creditNotes, bills, debitNotes, payments, expenses] = await Promise.all([
      this.invoiceModel.find({ orgId, customerId: c }, { journalId: 1, 'payments.journalId': 1 }).lean().exec(),
      this.creditNoteModel.find({ orgId, customerId: c }, { journalId: 1 }).lean().exec(),
      this.billModel.find({ orgId, vendorId: c }, { journalId: 1, 'payments.journalId': 1 }).lean().exec(),
      this.debitNoteModel.find({ orgId, vendorId: c }, { journalId: 1 }).lean().exec(),
      this.paymentModel.find({ orgId, partyId: c }, { journalId: 1, 'allocations.journalId': 1, 'refunds.journalId': 1 }).lean().exec(),
      this.expenseModel.find({ orgId, $or: [{ vendorId: c }, { customerId: c }] }, { journalId: 1 }).lean().exec(),
    ]);
    const ids = new Set<string>();
    const add = (v: unknown) => { const s = oid(v); if (s) ids.add(s); };
    for (const d of [...invoices, ...bills]) { add(d.journalId); for (const p of d.payments ?? []) add(p.journalId); }
    for (const d of [...creditNotes, ...debitNotes, ...expenses]) add(d.journalId);
    for (const p of payments) {
      add(p.journalId);
      for (const a of p.allocations ?? []) add(a.journalId);
      for (const r of p.refunds ?? []) add(r.journalId);
    }
    return [...ids].map((id) => new Types.ObjectId(id));
  }

  /** journalId → the customer or vendor of the document that posted it. */
  async contactsOf(orgId: string, journalIds: unknown[]): Promise<Map<string, VoucherContact>> {
    if (!journalIds.length) return new Map();
    const $in = journalIds;
    const wanted = new Set(journalIds.map(String));
    const [invoices, creditNotes, bills, debitNotes, payments, expenses] = await Promise.all([
      this.invoiceModel.find({ orgId, $or: [{ journalId: { $in } }, { 'payments.journalId': { $in } }] }, { journalId: 1, 'payments.journalId': 1, customerId: 1 }).lean().exec(),
      this.creditNoteModel.find({ orgId, journalId: { $in } }, { journalId: 1, customerId: 1 }).lean().exec(),
      this.billModel.find({ orgId, $or: [{ journalId: { $in } }, { 'payments.journalId': { $in } }] }, { journalId: 1, 'payments.journalId': 1, vendorId: 1 }).lean().exec(),
      this.debitNoteModel.find({ orgId, journalId: { $in } }, { journalId: 1, vendorId: 1 }).lean().exec(),
      this.paymentModel.find({ orgId, $or: [{ journalId: { $in } }, { 'allocations.journalId': { $in } }, { 'refunds.journalId': { $in } }] }, { journalId: 1, 'allocations.journalId': 1, 'refunds.journalId': 1, partyId: 1, kind: 1 }).lean().exec(),
      this.expenseModel.find({ orgId, journalId: { $in } }, { journalId: 1, vendorId: 1, customerId: 1 }).lean().exec(),
    ]);
    const refs = new Map<string, Ref>();
    const set = (journalId: unknown, party: unknown, kind: Ref['kind']) => {
      const j = oid(journalId);
      const p = oid(party);
      if (j && p && wanted.has(j) && !refs.has(j)) refs.set(j, { id: p, kind });
    };
    for (const d of invoices) { set(d.journalId, d.customerId, 'customer'); for (const p of d.payments ?? []) set(p.journalId, d.customerId, 'customer'); }
    for (const d of creditNotes) set(d.journalId, d.customerId, 'customer');
    for (const d of bills) { set(d.journalId, d.vendorId, 'vendor'); for (const p of d.payments ?? []) set(p.journalId, d.vendorId, 'vendor'); }
    for (const d of debitNotes) set(d.journalId, d.vendorId, 'vendor');
    for (const p of payments) {
      const kind = p.kind === 'receipt' ? 'customer' : 'vendor';
      set(p.journalId, p.partyId, kind);
      for (const a of p.allocations ?? []) set(a.journalId, p.partyId, kind);
      for (const r of p.refunds ?? []) set(r.journalId, p.partyId, kind);
    }
    for (const e of expenses) {
      if (e.vendorId) set(e.journalId, e.vendorId, 'vendor');
      else if (e.customerId) set(e.journalId, e.customerId, 'customer');
    }

    const ofKind = (k: Ref['kind']) => [...new Set([...refs.values()].filter((r) => r.kind === k).map((r) => r.id))].map((id) => new Types.ObjectId(id));
    const [customers, vendors] = await Promise.all([
      this.customerModel.find({ orgId, _id: { $in: ofKind('customer') } }, { name: 1 }).lean().exec(),
      this.vendorModel.find({ orgId, _id: { $in: ofKind('vendor') } }, { name: 1 }).lean().exec(),
    ]);
    const names = new Map([...customers, ...vendors].map((p) => [String(p._id), p.name]));
    const out = new Map<string, VoucherContact>();
    for (const [j, r] of refs) {
      const name = names.get(r.id);
      if (name) out.set(j, { id: r.id, name, kind: r.kind });
    }
    return out;
  }
}
