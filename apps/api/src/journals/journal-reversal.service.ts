import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BillStatus, InvoiceStatus, MatchStatus } from '@ai-accounting/shared';
import { PostingService } from '../gl/posting.service';
import { AuditService } from '../gl/audit.service';
import { JournalDocument } from '../gl/schemas/journal.schema';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { BankStatementLine, BankStatementLineDocument } from '../banking/schemas/bank-statement-line.schema';
import { CreditNote, CreditNoteDocument } from '../sales/schemas/credit-note.schema';
import { DebitNote, DebitNoteDocument } from '../purchase/schemas/debit-note.schema';
import { TdsDeposit, TdsDepositDocument } from '../tds/schemas/tds-deposit.schema';
import { withOrg } from '../database/tenant.plugin';

/** An invoice or bill as a reversal of one of its payments or notes reads it. */
interface SettledDocument {
  _id: unknown;
  status: string;
  amountPaidPaise?: number;
  adjustedPaise?: number;
  payments?: Array<{ journalId: unknown; amountPaise: number; tdsPaise?: number }>;
  adjustments?: Array<{ journalId: unknown; amountPaise: number; tdsPaise?: number }>;
}

/**
 * Reversing a voucher, with everything that points at it brought into line.
 *
 * The ledger reversal is PostingService's; this keeps the sub-ledgers and bank
 * reconciliation agreeing with it. Reversing a sale used to leave its invoice
 * "paid" or "posted", so ageing, GST registers and bank matching still counted
 * a sale the ledger had cancelled. All of it commits in one transaction:
 *
 *   - the invoice or bill the voucher posted goes back to draft — refused
 *     while it is paid, since its receipt or payment would then point at
 *     nothing (reverse that first);
 *   - a receipt, payment, credit note or debit note comes back off the
 *     invoice or bill it settled or adjusted — just that one;
 *   - a bank line confirmed against the voucher goes back to unmatched.
 */
@Injectable()
export class JournalReversalService {
  constructor(
    private posting: PostingService,
    private audit: AuditService,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(BankStatementLine.name) private lineModel: Model<BankStatementLineDocument>,
    @InjectModel(CreditNote.name) private creditNoteModel: Model<CreditNoteDocument>,
    @InjectModel(DebitNote.name) private debitNoteModel: Model<DebitNoteDocument>,
    @InjectModel(TdsDeposit.name) private depositModel: Model<TdsDepositDocument>,
  ) {}

