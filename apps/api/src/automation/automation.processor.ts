import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { withOrg } from '../database/tenant.plugin';
import { RecurringService } from './recurring.service';
import {
  BOOKS_AUTOMATION_QUEUE,
  DAILY_BOOKS_JOB,
  RemindersService,
  SEND_REMINDER_JOB,
  SendReminderJob,
} from './reminders.service';
import { todayIst } from './schedule';
import { MonthEndSweepService } from '../month-end/month-end-sweep.service';
import { ReportSchedulesService } from '../reports/report-schedules.service';

/**
 * Two jobs on one queue:
 *  - the daily sweep drafts recurring bills and invoices that have fallen due,
 *    then climbs the payment-reminder ladder, org by org;
 *  - send-reminder hands one written reminder to the messaging adapter.
 *
 * The sweep runs across orgs, so each org's work is wrapped in withOrg(): a
 * system job is the explicit, justified cross-tenant case Invariant 5 allows.
 */
@Processor(BOOKS_AUTOMATION_QUEUE)
export class AutomationProcessor extends WorkerHost {
  private readonly logger = new Logger(AutomationProcessor.name);

  constructor(
    private readonly recurring: RecurringService,
    private readonly reminders: RemindersService,
    private readonly monthEnd: MonthEndSweepService,
    @Optional() private readonly reportSchedules?: ReportSchedulesService,
  ) {
    super();
  }

  async process(job: Job<SendReminderJob | { today?: string }>): Promise<void> {
    if (job.name === SEND_REMINDER_JOB) {
      const { reminderId, orgId } = job.data as SendReminderJob;
      await withOrg(orgId, () => this.reminders.deliver(reminderId));
      return;
    }
    if (job.name !== DAILY_BOOKS_JOB) return;

    const today = (job.data as { today?: string })?.today ?? todayIst();
    await this.monthEnd.sweep(today);
    try {
      const reports = await this.reportSchedules?.runDue(today);
      if (reports && (reports.sent || reports.failed)) this.logger.log(`Report emails: ${reports.sent} sent, ${reports.failed} failed`);
    } catch (err) {
      this.logger.error(`Report emails failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const orgIds = [...new Set([...(await this.recurring.orgIdsDue(today)), ...(await this.reminders.orgIdsEnabled())])];
    for (const orgId of orgIds) {
      try {
        await withOrg(orgId, async () => {
          const drafted = await this.recurring.runDue(orgId, today);
          const reminded = await this.reminders.runDue(orgId, today);
          if (drafted.drafted.length || drafted.failed.length || reminded.queued) {
            this.logger.log(
              `Org ${orgId}: drafted ${drafted.drafted.length} recurring, ${drafted.failed.length} failed; queued ${reminded.queued} reminders`,
            );
          }
        });
      } catch (err) {
        // One org's bad data must not stop the sweep for the rest.
        this.logger.error(`Books sweep failed for org ${orgId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
