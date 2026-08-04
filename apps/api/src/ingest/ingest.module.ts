import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SpreadsheetParserService } from './spreadsheet-parser.service';
import { SpreadsheetIngestService } from './spreadsheet-ingest.service';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';
import { BankAccount, BankAccountSchema } from '../banking/schemas/bank-account.schema';
import { BankingModule } from '../banking/banking.module';
import { GlModule } from '../gl/gl.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProposedEntry.name, schema: ProposedEntrySchema },
      { name: BankAccount.name, schema: BankAccountSchema },
    ]),
    BankingModule,
    GlModule,
  ],
  providers: [SpreadsheetParserService, SpreadsheetIngestService],
  exports: [SpreadsheetParserService, SpreadsheetIngestService],
})
export class IngestModule {}
