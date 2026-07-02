import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Platform, PlatformSchema } from './schemas/platform.schema';
import { Firm, FirmSchema } from './schemas/firm.schema';
import { Organization, OrganizationSchema } from './schemas/organization.schema';
import { User, UserSchema } from './schemas/user.schema';
import { OrgMembership, OrgMembershipSchema } from './schemas/org-membership.schema';
import { TenancyService } from './tenancy.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Platform.name, schema: PlatformSchema },
      { name: Firm.name, schema: FirmSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: User.name, schema: UserSchema },
      { name: OrgMembership.name, schema: OrgMembershipSchema },
    ]),
  ],
  providers: [TenancyService],
  exports: [TenancyService, MongooseModule],
})
export class TenancyModule {}
