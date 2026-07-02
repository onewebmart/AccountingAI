import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExtractedDocument, ExtractedDocumentSchema } from './schemas/extracted-document.schema';
import { ExtractionService } from './extraction.service';
import { GeminiExtractionService } from './gemini-extraction.service';
import { OcrModule } from '../ocr/ocr.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExtractedDocument.name, schema: ExtractedDocumentSchema },
    ]),
    OcrModule, // for UsageMeterService
  ],
  providers: [ExtractionService, GeminiExtractionService],
  exports: [ExtractionService],
})
export class ExtractionModule {}
