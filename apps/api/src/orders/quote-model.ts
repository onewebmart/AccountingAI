import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerationConfig, GoogleGenerativeAI } from '@google/generative-ai';

export const QUOTE_MODEL = Symbol('QUOTE_MODEL');

/** Asked only when the rules read nothing: which of the org's items, how many. */
export interface QuoteModel {
  readonly available: boolean;
  read(message: string, itemNames: string[]): Promise<{ raw: unknown; tokensIn: number; tokensOut: number } | null>;
}

export function quotePrompt(message: string, itemNames: string[]): string {
  return [
    'A customer of a small Indian business sent the message below, asking for goods or services.',
    'List what they ask for. Use ONLY names from the item list, exactly as written; leave out anything not on it.',
    'Reply with JSON only: {"lines": [{"item": "<name from the list>", "qty": <number>}]}.',
    '',
    'Items:',
    ...itemNames.slice(0, 300),
    '',
    'Message:',
    message.slice(0, 2000),
  ].join('\n');
}

/** The model's lines, kept only where they name a real item and a sensible quantity. */
export function readQuoteAnswer(raw: unknown, itemNames: string[]): Array<{ item: string; qty: number }> {
  const lines = (raw as { lines?: unknown })?.lines;
  if (!Array.isArray(lines)) return [];
  const known = new Map(itemNames.map((n) => [n.toLowerCase(), n]));
  return lines.flatMap((l) => {
    const name = typeof l?.item === 'string' ? known.get(l.item.trim().toLowerCase()) : undefined;
    const qty = typeof l?.qty === 'number' ? l.qty : Number(l?.qty);
    return name && qty > 0 && qty < 1_000_000 ? [{ item: name, qty: Math.round(qty * 1000) / 1000 }] : [];
  });
}

@Injectable()
export class GeminiQuoteModel implements QuoteModel {
  private readonly logger = new Logger(GeminiQuoteModel.name);
  private readonly apiKey: string;
  private readonly modelName: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('gemini.apiKey') ?? '';
    this.modelName = config.get<string>('gemini.extractionModel') ?? 'gemini-2.5-flash';
  }

  get available() {
    return this.apiKey.length > 0;
  }

  async read(message: string, itemNames: string[]) {
    if (!this.available) return null;
    const model = new GoogleGenerativeAI(this.apiKey).getGenerativeModel({
      model: this.modelName,
      generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 600, thinkingConfig: { thinkingBudget: 0 } } as GenerationConfig & { thinkingConfig: { thinkingBudget: number } },
    });
    const result = await model.generateContent(quotePrompt(message, itemNames));
    const usage = result.response.usageMetadata;
    const text = result.response.text();
    let raw: unknown = null;
    try {
      raw = JSON.parse(text);
    } catch {
      this.logger.warn(`Quote model returned unreadable JSON: ${text.slice(0, 120)}`);
    }
    return { raw, tokensIn: usage?.promptTokenCount ?? 0, tokensOut: usage?.candidatesTokenCount ?? 0 };
  }
}
