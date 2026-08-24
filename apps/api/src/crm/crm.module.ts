import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CrmMessage, CrmMessageSchema } from './schemas/crm-message.schema';
import { ComplianceItem, ComplianceItemSchema } from './schemas/compliance-item.schema';
import { DocumentRequest, DocumentRequestSchema } from './schemas/document-request.schema';
import { Lead, LeadSchema } from './schemas/lead.schema';
import { PracticeInvoice, PracticeInvoiceSchema } from './schemas/practice-invoice.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { Conversation, ConversationSchema } from './schemas/conversation.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { Organization, OrganizationSchema } from '../tenancy/schemas/organization.schema';
import { Firm, FirmSchema } from '../tenancy/schemas/firm.schema';
import { MessagingService, CRM_MESSAGING_QUEUE } from './messaging/messaging.service';
import { MessagingController } from './messaging/messaging.controller';
import { MessagingProcessor } from './messaging/messaging.processor';
import { MESSAGING_PROVIDER } from './messaging/messaging.provider.interface';
import { MockMessagingProvider } from './messaging/mock-messaging.provider';
import { ComplianceService } from './compliance/compliance.service';
import { ComplianceController } from './compliance/compliance.controller';
import {
  ComplianceProcessor,
  CRM_COMPLIANCE_QUEUE,
  DAILY_SWEEP_JOB,
} from './compliance/compliance.processor';
import { DocumentRequestService } from './documents/document-request.service';
import { DocumentRequestController } from './documents/document-request.controller';
import { LeadsService, CRM_LEADS_QUEUE } from './leads/leads.service';
import { LeadsController } from './leads/leads.controller';
import { LeadsProcessor } from './leads/leads.processor';
import { LeadQualifierService } from './leads/lead-qualifier.service';
import { OcrModule } from '../ocr/ocr.module';
import { PracticeInvoiceService } from './invoices/practice-invoice.service';
import { PracticeInvoiceController } from './invoices/practice-invoice.controller';
import { ConversationsService, CRM_AGENT_QUEUE } from './agent/conversations.service';
import { AgentController } from './agent/agent.controller';
import { AgentProcessor } from './agent/agent.processor';
import { SupportAgentService } from './agent/support-agent.service';
import { ClientContextService } from './agent/client-context.service';

/**
 * CA firm practice management (CRM). Firm-scoped, unlike the accounting modules
 * which are org-scoped — see §3 of docs/CA_CRM_BUILD_PLAN.md.
 *
 * The messaging provider is bound here and nowhere else: swapping the mock for a
 * real WhatsApp Business API or SMTP adapter is a one-line change in this module
 * and touches no reminder, invoice or agent logic.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CrmMessage.name, schema: CrmMessageSchema },
      { name: ComplianceItem.name, schema: ComplianceItemSchema },
      { name: DocumentRequest.name, schema: DocumentRequestSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: PracticeInvoice.name, schema: PracticeInvoiceSchema },
      { name: Counter.name, schema: CounterSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: Firm.name, schema: FirmSchema },
    ]),
    BullModule.registerQueue({ name: CRM_MESSAGING_QUEUE }),
    BullModule.registerQueue({ name: CRM_COMPLIANCE_QUEUE }),
    BullModule.registerQueue({ name: CRM_LEADS_QUEUE }),
    BullModule.registerQueue({ name: CRM_AGENT_QUEUE }),
    // UsageMeterService — AI spend on lead qualification is billed like any other.
    OcrModule,
  ],
  controllers: [
    MessagingController,
    ComplianceController,
    DocumentRequestController,
    LeadsController,
    PracticeInvoiceController,
    AgentController,
  ],
  providers: [
    MessagingService,
    MessagingProcessor,
    ComplianceService,
    ComplianceProcessor,
    DocumentRequestService,
    LeadsService,
    LeadsProcessor,
    LeadQualifierService,
    PracticeInvoiceService,
    ConversationsService,
    AgentProcessor,
    SupportAgentService,
    ClientContextService,
    { provide: MESSAGING_PROVIDER, useClass: MockMessagingProvider },
  ],
  exports: [
    MessagingService,
    ComplianceService,
    DocumentRequestService,
    LeadsService,
    PracticeInvoiceService,
    ConversationsService,
  ],
})
export class CrmModule implements OnModuleInit {
  private readonly logger = new Logger(CrmModule.name);

  constructor(
    @InjectQueue(CRM_COMPLIANCE_QUEUE) private readonly complianceQueue: Queue,
  ) {}

  /**
   * Schedules the daily compliance sweep once, at boot.
   *
   * A fixed jobId plus a repeat pattern means restarting the API re-registers
   * the same schedule rather than stacking duplicates. 07:00 IST is early
   * enough that reminders land before a client's working day.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.complianceQueue.add(
        DAILY_SWEEP_JOB,
        {},
        {
          jobId: DAILY_SWEEP_JOB,
          repeat: { pattern: '0 7 * * *', tz: 'Asia/Kolkata' },
          removeOnComplete: true,
        },
      );
      this.logger.log('Daily compliance sweep scheduled for 07:00 IST');
    } catch (err) {
      // A scheduling failure must not stop the API from serving requests.
      this.logger.error(
        `Could not schedule the compliance sweep: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
