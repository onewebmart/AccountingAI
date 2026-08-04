import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Journal, JournalSchema } from './schemas/journal.schema';
import { Counter, CounterSchema } from './schemas/counter.schema';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from './schemas/ledger-account.schema';
import { PostingService } from './posting.service';
import { AccountsService } from './accounts.service';
import { GlController } from './gl.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Journal.name, schema: JournalSchema },
      { name: Counter.name, schema: CounterSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: LedgerAccount.name, schema: LedgerAccountSchema },
    ]),
  ],
  controllers: [GlController],
  providers: [PostingService, AccountsService],
  exports: [PostingService, AccountsService, MongooseModule],
})
export class GlModule {}
