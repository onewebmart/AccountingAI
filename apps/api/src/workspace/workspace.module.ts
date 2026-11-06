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
import { ApprovalRequest, ApprovalRequestSchema } from '../approvals/schemas/approval.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { GstFiling, GstFilingSchema } from '../gst/schemas/gst-filing.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { TdsModule } from '../tds/tds.module';
import { WorkspaceService } from './workspace.service';
import { PracticeSetupService } from './practice-setup.service';
import { NotificationsService } from './notifications.service';
import { WorkspaceController } from './workspace.controller';

/** Serves the app shell: org identity, badge counts, the AI meter and the notifications. */
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
      { name: ApprovalRequest.name, schema: ApprovalRequestSchema },
      { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
      { name: BankStatementLine.name, schema: BankStatementLineSchema },
      { name: GstFiling.name, schema: GstFilingSchema },
      { name: OrgSettings.name, schema: OrgSettingsSchema },
    ]),
    TdsModule,
  ],
  controllers: [WorkspaceController],
  providers: [WorkspaceService, PracticeSetupService, NotificationsService],
})
export class WorkspaceModule {}
