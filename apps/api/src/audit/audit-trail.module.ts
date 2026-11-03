import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { User, UserSchema } from '../tenancy/schemas/user.schema';
import { AuditTrailService } from './audit-trail.service';
import { AuditTrailController } from './audit-trail.controller';

/** The org's audit trail, read-only, for admins and auditors. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
      // Read for the names of the people who made each change.
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [AuditTrailController],
  providers: [AuditTrailService],
})
export class AuditTrailModule {}
