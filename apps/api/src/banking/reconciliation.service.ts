import { Injectable, Logger, NotFoundException, BadRequestException, HttpException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BillStatus,
  InvoiceStatus,
  JournalStatus,
  MatchStatus,
  StatementStatus,
  VoucherType,
} from '@ai-accounting/shared';
import { BankAccount, BankAccountDocument } from './schemas/bank-account.schema';
import { BankStatement, BankStatementDocument } from './schemas/bank-statement.schema';
import { BankStatementLine, BankStatementLineDocument } from './schemas/bank-statement-line.schema';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { PostingService } from '../gl/posting.service';
import { AuditService } from '../gl/audit.service';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { formatVoucherNumber } from '../journals/journals.service';
import { withOrg } from '../database/tenant.plugin';
import { outstandingPaise } from '../gl/schemas/settlement.schema';

export interface CreateBankAccountInput {
  orgId: string;
  actorId?: string;
  name: string;
  accountNumber?: string | null;
  bankName?: string | null;
  ifsc?: string | null;
  openingBalancePaise?: number;
  openingBalanceDate?: string | null;
}

export interface ImportStatementInput {
  orgId: string;
  /** Who imported it; absent when the upload worker imports a spreadsheet. */
  actorId?: string;
  bankAccountId: string;
  periodStart: string;
  periodEnd: string;
  openingBalancePaise: number;
  closingBalancePaise: number;
  lines: Array<{
    date: string;
    description: string;
    reference?: string | null;
    debitPaise: number;
    creditPaise: number;
    runningBalancePaise?: number | null;
  }>;
}

/** What a bank line can be matched to by hand — exactly one of these. */
export interface ManualMatchTarget {
  journalId?: string;
  invoiceId?: string;
  billId?: string;
}

export interface DiffReport {
  bankAccountId: string;
  statementId: string;
  periodStart: string;
  periodEnd: string;
  openingBalancePaise: number;
  closingBalancePaise: number;
  /**
   * The statement's opening balance plus every line whose movement is already
   * in the books — confirmed, or matched to a posted receipt or payment.
   */
  glBalancePaise: number;
  /** Bank closing balance − GL balance: money the books do not have yet. */
  differencePaise: number;
  totalLines: number;
  matchedLines: number;
  unmatchedLines: number;
  unmatchedAmountPaise: number;
  /** Lines matched to an invoice or bill that will post when confirmed. */
  pendingSettlements: number;
  possibleDuplicates: number;
  excludedLines: number;
  isReconciled: boolean;
  lines: Array<{
    id: string;
    date: string;
    description: string;
    reference: string | null;
    debitPaise: number;
    creditPaise: number;
    matchStatus: MatchStatus;
    matchedJournalId: string | null;
    matchedInvoiceId: string | null;
    matchedBillId: string | null;
    /** What the line is matched to, in words — e.g. "Invoice KT/001 · Sharma Textiles". */
    matchLabel: string | null;
    possibleDuplicate: boolean;
    excluded: boolean;
  }>;
}

export interface ConfirmResult {
  confirmed: number;
  /** Lines that could not be confirmed, with the reason — e.g. invoice already paid by hand. */
  failed: Array<{ lineId: string; reason: string }>;
}

/** ±3 days between a bank line and the voucher that records it. */
const MATCH_DATE_WINDOW_MS = 3 * 86_400_000;
const DAY_MS = 86_400_000;

