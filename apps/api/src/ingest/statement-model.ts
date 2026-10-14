import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerationConfig, GoogleGenerativeAI } from '@google/generative-ai';
import { ParsedStatement } from './statement-text-parser';

export const STATEMENT_MODEL = Symbol('STATEMENT_MODEL');

/**
 * Reads a statement the text parser could not: a layout it does not know, or
 * OCR that lost the line breaks. Whatever it returns is still checked line by
 * line against the balances before anything is imported.
 */
export interface StatementModel {
  readonly available: boolean;
  read(text: string): Promise<ParsedStatement | null>;
}

/** Longer than this and the answer would not fit the model's output; the parser has to do. */
export const STATEMENT_MODEL_MAX_CHARS = 40_000;

const PROMPT = `You read Indian bank statements. From the statement text below, return JSON only:
{"accountNumber": string|null, "bankName": string|null, "openingBalance": number, "closingBalance": number,
 "lines": [{"date": "YYYY-MM-DD", "description": string, "reference": string|null,
            "withdrawal": number, "deposit": number, "balance": number|null}]}
Rules: amounts in rupees as plain numbers (12345.67), no commas. Exactly one of withdrawal or deposit is non-zero per line.
Keep the lines in statement order. Do not invent lines; skip headers, totals and summaries.`;

/** Rupees as the model writes them → integer paise. The one conversion on this path (Invariant 1). */
function paise(rupees: unknown): number {
  const n = typeof rupees === 'number' ? rupees : Number(String(rupees ?? '0').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

@Injectable()
export class GeminiStatementModel implements StatementModel {
  private readonly logger = new Logger(GeminiStatementModel.name);
  private readonly apiKey: string;
  private readonly modelName: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('gemini.apiKey') ?? '';
    this.modelName = config.get<string>('gemini.extractionModel') ?? 'gemini-2.5-flash';
  }

  get available(): boolean {
    return this.apiKey.length > 0;
  }

  async read(text: string): Promise<ParsedStatement | null> {
    if (!this.available || text.length > STATEMENT_MODEL_MAX_CHARS) return null;
    const model = new GoogleGenerativeAI(this.apiKey).getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
        maxOutputTokens: 16_000,
        thinkingConfig: { thinkingBudget: 0 },
      } as GenerationConfig & { thinkingConfig: { thinkingBudget: number } },
    });
    const result = await model.generateContent(`${PROMPT}\n\nStatement:\n${text}`);
    try {
      const raw = JSON.parse(result.response.text()) as {
        accountNumber?: string | null;
        bankName?: string | null;
        openingBalance?: unknown;
        closingBalance?: unknown;
        lines?: Array<{ date?: string; description?: string; reference?: string | null; withdrawal?: unknown; deposit?: unknown; balance?: unknown }>;
      };
      const lines = (raw.lines ?? [])
        .filter((l) => typeof l.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l.date))
        .map((l) => ({
          date: l.date!,
          description: (l.description ?? '').trim() || 'Bank transaction',
          reference: l.reference ?? null,
          debitPaise: Math.abs(paise(l.withdrawal)),
          creditPaise: Math.abs(paise(l.deposit)),
          runningBalancePaise: l.balance === null || l.balance === undefined ? null : paise(l.balance),
        }));
      return {
        openingBalancePaise: paise(raw.openingBalance),
        closingBalancePaise: paise(raw.closingBalance),
        lines,
        accountNumber: raw.accountNumber ?? null,
        bankName: raw.bankName ?? null,
      };
    } catch (err) {
      this.logger.warn(`Statement model returned unreadable JSON: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
