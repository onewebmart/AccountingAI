import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { withOrg } from '../database/tenant.plugin';
import { HSN_QUEUE, ItemsService } from './items.service';

/** HSN/SAC suggestions the model makes, one job each, off the request path. */
@Processor(HSN_QUEUE)
export class HsnSuggestionProcessor extends WorkerHost {
  constructor(private readonly items: ItemsService) {
    super();
  }

  async process(job: Job<{ orgId: string; suggestionId: string }>): Promise<void> {
    const { orgId, suggestionId } = job.data;
    await withOrg(orgId, () => this.items.runModel(orgId, suggestionId));
  }
}
