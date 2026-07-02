import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OcrResult, OcrResultSchema } from './schemas/ocr-result.schema';
import { UsageMeter, UsageMeterSchema } from './schemas/usage-meter.schema';
import { OCR_PROVIDER } from './providers/ocr.provider.interface';
import { MockOcrProvider } from './providers/mock-ocr.provider';
import { OcrCascadeService } from './ocr-cascade.service';
import { GeminiVisionService } from './gemini-vision.service';
import { UsageMeterService } from './usage-meter.service';
import { PdfTextExtractorService } from './pdf-text-extractor.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OcrResult.name, schema: OcrResultSchema },
      { name: UsageMeter.name, schema: UsageMeterSchema },
    ]),
  ],
  providers: [
    OcrCascadeService,
    GeminiVisionService,
    UsageMeterService,
    PdfTextExtractorService,
    { provide: OCR_PROVIDER, useClass: MockOcrProvider },
  ],
  exports: [OcrCascadeService, UsageMeterService],
})
export class OcrModule {}
