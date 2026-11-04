import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerationConfig, GoogleGenerativeAI } from '@google/generative-ai';

export const REPORT_MODEL = Symbol('REPORT_MODEL');

/**
 * The model behind the monthly narrative and Ask your books. It is handed
 * one org's computed figures and returns JSON; what it says is checked
 * against those figures before anyone sees it.
 */
export interface ReportModel {
  readonly available: boolean;
  json(prompt: string, maxTokens?: number): Promise<{ raw: unknown; tokensIn: number; tokensOut: number } | null>;
}

@Injectable()
export class GeminiReportModel implements ReportModel {
  private readonly logger = new Logger(GeminiReportModel.name);
  private readonly apiKey: string;
  private readonly modelName: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('gemini.apiKey') ?? '';
    this.modelName = config.get<string>('gemini.extractionModel') ?? 'gemini-2.5-flash';
  }

  get available() {
    return this.apiKey.length > 0;
  }

  async json(prompt: string, maxTokens = 700) {
    if (!this.available) return null;
    const model = new GoogleGenerativeAI(this.apiKey).getGenerativeModel({
      model: this.modelName,
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } } as GenerationConfig & { thinkingConfig: { thinkingBudget: number } },
    });
    const result = await model.generateContent(prompt);
    const usage = result.response.usageMetadata;
    const text = result.response.text();
    let raw: unknown = null;
    try {
      raw = JSON.parse(text);
    } catch {
      this.logger.warn(`Report model returned unreadable JSON: ${text.slice(0, 120)}`);
    }
    return { raw, tokensIn: usage?.promptTokenCount ?? 0, tokensOut: usage?.candidatesTokenCount ?? 0 };
  }
}
