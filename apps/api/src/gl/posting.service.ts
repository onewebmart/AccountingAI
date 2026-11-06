import { Injectable, BadRequestException, NotFoundException, HttpException, Optional } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, Types, ClientSession } from 'mongoose';
import { VoucherType, JournalStatus } from '@ai-accounting/shared';
import { LedgerAccount, LedgerAccountDocument } from './schemas/ledger-account.schema';
import { Journal, JournalDocument } from './schemas/journal.schema';
import { Counter, CounterDocument } from './schemas/counter.schema';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';
import { PeriodLock, PeriodLockDocument } from './schemas/period-lock.schema';
import { withOrg } from '../database/tenant.plugin';
import { LOCK_MODULES, LockModule, MODULE_LABEL, ModuleLockState, locksCovering, modulesOfEntry } from './module-locks';

export interface PostJournalInput {
  orgId: string;
  voucherType: VoucherType;
  financialYear: string;
  date: string;
  narration?: string;
  postedBy: string;
  /** Set only by reverse(): the journal this entry cancels. */
  reversalOf?: string;
  /** Set only by year-end close: moves a year's income and expense to retained earnings. */
  isClosingEntry?: boolean;
  lines: Array<{
    accountId: string;
    description?: string;
    debitPaise: number;
    creditPaise: number;
    /** A project dimension, fixed at posting like the rest of the line. */
    projectId?: string | null;
    /** A customer or vendor the line is about (manual journals). */
    contact?: { kind: 'customer' | 'vendor'; id: string; name: string } | null;
  }>;
  /** Manual journals: Reference#, the person's own Journal#, and a reversal date. Fixed at posting. */
  reference?: string | null;
  journalNumber?: string | null;
  autoReverse?: { on: string; publishOnDate: boolean } | null;
}

