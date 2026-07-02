import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrgSettings, OrgSettingsSchema } from './schemas/org-settings.schema';
import { OrgMembership, OrgMembershipSchema } from '../tenancy/schemas/org-membership.schema';
import { User, UserSchema } from '../tenancy/schemas/user.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { OrgSettingsService } from './org-settings.service';
import { OrgSettingsController } from './org-settings.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OrgSettings.name, schema: OrgSettingsSchema },
      { name: OrgMembership.name, schema: OrgMembershipSchema },
      { name: User.name, schema: UserSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [OrgSettingsController],
  providers: [OrgSettingsService],
  exports: [OrgSettingsService],
})
export class OrgSettingsModule {}