/** Letters and digits only, so "KT/26-27/001" is found in "NEFT CR … KT2627001". */
function refKey(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Same date, amount and narration (and reference, if any) → same bank transaction. */
function duplicateKey(l: { date: string; debitPaise: number; creditPaise: number; description: string; reference?: string | null }): string {
  return [l.date, l.debitPaise, l.creditPaise, l.description.toLowerCase().replace(/\s+/g, ' ').trim(), l.reference ?? ''].join('|');
}

function lineAmount(l: { debitPaise: number; creditPaise: number }): number {
  return l.debitPaise > 0 ? l.debitPaise : l.creditPaise;
}

function journalTotal(j: JournalDocument): number {
  return j.lines.reduce((s, l) => s + l.creditPaise, 0);
}

function messageOf(err: unknown): string {
  if (err instanceof HttpException) return err.message;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Bank reconciliation: match each bank line to what records it in the books,
 * and post the ones the books do not have yet.
 *
 * A line is matched to one of:
 *   - a receipt or payment already posted (money that was recorded by hand), or
 *   - an open sales invoice (money in) or purchase bill (money out).
 *
 * Matching only suggests. "Confirm matches" is the human step that commits:
 * an invoice match posts Dr Bank / Cr Accounts Receivable dated the day the
 * money arrived and marks the invoice paid, in one transaction with the line.
 * It used to match bank lines to sales and purchase journals — which never
 * touch the bank — and post nothing, so a "reconciled" statement left the
 * receivable owed and the bank balance unchanged.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @InjectModel(BankAccount.name) private accountModel: Model<BankAccountDocument>,
    @InjectModel(BankStatement.name) private statementModel: Model<BankStatementDocument>,
    @InjectModel(BankStatementLine.name) private lineModel: Model<BankStatementLineDocument>,
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    private postingService: PostingService,
    private auditService: AuditService,
    private salesInvoices: SalesInvoicesService,
    private purchaseBills: PurchaseBillsService,
  ) {}

  // ── Bank account ─────────────────────────────────────────────────────────

  async createAccount(input: CreateBankAccountInput): Promise<BankAccountDocument> {
    const account = await this.accountModel.create({
      orgId: input.orgId,
      name: input.name,
      accountNumber: input.accountNumber ?? null,
      bankName: input.bankName ?? null,
      ifsc: input.ifsc ?? null,
      openingBalancePaise: input.openingBalancePaise ?? 0,
      openingBalanceDate: input.openingBalanceDate ?? null,
    });
    await this.auditService.record({
      orgId: input.orgId,
      entityType: 'BankAccount',
      entityId: account._id.toString(),
      action: 'CREATE',
      performedBy: input.actorId ?? 'system:ingest',
      after: { name: account.name, openingBalancePaise: account.openingBalancePaise },
    });
    return account;
  }

  async listAccounts(orgId: string): Promise<BankAccountDocument[]> {
    return withOrg(orgId, () => this.accountModel.find().sort({ name: 1 }).exec());
  }

  // ── Statement import ──────────────────────────────────────────────────────

  async importStatement(input: ImportStatementInput): Promise<BankStatementDocument> {
    const account = await withOrg(input.orgId, () =>
      this.accountModel.findById(input.bankAccountId).exec(),
    );
    if (!account) throw new NotFoundException('Bank account not found');

    const statement = await this.statementModel.create({
      orgId: input.orgId,
      bankAccountId: new Types.ObjectId(input.bankAccountId),
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      openingBalancePaise: input.openingBalancePaise,
      closingBalancePaise: input.closingBalancePaise,
      status: StatementStatus.PENDING,
      totalLines: input.lines.length,
      matchedLines: 0,
    });

    // Lines already on this account in the same dates — an overlapping
    // statement imported twice would otherwise double every movement in it.
    const dates = input.lines.map((l) => l.date).sort();
    const earlier = dates.length
      ? await withOrg(input.orgId, () =>
          this.lineModel
            .find({
              bankAccountId: account._id,
              statementId: { $ne: statement._id },
              date: { $gte: dates[0], $lte: dates[dates.length - 1] },
            })
            .exec(),
        )
      : [];
    const seen = new Set(earlier.map(duplicateKey));

    let duplicates = 0;
    const docs = input.lines.map((l) => {
      const key = duplicateKey(l);
      const possibleDuplicate = seen.has(key);
      if (possibleDuplicate) duplicates++;
      seen.add(key);
      return {
        orgId: input.orgId,
        statementId: statement._id,
        bankAccountId: new Types.ObjectId(input.bankAccountId),
        date: l.date,
        description: l.description,
        reference: l.reference ?? null,
        debitPaise: l.debitPaise,
        creditPaise: l.creditPaise,
        runningBalancePaise: l.runningBalancePaise ?? null,
        matchStatus: MatchStatus.UNMATCHED,
        matchedJournalId: null,
        possibleDuplicate,
      };
    });
    await this.lineModel.insertMany(docs);

    await this.auditService.record({
      orgId: input.orgId,
      entityType: 'BankStatement',
      entityId: statement._id.toString(),
      action: 'IMPORT',
      performedBy: input.actorId ?? 'system:ingest',
      after: { periodStart: input.periodStart, periodEnd: input.periodEnd, lines: input.lines.length },
      meta: { possibleDuplicates: duplicates },
    });

    this.logger.log(
      `Imported statement ${statement._id} with ${input.lines.length} lines (${duplicates} possible duplicates)`,
    );
    return statement;
  }

  // ── Auto-match ────────────────────────────────────────────────────────────

  /**
   * Suggest a match for each unmatched line: first a receipt or payment already
   * in the books (same amount, within 3 days), else an open invoice or bill for
   * exactly that amount — the one whose number appears in the bank narration,
   * or the only candidate. Nothing is posted until the matches are confirmed.
   */
  async autoMatch(
    statementId: string,
    orgId: string,
    actorId?: string,
  ): Promise<{ matched: number; unmatched: number }> {
    const statement = await withOrg(orgId, () => this.statementModel.findById(statementId).exec());
    if (!statement) throw new NotFoundException('Statement not found');

    const lines = await withOrg(orgId, () =>
      this.lineModel
        .find({
          statementId: statement._id,
          matchStatus: MatchStatus.UNMATCHED,
          excluded: { $ne: true },
          possibleDuplicate: { $ne: true },
        })
        .sort({ date: 1 })
        .exec(),
    );

    // One voucher, invoice or bill records one bank movement. Anything another
    // line already points at — on any statement — is off the table; the old
    // matcher forgot its previous runs and paired a duplicate deposit with the
    // same sale twice.
    const taken = await withOrg(orgId, () =>
      this.lineModel
        .find({ matchStatus: { $ne: MatchStatus.UNMATCHED } })
        .select('matchedJournalId matchedInvoiceId matchedBillId')
        .lean()
        .exec(),
    );
    const takenIds = new Set(
      taken.flatMap((t) => [t.matchedJournalId, t.matchedInvoiceId, t.matchedBillId]).filter(Boolean).map(String),
    );

    const from = new Date(new Date(statement.periodStart).getTime() - MATCH_DATE_WINDOW_MS).toISOString().slice(0, 10);
    const to = new Date(new Date(statement.periodEnd).getTime() + MATCH_DATE_WINDOW_MS).toISOString().slice(0, 10);
    const vouchers = await withOrg(orgId, () =>
      this.journalModel
        .find({
          voucherType: { $in: [VoucherType.RECEIPT, VoucherType.PAYMENT] },
          status: JournalStatus.POSTED,
          reversalOf: { $exists: false },
          date: { $gte: from, $lte: to },
        })
        .exec(),
    );
    // A voucher that has been reversed no longer records anything.
    const reversed = new Set(
      (
        await withOrg(orgId, () =>
          this.journalModel.find({ reversalOf: { $in: vouchers.map((v) => v._id) } }).select('reversalOf').lean().exec(),
        )
      ).map((r) => String(r.reversalOf)),
    );
    const openInvoices = await withOrg(orgId, () =>
      this.invoiceModel.find({ status: InvoiceStatus.POSTED }).exec(),
    );
    const openBills = await withOrg(orgId, () => this.billModel.find({ status: BillStatus.POSTED }).exec());

    let matched = 0;
    for (const line of lines) {
      const moneyIn = line.creditPaise > 0;
      const amount = lineAmount(line);
      const lineTime = new Date(line.date).getTime();

      // 1. A receipt or payment already posted, closest date first.
      const voucher = vouchers
        .filter(
          (v) =>
            !takenIds.has(String(v._id)) &&
            !reversed.has(String(v._id)) &&
            v.voucherType === (moneyIn ? VoucherType.RECEIPT : VoucherType.PAYMENT) &&
            journalTotal(v) === amount &&
            Math.abs(new Date(v.date).getTime() - lineTime) <= MATCH_DATE_WINDOW_MS,
        )
        .sort((a, b) => Math.abs(new Date(a.date).getTime() - lineTime) - Math.abs(new Date(b.date).getTime() - lineTime))[0];

      let set: Record<string, unknown> | null = null;
      if (voucher) {
        set = { matchedJournalId: voucher._id };
        takenIds.add(String(voucher._id));
      } else {
        // 2. An open invoice or bill owing exactly this amount, dated on or before the money moved.
        // Exactly what is still owed — auto-matching never guesses a part payment.
        const candidates = (moneyIn
          ? openInvoices.map((i) => ({ id: i._id, number: i.invoiceNumber, date: i.invoiceDate, owed: outstandingPaise(i) }))
          : openBills.map((b) => ({ id: b._id, number: b.billNumber, date: b.billDate, owed: outstandingPaise(b) }))
        ).filter((c) => !takenIds.has(String(c.id)) && c.owed === amount && c.date <= line.date);

        const narration = refKey(`${line.description} ${line.reference ?? ''}`);
        const byReference = candidates.filter((c) => refKey(c.number).length >= 4 && narration.includes(refKey(c.number)));
        const pick = byReference.length === 1 ? byReference[0] : byReference.length === 0 && candidates.length === 1 ? candidates[0] : null;

        if (pick) {
          set = moneyIn ? { matchedInvoiceId: pick.id } : { matchedBillId: pick.id };
          takenIds.add(String(pick.id));
        }
      }

      if (set) {
        const res = await withOrg(orgId, () =>
          this.lineModel
            .updateOne({ _id: line._id, matchStatus: MatchStatus.UNMATCHED }, { $set: { ...set, matchStatus: MatchStatus.AUTO_MATCHED } })
            .exec(),
        );
        if (res.modifiedCount === 1) matched++;
      }
    }

    await this.refreshCounts(statement._id, orgId);
    await this.auditService.record({
      orgId,
      entityType: 'BankStatement',
      entityId: statement._id.toString(),
      action: 'AUTO_MATCH',
      performedBy: actorId ?? 'system',
      meta: { matched, considered: lines.length },
    });

    this.logger.log(`autoMatch: ${matched} new matches for statement ${statementId}`);
    return { matched, unmatched: lines.length - matched };
  }

  // ── Confirm ───────────────────────────────────────────────────────────────

  /**
   * Commit every suggested and manual match on the statement. A line matched to
   * an invoice or bill posts its receipt or payment, dated the day the money
   * moved, and the line, the voucher, the invoice's status and the audit row
   * commit together. Each line stands alone: one that cannot be confirmed —
   * say the invoice was paid by hand meanwhile — is reported, not fatal.
   */
  async confirmMatches(statementId: string, orgId: string, actorId: string): Promise<ConfirmResult> {
    const statement = await withOrg(orgId, () => this.statementModel.findById(statementId).exec());
    if (!statement) throw new NotFoundException('Statement not found');

    const lines = await withOrg(orgId, () =>
      this.lineModel
        .find({
          statementId: statement._id,
          matchStatus: { $in: [MatchStatus.AUTO_MATCHED, MatchStatus.MANUALLY_MATCHED] },
          excluded: { $ne: true },
        })
        .sort({ date: 1 })
        .exec(),
    );

    let confirmed = 0;
    const failed: ConfirmResult['failed'] = [];

    for (const line of lines) {
      try {
        await this.postingService.inTransaction(async (session) => {
          let journalId = line.matchedJournalId;
          if (line.matchedInvoiceId) {
            const { receipt } = await this.salesInvoices.settleWithin(
              session, String(line.matchedInvoiceId), orgId, actorId,
              { paidOn: line.date, amountPaise: lineAmount(line), bankLineId: line._id.toString() },
            );
            journalId = receipt._id;
          } else if (line.matchedBillId) {
            const { payment } = await this.purchaseBills.settleWithin(
              session, String(line.matchedBillId), orgId, actorId,
              { paidOn: line.date, amountPaise: lineAmount(line), bankLineId: line._id.toString() },
            );
            journalId = payment._id;
          }

          const res = await withOrg(orgId, () =>
            this.lineModel
              .updateOne(
                { _id: line._id, matchStatus: line.matchStatus },
                { $set: { matchStatus: MatchStatus.CONFIRMED, matchedJournalId: journalId } },
                { session },
              )
              .exec(),
          );
          if (res.modifiedCount !== 1) throw new BadRequestException('This line changed while it was being confirmed');

          await this.auditService.record(
            {
              orgId,
              entityType: 'BankStatementLine',
              entityId: line._id.toString(),
              action: 'CONFIRM_MATCH',
              performedBy: actorId,
              before: { matchStatus: line.matchStatus },
              after: { matchStatus: MatchStatus.CONFIRMED, matchedJournalId: String(journalId) },
            },
            session,
          );
        });
        confirmed++;
      } catch (err) {
        failed.push({ lineId: line._id.toString(), reason: messageOf(err) });
      }
    }

    await this.refreshCounts(statement._id, orgId);
    this.logger.log(`confirmMatches: ${confirmed} confirmed, ${failed.length} failed for statement ${statementId}`);
    return { confirmed, failed };
  }

  // ── Manual decisions on one line ───────────────────────────────────────────

  /** Match a line by hand to a posted voucher, an open invoice (money in) or an open bill (money out). */
  async manualMatch(
    bankLineId: string,
    target: ManualMatchTarget,
    orgId: string,
    actorId: string,
  ): Promise<BankStatementLineDocument> {
    const line = await this.findOpenLine(bankLineId, orgId);
    const given = [target.journalId, target.invoiceId, target.billId].filter(Boolean);
    if (given.length !== 1) {
      throw new BadRequestException('Match the line to exactly one of: a voucher, an invoice or a bill');
    }
    const amount = lineAmount(line);
    const moneyIn = line.creditPaise > 0;
    let set: Record<string, unknown>;
    let label: string;

    if (target.journalId) {
      const journal = await withOrg(orgId, () => this.journalModel.findById(target.journalId).exec());
      if (!journal || journal.status !== JournalStatus.POSTED) throw new NotFoundException('Voucher not found');
      if (journalTotal(journal) !== amount) {
        throw new BadRequestException(`The voucher is for ${rupees(journalTotal(journal))} but the bank line is ${rupees(amount)}`);
      }
      set = { matchedJournalId: journal._id };
      label = formatVoucherNumber(journal.voucherType, journal.financialYear, journal.voucherNumber);
    } else if (target.invoiceId) {
      if (!moneyIn) throw new BadRequestException('Only money coming in can settle a sales invoice');
      const invoice = await withOrg(orgId, () => this.invoiceModel.findById(target.invoiceId).exec());
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status !== InvoiceStatus.POSTED) {
        throw new BadRequestException(`Only a posted, unpaid invoice can be settled (this one is ${invoice.status})`);
      }
      await this.requireRoomFor(invoice._id, outstandingPaise(invoice), amount, line._id, orgId, 'invoice');
      set = { matchedInvoiceId: invoice._id };
      label = `Invoice ${invoice.invoiceNumber ?? invoice._id}`;
    } else {
      if (moneyIn) throw new BadRequestException('Only money going out can settle a purchase bill');
      const bill = await withOrg(orgId, () => this.billModel.findById(target.billId).exec());
      if (!bill) throw new NotFoundException('Bill not found');
      if (bill.status !== BillStatus.POSTED) {
        throw new BadRequestException(`Only a posted, unpaid bill can be settled (this one is ${bill.status})`);
      }
      await this.requireRoomFor(bill._id, outstandingPaise(bill), amount, line._id, orgId, 'bill');
      set = { matchedBillId: bill._id };
      label = `Bill ${bill.billNumber ?? bill._id}`;
    }

    // A voucher records one bank movement. An invoice or bill can take several
    // (part payments) — requireRoomFor has already checked they fit.
    if (target.journalId) {
      const clash = await withOrg(orgId, () =>
        this.lineModel
          .exists({ _id: { $ne: line._id }, matchStatus: { $ne: MatchStatus.UNMATCHED }, matchedJournalId: set.matchedJournalId })
          .exec(),
      );
      if (clash) throw new BadRequestException(`${label} is already matched to another bank line`);
    }

    const updated = await withOrg(orgId, () =>
      this.lineModel
        .findOneAndUpdate(
          { _id: line._id, matchStatus: { $ne: MatchStatus.CONFIRMED } },
          {
            $set: {
              matchedJournalId: null,
              matchedInvoiceId: null,
              matchedBillId: null,
              ...set,
              matchStatus: MatchStatus.MANUALLY_MATCHED,
              possibleDuplicate: false,
            },
          },
          { new: true },
        )
        .exec(),
    );
    if (!updated) throw new BadRequestException('This line is already confirmed');

    await this.auditService.record({
      orgId,
      entityType: 'BankStatementLine',
      entityId: line._id.toString(),
      action: 'MATCH',
      performedBy: actorId,
      before: { matchStatus: line.matchStatus },
      after: { matchStatus: MatchStatus.MANUALLY_MATCHED, matchedTo: label },
    });
    await this.refreshCounts(line.statementId, orgId);
    return updated;
  }

  /** Undo a suggested or manual match that has not been confirmed. */
  async unmatch(bankLineId: string, orgId: string, actorId: string): Promise<BankStatementLineDocument> {
    const line = await this.findOpenLine(bankLineId, orgId);
    const updated = await this.setLine(line, actorId, 'UNMATCH', {
      matchStatus: MatchStatus.UNMATCHED,
      matchedJournalId: null,
      matchedInvoiceId: null,
      matchedBillId: null,
    });
    await this.refreshCounts(line.statementId, orgId);
    return updated;
  }

  /** Set a line aside (e.g. a duplicate the reviewer has confirmed), or bring it back. */
  async setExcluded(bankLineId: string, excluded: boolean, orgId: string, actorId: string): Promise<BankStatementLineDocument> {
    const line = await this.findOpenLine(bankLineId, orgId);
    const updated = await this.setLine(line, actorId, excluded ? 'EXCLUDE' : 'INCLUDE', {
      excluded,
      matchStatus: MatchStatus.UNMATCHED,
      matchedJournalId: null,
      matchedInvoiceId: null,
      matchedBillId: null,
    });
    await this.refreshCounts(line.statementId, orgId);
    return updated;
  }

  /** The reviewer says a flagged line is a genuine, separate transaction. */
  async clearDuplicateFlag(bankLineId: string, orgId: string, actorId: string): Promise<BankStatementLineDocument> {
    const line = await this.findOpenLine(bankLineId, orgId);
    return this.setLine(line, actorId, 'NOT_DUPLICATE', { possibleDuplicate: false });
  }

  // ── Diff report ───────────────────────────────────────────────────────────

  async getDiffReport(statementId: string, orgId: string): Promise<DiffReport> {
    const statement = await withOrg(orgId, () => this.statementModel.findById(statementId).exec());
    if (!statement) throw new NotFoundException('Statement not found');

    const allLines = await withOrg(orgId, () =>
      this.lineModel.find({ statementId: statement._id }).sort({ date: 1 }).exec(),
    );

    const labels = await this.matchLabels(allLines, orgId);
    const active = allLines.filter((l) => !l.excluded);
    const inBooks = (l: BankStatementLineDocument) =>
      l.matchStatus === MatchStatus.CONFIRMED ||
      ((l.matchStatus === MatchStatus.AUTO_MATCHED || l.matchStatus === MatchStatus.MANUALLY_MATCHED) && !!l.matchedJournalId);
    const unmatched = active.filter((l) => l.matchStatus === MatchStatus.UNMATCHED);
    const pending = active.filter((l) => !inBooks(l) && l.matchStatus !== MatchStatus.UNMATCHED);

    const glBalancePaise =
      statement.openingBalancePaise +
      active.filter(inBooks).reduce((s, l) => s + l.creditPaise - l.debitPaise, 0);
    const differencePaise = statement.closingBalancePaise - glBalancePaise;

    return {
      bankAccountId: statement.bankAccountId.toString(),
      statementId: statement._id.toString(),
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      openingBalancePaise: statement.openingBalancePaise,
      closingBalancePaise: statement.closingBalancePaise,
      glBalancePaise,
      differencePaise,
      totalLines: allLines.length,
      matchedLines: active.length - unmatched.length,
      unmatchedLines: unmatched.length,
      unmatchedAmountPaise: unmatched.reduce((s, l) => s + l.creditPaise - l.debitPaise, 0),
      pendingSettlements: pending.length,
      possibleDuplicates: active.filter((l) => l.possibleDuplicate).length,
      excludedLines: allLines.length - active.length,
      isReconciled: differencePaise === 0 && unmatched.length === 0 && pending.length === 0,
      lines: allLines.map((l) => ({
        id: l._id.toString(),
        date: l.date,
        description: l.description,
        reference: l.reference,
        debitPaise: l.debitPaise,
        creditPaise: l.creditPaise,
        matchStatus: l.matchStatus,
        matchedJournalId: l.matchedJournalId?.toString() ?? null,
        matchedInvoiceId: l.matchedInvoiceId?.toString() ?? null,
        matchedBillId: l.matchedBillId?.toString() ?? null,
        matchLabel: labels.get(l._id.toString()) ?? null,
        possibleDuplicate: !!l.possibleDuplicate,
        excluded: !!l.excluded,
      })),
    };
  }

  async listStatements(orgId: string, bankAccountId?: string): Promise<BankStatementDocument[]> {
    const filter = bankAccountId ? { bankAccountId: new Types.ObjectId(bankAccountId) } : {};
    return withOrg(orgId, () =>
      this.statementModel.find(filter).sort({ periodStart: -1 }).exec(),
    );
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async findOpenLine(bankLineId: string, orgId: string): Promise<BankStatementLineDocument> {
    const line = await withOrg(orgId, () => this.lineModel.findById(bankLineId).exec());
    if (!line) throw new NotFoundException('Bank statement line not found');
    if (line.matchStatus === MatchStatus.CONFIRMED) {
      throw new BadRequestException(
        'This line is confirmed and its entry is in the ledger — reverse that voucher to undo it',
      );
    }
    return line;
  }

  private async setLine(
    line: BankStatementLineDocument,
    actorId: string,
    action: string,
    set: Record<string, unknown>,
  ): Promise<BankStatementLineDocument> {
    const updated = await withOrg(line.orgId, () =>
      this.lineModel
        .findOneAndUpdate({ _id: line._id, matchStatus: { $ne: MatchStatus.CONFIRMED } }, { $set: set }, { new: true })
        .exec(),
    );
    if (!updated) throw new BadRequestException('This line was confirmed in the meantime');
    await this.auditService.record({
      orgId: line.orgId,
      entityType: 'BankStatementLine',
      entityId: line._id.toString(),
      action,
      performedBy: actorId,
      before: { matchStatus: line.matchStatus, excluded: line.excluded, possibleDuplicate: line.possibleDuplicate },
      after: set,
    });
    return updated;
  }

  /**
   * A bank line may settle part of an invoice or bill, and several lines may
   * settle one between them — but never more than is owed, counting other
   * lines already matched to it and waiting to be confirmed.
   */
  private async requireRoomFor(
    targetId: Types.ObjectId,
    owedPaise: number,
    amountPaise: number,
    lineId: Types.ObjectId,
    orgId: string,
    kind: 'invoice' | 'bill',
  ): Promise<void> {
    const field = kind === 'invoice' ? 'matchedInvoiceId' : 'matchedBillId';
    const pendingLines = await withOrg(orgId, () =>
      this.lineModel
        .find({
          _id: { $ne: lineId },
          [field]: targetId,
          matchStatus: { $in: [MatchStatus.AUTO_MATCHED, MatchStatus.MANUALLY_MATCHED] },
        })
        .exec(),
    );
    const pending = pendingLines.reduce((s, l) => s + lineAmount(l), 0);
    const room = owedPaise - pending;
    if (amountPaise > room) {
      throw new BadRequestException(
        `The ${kind} has ${rupees(room)} left to settle` +
          (pending > 0 ? ` (${rupees(pending)} is already matched from other lines)` : '') +
          `, but the bank line is ${rupees(amountPaise)}`,
      );
    }
  }

  private async refreshCounts(statementId: Types.ObjectId, orgId: string): Promise<void> {
    const lines = await withOrg(orgId, () =>
      this.lineModel.find({ statementId }).select('matchStatus excluded').lean().exec(),
    );
    const active = lines.filter((l) => !l.excluded);
    const matchedLines = active.filter((l) => l.matchStatus !== MatchStatus.UNMATCHED).length;
    const allConfirmed = active.every((l) => l.matchStatus === MatchStatus.CONFIRMED);
    await withOrg(orgId, () =>
      this.statementModel
        .updateOne(
          { _id: statementId },
          { $set: { matchedLines, status: allConfirmed ? StatementStatus.RECONCILED : StatementStatus.PENDING } },
        )
        .exec(),
    );
  }

  /** line id → what it is matched to, in words. */
  private async matchLabels(lines: BankStatementLineDocument[], orgId: string): Promise<Map<string, string>> {
    const ids = (field: 'matchedJournalId' | 'matchedInvoiceId' | 'matchedBillId') =>
      lines.map((l) => l[field]).filter((v): v is Types.ObjectId => !!v);
    const [journals, invoices, bills] = await Promise.all([
      withOrg(orgId, () => this.journalModel.find({ _id: { $in: ids('matchedJournalId') } }).exec()),
      withOrg(orgId, () => this.invoiceModel.find({ _id: { $in: ids('matchedInvoiceId') } }).exec()),
      withOrg(orgId, () => this.billModel.find({ _id: { $in: ids('matchedBillId') } }).exec()),
    ]);
    const byId = new Map<string, string>();
    for (const j of journals) byId.set(String(j._id), formatVoucherNumber(j.voucherType, j.financialYear, j.voucherNumber));
    for (const i of invoices) byId.set(String(i._id), `Invoice ${i.invoiceNumber ?? i._id}`);
    for (const b of bills) byId.set(String(b._id), `Bill ${b.billNumber ?? b._id}`);

    const labels = new Map<string, string>();
    for (const l of lines) {
      // Prefer the voucher once one exists — after confirm, that is what records the line.
      const id = l.matchedJournalId ?? l.matchedInvoiceId ?? l.matchedBillId;
      const label = id ? byId.get(String(id)) : undefined;
      if (label) labels.set(l._id.toString(), label);
    }
    return labels;
  }
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
