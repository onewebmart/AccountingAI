import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import { JournalStatus, ProposedEntryStatus } from '@ai-accounting/shared';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { LedgerAccount, LedgerAccountDocument, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { PeriodLock, PeriodLockDocument } from '../gl/schemas/period-lock.schema';
import { ProposedEntry, ProposedEntryDocument } from '../proposals/schemas/proposed-entry.schema';
import { formatVoucherNumber } from '../journals/journals.service';
import { todayIst } from '../automation/schedule';
import { AdjustmentsService, periodEnd } from './adjustments.service';

/** The most lines one search returns, and one reclassification moves. */
export const BULK_LINE_CAP = 500;
/**
 * Accounts kept party by party from documents: what each customer, vendor or
 * employee owes is read from invoices, bills, claims and payments, so a lump
 * moved on or off these would leave the account and the parties disagreeing.
 */
const PARTY_ACCOUNTS: ReadonlySet<string> = new Set([
  SystemAccountKey.ACCOUNTS_RECEIVABLE, SystemAccountKey.ACCOUNTS_PAYABLE, SystemAccountKey.CUSTOMER_ADVANCES,
  SystemAccountKey.VENDOR_ADVANCES, SystemAccountKey.EMPLOYEE_PAYABLE,
]);
/** Journals read per search: enough for the cap with room for lines on other accounts. */
const JOURNAL_SCAN_CAP = 2000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface BulkLine {
  journalId: string;
  /** The line's position in its journal: with journalId, what identifies it. */
  index: number;
  voucherNumber: string;
  voucherType: string;
  date: string;
  narration: string | null;
  description: string;
  debitPaise: number;
  creditPaise: number;
  projectId: string | null;
  /** Set when a reclassification in review, or approved, already moves this line. */
  movedBy: { proposalId: string; status: 'proposed' | 'approved' } | null;
}

export interface BulkProposeInput {
  fromAccountId: string;
  toAccountId: string;
  lines: Array<{ journalId: string; index: number }>;
  reason?: string | null;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rupees = (paise: number) =>
  `₹${(Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayAfter = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Bulk update: find posted lines on one account and move them to another.
 * A posted journal is never edited (Invariant 3). The move is one reclass
 * adjustment in the review queue, Dr the new account and Cr the old one for
 * the net of the lines chosen, and it posts only when a person approves it.
 */
@Injectable()
export class BulkUpdateService {
  constructor(
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
    @InjectModel(LedgerAccount.name) private accountModel: Model<LedgerAccountDocument>,
    @InjectModel(PeriodLock.name) private lockModel: Model<PeriodLockDocument>,
    @InjectModel(ProposedEntry.name) private proposalModel: Model<ProposedEntryDocument>,
    private adjustments: AdjustmentsService,
  ) {}

  /**
   * Posted lines on an account, oldest first: not reversed, not reversals,
   * not the year-end closing entry. Text matches the narration or the line.
   */
  async lines(orgId: string, q: { accountId: string; from?: string; to?: string; text?: string }): Promise<{ lines: BulkLine[]; capped: boolean }> {
    const account = await this.account(orgId, q.accountId, 'The account');
    if (q.from && !DATE.test(q.from)) throw new BadRequestException('from must look like 2026-04-01');
    if (q.to && !DATE.test(q.to)) throw new BadRequestException('to must look like 2026-11-30');
    if (q.from && q.to && q.from > q.to) throw new BadRequestException('The start date is after the end date.');

    const text = q.text?.trim().slice(0, 100) || '';
    const match = text ? new RegExp(escapeRegex(text), 'i') : null;
    const filter: Record<string, unknown> = {
      orgId,
      status: JournalStatus.POSTED,
      'lines.accountId': account._id,
      reversalOf: { $exists: false },
      isClosingEntry: { $ne: true },
    };
    if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    if (match) filter.$or = [{ narration: match }, { 'lines.description': match }];

    const journals = await this.journalModel.find(filter).sort({ date: 1, voucherNumber: 1 }).limit(JOURNAL_SCAN_CAP).lean().exec();
    const reversed = await this.reversedIds(orgId, journals.map((j) => j._id));
    const moved = await this.movedLines(orgId);

    const out: BulkLine[] = [];
    let capped = journals.length === JOURNAL_SCAN_CAP;
    for (const j of journals) {
      if (reversed.has(String(j._id))) continue;
      const narrationHit = !!match && match.test(j.narration ?? '');
      for (const [index, l] of j.lines.entries()) {
        if (String(l.accountId) !== String(account._id)) continue;
        if (match && !narrationHit && !match.test(l.description ?? '')) continue;
        if (out.length === BULK_LINE_CAP) {
          capped = true;
          break;
        }
        out.push({
          journalId: String(j._id),
          index,
          voucherNumber: formatVoucherNumber(j.voucherType, j.financialYear, j.voucherNumber),
          voucherType: String(j.voucherType).toLowerCase(),
          date: j.date,
          narration: j.narration ?? null,
          description: l.description ?? '',
          debitPaise: l.debitPaise,
          creditPaise: l.creditPaise,
          projectId: l.projectId ? String(l.projectId) : null,
          movedBy: moved.get(`${String(j._id)}:${index}`) ?? null,
        });
      }
      if (out.length === BULK_LINE_CAP && capped) break;
    }
    return { lines: out, capped };
  }

  /**
   * One reclass proposal moving the chosen lines' net from one account to
   * the other. The lines are read again here: amounts never come from the
   * client, and each must still be posted, unreversed and on the old account.
   */
  async propose(orgId: string, actorId: string, input: BulkProposeInput) {
    if (input.fromAccountId === input.toAccountId) throw new BadRequestException('Move the lines to a different account.');
    const from = await this.account(orgId, input.fromAccountId, 'The account to move from');
    const to = await this.account(orgId, input.toAccountId, 'The account to move to');

    const refs = input.lines ?? [];
    if (!refs.length) throw new BadRequestException('Choose at least one line to move.');
    if (refs.length > BULK_LINE_CAP) throw new BadRequestException(`Move at most ${BULK_LINE_CAP} lines at a time.`);
    const keys = new Set<string>();
    for (const r of refs) {
      if (!Types.ObjectId.isValid(r.journalId) || !Number.isInteger(r.index) || r.index < 0) throw new BadRequestException('A chosen line is not one of your entries.');
      const key = `${r.journalId}:${r.index}`;
      if (keys.has(key)) throw new BadRequestException('A line is chosen twice.');
      keys.add(key);
    }

    const ids = [...new Set(refs.map((r) => r.journalId))].map((id) => new Types.ObjectId(id));
    const journals = await this.journalModel.find({ orgId, _id: { $in: ids } }).lean().exec();
    const byId = new Map(journals.map((j) => [String(j._id), j]));
    const reversed = await this.reversedIds(orgId, ids);
    const moved = await this.movedLines(orgId);

    const chosen: Array<{ voucher: string; date: string; debitPaise: number; creditPaise: number; projectId: string | null }> = [];
    for (const r of refs) {
      const j = byId.get(r.journalId);
      if (!j) throw new NotFoundException('A chosen line is not one of your entries.');
      const voucher = formatVoucherNumber(j.voucherType, j.financialYear, j.voucherNumber);
      if (j.status !== JournalStatus.POSTED) throw new BadRequestException(`${voucher} is not posted.`);
      if (j.reversalOf) throw new BadRequestException(`${voucher} is a reversal: it cannot be moved.`);
      if (reversed.has(r.journalId)) throw new BadRequestException(`${voucher} has been reversed: it cannot be moved.`);
      if (j.isClosingEntry) throw new BadRequestException(`${voucher} is the year-end closing entry: it cannot be moved.`);
      const line = j.lines[r.index];
      if (!line || String(line.accountId) !== String(from._id)) throw new BadRequestException(`Line ${r.index + 1} of ${voucher} is not on ${from.name}.`);
      if (moved.has(`${r.journalId}:${r.index}`)) throw new ConflictException(`Line ${r.index + 1} of ${voucher} is already in a reclassification: approve or reject that one first.`);
      chosen.push({ voucher, date: j.date, debitPaise: line.debitPaise, creditPaise: line.creditPaise, projectId: line.projectId ? String(line.projectId) : null });
    }

    const net = chosen.reduce((s, l) => s + l.debitPaise - l.creditPaise, 0);
    if (net === 0) throw new BadRequestException('The chosen lines net to nothing: there is nothing to move.');
    const amount = Math.abs(net);

    // Dated at the end of the latest line's month, so the move lands in the
    // month the lines are in; never after today; after the lock when that
    // month is closed, as every entry must be.
    const latest = chosen.reduce((m, l) => (l.date > m ? l.date : m), chosen[0].date);
    const today = todayIst();
    let date = periodEnd(latest.slice(0, 7));
    if (date > today) date = today;
    const lock = await this.lockModel.findOne({ orgId }).lean().exec();
    if (lock?.lockedThrough && date <= lock.lockedThrough) date = today > lock.lockedThrough ? today : dayAfter(lock.lockedThrough);
    const period = date.slice(0, 7);

    // A project stays with the money only when every line shares it.
    const projects = new Set(chosen.map((l) => l.projectId));
    const projectId = projects.size === 1 ? [...projects][0] : null;

    const vouchers = [...new Set(chosen.map((l) => l.voucher))];
    const listed = vouchers.length > 20 ? `${vouchers.slice(0, 20).join(', ')} and ${vouchers.length - 20} more` : vouchers.join(', ');
    const why = input.reason?.trim().slice(0, 300);
    const reason =
      `${chosen.length} posted line${chosen.length === 1 ? '' : 's'} on ${from.name} (net ${net > 0 ? 'debit' : 'credit'} ${rupees(amount)}) move to ${to.name}. ` +
      `Vouchers: ${listed}.${why ? ` Why: ${why}` : ''} The original entries stay as they were posted.`;

    const refId = `bulk:${createHash('sha1').update([...keys].sort().join(',')).digest('hex').slice(0, 16)}`;
    const toId = String(to._id);
    const fromId = String(from._id);
    const proposal = await this.adjustments.propose({
      orgId, actorId, kind: 'reclass', refId, period, date, unique: true,
      narration: `Reclassification from ${from.name} to ${to.name}`,
      reason,
      lines: net > 0
        ? [{ accountId: toId, debitPaise: amount, creditPaise: 0 }, { accountId: fromId, debitPaise: 0, creditPaise: amount }]
        : [{ accountId: fromId, debitPaise: amount, creditPaise: 0 }, { accountId: toId, debitPaise: 0, creditPaise: amount }],
      sources: refs.map((r) => ({ journalId: r.journalId, index: r.index })),
    });
    return { proposalId: String(proposal._id), amountPaise: amount, direction: net > 0 ? 'debit' : 'credit', date, period, lines: chosen.length, projectId };
  }

  /** The org's account, open to postings: active and not a group. */
  private async account(orgId: string, id: string, what: string) {
    if (!id || !Types.ObjectId.isValid(id)) throw new BadRequestException(`${what} is not one of your accounts.`);
    const a = await this.accountModel.findOne({ orgId, _id: new Types.ObjectId(id) }).lean().exec();
    if (!a) throw new NotFoundException(`${what} is not one of your accounts.`);
    if (a.isGroup) throw new BadRequestException(`${a.name} is a group; pick an account under it.`);
    if (!a.isActive) throw new BadRequestException(`${a.name} is inactive.`);
    if (a.systemKey && PARTY_ACCOUNTS.has(a.systemKey)) {
      throw new BadRequestException(`${a.name} is kept party by party from documents and payments: correct it with a credit note, a debit note or a payment, not a bulk move.`);
    }
    return a;
  }

  /** Of these journals, the ones a reversal cancels. */
  private async reversedIds(orgId: string, ids: unknown[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const reversals = await this.journalModel.find({ orgId, reversalOf: { $in: ids } }, { reversalOf: 1 }).lean().exec();
    return new Set(reversals.map((r) => String(r.reversalOf)));
  }

  /** journalId:index → the live reclassification that moves it. */
  private async movedLines(orgId: string): Promise<Map<string, { proposalId: string; status: 'proposed' | 'approved' }>> {
    const live = await this.proposalModel
      .find({
        orgId, sourceType: 'adjustment', 'adjustment.kind': 'reclass', 'adjustment.sources.0': { $exists: true },
        status: { $in: [ProposedEntryStatus.PROPOSED, ProposedEntryStatus.APPROVED] },
      }, { adjustment: 1, status: 1 })
      .lean()
      .exec();
    const out = new Map<string, { proposalId: string; status: 'proposed' | 'approved' }>();
    for (const p of live) {
      const sources = (p.adjustment as { sources?: Array<{ journalId: string; index: number }> } | null)?.sources ?? [];
      const status = p.status === ProposedEntryStatus.APPROVED ? 'approved' : 'proposed';
      for (const s of sources) out.set(`${s.journalId}:${s.index}`, { proposalId: String(p._id), status });
    }
    return out;
  }
}
