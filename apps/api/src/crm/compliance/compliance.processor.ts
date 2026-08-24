import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { withFirm } from '../../database/tenant.plugin';
import { ComplianceService } from './compliance.service';

export const CRM_COMPLIANCE_QUEUE = 'crm-compliance';

/** Job name for the daily sweep. */
export const DAILY_SWEEP_JOB = 'daily-sweep';

export interface ComplianceSweepJob {
  /** Overrides "today" — used by tests and backfills. */
  today?: string;
}

/**
 * Daily sweep: top up the calendar, then fire any reminders now due.
 *
 * Runs cross-firm, so every database touch is wrapped in withFirm() — the
 * isolation plugin injects firmId from that context, and a system job is
 * exactly the "explicit and justified" cross-tenant case the invariant allows.
 */
@Processor(CRM_COMPLIANCE_QUEUE)
export class ComplianceProcessor extends WorkerHost {
  private readonly logger = new Logger(ComplianceProcessor.name);

  constructor(private readonly compliance: ComplianceService) {
    super();
  }

  async process(job: Job<ComplianceSweepJob>): Promise<void> {
    const today = job.data?.today;

    const firmIds = await this.compliance.firmIdsWithItems();
    if (firmIds.length === 0) {
      this.logger.log('Compliance sweep: no firms with obligations yet');
      return;
    }

    for (const firmId of firmIds) {
      try {
        await withFirm(firmId, async () => {
          await this.compliance.generateForFirm(firmId, today);
          await this.compliance.runDueReminders(firmId, today);
        });
      } catch (err) {
        // One firm's bad data must not stop the sweep for everyone else.
        this.logger.error(
          `Compliance sweep failed for firm ${firmId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(`Compliance sweep complete across ${firmIds.length} firm(s)`);
  }
}
