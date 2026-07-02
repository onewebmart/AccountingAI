import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface GeminiVisionResult {
  text: string;
  confidence: number;
  tokensIn: number;
  tokensOut: number;
}

const VISION_MODEL = 'gemini-1.5-flash';

const VISION_PROMPT = `You are an OCR engine for Indian accounting documents.
Extract ALL visible text from the image as plain text, preserving layout with newlines.
Rules: output ONLY the extracted text — no commentary, no markdown, no analysis.
If the image is unreadable, output exactly: [UNREADABLE]`;

@Injectable()
export class GeminiVisionService {
  private readonly logger = new Logger(GeminiVisionService.name);
  private genAI: GoogleGenerativeAI;

  constructor(private config: ConfigService) {
    this.genAI = new GoogleGenerativeAI(this.config.get<string>('gemini.apiKey') ?? '');
  }

  async extractText(buffer: Buffer, mimeType: string): Promise<GeminiVisionResult> {
    // Gemini vision only accepts image types; treat application/pdf as image/jpeg for vision fallback
    const imageMimeType = mimeType.startsWith('image/') ? mimeType : 'image/jpeg';

    const model = this.genAI.getGenerativeModel({
      model: VISION_MODEL,
      generationConfig: { temperature: 0, maxOutputTokens: 2048 },
    });

    const result = await model.generateContent([
      { text: VISION_PROMPT },
      { inlineData: { mimeType: imageMimeType, data: buffer.toString('base64') } },
    ]);

    const text = result.response.text();
    const usage = result.response.usageMetadata;
    const unreadable = text.trim() === '[UNREADABLE]';

    this.logger.log(`Gemini vision: ${usage?.totalTokenCount ?? 0} tokens, unreadable=${unreadable}`);

    return {
      text: unreadable ? '' : text,
      confidence: unreadable ? 0.1 : 0.8,
      tokensIn: usage?.promptTokenCount ?? 0,
      tokensOut: usage?.candidatesTokenCount ?? 0,
    };
  }
}
