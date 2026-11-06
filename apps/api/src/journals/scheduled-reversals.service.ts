import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { JournalStatus } from '@ai-accounting/shared';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { withOrg } from '../database/tenant.plugin';
import { JournalReversalService } from './journal-reversal.service';
import { formatVoucherNumber } from './journals.service';

/**
 * Journals posted with a reverse journal date and "publish only on the
 * reverse journal date" ticked reverse themselves on that date: the daily
 * books job (06:30 IST, apps/api/src/automation) calls runDue.
 *
 * The journal is never touched (Invariant 3); "still to reverse" is a
 * journal whose date has come and that no reversal points at yet. A
 * reversal refused today (the period it falls in is locked) is tried again
 * on the next run, so it posts once the period is unlocked.
 */
@Injectable()
export class ScheduledReversalsService {
  private readonly logger = new Logger(ScheduledReversalsService.name);

  constructor(
    @InjectModel(Journal.name) private readonly journalModel: Model<JournalDocument>,
    private readonly reversals: JournalReversalService,
  ) {}

  /** Journals whose reversal falls due on or before `today`, not yet reversed. Across orgs, or one. */
  async due(today: string, orgId?: string) {
    return this.journalModel
      .aggregate<{ _id: Types.ObjectId; orgId: string; postedBy: Types.ObjectId; voucherType: Journal['voucherType']; financialYear: string; voucherNumber: number; journalNumber?: string | null; narration?: string; autoReverse: { on: string } }>([
        {
          $match: {
            ...(orgId ? { orgId } : {}),
            status: JournalStatus.POSTED,
            'autoReverse.publishOnDate': true,
            'autoReverse.on': { $lte: today },
          },
        },
        { $lookup: { from: 'journals', localField: '_id', foreignField: 'reversalOf', as: 'reversal' } },
        { $match: { reversal: { $size: 0 } } },
        { $project: { orgId: 1, postedBy: 1, voucherType: 1, financialYear: 1, voucherNumber: 1, journalNumber: 1, narration: 1, autoReverse: 1 } },
        { $sort: { 'autoReverse.on': 1, _id: 1 } },
      ])
      .exec();
  }

  /**
   * Post every reversal that has fallen due, dated its reverse date, in the
   * name of whoever posted the journal (or approved it): they set the date.
   * A system job across orgs, so each one runs in its org's context.
   */
  async runDue(today: string, orgId?: string): Promise<{ reversed: number; failed: number }> {
    let reversed = 0;
    let failed = 0;
    for (const j of await this.due(today, orgId)) {
      const number = j.journalNumber ?? formatVoucherNumber(j.voucherType, j.financialYear, j.voucherNumber);
      try {
        await withOrg(j.orgId, () =>
          this.reversals.reverse(String(j._id), j.orgId, String(j.postedBy), {
            date: j.autoReverse.on,
            narration: `Reversal of ${number}${j.narration ? `: ${j.narration}` : ''}`.slice(0, 500),
            scheduled: true,
          }),
        );
        reversed++;
      } catch (err) {
        failed++;
        this.logger.warn(`Journal ${number} (org ${j.orgId}) not reversed on ${j.autoReverse.on}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (reversed || failed) this.logger.log(`Scheduled journal reversals: ${reversed} posted, ${failed} waiting`);
    return { reversed, failed };
  }
}
