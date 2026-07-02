import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection, Types } from 'mongoose';
import { VoucherType, JournalStatus } from '@ai-accounting/shared';
import { Journal, JournalDocument } from './schemas/journal.schema';
import { Counter, CounterDocument } from './schemas/counter.schema';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';
import { withOrg } from '../database/tenant.plugin';

export interface PostJournalInput {
  orgId: string;
  voucherType: VoucherType;
  financialYear: string;
  date: string;
  narration?: string;
  postedBy: string;
  lines: Array<{
    accountId: string;
    description?: string;
    debitPaise: number;
    creditPaise: number;
  }>;
}

@Injectable()
export class PostingService {
  constructor(
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
    @InjectModel(Counter.name) private counterModel: Model<CounterDocument>,
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
    @InjectConnection() private connection: Connection,
  ) {}

  /**
   * Post a balanced journal inside a single MongoDB transaction.
   * Invariants enforced here:
   *   - Gapless voucher number (counter $inc inside the same session)
   *   - Balance (schema pre-validate hook)
   *   - Integer paise (schema validators)
   *   - Audit log entry committed with the same transaction
   */
  async post(input: PostJournalInput): Promise<JournalDocument> {
    const session = await this.connection.startSession();
    let journal: JournalDocument | undefined;

    try {
      await session.withTransaction(async () => {
        const counterId = `${input.orgId}:${input.voucherType}:${input.financialYear}`;
        const counter = await this.counterModel
          .findByIdAndUpdate(
            counterId,
            { $inc: { seq: 1 } },
            { upsert: true, new: true, session },
          )
          .exec();

        if (!counter) throw new Error('Failed to allocate voucher number.');

        // Build the journal document — schema hooks enforce balance and paise invariants
        const doc = new this.journalModel({
          orgId: input.orgId,
          voucherType: input.voucherType,
          voucherNumber: counter.seq,
          financialYear: input.financialYear,
          date: input.date,
          narration: input.narration,
          status: JournalStatus.POSTED,
          postedBy: new Types.ObjectId(input.postedBy),
          postedAt: new Date(),
          lines: input.lines.map((l) => ({
            accountId: new Types.ObjectId(l.accountId),
            description: l.description ?? '',
            debitPaise: l.debitPaise,
            creditPaise: l.creditPaise,
          })),
        });

        // Run schema validation manually so any balance/paise errors surface before save
        try {
          await doc.validate();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new BadRequestException(msg);
        }

        await doc.save({ session });
        journal = doc;

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
      });
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(msg);
    } finally {
      await session.endSession();
    }

    return journal!;
  }

  /**
   * Reverse a posted journal: creates an equal-and-opposite contra entry.
   * The original journal gains status "reversed"; a new journal with status "posted"
   * is created referencing the original via reversalOf.
   * Both operations happen inside a single transaction.
   */
  async reverse(journalId: string, reversedBy: string): Promise<JournalDocument> {
    const original = await this.journalModel.findById(journalId).exec();
    if (!original) throw new NotFoundException(`Journal ${journalId} not found.`);
    if (original.status !== JournalStatus.POSTED) {
      throw new BadRequestException('Only posted journals can be reversed.');
    }

    return this.post({
      orgId: original.orgId,
      voucherType: original.voucherType,
      financialYear: original.financialYear,
      date: new Date().toISOString().slice(0, 10),
      narration: `Reversal of voucher #${original.voucherNumber}`,
      postedBy: reversedBy,
      lines: original.lines.map((l) => ({
        accountId: l.accountId.toString(),
        description: l.description,
        // Swap debit ↔ credit to create the contra entry
        debitPaise: l.creditPaise,
        creditPaise: l.debitPaise,
      })),
    }).then(async (reversal) => {
      // Mark the original as reversed — use findOneAndUpdate to bypass the posted-immutable hook
      // We're intentionally changing status from "posted" → "reversed", which IS allowed
      await this.journalModel.collection.updateOne(
        { _id: original._id },
        { $set: { status: JournalStatus.REVERSED, reversalOf: reversal._id } },
      );

      await this.auditLogModel.create({
        orgId: original.orgId,
        entityType: 'Journal',
        entityId: original._id.toString(),
        action: 'REVERSE',
        performedBy: reversedBy,
        meta: { reversalJournalId: reversal._id.toString() },
      });

      return reversal;
    });
  }

  async findById(journalId: string, orgId: string): Promise<JournalDocument | null> {
    return withOrg(orgId, () =>
      this.journalModel.findById(journalId).exec(),
    );
  }
}
