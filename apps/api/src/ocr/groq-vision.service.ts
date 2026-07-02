import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';

export interface GroqVisionResult {
  text: string;
  confidence: number;
  tokensIn: number;
  tokensOut: number;
}

const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

const SYSTEM_PROMPT = `You are an OCR engine for Indian accounting documents.
Extract ALL visible text from the image as plain text, preserving layout with newlines.
Rules: output ONLY the extracted text — no commentary, no markdown, no analysis.
If the image is unreadable, output exactly: [UNREADABLE]`;

@Injectable()
export class GroqVisionService {
  private readonly logger = new Logger(GroqVisionService.name);
  private groq: Groq;

  constructor(private config: ConfigService) {
    this.groq = new Groq({ apiKey: this.config.get<string>('groq.apiKey') ?? '' });
  }

  async extractText(buffer: Buffer, mimeType: string): Promise<GroqVisionResult> {
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const response = await this.groq.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: SYSTEM_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 2048,
    });

    const text = response.choices[0]?.message?.content ?? '';
    const usage = response.usage;

    const unreadable = text.trim() === '[UNREADABLE]';
    this.logger.log(`Groq vision: ${usage?.total_tokens ?? 0} tokens, unreadable=${unreadable}`);

    return {
      text: unreadable ? '' : text,
      confidence: unreadable ? 0.1 : 0.75,
      tokensIn: usage?.prompt_tokens ?? 0,
      tokensOut: usage?.completion_tokens ?? 0,
    };
  }
}
