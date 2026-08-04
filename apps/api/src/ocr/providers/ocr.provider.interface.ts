export const OCR_PROVIDER = 'OCR_PROVIDER';

export interface OcrProviderResult {
  text: string;
  layoutJson: Record<string, unknown>;
  /** 0–1 confidence from the provider */
  confidence: number;
  pageCount: number;
  /** Set by LLM-backed providers so the cascade can meter token spend. */
  tokensIn?: number;
  tokensOut?: number;
}

export interface OcrProvider {
  recognize(buffer: Buffer, mimeType: string): Promise<OcrProviderResult>;
  /**
   * True when this provider is already a vision LLM. The cascade then skips its
   * Tier 3 escalation — re-sending the same bytes to the same model costs tokens
   * and returns the same answer.
   */
  readonly isVisionLlm?: boolean;
}
