import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { Document, DocumentSchema } from './schemas/document.schema';
import { DocumentsController } from './documents.controller';
import { DocumentsService, DOCUMENT_PROCESSING_QUEUE } from './documents.service';
import { StorageService } from './storage.service';
import { DocumentProcessingProcessor } from './document-processing.processor';
import { OcrModule } from '../ocr/ocr.module';
import { ExtractionModule } from '../extraction/extraction.module';
import { ProposalsModule } from '../proposals/proposals.module';
import { IngestModule } from '../ingest/ingest.module';
import { CrmModule } from '../crm/crm.module';
import { OcrResult, OcrResultSchema } from '../ocr/schemas/ocr-result.schema';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Document.name, schema: DocumentSchema },
      { name: ProposedEntry.name, schema: ProposedEntrySchema },
      // Read-only here, so the Inbox can show which OCR tier handled each file.
      { name: OcrResult.name, schema: OcrResultSchema },
    ]),
    BullModule.registerQueue({ name: DOCUMENT_PROCESSING_QUEUE }),
    OcrModule,
    ExtractionModule,
    ProposalsModule,
    IngestModule,
    CrmModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, StorageService, DocumentProcessingProcessor],
  exports: [DocumentsService, StorageService],
})
export class DocumentsModule {}
