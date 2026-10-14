import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Journal, JournalSchema } from './schemas/journal.schema';
import { Counter, CounterSchema } from './schemas/counter.schema';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from './schemas/ledger-account.schema';
import { PeriodLock, PeriodLockSchema } from './schemas/period-lock.schema';
import { PostingService } from './posting.service';
import { AccountsService } from './accounts.service';
import { AuditService } from './audit.service';
import { GlController } from './gl.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Journal.name, schema: JournalSchema },
      { name: Counter.name, schema: CounterSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: LedgerAccount.name, schema: LedgerAccountSchema },
      { name: PeriodLock.name, schema: PeriodLockSchema },
    ]),
  ],
  controllers: [GlController],
  providers: [PostingService, AccountsService, AuditService],
  exports: [PostingService, AccountsService, AuditService, MongooseModule],
})
export class GlModule {}
