import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Organization, OrganizationSchema } from '../tenancy/schemas/organization.schema';
import { UsageMeter, UsageMeterSchema } from '../ocr/schemas/usage-meter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { Subscription, SubscriptionSchema } from './schemas/subscription.schema';
import { FeatureFlag, FeatureFlagSchema } from './schemas/feature-flag.schema';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminGuard } from './platform-admin.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: UsageMeter.name, schema: UsageMeterSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: FeatureFlag.name, schema: FeatureFlagSchema },
    ]),
  ],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService, PlatformAdminGuard],
  exports: [PlatformAdminService],
})
export class PlatformAdminModule {}