/** Indian financial year (April–March) of a YYYY-MM-DD date, e.g. "2026-27". */
export function financialYearOf(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

function isDuplicateKeyError(err: unknown): boolean {
  return (err as { code?: number } | null)?.code === 11000;
}

@Injectable()
export class PostingService {
  constructor(
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
    @InjectModel(Counter.name) private counterModel: Model<CounterDocument>,
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
    @InjectConnection() private connection: Connection,
    // GlModule always registers it. Optional only so specs that build
    // PostingService by hand need not — they have no locks to enforce.
    @Optional() @InjectModel(PeriodLock.name) private lockModel?: Model<PeriodLockDocument>,
    // Optional for the same reason: specs that build PostingService by hand.
    @Optional() @InjectModel(LedgerAccount.name) private accountModel?: Model<LedgerAccountDocument>,
  ) {}

  /**
   * Run `work` inside one MongoDB transaction and return its result.
   *
   * Anything that changes a record's status as part of posting (invoice → paid,
   * proposal → approved) claims that change with a conditional update inside
   * `work`, then posts with the same session. Two simultaneous clicks serialise
   * on the claim — the second finds nothing left to claim and posts nothing —
   * and a crash can never leave a journal without its status change.
   */
  async inTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let result: T | undefined;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result as T;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Post a balanced journal inside a single MongoDB transaction.
   * Invariants enforced here:
   *   - Gapless voucher number (counter $inc inside the same session)
   *   - Balance (schema pre-validate hook)
   *   - Integer paise (schema validators)
   *   - Audit log entry committed with the same transaction
   *
   * Pass `session` to post as part of a caller's transaction (see inTransaction);
   * the caller then owns commit, retry and error handling.
   */
  /**
   * The next number in a document series, such as sales invoice serials, from
   * the same counters as voucher numbers. It runs inside the caller's
   * transaction, so a number is used only if the document it numbers is saved,
   * and the series has no gaps (Invariant 7; GST rule 46).
   */
  async nextDocumentNumber(
    orgId: string,
    series: 'INVOICE_SERIAL' | 'QUOTE' | 'SALES_ORDER' | 'CHALLAN' | 'PURCHASE_ORDER' | 'GRN' | 'EXPENSE_CLAIM' | 'EXPENSE' | 'PARTY_RECEIPT' | 'PARTY_PAYMENT',
    financialYear: string,
    session?: ClientSession,
  ): Promise<number> {
    const counter = await this.counterModel
      .findByIdAndUpdate(`${orgId}:${series}:${financialYear}`, { $inc: { seq: 1 } }, { upsert: true, new: true, session: session ?? null })
      .exec();
    if (!counter) throw new Error(`Failed to allocate the next ${series} number.`);
    return counter.seq;
  }

  async post(input: PostJournalInput, session?: ClientSession): Promise<JournalDocument> {
    if (session) return this.postInSession(input, session);

    try {
      return await this.inTransaction((s) => this.postInSession(input, s));
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(msg);
    }
  }

  private async postInSession(input: PostJournalInput, session: ClientSession): Promise<JournalDocument> {
    // A closed period stays closed: nothing may be dated on or before the lock.
    // Read inside the transaction, so a lock taken meanwhile is honoured. The
    // one exception is the year-end closing entry (and its reversal on
    // reopening), which is dated the last day of the year by definition.
    const lock = input.isClosingEntry
      ? null
      : await this.lockModel?.findOne({ orgId: input.orgId }).session(session).lean().exec();
    if (lock?.lockedThrough && input.date <= lock.lockedThrough) {
      throw new BadRequestException(
        `The books are locked through ${lock.lockedThrough}, and this entry is dated ${input.date}. ` +
          'Date it after the lock, or unlock the period first.',
      );
    }
    // Sales, Purchases, Banking and Accountant lock separately (module-locks.ts).
    if (!input.isClosingEntry) await this.assertModulesOpen(input.orgId, input.voucherType, input.lines, input.date, session, 'post', lock);

    // Nothing new goes to a deactivated account or straight to a group header.
    // A reversal and the year-end closing entry are exempt: a correction must
    // always be possible, whatever has happened to the account since.
    if (this.accountModel && !input.reversalOf && !input.isClosingEntry) {
      const ids = [...new Set(input.lines.map((l) => l.accountId))].filter((a) => Types.ObjectId.isValid(a));
      const closed = await this.accountModel
        .find({ orgId: input.orgId, _id: { $in: ids }, $or: [{ isActive: false }, { isGroup: true }] }, { name: 1, isGroup: 1 })
        .session(session)
        .lean()
        .exec();
      if (closed.length > 0) {
        const a = closed[0];
        throw new BadRequestException(
          a.isGroup
            ? `${a.name} is a group, not an account. Post to an account under it.`
            : `${a.name} is deactivated. Post to another account, or reactivate it in the chart of accounts.`,
        );
      }
    }

    const counterId = `${input.orgId}:${input.voucherType}:${input.financialYear}`;
    const counter = await this.counterModel
      .findByIdAndUpdate(
        counterId,
        { $inc: { seq: 1 } },
        { upsert: true, new: true, session },
      )
      .exec();

    if (!counter) throw new Error('Failed to allocate voucher number.');

    // Build the journal and run schema validation manually, so a bad id or a
    // balance/paise error is a 400 — even when posting inside a caller's
    // transaction, where nothing else maps errors.
    let doc: JournalDocument;
    try {
      doc = new this.journalModel({
        orgId: input.orgId,
        voucherType: input.voucherType,
        voucherNumber: counter.seq,
        financialYear: input.financialYear,
        date: input.date,
        narration: input.narration,
        status: JournalStatus.POSTED,
        reversalOf: input.reversalOf ? new Types.ObjectId(input.reversalOf) : undefined,
        isClosingEntry: input.isClosingEntry ?? false,
        postedBy: new Types.ObjectId(input.postedBy),
        postedAt: new Date(),
        reference: input.reference ?? null,
        journalNumber: input.journalNumber ?? null,
        autoReverse: input.autoReverse ?? null,
        lines: input.lines.map((l) => ({
          accountId: new Types.ObjectId(l.accountId),
          description: l.description ?? '',
          debitPaise: l.debitPaise,
          creditPaise: l.creditPaise,
          projectId: l.projectId && Types.ObjectId.isValid(l.projectId) ? new Types.ObjectId(l.projectId) : null,
          contact: l.contact && Types.ObjectId.isValid(l.contact.id) ? { kind: l.contact.kind, id: new Types.ObjectId(l.contact.id), name: l.contact.name } : null,
        })),
      });
      await doc.validate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(msg);
    }

    await doc.save({ session });

    await this.auditLogModel.create(
      [
        {
          orgId: input.orgId,
          entityType: 'Journal',
          entityId: doc._id.toString(),
          action: 'POST',
          performedBy: input.postedBy,
          meta: {
            voucherType: input.voucherType,
            voucherNumber: counter.seq,
            financialYear: input.financialYear,
            lineCount: input.lines.length,
          },
        },
      ],
      { session },
    );

    return doc;
  }

  /**
   * Reverse a posted journal with an equal-and-opposite contra entry, dated
   * today and filed in today's financial year.
   *
   * The original is never touched (Invariant 3). Both journals stay "posted",
   * so every report that sums posted journals nets them to zero. The contra
   * carries `reversalOf: original._id`, and the unique index on that field
   * means a journal is reversed at most once — even by simultaneous requests.
   */
  async reverse(journalId: string, reversedBy: string, session?: ClientSession, opts: { date?: string; narration?: string } = {}): Promise<JournalDocument> {
    const original = await this.journalModel.findById(journalId).session(session ?? null).exec();
    if (!original) throw new NotFoundException(`Journal ${journalId} not found.`);

    // REVERSED is only found on journals reversed before reversals stopped
    // mutating the original; scripts/migrate-reversal-links.mjs repairs them.
    if (
      original.status !== JournalStatus.POSTED ||
      (await this.journalModel.exists({ reversalOf: original._id }).session(session ?? null))
    ) {
      throw new BadRequestException('This voucher has already been reversed.');
    }
    if (original.reversalOf) {
      throw new BadRequestException('This voucher is itself a reversal and cannot be reversed.');
    }

    const date = opts.date ?? new Date().toISOString().slice(0, 10);
    // A date chosen for it (an accrual's 1st of the month) must not precede the voucher; today's is as before.
    if (opts.date && opts.date < original.date) throw new BadRequestException('A reversal cannot be dated before the voucher it reverses.');

    const work = async (session: ClientSession) => {
      const reversal = await this.postInSession(
        {
          orgId: original.orgId,
          voucherType: original.voucherType,
          financialYear: financialYearOf(date),
          date,
          narration: opts.narration ?? `Reversal of voucher #${original.voucherNumber}`,
          postedBy: reversedBy,
          reversalOf: original._id.toString(),
          lines: original.lines.map((l) => ({
            accountId: l.accountId.toString(),
            description: l.description,
            // Swap debit ↔ credit to create the contra entry
            debitPaise: l.creditPaise,
            creditPaise: l.debitPaise,
            // A reversal comes off the same project it went to.
            projectId: l.projectId ? l.projectId.toString() : null,
            // …and is about the same customer or vendor.
            contact: l.contact ? { kind: l.contact.kind, id: String(l.contact.id), name: l.contact.name } : null,
          })),
        },
        session,
      );

      await this.auditLogModel.create(
        [
          {
            orgId: original.orgId,
            entityType: 'Journal',
            entityId: original._id.toString(),
            action: 'REVERSE',
            performedBy: reversedBy,
            meta: { reversalJournalId: reversal._id.toString() },
          },
        ],
        { session },
      );

      return reversal;
    };

    // Inside a caller's transaction the caller owns retries and error mapping.
    if (session) return work(session);

    try {
      return await this.inTransaction(work);
    } catch (err: unknown) {
      // A concurrent request reversed it between the check above and this insert.
      if (isDuplicateKeyError(err)) {
        throw new BadRequestException('This voucher has already been reversed.');
      }
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(msg);
    }
  }

  /**
   * Refuse an entry when a module it belongs to (Sales, Purchases, Banking,
   * Accountant: see module-locks.ts for which is which) is locked through its
   * date. 'post' is a new entry on that date; 'reverse' is a posted entry of
   * that date about to be reversed, which a module lock forbids just as it
   * forbids changing or deleting a locked transaction. Read inside the
   * caller's transaction, so a lock taken meanwhile is honoured.
   *
   * `lockDoc` is the org's lock when the caller has read it already.
   */
  async assertModulesOpen(
    orgId: string,
    voucherType: VoucherType,
    lines: Array<{ accountId: unknown; debitPaise: number; creditPaise: number }>,
    date: string,
    session?: ClientSession | null,
    purpose: 'post' | 'reverse' = 'post',
    lockDoc?: { modules?: Partial<Record<LockModule, ModuleLockState | null>> | null } | null,
  ): Promise<void> {
    const lock = lockDoc !== undefined ? lockDoc : await this.lockModel?.findOne({ orgId }).session(session ?? null).lean().exec();
    if (!lock?.modules) return;
    // Nothing locked on or after this date: no need to work out the module.
    if (!locksCovering([...LOCK_MODULES], date, lock.modules).length) return;

    const ids = [...new Set(lines.map((l) => String(l.accountId)))].filter((a) => Types.ObjectId.isValid(a));
    const accounts = this.accountModel
      ? await this.accountModel.find({ orgId, _id: { $in: ids } }, { systemKey: 1, type: 1 }).session(session ?? null).lean().exec()
      : [];
    const facts = new Map(accounts.map((a) => [String(a._id), { systemKey: a.systemKey ?? null, type: a.type }]));
    const hit = locksCovering(modulesOfEntry(voucherType, lines, facts), date, lock.modules)[0];
    if (!hit) return;
    const label = MODULE_LABEL[hit.module];
    throw new BadRequestException(
      purpose === 'post'
        ? `${label} is locked through ${hit.lockedThrough}, and this entry is dated ${date}. Date it after the lock, or unlock ${label} in Transaction locking.`
        : `This entry is dated ${date}, and ${label} is locked through ${hit.lockedThrough}, so it cannot be reversed. Unlock ${label} in Transaction locking first, or correct it with a new entry dated after the lock.`,
    );
  }

  /**
   * Refuse an action in one module on a date its lock covers, for what is not
   * itself a posting: confirming a bank match is Banking's, for example.
   * `what` names the thing, as in "This bank line".
   */
  async assertModuleOpen(orgId: string, module: LockModule, date: string, what: string, session?: ClientSession | null): Promise<void> {
    const lock = await this.lockModel?.findOne({ orgId }).session(session ?? null).lean().exec();
    const hit = locksCovering([module], date, lock?.modules)[0];
    if (!hit) return;
    const label = MODULE_LABEL[module];
    throw new BadRequestException(`${label} is locked through ${hit.lockedThrough}, and ${what.charAt(0).toLowerCase()}${what.slice(1)} is dated ${date}. Unlock ${label} in Transaction locking first.`);
  }

  async findById(journalId: string, orgId: string): Promise<JournalDocument | null> {
    return withOrg(orgId, () =>
      this.journalModel.findById(journalId).exec(),
    );
  }
}
