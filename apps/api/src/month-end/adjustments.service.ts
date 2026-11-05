import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProposedEntryStatus } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { LedgerAccount, LedgerAccountDocument } from '../gl/schemas/ledger-account.schema';
import { ProposedEntry, ProposedEntryDocument } from '../proposals/schemas/proposed-entry.schema';
import { withOrg } from '../database/tenant.plugin';

export type AdjustmentKind = NonNullable<ProposedEntry['adjustment']>['kind'];

export interface AdjustmentInput {
  orgId: string;
  actorId: string;
  kind: AdjustmentKind;
  refId: string | null;
  period: string | null;
  /** The voucher date: usually the period's last day. */
  date: string;
  narration: string;
  reason: string;
  lines: Array<{ accountId: string; debitPaise: number; creditPaise: number }>;
  /** 1 for entries worked out from the books; capped below for the assistant's guesses. */
  confidence?: number;
  reverseOn?: string | null;
  assets?: Array<{ assetId: string; amountPaise: number; from: string; to: string }>;
  /** One per kind, source and period: a second draft for the same month is refused. */
  unique?: boolean;
  /**
   * The posted lines a bulk reclassification moves, by journal and line
   * index, so the same line is not moved twice while one is live.
   */
  sources?: Array<{ journalId: string; index: number }>;
}