  async reverse(journalId: string, orgId: string, actorId: string): Promise<JournalDocument> {
    try {
      return await this.posting.inTransaction(async (session) => {
        const id = new Types.ObjectId(journalId);
        await this.refuseWhilePaid(id, orgId, session);

        const reversal = await this.posting.reverse(journalId, actorId, session);

        // Opening balances imported with this entry go with it: they have no
        // posting of their own, so sending them back to draft would let one be
        // posted as a fresh sale. (A paid one has already been refused above.)
        await this.removeOpeningDocuments(id, orgId, actorId, session);

        await this.reopen('SalesInvoice', orgId, actorId, session, 'REVERSE_POSTING',
          { status: InvoiceStatus.DRAFT, journalId: null, postedBy: null },
          (set) => this.invoiceModel
            .findOneAndUpdate({ journalId: id, status: InvoiceStatus.POSTED }, { $set: set }, { session })
            .lean()
            .exec());
        await this.reopen('PurchaseBill', orgId, actorId, session, 'REVERSE_POSTING',
          { status: BillStatus.DRAFT, journalId: null, postedBy: null },
          (set) => this.billModel
            .findOneAndUpdate({ journalId: id, status: BillStatus.POSTED }, { $set: set }, { session })
            .lean()
            .exec());
        // A receipt or payment, or a credit or debit note: take that one back off
        // the invoice or bill it settled or adjusted.
        for (const [field, amountField] of [['payments', 'amountPaidPaise'], ['adjustments', 'adjustedPaise']] as const) {
          const entryKey = `${field}.journalId`;
          // A receipt's settled amount includes TDS the customer deducted; a
          // debit note's TDS share goes back onto the bill's deduction.
          const undo = (status: string, entry: { amountPaise: number; tdsPaise?: number }) => ({
            $pull: { [field]: { journalId: id } },
            $inc:
              field === 'payments'
                ? { [amountField]: -(entry.amountPaise + (entry.tdsPaise ?? 0)) }
                : { [amountField]: -entry.amountPaise, ...(entry.tdsPaise ? { 'tds.amountPaise': entry.tdsPaise } : {}) },
            $set: field === 'payments' ? { status, paidBy: null } : { status },
          });
          await this.takeBack('SalesInvoice', field, InvoiceStatus.POSTED, id, orgId, actorId, session,
            () => this.invoiceModel.findOne({ [entryKey]: id }).session(session).lean().exec(),
            (docId, entry) => this.invoiceModel
              .updateOne({ _id: docId, [entryKey]: id }, undo(InvoiceStatus.POSTED, entry), { session })
              .exec());
          await this.takeBack('PurchaseBill', field, BillStatus.POSTED, id, orgId, actorId, session,
            () => this.billModel.findOne({ [entryKey]: id }).session(session).lean().exec(),
            (docId, entry) => this.billModel
              .updateOne({ _id: docId, [entryKey]: id }, undo(BillStatus.POSTED, entry), { session })
              .exec());
        }
        // A TDS deposit reversed: its bills' TDS is undeposited again.
        const deposit = await withOrg(orgId, () =>
          this.depositModel.findOneAndUpdate({ journalId: id, status: 'posted' }, { $set: { status: 'reversed' } }, { session }).exec(),
        );
        if (deposit) {
          await withOrg(orgId, () =>
            this.billModel
              .updateMany({ 'tds.depositId': deposit._id }, { $set: { 'tds.depositId': null } }, { session })
              .exec(),
          );
          await this.audit.record(
            {
              orgId,
              entityType: 'TdsDeposit',
              entityId: String(deposit._id),
              action: 'REVERSE',
              performedBy: actorId,
              before: { status: 'posted' },
              after: { status: 'reversed', reversedJournalId: String(id) },
            },
            session,
          );
        }

        // The note itself is kept, marked reversed — it was issued, then cancelled.
        await withOrg(orgId, () =>
          this.creditNoteModel.updateOne({ journalId: id }, { $set: { status: 'reversed' } }, { session }).exec(),
        );
        await withOrg(orgId, () =>
          this.debitNoteModel.updateOne({ journalId: id }, { $set: { status: 'reversed' } }, { session }).exec(),
        );

        const lines = await withOrg(orgId, () =>
          this.lineModel.find({ matchedJournalId: id, matchStatus: MatchStatus.CONFIRMED }).session(session).exec(),
        );
        for (const line of lines) {
          await this.reopen('BankStatementLine', orgId, actorId, session, 'UNMATCH_REVERSED',
            { matchStatus: MatchStatus.UNMATCHED, matchedJournalId: null, matchedInvoiceId: null, matchedBillId: null },
            (set) => this.lineModel
              .findOneAndUpdate({ _id: line._id, matchStatus: MatchStatus.CONFIRMED }, { $set: set }, { session })
              .lean()
              .exec());
        }

        return reversal;
      });
    } catch (err: unknown) {
      if ((err as { code?: number } | null)?.code === 11000) {
        throw new BadRequestException('This voucher has already been reversed.');
      }
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * A sale or purchase with any payment or note against it cannot be undone
   * underneath them.
   */
  private async removeOpeningDocuments(journalId: Types.ObjectId, orgId: string, actorId: string, session: ClientSession): Promise<void> {
    const filter = { orgId, journalId, isOpeningBalance: true };
    const [invoices, bills] = await Promise.all([
      this.invoiceModel.find(filter).session(session).lean().exec(),
      this.billModel.find(filter).session(session).lean().exec(),
    ]);
    for (const [entityType, docs] of [['SalesInvoice', invoices], ['PurchaseBill', bills]] as const) {
      for (const doc of docs) {
        await this.audit.record(
          { orgId, entityType, entityId: doc._id.toString(), action: 'DELETE', performedBy: actorId, before: { status: doc.status, isOpeningBalance: true, totalPaise: doc.amountsPaise.total } },
          session,
        );
      }
    }
    if (invoices.length) await this.invoiceModel.deleteMany(filter, { session }).exec();
    if (bills.length) await this.billModel.deleteMany(filter, { session }).exec();
  }

  private async refuseWhilePaid(journalId: Types.ObjectId, orgId: string, session: ClientSession): Promise<void> {
    const paidAtAll = {
      journalId,
      $or: [{ amountPaidPaise: { $gt: 0 } }, { adjustedPaise: { $gt: 0 } }, { status: 'paid' }],
    };
    const invoice = await withOrg(orgId, () => this.invoiceModel.findOne(paidAtAll).session(session).exec());
    if (invoice) {
      throw new BadRequestException(
        `Invoice ${invoice.invoiceNumber ?? invoice._id} has receipts or credit notes against it — reverse those first, then the sale.`,
      );
    }
    const bill = await withOrg(orgId, () => this.billModel.findOne(paidAtAll).session(session).exec());
    if (bill) {
      throw new BadRequestException(
        `Bill ${bill.billNumber ?? bill._id} has payments or debit notes against it — reverse those first, then the purchase.`,
      );
    }
  }

  /**
   * Reversing a receipt, payment or note takes that one back off the invoice
   * or bill: its amount comes off what was paid or adjusted, and a closed
   * document is open again. The others stand.
   */
  private async takeBack(
    entityType: string,
    field: 'payments' | 'adjustments',
    openStatus: string,
    journalId: Types.ObjectId,
    orgId: string,
    actorId: string,
    session: ClientSession,
    find: () => Promise<SettledDocument | null>,
    update: (docId: unknown, entry: { amountPaise: number; tdsPaise?: number }) => Promise<unknown>,
  ): Promise<void> {
    const doc = await withOrg(orgId, find);
    if (!doc) return;
    const entry = (doc[field] ?? []).find((p) => String(p.journalId) === String(journalId));
    if (!entry) return;

    await withOrg(orgId, () => update(doc._id, entry));
    const amountField = field === 'payments' ? 'amountPaidPaise' : 'adjustedPaise';
    const taken = field === 'payments' ? entry.amountPaise + (entry.tdsPaise ?? 0) : entry.amountPaise;
    await this.audit.record(
      {
        orgId,
        entityType,
        entityId: String(doc._id),
        action: field === 'payments' ? 'REVERSE_PAYMENT' : 'REVERSE_NOTE',
        performedBy: actorId,
        before: { status: doc.status, [amountField]: doc[amountField] ?? 0 },
        after: {
          status: openStatus,
          [amountField]: (doc[amountField] ?? 0) - taken,
          reversedJournalId: String(journalId),
        },
      },
      session,
    );
  }

  /**
   * Run one conditional update (`apply` returns the record as it was, or null
   * when nothing matched) and audit it.
   */
  private async reopen(
    entityType: string,
    orgId: string,
    actorId: string,
    session: ClientSession,
    action: string,
    set: Record<string, unknown>,
    apply: (set: Record<string, unknown>) => Promise<unknown>,
  ): Promise<void> {
    const before = (await withOrg(orgId, () => apply(set))) as Record<string, unknown> | null;
    if (!before) return;
    await this.audit.record(
      {
        orgId,
        entityType,
        entityId: String(before._id),
        action,
        performedBy: actorId,
        before: Object.fromEntries(Object.keys(set).map((k) => [k, before[k] ?? null])),
        after: set,
      },
      session,
    );
  }
}
