import { Injectable } from '@nestjs/common';
import { OcrProvider, OcrProviderResult } from './ocr.provider.interface';

/**
 * Stub OCR provider used in development and tests.
 * Swap for a real Textract/Google Vision implementation via OCR_PROVIDER token.
 */
@Injectable()
export class MockOcrProvider implements OcrProvider {
  async recognize(buffer: Buffer, mimeType: string): Promise<OcrProviderResult> {
    return {
      text: `[MockOCR] Extracted from ${mimeType} (${buffer.length} bytes)`,
      layoutJson: { pages: [{ width: 612, height: 792, blocks: [] }] },
      confidence: 0.85,
      pageCount: 1,
    };
  }
}
