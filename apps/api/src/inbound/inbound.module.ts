import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InboundMessage, InboundMessageSchema } from './schemas/inbound-message.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { OrgMembership, OrgMembershipSchema } from '../tenancy/schemas/org-membership.schema';
import { User, UserSchema } from '../tenancy/schemas/user.schema';
import { DocumentsModule } from '../documents/documents.module';
import { GlModule } from '../gl/gl.module';
import { InboundService } from './inbound.service';
import { MetaWhatsAppMedia, WHATSAPP_MEDIA } from './whatsapp-media';
import { InboundEmailController, InboxController } from './inbound.controller';

/** Bills sent in by email or WhatsApp, into the upload pipeline. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InboundMessage.name, schema: InboundMessageSchema },
      { name: OrgSettings.name, schema: OrgSettingsSchema },
      // Read to tell a known sender (a vendor, a team member) from a stranger.
      { name: Vendor.name, schema: VendorSchema },
      { name: OrgMembership.name, schema: OrgMembershipSchema },
      { name: User.name, schema: UserSchema },
    ]),
    DocumentsModule, // uploads into the pipeline
    GlModule, // AuditService
  ],
  controllers: [InboxController, InboundEmailController],
  providers: [InboundService, { provide: WHATSAPP_MEDIA, useClass: MetaWhatsAppMedia }],
  exports: [InboundService],
})
export class InboundModule {}
