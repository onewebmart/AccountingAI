import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MatchStatus, StatementStatus, VoucherType } from '@ai-accounting/shared';
import { BankAccount, BankAccountDocument } from './schemas/bank-account.schema';
import { BankStatement, BankStatementDocument } from './schemas/bank-statement.schema';
import { BankStatementLine, BankStatementLineDocument } from './schemas/bank-statement-line.schema';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { withOrg } from '../database/tenant.plugin';

export interface CreateBankAccountInput {
  orgId: string;
  name: string;
  accountNumber?: string | null;
  bankName?: string | null;
  ifsc?: string | null;
  openingBalancePaise?: number;
  openingBalanceDate?: string | null;
}

export interface ImportStatementInput {
  orgId: string;
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

export interface DiffReport {
  bankAccountId: string;
  statementId: string;
  periodStart: string;
  periodEnd: string;
  openingBalancePaise: number;
  closingBalancePaise: number;
  /** GL balance = opening + matched receipts - matched payments */
  glBalancePaise: number;
  /** Difference: bank closing balance - GL balance */
  differencePaise: number;
  totalLines: number;
  matchedLines: number;
  unmatchedLines: number;
  unmatchedAmountPaise: number;
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
  }>;
}

/** ±3-day window for auto-matching. */
const MATCH_DATE_WINDOW_MS = 3 * 86_400_000;

