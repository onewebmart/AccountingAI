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
import { GlModule } from '../gl/gl.module';
import { IngestModule } from '../ingest/ingest.module';
import { CrmModule } from '../crm/crm.module';
import { OcrResult, OcrResultSchema } from '../ocr/schemas/ocr-result.schema';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';
import { ExtractedDocument, ExtractedDocumentSchema } from '../extraction/schemas/extracted-document.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { DocumentEntryController } from './document-entry.controller';
import { DocumentEntryService } from './document-entry.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Document.name, schema: DocumentSchema },
      { name: ProposedEntry.name, schema: ProposedEntrySchema },
      // Read-only here, so the Inbox can show which OCR tier handled each file.
      { name: OcrResult.name, schema: OcrResultSchema },
      // Read only, for "Add to": what the AI read, and the party it is from.
      { name: ExtractedDocument.name, schema: ExtractedDocumentSchema },
      { name: Vendor.name, schema: VendorSchema },
      { name: Customer.name, schema: CustomerSchema },
    ]),
    BullModule.registerQueue({ name: DOCUMENT_PROCESSING_QUEUE }),
    OcrModule,
    ExtractionModule,
    ProposalsModule,
    GlModule, // AuditService
    IngestModule,
    CrmModule,
  ],
  controllers: [DocumentsController, DocumentEntryController],
  providers: [DocumentsService, StorageService, DocumentProcessingProcessor, DocumentEntryService],
  exports: [DocumentsService, StorageService],
})
export class DocumentsModule {}
