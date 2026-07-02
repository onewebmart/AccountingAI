import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Firm, FirmSchema } from '../tenancy/schemas/firm.schema';
import { Organization, OrganizationSchema } from '../tenancy/schemas/organization.schema';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { WhiteLabelService } from './white-label.service';
import { WhiteLabelController } from './white-label.controller';
import { FirmAdminGuard } from './white-label.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Firm.name, schema: FirmSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: ProposedEntry.name, schema: ProposedEntrySchema },
      { name: PurchaseBill.name, schema: PurchaseBillSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [WhiteLabelController],
  providers: [WhiteLabelService, FirmAdminGuard],
  exports: [WhiteLabelService],
})
export class WhiteLabelModule {}
