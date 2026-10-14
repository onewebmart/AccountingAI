import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { withOrg } from '../database/tenant.plugin';
import { BankFeedsService } from './bank-feeds.service';

export const BANK_FEEDS_QUEUE = 'bank-feeds';
export const DAILY_FEED_JOB = 'daily-feed-pull';

/**
 * Each morning, pulls every active feed. Runs across orgs, so each consent's
 * work is wrapped in withOrg(): the explicit system-job case Invariant 5 allows.
 */
@Processor(BANK_FEEDS_QUEUE)
export class BankFeedsProcessor extends WorkerHost {
  private readonly logger = new Logger(BankFeedsProcessor.name);

  constructor(private readonly feeds: BankFeedsService) {
    super();
  }

  async process(): Promise<void> {
    const consents = await this.feeds.activeConsents();
    for (const { orgId, id } of consents) {
      try {
        const result = await withOrg(orgId, () => this.feeds.sync(orgId, id));
        const imported = result.accounts.reduce((s, a) => s + a.imported, 0);
        if (imported) this.logger.log(`Bank feed ${id}: ${imported} new lines`);
      } catch (err) {
        // One bank's outage must not stop the rest.
        this.logger.error(`Bank feed ${id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
