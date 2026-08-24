import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { CrmMessage, CrmMessageSchema } from './schemas/crm-message.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { MessagingService, CRM_MESSAGING_QUEUE } from './messaging/messaging.service';
import { MessagingController } from './messaging/messaging.controller';
import { MessagingProcessor } from './messaging/messaging.processor';
import { MESSAGING_PROVIDER } from './messaging/messaging.provider.interface';
import { MockMessagingProvider } from './messaging/mock-messaging.provider';

/**
 * CA firm practice management (CRM). Firm-scoped, unlike the accounting modules
 * which are org-scoped — see §3 of CA_CRM_BUILD_PLAN.md.
 *
 * The messaging provider is bound here and nowhere else: swapping the mock for a
 * real WhatsApp Business API or SMTP adapter is a one-line change in this module
 * and touches no reminder, invoice or agent logic.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CrmMessage.name, schema: CrmMessageSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
    BullModule.registerQueue({ name: CRM_MESSAGING_QUEUE }),
  ],
  controllers: [MessagingController],
  providers: [
    MessagingService,
    MessagingProcessor,
    { provide: MESSAGING_PROVIDER, useClass: MockMessagingProvider },
  ],
  exports: [MessagingService],
})
export class CrmModule {}
