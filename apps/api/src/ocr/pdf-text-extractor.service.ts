import { Injectable } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';

export interface PdfExtractResult {
  text: string;
  pageCount: number;
}

@Injectable()
export class PdfTextExtractorService {
  async extract(buffer: Buffer): Promise<PdfExtractResult> {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return {
        text: (result.text ?? '').trim(),
        pageCount: result.pages.length || 1,
      };
    } finally {
      await parser.destroy();
    }
  }
}
