import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import { MatchStatus, ProposedEntryStatus } from '@ai-accounting/shared';
import { BankStatementLine, BankStatementLineDocument } from '../../banking/schemas/bank-statement-line.schema';
import { AccountsService } from '../../gl/accounts.service';
import { financialYearOf } from '../../gl/posting.service';
import { SystemAccountKey } from '../../gl/schemas/ledger-account.schema';
import { ProposedEntry, ProposedEntryDocument } from '../schemas/proposed-entry.schema';
import { ExpenseCategorizerService } from './expense-categorizer.service';
import { counterpartyFrom } from './category-rules';

export const CATEGORISE_QUEUE = 'categorise';
export const CATEGORISE_BANK_LINE_JOB = 'bank-line';

export interface CategoriseBankLineJob {
  orgId: string;
  lineId: string;
}

/** At most this many lines in one request. */
const MAX_LINES = 200;

/**
 * Bank lines with no bill or invoice behind them (charges, salaries, a card
 * payment to a restaurant) become proposals in the review queue.
 *
 * The categoriser suggests the account, the reviewer approves, and approving
 * posts the voucher and matches the line in one transaction. The AI only ever
 * writes the proposal (Invariant 4); the work runs in a queued job, never in
 * the request.
 */
@Injectable()
export class BankCategorisationService {
  private readonly logger = new Logger(BankCategorisationService.name);

  constructor(
    @InjectModel(BankStatementLine.name) private lineModel: Model<BankStatementLineDocument>,
    @InjectModel(ProposedEntry.name) private proposalModel: Model<ProposedEntryDocument>,
    @InjectQueue(CATEGORISE_QUEUE) private queue: Queue<CategoriseBankLineJob>,
    private categorizer: ExpenseCategorizerService,
    private accounts: AccountsService,
  ) {}

  /** Queues each line that can be categorised, and says why the rest cannot. */
  async queueLines(orgId: string, lineIds: string[]) {
    const ids = [...new Set(lineIds)].filter((id) => Types.ObjectId.isValid(id));
    if (ids.length === 0) throw new BadRequestException('Choose at least one bank line.');
    if (ids.length > MAX_LINES) throw new BadRequestException(`Choose at most ${MAX_LINES} lines at a time.`);

    const objectIds = ids.map((id) => new Types.ObjectId(id));
    const [lines, inReview] = await Promise.all([
      this.lineModel.find({ orgId, _id: { $in: objectIds } }).lean().exec(),
      this.proposalModel.distinct('bankLineId', { orgId, bankLineId: { $in: objectIds }, status: ProposedEntryStatus.PROPOSED }).exec(),
    ]);
    const reviewing = new Set(inReview.map(String));
    const found = new Map(lines.map((l) => [l._id.toString(), l]));

    const skipped: Array<{ lineId: string; reason: string }> = [];
    let queued = 0;
    for (const id of ids) {
      const line = found.get(id);
      const reason = !line
        ? 'not found'
        : line.excluded
          ? 'excluded from reconciliation'
          : line.matchStatus !== MatchStatus.UNMATCHED
            ? 'already matched'
            : reviewing.has(id)
              ? 'already in the review queue'
              : null;
      if (reason) {
        skipped.push({ lineId: id, reason });
        continue;
      }
      await this.queue.add(
        CATEGORISE_BANK_LINE_JOB,
        { orgId, lineId: id },
        { jobId: `bank-line-${id}`, attempts: 2, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: true, removeOnFail: true },
      );
      queued += 1;
    }
    return { queued, skipped };
  }

  /** Writes the proposal for one line. Called only from the queue processor. */
  async propose(orgId: string, lineId: string): Promise<ProposedEntryDocument | null> {
    const line = await this.lineModel.findOne({ _id: lineId, orgId }).exec();
    if (!line || line.excluded || line.matchStatus !== MatchStatus.UNMATCHED) return null;

    const outgoing = line.debitPaise > 0;
    const amount = outgoing ? line.debitPaise : line.creditPaise;
    if (amount <= 0) return null;
    const party = counterpartyFrom(line.description);
    const pick = await this.categorizer.suggest(orgId, {
      kind: outgoing ? 'withdrawal' : 'deposit',
      partyName: party,
      narration: line.description,
      amountPaise: amount,
    });
    const bank = await this.accounts.resolveSystemAccount(orgId, SystemAccountKey.BANK);

    const category = {
      accountName: pick.accountName,
      accountCode: pick.accountCode,
      accountId: new Types.ObjectId(pick.accountId),
      confidence: pick.confidence,
      isAiSuggested: pick.source !== 'learned',
    };
    const bankLeg = { accountName: bank.name, accountCode: bank.code, accountId: bank._id, confidence: 1, isAiSuggested: false };
    const suggestedLines = outgoing
      ? [{ ...category, debitPaise: amount, creditPaise: 0 }, { ...bankLeg, debitPaise: 0, creditPaise: amount }]
      : [{ ...bankLeg, debitPaise: amount, creditPaise: 0 }, { ...category, debitPaise: 0, creditPaise: amount }];

    try {
      return await this.proposalModel.create({
        orgId,
        documentId: null,
        extractedDocumentId: null,
        sourceType: 'bank',
        bankLineId: line._id,
        status: ProposedEntryStatus.PROPOSED,
        documentType: outgoing ? 'bank_payment' : 'bank_receipt',
        vendorName: party,
        vendorGstin: null,
        invoiceNumber: line.reference,
        invoiceDate: line.date,
        dueDate: null,
        amountsPaise: { taxableValue: amount, cgst: 0, sgst: 0, igst: 0, cess: 0, total: amount },
        confidenceOverall: pick.confidence,
        // Date, amount and reference come straight off the statement; only the account is a guess.
        fieldConfidence: { vendor: party ? 0.7 : 0.3, invoiceNumber: 1, invoiceDate: 1, amounts: 1 },
        rawWarnings: [`From the bank statement: ${line.description}`],
        suggestedLines,
        category: { source: pick.source, reason: pick.reason, accountName: pick.accountName, confidence: pick.confidence },
        financialYear: financialYearOf(line.date),
      });
    } catch (err) {
      // Another job proposed this line first; one proposal per line is enough.
      if ((err as { code?: number }).code === 11000) return null;
      throw err;
    }
  }
}
