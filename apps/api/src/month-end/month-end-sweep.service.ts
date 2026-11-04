import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProposedEntryStatus } from '@ai-accounting/shared';
import { withOrg } from '../database/tenant.plugin';
import { ProposedEntry, ProposedEntryDocument } from '../proposals/schemas/proposed-entry.schema';
import { AdjustmentSchedule, AdjustmentScheduleDocument } from './schemas/adjustment-schedule.schema';
import { AdjustmentsService, periodEnd } from './adjustments.service';
import { SchedulesService } from './schedules.service';

/** The month whose last day has passed by `today`: on 2026-11-30 it is November, before then October. */
export function lastClosedPeriod(today: string): string {
  const period = today.slice(0, 7);
  if (periodEnd(period) === today) return period;
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

/**
 * The daily part of month-end: each schedule's entry for a month that has
 * ended goes to the review queue, and accruals people approved reverse on
 * the 1st as they said they would.
 */
@Injectable()
export class MonthEndSweepService {
  private readonly logger = new Logger(MonthEndSweepService.name);

  constructor(
    @InjectModel(AdjustmentSchedule.name) private scheduleModel: Model<AdjustmentScheduleDocument>,
    @InjectModel(ProposedEntry.name) private proposalModel: Model<ProposedEntryDocument>,
    private schedules: SchedulesService,
    private adjustments: AdjustmentsService,
  ) {}

  async sweep(today: string): Promise<void> {
    const [withSchedules, withAccruals] = await Promise.all([
      this.scheduleModel.distinct('orgId', { status: 'active' }).exec(),
      this.proposalModel.distinct('orgId', { sourceType: 'adjustment', status: ProposedEntryStatus.APPROVED, 'adjustment.reverseOn': { $ne: null, $lte: today }, 'adjustment.reversalJournalId': { $exists: false } }).exec(),
    ]);
    for (const orgId of new Set([...withSchedules, ...withAccruals].map(String))) {
      try {
        await withOrg(orgId, async () => {
          const { drafted } = await this.schedules.draftDue(orgId, 'system:month-end', lastClosedPeriod(today));
          const reversed = await this.adjustments.reverseDueAccruals(orgId, today);
          if (drafted || reversed) this.logger.log(`Org ${orgId}: drafted ${drafted} scheduled entries, reversed ${reversed} accruals`);
        });
      } catch (err) {
        this.logger.error(`Month-end sweep failed for org ${orgId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
