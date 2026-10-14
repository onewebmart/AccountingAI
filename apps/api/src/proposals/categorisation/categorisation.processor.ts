import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { withOrg } from '../../database/tenant.plugin';
import { BankCategorisationService, CATEGORISE_QUEUE, CategoriseBankLineJob } from './bank-categorisation.service';

/** Turns queued bank lines into review-queue proposals, one job per line. */
@Processor(CATEGORISE_QUEUE)
export class CategorisationProcessor extends WorkerHost {
  private readonly logger = new Logger(CategorisationProcessor.name);

  constructor(private readonly bankCategorisation: BankCategorisationService) {
    super();
  }

  async process(job: Job<CategoriseBankLineJob>): Promise<void> {
    const { orgId, lineId } = job.data;
    const proposal = await withOrg(orgId, () => this.bankCategorisation.propose(orgId, lineId));
    if (proposal) {
      this.logger.log(`Bank line ${lineId} → proposal ${proposal._id} (${proposal.category?.accountName}, ${proposal.category?.source})`);
    }
  }
}
