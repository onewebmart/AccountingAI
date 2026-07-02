export const OCR_PROVIDER = 'OCR_PROVIDER';

export interface OcrProviderResult {
  text: string;
  layoutJson: Record<string, unknown>;
  /** 0–1 confidence from the provider */
  confidence: number;
  pageCount: number;
}

export interface OcrProvider {
  recognize(buffer: Buffer, mimeType: string): Promise<OcrProviderResult>;
}
