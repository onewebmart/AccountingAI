import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Organization, OrganizationSchema } from '../tenancy/schemas/organization.schema';
import { Firm, FirmSchema } from '../tenancy/schemas/firm.schema';
import { User, UserSchema } from '../tenancy/schemas/user.schema';
import { Document, DocumentSchema } from '../documents/schemas/document.schema';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';
import { UsageMeter, UsageMeterSchema } from '../ocr/schemas/usage-meter.schema';
import { OrgMembership, OrgMembershipSchema } from '../tenancy/schemas/org-membership.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { WorkspaceService } from './workspace.service';
import { PracticeSetupService } from './practice-setup.service';
import { WorkspaceController } from './workspace.controller';

/** Serves the app shell: org identity, badge counts and the AI meter. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: Firm.name, schema: FirmSchema },
      { name: User.name, schema: UserSchema },
      { name: Document.name, schema: DocumentSchema },
      { name: ProposedEntry.name, schema: ProposedEntrySchema },
      { name: UsageMeter.name, schema: UsageMeterSchema },
      { name: OrgMembership.name, schema: OrgMembershipSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [WorkspaceController],
  providers: [WorkspaceService, PracticeSetupService],
})
export class WorkspaceModule {}
