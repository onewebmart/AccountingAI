import { Injectable, BadRequestException, NotFoundException, HttpException, Optional } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, Types, ClientSession } from 'mongoose';
import { VoucherType, JournalStatus } from '@ai-accounting/shared';
import { Journal, JournalDocument } from './schemas/journal.schema';
import { Counter, CounterDocument } from './schemas/counter.schema';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';
import { PeriodLock, PeriodLockDocument } from './schemas/period-lock.schema';
import { withOrg } from '../database/tenant.plugin';

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
  }>;
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
    series: 'INVOICE_SERIAL',
    financialYear: string,
    session: ClientSession,
  ): Promise<number> {
    const counter = await this.counterModel
      .findByIdAndUpdate(`${orgId}:${series}:${financialYear}`, { $inc: { seq: 1 } }, { upsert: true, new: true, session })
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
        lines: input.lines.map((l) => ({
          accountId: new Types.ObjectId(l.accountId),
          description: l.description ?? '',
          debitPaise: l.debitPaise,
          creditPaise: l.creditPaise,
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
  async reverse(journalId: string, reversedBy: string, session?: ClientSession): Promise<JournalDocument> {
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

    const date = new Date().toISOString().slice(0, 10);

    const work = async (session: ClientSession) => {
      const reversal = await this.postInSession(
        {
          orgId: original.orgId,
          voucherType: original.voucherType,
          financialYear: financialYearOf(date),
          date,
          narration: `Reversal of voucher #${original.voucherNumber}`,
          postedBy: reversedBy,
          reversalOf: original._id.toString(),
          lines: original.lines.map((l) => ({
            accountId: l.accountId.toString(),
            description: l.description,
            // Swap debit ↔ credit to create the contra entry
            debitPaise: l.creditPaise,
            creditPaise: l.debitPaise,
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

  async findById(journalId: string, orgId: string): Promise<JournalDocument | null> {
    return withOrg(orgId, () =>
      this.journalModel.findById(journalId).exec(),
    );
  }
}
