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
import { withOrg } from '../database/tenant.plugin';

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
 *   - the invoice or bill the voucher settled goes back to unpaid;
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
  ) {}

  async reverse(journalId: string, orgId: string, actorId: string): Promise<JournalDocument> {
    try {
      return await this.posting.inTransaction(async (session) => {
        const id = new Types.ObjectId(journalId);
        await this.refuseWhilePaid(id, orgId, session);

        const reversal = await this.posting.reverse(journalId, actorId, session);

        await this.reopen('SalesInvoice', orgId, actorId, session, 'REVERSE_POSTING',
          { status: InvoiceStatus.DRAFT, journalId: null, postedBy: null },
          (set) => this.invoiceModel
            .findOneAndUpdate({ journalId: id, status: InvoiceStatus.POSTED }, { $set: set }, { session })
            .lean()
            .exec());
        await this.reopen('SalesInvoice', orgId, actorId, session, 'REVERSE_PAYMENT',
          { status: InvoiceStatus.POSTED, paymentJournalId: null, paidBy: null },
          (set) => this.invoiceModel
            .findOneAndUpdate({ paymentJournalId: id, status: InvoiceStatus.PAID }, { $set: set }, { session })
            .lean()
            .exec());
        await this.reopen('PurchaseBill', orgId, actorId, session, 'REVERSE_POSTING',
          { status: BillStatus.DRAFT, journalId: null, postedBy: null },
          (set) => this.billModel
            .findOneAndUpdate({ journalId: id, status: BillStatus.POSTED }, { $set: set }, { session })
            .lean()
            .exec());
        await this.reopen('PurchaseBill', orgId, actorId, session, 'REVERSE_PAYMENT',
          { status: BillStatus.POSTED, paymentJournalId: null, paidBy: null },
          (set) => this.billModel
            .findOneAndUpdate({ paymentJournalId: id, status: BillStatus.PAID }, { $set: set }, { session })
            .lean()
            .exec());

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

  private async refuseWhilePaid(journalId: Types.ObjectId, orgId: string, session: ClientSession): Promise<void> {
    const invoice = await withOrg(orgId, () =>
      this.invoiceModel.findOne({ journalId, status: InvoiceStatus.PAID }).session(session).exec(),
    );
    if (invoice) {
      throw new BadRequestException(
        `Invoice ${invoice.invoiceNumber ?? invoice._id} has been paid — reverse its receipt first, then the sale.`,
      );
    }
    const bill = await withOrg(orgId, () =>
      this.billModel.findOne({ journalId, status: BillStatus.PAID }).session(session).exec(),
    );
    if (bill) {
      throw new BadRequestException(
        `Bill ${bill.billNumber ?? bill._id} has been paid — reverse its payment first, then the purchase.`,
      );
    }
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
