import { Optional, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AccountType, BillStatus, InvoiceStatus, VoucherType } from '@ai-accounting/shared';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { isMoneyAccount } from '../gl/money-accounts';
import { financialYearOf, PostingService } from '../gl/posting.service';
import { LedgerAccount, LedgerAccountDocument, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { outstandingPaise } from '../gl/schemas/settlement.schema';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { PartyPayment, PartyPaymentDocument, PAYMENT_MODES, PaymentMode } from './schemas/party-payment.schema';
import { suggestAllocation, Suggestion } from './allocation';

export type PaymentKind = 'receipt' | 'payment';

export interface RecordPaymentInput {
  kind: PaymentKind;
  partyId: string;
  date: string;
  /** What the party paid us, or we paid them. Bank charges come out of a receipt, and on top of a payment. */
  amountPaise: number;
  /** Bank, cash or (receipts) the payment gateway. A chosen depositAccountId decides bank or cash instead. */
  via?: 'bank' | 'cash' | 'gateway';
  /** How it moved: cash, bank transfer, cheque, UPI, card or other. */
  mode?: PaymentMode | null;
  /** The bank or cash ledger it went into or left from; by default the system Bank or Cash account from `via`. */
  depositAccountId?: string | null;
  /** What the bank kept from a receipt, or charged on a payment; booked to Bank Charges. */
  bankChargesPaise?: number;
  /** Internal notes. */
  notes?: string | null;
  reference?: string | null;
  /** Receipts only may carry tdsPaise: TDS the customer deducted on that invoice. */
  allocations: Array<{ documentId: string; amountPaise: number; tdsPaise?: number }>;
  bankLineId?: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** How each direction books. A receipt is money in against invoices; a payment, money out against bills. */
const SIDE = {
  receipt: {
    voucher: VoucherType.RECEIPT,
    control: SystemAccountKey.ACCOUNTS_RECEIVABLE,
    advances: SystemAccountKey.CUSTOMER_ADVANCES,
    open: InvoiceStatus.POSTED as string,
    paid: InvoiceStatus.PAID as string,
    entity: 'SalesInvoice',
    doc: 'invoice',
    party: 'customer',
  },
  payment: {
    voucher: VoucherType.PAYMENT,
    control: SystemAccountKey.ACCOUNTS_PAYABLE,
    advances: SystemAccountKey.VENDOR_ADVANCES,
    open: BillStatus.POSTED as string,
    paid: BillStatus.PAID as string,
    entity: 'PurchaseBill',
    doc: 'bill',
    party: 'vendor',
  },
} as const;

type SettledDoc = (SalesInvoiceDocument | PurchaseBillDocument) & { amountPaidPaise?: number | null };

/**
 * A receipt from a customer, or a payment to a vendor, across as many
 * invoices or bills as it settles, with anything left over held as an
 * advance and applied later.
 *
 * The voucher and every document it settles commit together. Each document
 * records its share as an ordinary payment entry, so ageing, statements,
 * GST and reversal see one receipt settling three invoices exactly as they
 * see three receipts.
 *
 * GST is due when an advance is received for services (not for goods).
 * Nothing here charges it; the screen says so.
 */
import { ApprovalsService } from '../approvals/approvals.service';
@Injectable()
export class PartyPaymentsService {
  constructor(
    @InjectModel(PartyPayment.name) private paymentModel: Model<PartyPaymentDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(LedgerAccount.name) private accountModel: Model<LedgerAccountDocument>,
    private posting: PostingService,
    private accounts: AccountsService,
    private audit: AuditService,
    // Optional so specs that build this by hand need no approvals.
    @Optional() private approvals?: ApprovalsService,
  ) {}

  onModuleInit() {
    this.approvals?.register('party_payment', async (orgId, actorId, request) => {
      const p = request.payload as { input: RecordPaymentInput };
      return String((await this.record(orgId, actorId, p.input, { approved: true }))._id);
    });
  }

  async record(orgId: string, actorId: string, input: RecordPaymentInput, opts: { actorRole?: string; approved?: boolean } = {}) {
    const side = SIDE[input.kind];
    if (!side) throw new BadRequestException('kind must be receipt or payment');
    if (!DATE.test(input.date ?? '')) throw new BadRequestException('date must be a date like 2026-10-14');
    if (!Number.isInteger(input.amountPaise) || input.amountPaise < 0) throw new BadRequestException('The amount must be whole paise.');
    const charges = input.bankChargesPaise ?? 0;
    if (!Number.isInteger(charges) || charges < 0) throw new BadRequestException('Bank charges must be whole paise, not negative.');
    if (input.mode != null && !(PAYMENT_MODES as readonly string[]).includes(input.mode)) throw new BadRequestException(`The payment mode must be one of ${PAYMENT_MODES.join(', ')}.`);
    if (input.via === 'gateway' && input.kind !== 'receipt') throw new BadRequestException('Only money in can come through the payment gateway.');
    if (input.via === 'gateway' && (input.depositAccountId || charges)) {
      throw new BadRequestException('An online receipt is held on the payment gateway account; its fee is booked when the gateway settles to the bank.');
    }
    // A receipt's charges come out of what the customer paid: the bank gets the rest.
    if (input.kind === 'receipt' && charges > input.amountPaise) throw new BadRequestException(`The bank charges (${rupees(charges)}) are more than the ${rupees(input.amountPaise)} received.`);
    const notes = input.notes?.trim() || null;
    if (notes && notes.length > 2000) throw new BadRequestException('Keep the notes under 2,000 characters.');

    // The ledgers it books to, checked before anything is held for approval or posted.
    const moneyKey = input.via === 'cash' ? SystemAccountKey.CASH : input.via === 'gateway' ? SystemAccountKey.PAYMENT_GATEWAY : SystemAccountKey.BANK;
    const sys = await this.accounts.resolveSystemAccounts(orgId, [moneyKey, side.control, side.advances, SystemAccountKey.TDS_RECEIVABLE]);
    const money = input.depositAccountId ? await this.moneyAccount(orgId, input.kind, input.depositAccountId) : sys.get(moneyKey)!;
    const via: 'bank' | 'cash' | 'gateway' = input.via === 'gateway' ? 'gateway' : input.depositAccountId ? viaOf(money) : (input.via ?? 'bank');
    const chargesAccount = charges > 0 ? await this.bankChargesAccount(orgId) : null;

    // Money out, entered by a person, waits for approval where a policy says so.
    if (input.kind === 'payment' && this.approvals && !opts.approved) {
      const out = input.amountPaise + charges;
      await this.approvals.gate({
        orgId, docType: 'payment', docId: null, payload: { kind: 'party_payment', input },
        summary:
          `Payment of ₹${(out / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` +
          (charges ? ` (with ${rupees(charges)} bank charges)` : '') +
          (input.reference ? ` — ${input.reference}` : ''),
        amountPaise: out, makerId: actorId, actorId, actorRole: opts.actorRole ?? '', facts: { date: input.date, amountPaise: out },
      });
    }
    const allocations = input.allocations ?? [];
    for (const a of allocations) {
      if (!Types.ObjectId.isValid(a.documentId)) throw new BadRequestException(`Unknown ${side.doc}.`);
      if (!Number.isInteger(a.amountPaise) || a.amountPaise < 0 || !Number.isInteger(a.tdsPaise ?? 0) || (a.tdsPaise ?? 0) < 0) {
        throw new BadRequestException('Allocations must be whole paise, not negative.');
      }
      if (input.kind === 'payment' && (a.tdsPaise ?? 0) > 0) throw new BadRequestException('TDS on a bill is withheld when the bill is posted, not when it is paid.');
      if (a.amountPaise + (a.tdsPaise ?? 0) === 0) throw new BadRequestException(`An allocation to a ${side.doc} must be above zero.`);
    }
    if (new Set(allocations.map((a) => a.documentId)).size !== allocations.length) throw new BadRequestException(`Each ${side.doc} can be allocated once.`);
    const applied = allocations.reduce((s, a) => s + a.amountPaise, 0);
    const tds = allocations.reduce((s, a) => s + (a.tdsPaise ?? 0), 0);
    if (applied > input.amountPaise) throw new BadRequestException(`${rupees(applied)} is allocated, more than the ${rupees(input.amountPaise)} that moved.`);
    if (input.amountPaise + tds === 0) throw new BadRequestException('Nothing to record.');
    const unapplied = input.amountPaise - applied;

    const party = await this.party(orgId, input.kind, input.partyId);

    return this.posting.inTransaction(async (session) => {
      const docs = await this.documents(input.kind, orgId, allocations.map((a) => a.documentId), session);
      for (const a of allocations) {
        const doc = docs.get(a.documentId);
        if (!doc || String((doc as unknown as Record<string, unknown>)[`${side.party}Id`]) !== String(party._id)) {
          throw new BadRequestException(`That ${side.doc} is not ${party.name}'s.`);
        }
        if (doc.status !== side.open) throw new BadRequestException(`${number(doc)} is ${doc.status}; only a posted ${side.doc} can be settled.`);
        const owed = outstandingPaise(doc);
        if (a.amountPaise + (a.tdsPaise ?? 0) > owed) throw new BadRequestException(`${number(doc)} has only ${rupees(owed)} outstanding.`);
      }

      const control = sys.get(side.control)!;
      const advances = sys.get(side.advances)!;
      const tdsReceivable = sys.get(SystemAccountKey.TDS_RECEIVABLE)!;
      const leg = (a: { _id: Types.ObjectId; name: string }, debitPaise: number, creditPaise: number) => ({
        accountId: a._id.toString(),
        description: a.name,
        debitPaise,
        creditPaise,
      });
      const settled = applied + tds;
      // Receipt: the bank gets what was paid less its charges; the customer is
      // credited with all of it. Payment: the bank pays out the amount and its
      // charges; the vendor is debited with the amount. One balanced voucher.
      const lines =
        input.kind === 'receipt'
          ? [
              ...(input.amountPaise - charges ? [leg(money, input.amountPaise - charges, 0)] : []),
              ...(charges ? [leg(chargesAccount!, charges, 0)] : []),
              ...(tds ? [leg(tdsReceivable, tds, 0)] : []),
              ...(settled ? [leg(control, 0, settled)] : []),
              ...(unapplied ? [leg(advances, 0, unapplied)] : []),
            ]
          : [
              ...(applied ? [leg(control, applied, 0)] : []),
              ...(unapplied ? [leg(advances, unapplied, 0)] : []),
              ...(charges ? [leg(chargesAccount!, charges, 0)] : []),
              leg(money, 0, input.amountPaise + charges),
            ];

      // The payment's own number, from a gapless series taken in this
      // transaction: if the posting fails, the number was never used (Invariant 7).
      const fy = financialYearOf(input.date);
      const seq = await this.posting.nextDocumentNumber(orgId, input.kind === 'receipt' ? 'PARTY_RECEIPT' : 'PARTY_PAYMENT', fy, session);
      const paymentNumber = `${input.kind === 'receipt' ? 'RCT' : 'PMT'}/${fy}/${String(seq).padStart(4, '0')}`;

      const numbers = allocations.map((a) => number(docs.get(a.documentId)!));
      const narration =
        `${input.kind === 'receipt' ? 'Receipt' : 'Payment'} ${paymentNumber} ${input.kind === 'receipt' ? 'from' : 'to'} ${party.name}` +
        (numbers.length ? ` — ${numbers.join(', ')}` : '') +
        (unapplied ? ` · ${rupees(unapplied)} as advance` : '') +
        (charges ? ` · ${rupees(charges)} bank charges` : '') +
        (input.reference?.trim() ? ` · ref ${input.reference.trim()}` : '');
      const journal = await this.posting.post(
        { orgId, voucherType: side.voucher, financialYear: fy, date: input.date, narration, postedBy: actorId, lines },
        session,
      );

      for (const a of allocations) {
        await this.settle(input.kind, orgId, actorId, docs.get(a.documentId)!, { journalId: journal._id, amountPaise: a.amountPaise, tdsPaise: a.tdsPaise ?? 0, paidOn: input.date, bankLineId: input.bankLineId ?? null }, session);
      }

      const [payment] = await this.paymentModel.create(
        [
          {
            orgId,
            kind: input.kind,
            number: paymentNumber,
            partyId: party._id,
            partyName: party.name,
            date: input.date,
            amountPaise: input.amountPaise,
            tdsPaise: tds,
            via,
            mode: input.mode ?? null,
            depositAccountId: money._id,
            depositAccountName: money.name,
            bankChargesPaise: charges,
            notes,
            reference: input.reference?.trim() || null,
            journalId: journal._id,
            allocations: allocations.map((a) => ({
              documentId: new Types.ObjectId(a.documentId),
              documentNumber: ownNumber(docs.get(a.documentId)!),
              amountPaise: a.amountPaise,
              tdsPaise: a.tdsPaise ?? 0,
              journalId: journal._id,
              appliedOn: input.date,
            })),
            unappliedPaise: unapplied,
            bankLineId: input.bankLineId ? new Types.ObjectId(input.bankLineId) : null,
            createdBy: actorId,
          },
        ],
        { session },
      );
      await this.audit.record(
        {
          orgId, entityType: 'PartyPayment', entityId: payment._id.toString(), action: 'CREATE', performedBy: actorId,
          after: {
            kind: input.kind, number: paymentNumber, party: party.name, amountPaise: input.amountPaise, tdsPaise: tds, allocated: allocations.length, unappliedPaise: unapplied,
            via, mode: input.mode ?? null, depositAccountId: money._id.toString(), depositAccountName: money.name, bankChargesPaise: charges, notes,
            reference: input.reference?.trim() || null, journalId: journal._id.toString(),
          },
        },
        session,
      );
      return payment;
    });
  }

  /** Apply part of an advance to an invoice or bill: advances against the receivable or payable. */
  async applyAdvance(orgId: string, actorId: string, paymentId: string, input: { documentId: string; amountPaise: number; date: string }) {
    if (!Types.ObjectId.isValid(paymentId)) throw new NotFoundException('Payment not found');
    if (!DATE.test(input.date ?? '')) throw new BadRequestException('date must be a date like 2026-10-14');
    if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) throw new BadRequestException('The amount must be whole paise, above zero.');

    return this.posting.inTransaction(async (session) => {
      const payment = await this.paymentModel.findOne({ _id: paymentId, orgId }).session(session).exec();
      if (!payment) throw new NotFoundException('Payment not found');
      const side = SIDE[payment.kind];
      if (payment.status !== 'posted') throw new BadRequestException('This payment has been reversed.');
      if (input.amountPaise > payment.unappliedPaise) throw new BadRequestException(`Only ${rupees(payment.unappliedPaise)} of this advance is left to apply.`);
      if (input.date < payment.date) throw new BadRequestException('An advance cannot be applied before it was received.');
      const doc = (await this.documents(payment.kind, orgId, [input.documentId], session)).get(input.documentId);
      if (!doc || String((doc as unknown as Record<string, unknown>)[`${side.party}Id`]) !== String(payment.partyId)) {
        throw new BadRequestException(`That ${side.doc} is not ${payment.partyName}'s.`);
      }
      if (doc.status !== side.open) throw new BadRequestException(`${number(doc)} is ${doc.status}; only a posted ${side.doc} can be settled.`);
      if (input.amountPaise > outstandingPaise(doc)) throw new BadRequestException(`${number(doc)} has only ${rupees(outstandingPaise(doc))} outstanding.`);

      const sys = await this.accounts.resolveSystemAccounts(orgId, [side.control, side.advances]);
      const control = sys.get(side.control)!;
      const advances = sys.get(side.advances)!;
      const [debit, credit] = payment.kind === 'receipt' ? [advances, control] : [control, advances];
      const journal = await this.posting.post(
        {
          orgId,
          voucherType: VoucherType.JOURNAL,
          financialYear: financialYearOf(input.date),
          date: input.date,
          narration: `Advance from ${payment.date} applied to ${number(doc)} — ${payment.partyName}`,
          postedBy: actorId,
          lines: [
            { accountId: debit._id.toString(), description: debit.name, debitPaise: input.amountPaise, creditPaise: 0 },
            { accountId: credit._id.toString(), description: credit.name, debitPaise: 0, creditPaise: input.amountPaise },
          ],
        },
        session,
      );
      await this.settle(payment.kind, orgId, actorId, doc, { journalId: journal._id, amountPaise: input.amountPaise, tdsPaise: 0, paidOn: input.date, bankLineId: null }, session);
      const claimed = await this.paymentModel
        .findOneAndUpdate(
          { _id: payment._id, orgId, status: 'posted', unappliedPaise: payment.unappliedPaise },
          {
            $inc: { unappliedPaise: -input.amountPaise },
            $push: {
              allocations: {
                documentId: doc._id,
                documentNumber: ownNumber(doc),
                amountPaise: input.amountPaise,
                tdsPaise: 0,
                journalId: journal._id,
                appliedOn: input.date,
              },
            },
          },
          { new: true, session },
        )
        .exec();
      if (!claimed) throw new BadRequestException('This advance changed while it was being applied. Try again.');
      await this.audit.record(
        {
          orgId, entityType: 'PartyPayment', entityId: paymentId, action: 'APPLY_ADVANCE', performedBy: actorId,
          before: { unappliedPaise: payment.unappliedPaise }, after: { unappliedPaise: claimed.unappliedPaise, documentId: String(doc._id), journalId: journal._id.toString() },
        },
        session,
      );
      return claimed;
    });
  }

  /**
   * Give an advance or credit back as money: to the customer (Advances from
   * Customers Dr, Bank Cr), or from the vendor (Bank Dr, Advances to
   * Vendors Cr).
   */
  async refund(orgId: string, actorId: string, paymentId: string, input: { amountPaise: number; date: string; via?: 'bank' | 'cash' }) {
    if (!Types.ObjectId.isValid(paymentId)) throw new NotFoundException('Payment not found');
    if (!DATE.test(input.date ?? '')) throw new BadRequestException('date must be a date like 2026-10-14');
    if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) throw new BadRequestException('The amount must be whole paise, above zero.');
    return this.posting.inTransaction(async (session) => {
      const payment = await this.paymentModel.findOne({ _id: paymentId, orgId }).session(session).exec();
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.status !== 'posted') throw new BadRequestException('This has been reversed.');
      if (input.amountPaise > payment.unappliedPaise) throw new BadRequestException(`Only ${rupees(payment.unappliedPaise)} is left to refund.`);
      if (input.date < payment.date) throw new BadRequestException('A refund cannot be dated before the credit it returns.');
      const side = SIDE[payment.kind];
      const moneyKey = input.via === 'cash' ? SystemAccountKey.CASH : SystemAccountKey.BANK;
      const sys = await this.accounts.resolveSystemAccounts(orgId, [moneyKey, side.advances]);
      const money = sys.get(moneyKey)!;
      const advances = sys.get(side.advances)!;
      const toCustomer = payment.kind === 'receipt';
      const journal = await this.posting.post(
        {
          orgId,
          voucherType: toCustomer ? VoucherType.PAYMENT : VoucherType.RECEIPT,
          financialYear: financialYearOf(input.date),
          date: input.date,
          narration: toCustomer ? `Refund to ${payment.partyName}` : `Refund from ${payment.partyName}`,
          postedBy: actorId,
          lines: toCustomer
            ? [
                { accountId: advances._id.toString(), description: advances.name, debitPaise: input.amountPaise, creditPaise: 0 },
                { accountId: money._id.toString(), description: money.name, debitPaise: 0, creditPaise: input.amountPaise },
              ]
            : [
                { accountId: money._id.toString(), description: money.name, debitPaise: input.amountPaise, creditPaise: 0 },
                { accountId: advances._id.toString(), description: advances.name, debitPaise: 0, creditPaise: input.amountPaise },
              ],
        },
        session,
      );
      const claimed = await this.paymentModel
        .findOneAndUpdate(
          { _id: payment._id, orgId, status: 'posted', unappliedPaise: payment.unappliedPaise },
          { $inc: { unappliedPaise: -input.amountPaise }, $push: { refunds: { journalId: journal._id, amountPaise: input.amountPaise, date: input.date, via: input.via ?? 'bank' } } },
          { new: true, session },
        )
        .exec();
      if (!claimed) throw new BadRequestException('This credit changed while the refund was being recorded. Try again.');
      await this.audit.record(
        {
          orgId, entityType: 'PartyPayment', entityId: paymentId, action: 'REFUND', performedBy: actorId,
          before: { unappliedPaise: payment.unappliedPaise }, after: { unappliedPaise: claimed.unappliedPaise, journalId: journal._id.toString() },
        },
        session,
      );
      return claimed;
    });
  }

  /**
   * A credit or debit note that took back more than was still owed: the
   * excess becomes the party's credit, applied or refunded like an advance.
   * Called by the note services, inside their transaction.
   */
  async creditFromNote(
    orgId: string,
    actorId: string,
    note: { kind: PaymentKind; partyId: Types.ObjectId; partyName: string; date: string; journalId: Types.ObjectId; noteNumber: string; excessPaise: number },
    session: ClientSession,
  ): Promise<void> {
    const [credit] = await this.paymentModel.create(
      [
        {
          orgId,
          kind: note.kind,
          partyId: note.partyId,
          partyName: note.partyName,
          date: note.date,
          amountPaise: 0,
          tdsPaise: 0,
          source: note.kind === 'receipt' ? 'credit_note' : 'debit_note',
          reference: note.noteNumber,
          journalId: note.journalId,
          allocations: [],
          unappliedPaise: note.excessPaise,
          createdBy: actorId,
        },
      ],
      { session },
    );
    await this.audit.record(
      {
        orgId, entityType: 'PartyPayment', entityId: credit._id.toString(), action: 'CREATE', performedBy: actorId,
        after: { source: credit.source, party: note.partyName, unappliedPaise: note.excessPaise, noteNumber: note.noteNumber },
      },
      session,
    );
  }

  async list(orgId: string, kind?: PaymentKind, partyId?: string) {
    const filter: Record<string, unknown> = { orgId };
    if (kind) filter.kind = kind;
    if (partyId && Types.ObjectId.isValid(partyId)) filter.partyId = new Types.ObjectId(partyId);
    return this.paymentModel.find(filter).sort({ date: -1, _id: -1 }).limit(200).lean().exec();
  }

  /** Advances still held, by party. */
  async advances(orgId: string, kind: PaymentKind) {
    const rows = await this.paymentModel
      .aggregate<{ _id: Types.ObjectId; partyName: string; unappliedPaise: number; payments: number }>([
        { $match: { orgId, kind, status: 'posted', unappliedPaise: { $gt: 0 } } },
        { $group: { _id: '$partyId', partyName: { $last: '$partyName' }, unappliedPaise: { $sum: '$unappliedPaise' }, payments: { $sum: 1 } } },
        { $sort: { unappliedPaise: -1 } },
      ])
      .exec();
    return rows.map((r) => ({ partyId: r._id.toString(), partyName: r.partyName, unappliedPaise: r.unappliedPaise, payments: r.payments }));
  }

  /** How a lump sum would most likely be allocated across the party's open documents. */
  async suggest(orgId: string, kind: PaymentKind, partyId: string, amountPaise: number, text?: string | null): Promise<Suggestion> {
    if (!Number.isInteger(amountPaise) || amountPaise < 0) throw new BadRequestException('The amount must be whole paise.');
    const party = await this.party(orgId, kind, partyId);
    const docs =
      kind === 'receipt'
        ? await this.invoiceModel.find({ orgId, customerId: party._id, status: InvoiceStatus.POSTED, foreign: null }).lean().exec()
        : await this.billModel.find({ orgId, vendorId: party._id, status: BillStatus.POSTED, foreign: null }).lean().exec();
    return suggestAllocation(
      amountPaise,
      docs.map((d) => ({
        id: String(d._id),
        number: (kind === 'receipt' ? (d as SalesInvoice).invoiceNumber : (d as PurchaseBill).billNumber) ?? null,
        date: kind === 'receipt' ? (d as SalesInvoice).invoiceDate : (d as PurchaseBill).billDate,
        owedPaise: outstandingPaise(d),
      })),
      text,
    );
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** A bank or cash ledger of this org, by the rule expenses are paid through (gl/money-accounts). */
  private async moneyAccount(orgId: string, kind: PaymentKind, id: string): Promise<LedgerAccountDocument> {
    const pick = kind === 'receipt' ? 'Deposit it to one of your bank or cash accounts.' : 'Pay it from one of your bank or cash accounts.';
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException(pick);
    const account = await this.accountModel.findOne({ _id: id, orgId }).exec();
    if (!account || !isMoneyAccount(account)) throw new BadRequestException(`${account ? `${account.name} is not a bank or cash account. ` : ''}${pick}`);
    if (account.isActive === false) throw new BadRequestException(`${account.name} is deactivated. ${pick}`);
    return account;
  }

  /**
   * Where bank charges are booked: the expense account named Bank Charges,
   * which every chart starts with. There is no system account for them, so
   * an org that renamed or removed it is told how to fix it.
   */
  private async bankChargesAccount(orgId: string): Promise<LedgerAccountDocument> {
    const account = await this.accountModel
      .findOne({ orgId, type: AccountType.EXPENSE, isGroup: { $ne: true }, isActive: { $ne: false }, name: /^\s*bank charges\s*$/i })
      .exec();
    if (!account) {
      throw new BadRequestException('There is no Bank Charges expense account to book the charges to. Add an expense account named Bank Charges in the chart of accounts, or record this without bank charges.');
    }
    return account;
  }

  private async party(orgId: string, kind: PaymentKind, partyId: string) {
    if (!Types.ObjectId.isValid(partyId)) throw new NotFoundException(kind === 'receipt' ? 'Customer not found' : 'Vendor not found');
    const party =
      kind === 'receipt'
        ? await this.customerModel.findOne({ _id: partyId, orgId }, { name: 1 }).lean().exec()
        : await this.vendorModel.findOne({ _id: partyId, orgId }, { name: 1 }).lean().exec();
    if (!party) throw new NotFoundException(kind === 'receipt' ? 'Customer not found' : 'Vendor not found');
    return party;
  }

  private async documents(kind: PaymentKind, orgId: string, ids: string[], session: ClientSession): Promise<Map<string, SettledDoc>> {
    const objectIds = ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    const found: SettledDoc[] =
      kind === 'receipt'
        ? await this.invoiceModel.find({ orgId, _id: { $in: objectIds } }).session(session).exec()
        : await this.billModel.find({ orgId, _id: { $in: objectIds } }).session(session).exec();
    return new Map(found.map((d) => [String(d._id), d]));
  }

  /**
   * Add one share to a document's payments, guarded on what it had paid so
   * far: two payments recorded at once cannot overpay it.
   */
  private async settle(
    kind: PaymentKind,
    orgId: string,
    actorId: string,
    doc: SettledDoc,
    entry: { journalId: Types.ObjectId; amountPaise: number; tdsPaise: number; paidOn: string; bankLineId: string | null },
    session: ClientSession,
  ): Promise<void> {
    const side = SIDE[kind];
    const foreign = (doc as { foreign?: { currency: string } | null }).foreign;
    if (foreign) throw new BadRequestException(`${foreign.currency} documents are paid in their currency, with the rate, from the document itself.`);
    const settled = entry.amountPaise + entry.tdsPaise;
    const paidInFull = settled === outstandingPaise(doc);
    const model = (kind === 'receipt' ? this.invoiceModel : this.billModel) as unknown as Model<SettledDoc>;
    const updated = await model
      .findOneAndUpdate(
        { _id: doc._id, orgId, status: side.open, amountPaidPaise: doc.amountPaidPaise ?? 0 },
        {
          $inc: { amountPaidPaise: settled },
          $push: {
            payments: {
              journalId: entry.journalId,
              amountPaise: entry.amountPaise,
              tdsPaise: entry.tdsPaise,
              paidOn: entry.paidOn,
              bankLineId: entry.bankLineId ? new Types.ObjectId(entry.bankLineId) : null,
            },
          },
          $set: paidInFull ? { status: side.paid, paidBy: actorId } : {},
        },
        { new: true, session },
      )
      .exec();
    if (!updated) throw new BadRequestException(`${number(doc)} changed while this was being recorded. Try again.`);
    await this.audit.record(
      {
        orgId, entityType: side.entity, entityId: String(doc._id), action: paidInFull ? 'PAY' : 'PART_PAY', performedBy: actorId,
        before: { status: doc.status, amountPaidPaise: doc.amountPaidPaise ?? 0 },
        after: { status: updated.status, amountPaidPaise: updated.amountPaidPaise, journalId: entry.journalId.toString(), paidOn: entry.paidOn },
      },
      session,
    );
  }
}

/** Bank or cash, for a chosen money ledger: the system Cash account, or one named like cash. */
function viaOf(a: { systemKey?: string | null; name: string }): 'bank' | 'cash' {
  if (a.systemKey === SystemAccountKey.CASH) return 'cash';
  if (a.systemKey === SystemAccountKey.BANK) return 'bank';
  return /\b(cash|petty|imprest)\b/i.test(a.name) ? 'cash' : 'bank';
}

function ownNumber(doc: SettledDoc): string | null {
  const d = doc as unknown as { invoiceNumber?: string | null; billNumber?: string | null };
  return d.invoiceNumber ?? d.billNumber ?? null;
}

function number(doc: SettledDoc): string {
  const d = doc as unknown as { invoiceNumber?: string | null; billNumber?: string | null; _id: Types.ObjectId };
  return d.invoiceNumber ?? d.billNumber ?? `…${String(d._id).slice(-6)}`;
}
