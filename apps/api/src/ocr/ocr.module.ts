import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { OcrResult, OcrResultSchema } from './schemas/ocr-result.schema';
import { UsageMeter, UsageMeterSchema } from './schemas/usage-meter.schema';
import { OCR_PROVIDER } from './providers/ocr.provider.interface';
import { MockOcrProvider } from './providers/mock-ocr.provider';
import { GeminiOcrProvider } from './providers/gemini-ocr.provider';
import { OcrCascadeService } from './ocr-cascade.service';
import { GeminiVisionService } from './gemini-vision.service';
import { UsageMeterService } from './usage-meter.service';
import { PdfTextExtractorService } from './pdf-text-extractor.service';
import { DocumentTextExtractorService } from './document-text-extractor.service';

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
    DocumentTextExtractorService,
    GeminiOcrProvider,
    MockOcrProvider,
    {
      // Real OCR whenever a Gemini key is present; the stub only stands in when
      // the platform runs without one (offline tests, CI without secrets).
      provide: OCR_PROVIDER,
      inject: [ConfigService, GeminiOcrProvider, MockOcrProvider],
      useFactory: (
        config: ConfigService,
        gemini: GeminiOcrProvider,
        mock: MockOcrProvider,
      ) => {
        const hasKey = !!config.get<string>('gemini.apiKey');
        if (!hasKey) {
          new Logger('OcrModule').warn(
            'GEMINI_API_KEY is not set — falling back to MockOcrProvider. OCR will return placeholder text.',
          );
          return mock;
        }
        return gemini;
      },
    },
  ],
  exports: [OcrCascadeService, UsageMeterService, GeminiVisionService],
})
export class OcrModule {}