/** Bank statement debits (money out) match PAYMENT journals; credits (money in) match RECEIPT journals. */
const BANK_DEBIT_VOUCHER_TYPES = [VoucherType.PAYMENT, VoucherType.PURCHASE];
const BANK_CREDIT_VOUCHER_TYPES = [VoucherType.RECEIPT, VoucherType.SALES];

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @InjectModel(BankAccount.name) private accountModel: Model<BankAccountDocument>,
    @InjectModel(BankStatement.name) private statementModel: Model<BankStatementDocument>,
    @InjectModel(BankStatementLine.name) private lineModel: Model<BankStatementLineDocument>,
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
  ) {}

  // ── Bank account ─────────────────────────────────────────────────────────

  async createAccount(input: CreateBankAccountInput): Promise<BankAccountDocument> {
    return this.accountModel.create({
      orgId: input.orgId,
      name: input.name,
      accountNumber: input.accountNumber ?? null,
      bankName: input.bankName ?? null,
      ifsc: input.ifsc ?? null,
      openingBalancePaise: input.openingBalancePaise ?? 0,
      openingBalanceDate: input.openingBalanceDate ?? null,
    });
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

    await this.lineModel.insertMany(
      input.lines.map((l) => ({
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
      })),
    );

    this.logger.log(`Imported statement ${statement._id} with ${input.lines.length} lines`);
    return statement;
  }

  // ── Auto-match ────────────────────────────────────────────────────────────

  /**
   * Auto-match unmatched bank lines against posted journals by amount + date.
   * - Bank debit (money out) → matches PAYMENT/PURCHASE journals
   * - Bank credit (money in) → matches RECEIPT/SALES journals
   */
  async autoMatch(statementId: string, orgId: string): Promise<{ matched: number; unmatched: number }> {
    const statement = await withOrg(orgId, () =>
      this.statementModel.findById(statementId).exec(),
    );
    if (!statement) throw new NotFoundException('Statement not found');

    const unmatchedLines = await withOrg(orgId, () =>
      this.lineModel.find({ statementId: new Types.ObjectId(statementId), matchStatus: MatchStatus.UNMATCHED }).exec(),
    );

    // Load all unmatched journals (PAYMENT, RECEIPT, PURCHASE, SALES) in the statement period
    const periodStart = new Date(statement.periodStart);
    const periodEnd = new Date(statement.periodEnd);
    // Expand by ±3 days to catch edge cases
    periodStart.setDate(periodStart.getDate() - 3);
    periodEnd.setDate(periodEnd.getDate() + 3);

    const journals = await withOrg(orgId, () =>
      this.journalModel
        .find({
          voucherType: { $in: [...BANK_DEBIT_VOUCHER_TYPES, ...BANK_CREDIT_VOUCHER_TYPES] },
          date: {
            $gte: periodStart.toISOString().slice(0, 10),
            $lte: periodEnd.toISOString().slice(0, 10),
          },
        })
        .exec(),
    );

    // Index journals by id for fast lookup of already-matched ones
    const matchedJournalIds = new Set<string>();

    let matchedCount = 0;

    for (const line of unmatchedLines) {
      const lineDate = new Date(line.date).getTime();
      const isDebit = line.debitPaise > 0;
      const lineAmount = isDebit ? line.debitPaise : line.creditPaise;
      const targetVoucherTypes = isDebit ? BANK_DEBIT_VOUCHER_TYPES : BANK_CREDIT_VOUCHER_TYPES;

      // Find best matching journal: same amount, same side, date ±3 days, not already matched
      const candidate = journals.find((j) => {
        if (matchedJournalIds.has(j._id.toString())) return false;
        if (!targetVoucherTypes.includes(j.voucherType)) return false;

        // Journal total = sum of all credit lines (= sum of debit lines for a balanced journal)
        const journalTotal = j.lines.reduce((s, l) => s + l.creditPaise, 0);
        if (journalTotal !== lineAmount) return false;

        const journalDate = new Date(j.date).getTime();
        return Math.abs(journalDate - lineDate) <= MATCH_DATE_WINDOW_MS;
      });

      if (candidate) {
        await this.lineModel
          .findByIdAndUpdate(line._id, {
            $set: { matchStatus: MatchStatus.AUTO_MATCHED, matchedJournalId: candidate._id },
          })
          .exec();
        matchedJournalIds.add(candidate._id.toString());
        matchedCount++;
      }
    }

    // Update statement counters
    const totalMatched = await this.lineModel
      .countDocuments({
        statementId: new Types.ObjectId(statementId),
        matchStatus: { $in: [MatchStatus.AUTO_MATCHED, MatchStatus.MANUALLY_MATCHED, MatchStatus.CONFIRMED] },
      })
      .exec();

    await this.statementModel
      .findByIdAndUpdate(statementId, { $set: { matchedLines: totalMatched } })
      .exec();

    this.logger.log(`autoMatch: ${matchedCount} new matches for statement ${statementId}`);
    return { matched: matchedCount, unmatched: unmatchedLines.length - matchedCount };
  }

  /**
   * Promote all AUTO_MATCHED lines to CONFIRMED.
   * "Confirm matches" action → chips turn green.
   */
  async confirmMatches(statementId: string, orgId: string): Promise<{ confirmed: number }> {
    const result = await this.lineModel
      .updateMany(
        { statementId: new Types.ObjectId(statementId), matchStatus: MatchStatus.AUTO_MATCHED },
        { $set: { matchStatus: MatchStatus.CONFIRMED } },
      )
      .exec();

    const confirmed = result.modifiedCount;

    // Mark statement reconciled if all lines are now matched
    const unmatched = await this.lineModel
      .countDocuments({ statementId: new Types.ObjectId(statementId), matchStatus: MatchStatus.UNMATCHED })
      .exec();

    if (unmatched === 0) {
      await this.statementModel
        .findByIdAndUpdate(statementId, { $set: { status: StatementStatus.RECONCILED } })
        .exec();
    }

    this.logger.log(`confirmMatches: ${confirmed} lines confirmed for statement ${statementId}`);
    return { confirmed };
  }

  /**
   * Manually match a single bank line to a journal.
   */
  async manualMatch(
    bankLineId: string,
    journalId: string,
    orgId: string,
  ): Promise<BankStatementLineDocument> {
    const line = await withOrg(orgId, () => this.lineModel.findById(bankLineId).exec());
    if (!line) throw new NotFoundException('Bank statement line not found');
    if (line.matchStatus === MatchStatus.CONFIRMED) {
      throw new BadRequestException('Line is already confirmed');
    }

    const journal = await withOrg(orgId, () => this.journalModel.findById(journalId).exec());
    if (!journal) throw new NotFoundException('Journal not found');

    const updated = await this.lineModel
      .findByIdAndUpdate(
        bankLineId,
        { $set: { matchStatus: MatchStatus.MANUALLY_MATCHED, matchedJournalId: new Types.ObjectId(journalId) } },
        { new: true },
      )
      .exec();

    this.logger.log(`manualMatch: line ${bankLineId} → journal ${journalId}`);
    return updated!;
  }

  // ── Diff report ───────────────────────────────────────────────────────────

  /**
   * Produce the reconciliation difference report for a statement.
   *
   * GL balance = bank account opening balance
   *           + Σ credit lines (confirmed/auto_matched receipts → money in)
   *           - Σ debit lines (confirmed/auto_matched payments → money out)
   *
   * Reconciled when: GL balance = bank closing balance.
   */
  async getDiffReport(statementId: string, orgId: string): Promise<DiffReport> {
    const statement = await withOrg(orgId, () =>
      this.statementModel.findById(statementId).exec(),
    );
    if (!statement) throw new NotFoundException('Statement not found');

    const account = await withOrg(orgId, () =>
      this.accountModel.findById(statement.bankAccountId).exec(),
    );
    if (!account) throw new NotFoundException('Bank account not found');

    const allLines = await withOrg(orgId, () =>
      this.lineModel.find({ statementId: new Types.ObjectId(statementId) }).sort({ date: 1 }).exec(),
    );

    const MATCHED_STATUSES: MatchStatus[] = [
      MatchStatus.AUTO_MATCHED,
      MatchStatus.MANUALLY_MATCHED,
      MatchStatus.CONFIRMED,
    ];

    const matchedLines = allLines.filter((l) => MATCHED_STATUSES.includes(l.matchStatus));
    const unmatchedLines = allLines.filter((l) => l.matchStatus === MatchStatus.UNMATCHED);

    // GL balance: opening + matched credits (money in) - matched debits (money out)
    const matchedCredits = matchedLines.reduce((s, l) => s + l.creditPaise, 0);
    const matchedDebits = matchedLines.reduce((s, l) => s + l.debitPaise, 0);
    const glBalancePaise = account.openingBalancePaise + matchedCredits - matchedDebits;

    const differencePaise = statement.closingBalancePaise - glBalancePaise;

    const unmatchedAmountPaise = unmatchedLines.reduce(
      (s, l) => s + l.creditPaise - l.debitPaise,
      0,
    );

    return {
      bankAccountId: account._id.toString(),
      statementId: statement._id.toString(),
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      openingBalancePaise: statement.openingBalancePaise,
      closingBalancePaise: statement.closingBalancePaise,
      glBalancePaise,
      differencePaise,
      totalLines: allLines.length,
      matchedLines: matchedLines.length,
      unmatchedLines: unmatchedLines.length,
      unmatchedAmountPaise,
      isReconciled: differencePaise === 0 && unmatchedLines.length === 0,
      lines: allLines.map((l) => ({
        id: l._id.toString(),
        date: l.date,
        description: l.description,
        reference: l.reference,
        debitPaise: l.debitPaise,
        creditPaise: l.creditPaise,
        matchStatus: l.matchStatus,
        matchedJournalId: l.matchedJournalId?.toString() ?? null,
      })),
    };
  }

  async listStatements(orgId: string, bankAccountId?: string): Promise<BankStatementDocument[]> {
    const filter = bankAccountId ? { bankAccountId: new Types.ObjectId(bankAccountId) } : {};
    return withOrg(orgId, () =>
      this.statementModel.find(filter).sort({ periodStart: -1 }).exec(),
    );
  }
}