/** The last day of a month: 2026-11 → 2026-11-30. */
export function periodEnd(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * Every month-end adjustment goes to the review queue as a proposal: a
 * person reads the reason and the lines and presses Approve & post, which
 * posts through PostingService like any other entry. This service never
 * writes to the ledger itself, except to reverse an accrual a person
 * already approved, on the date it said it would.
 */
@Injectable()
export class AdjustmentsService {
  private readonly logger = new Logger(AdjustmentsService.name);

  constructor(
    @InjectModel(ProposedEntry.name) private proposalModel: Model<ProposedEntryDocument>,
    @InjectModel(LedgerAccount.name) private accountModel: Model<LedgerAccountDocument>,
    private posting: PostingService,
    private audit: AuditService,
  ) {}

  async propose(input: AdjustmentInput): Promise<ProposedEntryDocument> {
    const lines = input.lines.filter((l) => l.debitPaise > 0 || l.creditPaise > 0);
    for (const l of lines) {
      if (!Number.isInteger(l.debitPaise) || !Number.isInteger(l.creditPaise) || l.debitPaise < 0 || l.creditPaise < 0) {
        throw new BadRequestException('Amounts are whole paise, not negative.');
      }
      if (l.debitPaise > 0 && l.creditPaise > 0) throw new BadRequestException('A line is a debit or a credit, not both.');
    }
    const debit = lines.reduce((s, l) => s + l.debitPaise, 0);
    const credit = lines.reduce((s, l) => s + l.creditPaise, 0);
    if (debit === 0 || debit !== credit) throw new BadRequestException(`Debits (${debit}) and credits (${credit}) must be equal and more than nothing.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new BadRequestException('date must look like 2026-11-30');

    const ids = [...new Set(lines.map((l) => l.accountId))];
    if (ids.some((id) => !Types.ObjectId.isValid(id))) throw new BadRequestException('No such account.');
    const accounts = await this.accountModel.find({ orgId: input.orgId, _id: { $in: ids } }).lean().exec();
    const byId = new Map(accounts.map((a) => [String(a._id), a]));
    for (const id of ids) {
      const a = byId.get(id);
      if (!a) throw new BadRequestException('No such account.');
      if (a.isGroup) throw new BadRequestException(`${a.name} is a group; pick an account under it.`);
      if (!a.isActive) throw new BadRequestException(`${a.name} is inactive.`);
    }

    const confidence = Math.max(0, Math.min(1, input.confidence ?? 1));
    const key = input.unique && input.refId && input.period ? `${input.kind}:${input.refId}:${input.period}` : undefined;
    try {
      const proposal = await this.proposalModel.create({
        orgId: input.orgId,
        sourceType: 'adjustment',
        status: ProposedEntryStatus.PROPOSED,
        documentType: 'journal',
        vendorName: null,
        invoiceNumber: null,
        invoiceDate: input.date,
        amountsPaise: { taxableValue: debit, cgst: 0, sgst: 0, igst: 0, cess: 0, total: debit },
        confidenceOverall: confidence,
        fieldConfidence: { vendor: confidence, invoiceNumber: confidence, invoiceDate: confidence, amounts: confidence },
        suggestedLines: lines.map((l) => ({
          accountId: new Types.ObjectId(l.accountId),
          accountName: byId.get(l.accountId)!.name,
          accountCode: byId.get(l.accountId)!.code,
          debitPaise: l.debitPaise,
          creditPaise: l.creditPaise,
          confidence,
          isAiSuggested: confidence < 1,
        })),
        financialYear: financialYearOf(input.date),
        narration: input.narration.slice(0, 300),
        adjustment: {
          kind: input.kind, refId: input.refId, period: input.period, reason: input.reason, reverseOn: input.reverseOn ?? null, assets: input.assets ?? [],
          ...(input.sources?.length ? { sources: input.sources } : {}),
        },
        ...(key ? { adjustmentKey: key } : {}),
      });
      await this.audit.record({
        orgId: input.orgId, entityType: 'ProposedEntry', entityId: proposal._id.toString(), action: 'PROPOSE_ADJUSTMENT', performedBy: input.actorId,
        after: { kind: input.kind, period: input.period, totalPaise: debit, reason: input.reason },
      });
      return proposal;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictException(`This ${input.kind.replace('_', ' ')} is already drafted for ${input.period}: approve or reject the one in the review queue.`);
      throw err;
    }
  }

  /** Adjustments of a kind, optionally for one source, in review or approved. */
  async live(orgId: string, kind: AdjustmentKind, refId?: string) {
    return this.proposalModel
      .find({ orgId, sourceType: 'adjustment', 'adjustment.kind': kind, ...(refId ? { 'adjustment.refId': refId } : {}), status: { $in: [ProposedEntryStatus.PROPOSED, ProposedEntryStatus.APPROVED] } })
      .lean()
      .exec();
  }

  /**
   * Accruals a person approved reverse on the date they carry (the 1st of
   * the next month), so the bill booked when it comes is not counted twice.
   */
  async reverseDueAccruals(orgId: string, today: string): Promise<number> {
    const due = await this.proposalModel
      .find({ orgId, sourceType: 'adjustment', status: ProposedEntryStatus.APPROVED, journalId: { $ne: null }, 'adjustment.reverseOn': { $ne: null, $lte: today }, 'adjustment.reversalJournalId': { $exists: false } })
      .exec();
    let reversed = 0;
    for (const p of due) {
      const on = p.adjustment!.reverseOn!;
      // Posted in the name of whoever approved the accrual: they agreed it would reverse.
      const by = p.approvedBy;
      if (!by || !Types.ObjectId.isValid(by)) continue;
      try {
        const reversal = await withOrg(orgId, () => this.posting.reverse(String(p.journalId), by, undefined, { date: on, narration: `Reversal of accrual: ${p.narration ?? ''}`.slice(0, 300) }));
        await this.proposalModel.updateOne({ _id: p._id }, { $set: { 'adjustment.reversalJournalId': String(reversal._id) } }).exec();
        reversed++;
      } catch (err) {
        // Already reversed by hand: note it, so it is not tried again.
        if (err instanceof BadRequestException && /already been reversed/.test(err.message)) {
          await this.proposalModel.updateOne({ _id: p._id }, { $set: { 'adjustment.reversalJournalId': 'manual' } }).exec();
        } else {
          this.logger.warn(`Accrual ${p._id} not reversed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    return reversed;
  }
}
