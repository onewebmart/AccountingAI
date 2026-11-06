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
import { PostingService } from '../gl/posting.service';
import { todayIst } from '../automation/schedule';
import { AdjustmentsService, periodEnd } from './adjustments.service';
import { VoucherContact, VoucherContactsService } from './voucher-contacts.service';

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
  /** The customer or vendor of the document that posted the voucher, when there is one. */
  contact: VoucherContact | null;
  /** Set when a reclassification in review, or approved, already moves this line. */
  movedBy: { proposalId: string; status: 'proposed' | 'approved' } | null;
}

export interface BulkLinesQuery {
  accountId: string;
  from?: string;
  to?: string;
  text?: string;
  /** A customer or vendor: only vouchers their documents posted. */
  contactId?: string;
  /** The line's amount (its debit or its credit), in paise, at least and at most. */
  minPaise?: number;
  maxPaise?: number;
}

/**
 * month: one reclassification per calendar month of the lines, each dated at
 * that month's end, so the monthly P&L moves in the months the lines are in.
 * single: one for all of them, dated at the end of the latest line's month.
 */
export type BulkSplit = 'month' | 'single';

export interface BulkProposeInput {
  fromAccountId: string;
  toAccountId: string;
  lines: Array<{ journalId: string; index: number }>;
  reason?: string | null;
  /** By default one entry per month when the lines span months, else one. */
  split?: BulkSplit;
}

