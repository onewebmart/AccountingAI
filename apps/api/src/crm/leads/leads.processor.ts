import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { withFirm } from '../../database/tenant.plugin';
import { UsageMeterService } from '../../ocr/usage-meter.service';
import { LeadQualifierService } from './lead-qualifier.service';
import { CRM_LEADS_QUEUE, LeadsService, QualifyLeadJob } from './leads.service';

/**
 * Runs the AI qualification pass off the request path.
 *
 * The verdict is written to the lead's `qualification` block and nowhere else —
 * the worker has no code path that changes `stage`. Moving a lead is a human
 * action (Invariant 4).
 */
@Processor(CRM_LEADS_QUEUE)
export class LeadsProcessor extends WorkerHost {
  private readonly logger = new Logger(LeadsProcessor.name);

  constructor(
    private readonly leads: LeadsService,
    private readonly qualifier: LeadQualifierService,
    private readonly usageMeter: UsageMeterService,
  ) {
    super();
  }

  async process(job: Job<QualifyLeadJob>): Promise<void> {
    const { leadId, firmId } = job.data;

    await withFirm(firmId, async () => {
      const lead = await this.leads.findById(leadId);

      if (lead.firmId.toString() !== firmId) {
        // Defensive: a mismatched job must never qualify another firm's lead.
        throw new Error(`Lead ${leadId} does not belong to firm ${firmId}`);
      }

      try {
        const result = await this.qualifier.qualify({
          name: lead.name,
          contactName: lead.contactName,
          source: lead.source,
          services: lead.services,
          enquiryNotes: lead.enquiryNotes,
          estimatedValuePaise: lead.estimatedValuePaise,
        });

        await this.leads.applyQualification(leadId, result);

        // Bill the model spend against the firm, like every other AI call.
        await this.usageMeter.recordAiTokens(firmId, result.tokensIn, result.tokensOut);

        this.logger.log(`Lead ${leadId} qualified: score=${result.score}`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await this.leads.markQualificationFailed(leadId, reason);
        this.logger.error(`Lead ${leadId} qualification failed: ${reason}`);
        throw err; // let BullMQ retry
      }
    });
  }
}
