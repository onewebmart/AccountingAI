import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Journal, JournalSchema } from './schemas/journal.schema';
import { Counter, CounterSchema } from './schemas/counter.schema';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import { PostingService } from './posting.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Journal.name, schema: JournalSchema },
      { name: Counter.name, schema: CounterSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  providers: [PostingService],
  exports: [PostingService, MongooseModule],
})
export class GlModule {}
