import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TallySyncRecord, TallySyncRecordSchema } from './schemas/tally-sync-record.schema';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { TallyService } from './tally.service';
import { ExportsService } from './exports.service';
import { ExportsController } from './exports.controller';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TallySyncRecord.name, schema: TallySyncRecordSchema },
      { name: Journal.name, schema: JournalSchema },
    ]),
    ReportsModule,
  ],
  controllers: [ExportsController],
  providers: [TallyService, ExportsService],
  exports: [TallyService, ExportsService],
})
export class ExportsModule {}