export interface BulkEntry {
  proposalId: string;
  /** The month whose lines this entry moves; null for a single entry over several months. */
  month: string | null;
  amountPaise: number;
  direction: 'debit' | 'credit';
  date: string;
  period: string;
  lines: number;
  projectId: string | null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
/** The line's amount: its debit or its credit. */
const amountOf = (l: { debitPaise: number; creditPaise: number }) => l.debitPaise || l.creditPaise;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rupees = (paise: number) =>
  `₹${(Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayAfter = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Bulk update: find posted lines on one account and move them to another.
 * A posted journal is never edited (Invariant 3). The move is a reclass
 * adjustment in the review queue, Dr the new account and Cr the old one for
 * the net of the lines chosen (one per month the lines are in, or one for
 * all), and it posts only when a person approves it.
 */
@Injectable()
export class BulkUpdateService {
  constructor(
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
    @InjectModel(LedgerAccount.name) private accountModel: Model<LedgerAccountDocument>,
    @InjectModel(PeriodLock.name) private lockModel: Model<PeriodLockDocument>,
    @InjectModel(ProposedEntry.name) private proposalModel: Model<ProposedEntryDocument>,
    private adjustments: AdjustmentsService,
    private posting: PostingService,
    private contacts: VoucherContactsService,
  ) {}

  /** The customers and vendors to filter by. */
  contactList(orgId: string) {
    return this.contacts.list(orgId);
  }

  /**
   * Posted lines on an account, oldest first: not reversed, not reversals,
   * not the year-end closing entry. Text matches the narration or the line;
   * a contact keeps the lines tagged with them and, on untagged lines, the
   * vouchers their documents posted; the amount range is on the line's own
   * debit or credit.
   */
  async lines(orgId: string, q: BulkLinesQuery): Promise<{ lines: BulkLine[]; capped: boolean; contact: VoucherContact | null }> {
    const account = await this.account(orgId, q.accountId, 'The account');
    if (q.from && !DATE.test(q.from)) throw new BadRequestException('from must look like 2026-04-01');
    if (q.to && !DATE.test(q.to)) throw new BadRequestException('to must look like 2026-11-30');
    if (q.from && q.to && q.from > q.to) throw new BadRequestException('The start date is after the end date.');
    const min = q.minPaise ?? null;
    const max = q.maxPaise ?? null;
    for (const v of [min, max]) if (v !== null && (!Number.isInteger(v) || v < 0)) throw new BadRequestException('An amount is whole paise, not negative.');
    if (min !== null && max !== null && min > max) throw new BadRequestException('The smallest amount is more than the largest.');

    const text = q.text?.trim().slice(0, 100) || '';
    const match = text ? new RegExp(escapeRegex(text), 'i') : null;
    const filter: Record<string, unknown> = {
      orgId,
      status: JournalStatus.POSTED,
      reversalOf: { $exists: false },
      isClosingEntry: { $ne: true },
    };
    const inRange = (l: { debitPaise: number; creditPaise: number }) => {
      const a = amountOf(l);
      return (min === null || a >= min) && (max === null || a <= max);
    };
    if (min !== null || max !== null) {
      // A line is a debit or a credit: the range is on whichever it is.
      const range = { $gte: Math.max(1, min ?? 1), ...(max !== null ? { $lte: max } : {}) };
      filter.lines = { $elemMatch: { accountId: account._id, $or: [{ debitPaise: range }, { creditPaise: range }] } };
    } else {
      filter['lines.accountId'] = account._id;
    }
    if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    const and: Array<Record<string, unknown>> = [];
    if (match) and.push({ $or: [{ narration: match }, { 'lines.description': match }] });

    // A line's contact: the customer or vendor it is tagged with (a manual
    // journal's line can carry one), else the contact of the document that
    // posted its voucher.
    let contact: VoucherContact | null = null;
    let ofContact: Set<string> | null = null;
    if (q.contactId) {
      contact = await this.contacts.contact(orgId, q.contactId);
      if (!contact) throw new NotFoundException('That is not one of your customers or vendors.');
      const ids = await this.contacts.journalIdsOf(orgId, q.contactId);
      ofContact = new Set(ids.map(String));
      and.push({ $or: [...(ids.length ? [{ _id: { $in: ids } }] : []), { lines: { $elemMatch: { accountId: account._id, 'contact.id': new Types.ObjectId(q.contactId) } } }] });
    }
    if (and.length) filter.$and = and;

    const journals = await this.journalModel.find(filter).sort({ date: 1, voucherNumber: 1 }).limit(JOURNAL_SCAN_CAP).lean().exec();
    const reversed = await this.reversedIds(orgId, journals.map((j) => j._id));
    const moved = await this.movedLines(orgId);

    const out: Array<Omit<BulkLine, 'contact'> & { tagged: VoucherContact | null }> = [];
    let capped = journals.length === JOURNAL_SCAN_CAP;
    for (const j of journals) {
      if (reversed.has(String(j._id))) continue;
      const narrationHit = !!match && match.test(j.narration ?? '');
      for (const [index, l] of j.lines.entries()) {
        if (String(l.accountId) !== String(account._id)) continue;
        if (match && !narrationHit && !match.test(l.description ?? '')) continue;
        if (!inRange(l)) continue;
        const tagged: VoucherContact | null = l.contact?.id ? { id: String(l.contact.id), name: l.contact.name ?? '', kind: l.contact.kind } : null;
        if (q.contactId && (tagged ? tagged.id !== q.contactId : !ofContact!.has(String(j._id)))) continue;
        if (out.length === BULK_LINE_CAP) {
          capped = true;
          break;
        }
        out.push({
          tagged,
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
    const untagged = [...new Set(out.filter((l) => !l.tagged).map((l) => l.journalId))];
    const who = contact || !untagged.length ? null : await this.contacts.contactsOf(orgId, untagged.map((id) => new Types.ObjectId(id)));
    return { lines: out.map(({ tagged, ...l }) => ({ ...l, contact: tagged ?? contact ?? who?.get(l.journalId) ?? null })), capped, contact };
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

    const chosen: Array<{ journalId: string; index: number; voucher: string; date: string; debitPaise: number; creditPaise: number; projectId: string | null }> = [];
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
      chosen.push({ journalId: r.journalId, index: r.index, voucher, date: j.date, debitPaise: line.debitPaise, creditPaise: line.creditPaise, projectId: line.projectId ? String(line.projectId) : null });
    }

    const net = chosen.reduce((s, l) => s + l.debitPaise - l.creditPaise, 0);
    if (net === 0) throw new BadRequestException('The chosen lines net to nothing: there is nothing to move.');

    // By month: one entry per month the lines are in, so the monthly P&L
    // moves where the lines are, not all in the latest month.
    const months = [...new Set(chosen.map((l) => l.date.slice(0, 7)))].sort();
    if (input.split && input.split !== 'month' && input.split !== 'single') throw new BadRequestException('split is month or single.');
    const split: BulkSplit = input.split ?? (months.length > 1 ? 'month' : 'single');
    const groups = split === 'month' && months.length > 1
      ? months.map((m) => ({ month: m as string | null, lines: chosen.filter((l) => l.date.startsWith(m)) }))
      : [{ month: months.length === 1 ? months[0] : null, lines: chosen }];

    const today = todayIst();
    const lock = await this.lockModel.findOne({ orgId }).lean().exec();
    // Dated at the end of the month the lines are in (the latest line's, for
    // one entry), never after today. When that month is locked, the first
    // day after the lock: the nearest the books still allow.
    const dateFor = (latest: string) => {
      let date = periodEnd(latest.slice(0, 7));
      if (date > today) date = today;
      if (lock?.lockedThrough && date <= lock.lockedThrough) date = dayAfter(lock.lockedThrough);
      return date;
    };

    const why = input.reason?.trim().slice(0, 300);
    const toId = String(to._id);
    const fromId = String(from._id);
    const skipped: string[] = [];
    const drafts = groups.flatMap((g) => {
      const n = g.lines.reduce((s, l) => s + l.debitPaise - l.creditPaise, 0);
      if (n === 0) {
        if (g.month) skipped.push(g.month);
        return [];
      }
      const amount = Math.abs(n);
      const latest = g.lines.reduce((m, l) => (l.date > m ? l.date : m), g.lines[0].date);
      const date = dateFor(latest);
      // A project stays with the money only when every line shares it.
      const projects = new Set(g.lines.map((l) => l.projectId));
      const projectId = projects.size === 1 ? [...projects][0] : null;
      const vouchers = [...new Set(g.lines.map((l) => l.voucher))];
      const listed = vouchers.length > 20 ? `${vouchers.slice(0, 20).join(', ')} and ${vouchers.length - 20} more` : vouchers.join(', ');
      const ofMonth = split === 'month' && g.month && groups.length > 1 ? ` of ${monthName(g.month)}` : '';
      const reason =
        `${g.lines.length} posted line${g.lines.length === 1 ? '' : 's'}${ofMonth} on ${from.name} (net ${n > 0 ? 'debit' : 'credit'} ${rupees(amount)}) move to ${to.name}. ` +
        `Vouchers: ${listed}.${why ? ` Why: ${why}` : ''}${date.slice(0, 7) !== latest.slice(0, 7) ? ` Dated ${date}: that month is closed or not over.` : ''} The original entries stay as they were posted.`;
      const lineKeys = g.lines.map((l) => `${l.journalId}:${l.index}`).sort();
      return [{
        month: g.month, amount, direction: (n > 0 ? 'debit' : 'credit') as 'debit' | 'credit', date, projectId, lines: g.lines.length,
        input: {
          orgId, actorId, kind: 'reclass' as const, refId: `bulk:${createHash('sha1').update(lineKeys.join(',')).digest('hex').slice(0, 16)}`, period: date.slice(0, 7), date, unique: true,
          narration: `Reclassification from ${from.name} to ${to.name}${ofMonth ? `, ${monthName(g.month!)}` : ''}`,
          reason,
          lines: n > 0
            ? [{ accountId: toId, debitPaise: amount, creditPaise: 0, projectId }, { accountId: fromId, debitPaise: 0, creditPaise: amount, projectId }]
            : [{ accountId: fromId, debitPaise: amount, creditPaise: 0, projectId }, { accountId: toId, debitPaise: 0, creditPaise: amount, projectId }],
          sources: g.lines.map((l) => ({ journalId: l.journalId, index: l.index })),
        },
      }];
    });

    // Every entry goes to the review queue together, or none does.
    const proposals = await this.posting.inTransaction(async (session) => {
      const made = [];
      for (const d of drafts) made.push(await this.adjustments.propose(d.input, session));
      return made;
    });
    const entries: BulkEntry[] = drafts.map((d, i) => ({
      proposalId: String(proposals[i]._id), month: d.month, amountPaise: d.amount, direction: d.direction, date: d.date, period: d.date.slice(0, 7), lines: d.lines, projectId: d.projectId,
    }));
    return { split, entries, lines: chosen.length, skipped };
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
