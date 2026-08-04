import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerationConfig } from '@google/generative-ai';

export interface GeminiVisionResult {
  text: string;
  confidence: number;
  tokensIn: number;
  tokensOut: number;
  pageCount: number;
}

/** Mime types Gemini accepts as inline document/image data. */
const SUPPORTED_INLINE_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const VISION_PROMPT = `You are an OCR engine for Indian accounting documents.
Transcribe ALL visible text from this document as plain text.

Rules:
- Preserve the reading order and use newlines to keep the layout readable.
- Keep tables aligned: one row per line, columns separated by " | ".
- Transcribe numbers, GSTIN, invoice numbers and dates EXACTLY as printed. Never reformat or correct them.
- Include header, footer, stamps and handwritten notes if legible.
- Output ONLY the transcribed text — no commentary, no markdown fences, no analysis.
- If the document is genuinely unreadable, output exactly: [UNREADABLE]`;

@Injectable()
export class GeminiVisionService {
  private readonly logger = new Logger(GeminiVisionService.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly modelName: string;
  private readonly hasKey: boolean;

  constructor(private config: ConfigService) {
    const apiKey = this.config.get<string>('gemini.apiKey') ?? '';
    this.hasKey = apiKey.length > 0;
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.modelName = this.config.get<string>('gemini.visionModel') ?? 'gemini-2.5-flash';
  }

  isConfigured(): boolean {
    return this.hasKey;
  }

  async extractText(buffer: Buffer, mimeType: string): Promise<GeminiVisionResult> {
    if (!this.hasKey) {
      throw new Error('GEMINI_API_KEY is not configured — cannot run OCR.');
    }

    // Anything Gemini can't take directly (TIFF, for instance) is labelled JPEG;
    // the API sniffs the actual bytes, so a plausible label still gets read.
    const inlineMimeType = SUPPORTED_INLINE_TYPES.has(mimeType) ? mimeType : 'image/jpeg';

    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 8192,
        // Transcription needs no reasoning budget, and Gemini 2.5 bills thinking
        // tokens against the output limit — leaving it on truncates long pages.
        thinkingConfig: { thinkingBudget: 0 },
      } as GenerationConfig & { thinkingConfig: { thinkingBudget: number } },
    });

    const result = await model.generateContent([
      { text: VISION_PROMPT },
      { inlineData: { mimeType: inlineMimeType, data: buffer.toString('base64') } },
    ]);

    const text = result.response.text() ?? '';
    const usage = result.response.usageMetadata;
    const trimmed = text.trim();
    const unreadable = trimmed === '[UNREADABLE]' || trimmed.length === 0;

    this.logger.log(
      `Gemini vision (${this.modelName}): ${trimmed.length} chars, ` +
        `${usage?.totalTokenCount ?? 0} tokens, unreadable=${unreadable}`,
    );

    return {
      text: unreadable ? '' : text,
      // Confidence is a proxy: a rich transcription is far more trustworthy than a
      // near-empty one, and an explicit [UNREADABLE] must fall below every threshold.
      confidence: unreadable ? 0.1 : trimmed.length > 200 ? 0.9 : 0.75,
      tokensIn: usage?.promptTokenCount ?? 0,
      tokensOut: usage?.candidatesTokenCount ?? 0,
      pageCount: 1,
    };
  }
}
