import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProposedEntry, ProposedEntrySchema } from './schemas/proposed-entry.schema';
import { ExtractedDocument, ExtractedDocumentSchema } from '../extraction/schemas/extracted-document.schema';
import { VendorLedgerMap, VendorLedgerMapSchema } from './schemas/vendor-ledger-map.schema';
import { ProposalsService } from './proposals.service';
import { ProposalsController } from './proposals.controller';
import { LearningService } from './learning.service';
import { GlModule } from '../gl/gl.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProposedEntry.name, schema: ProposedEntrySchema },
      { name: ExtractedDocument.name, schema: ExtractedDocumentSchema },
      { name: VendorLedgerMap.name, schema: VendorLedgerMapSchema },
    ]),
    GlModule, // for PostingService
  ],
  controllers: [ProposalsController],
  providers: [ProposalsService, LearningService],
  exports: [ProposalsService, LearningService],
})
export class ProposalsModule {}
