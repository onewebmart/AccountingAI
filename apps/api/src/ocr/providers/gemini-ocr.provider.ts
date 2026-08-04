import { Injectable, Logger } from '@nestjs/common';
import { OcrProvider, OcrProviderResult } from './ocr.provider.interface';
import { GeminiVisionService } from '../gemini-vision.service';

/**
 * Real OCR provider backed by Gemini vision.
 *
 * Gemini reads images and PDFs natively, so the same call handles a phone photo of a
 * bill and a scanned multi-page PDF. Confidence comes back from the vision service;
 * the cascade escalates on its own if the page turns out to be unreadable.
 */
@Injectable()
export class GeminiOcrProvider implements OcrProvider {
  private readonly logger = new Logger(GeminiOcrProvider.name);

  readonly isVisionLlm = true;

  constructor(private vision: GeminiVisionService) {}

  async recognize(buffer: Buffer, mimeType: string): Promise<OcrProviderResult> {
    const result = await this.vision.extractText(buffer, mimeType);

    this.logger.log(
      `Gemini OCR: ${result.text.length} chars from ${mimeType} (${buffer.length} bytes)`,
    );

    return {
      text: result.text,
      layoutJson: { source: 'gemini-vision', mimeType },
      confidence: result.confidence,
      pageCount: result.pageCount,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    };
  }
}
