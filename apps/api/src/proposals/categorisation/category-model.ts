import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerationConfig, GoogleGenerativeAI } from '@google/generative-ai';

export const CATEGORY_MODEL = Symbol('CATEGORY_MODEL');

export interface CategoryChoiceInput {
  kind: 'bill' | 'withdrawal' | 'deposit';
  partyName: string | null;
  narration: string | null;
  lines: Array<{ description: string | null; hsnSac: string | null }>;
  amountPaise: number;
  /** The org's own accounts it may choose from, with a hint at what each is for. */
  accounts: Array<{ code: string; name: string }>;
}

export interface CategoryChoice {
  code: string;
  confidence: number;
  reason: string;
}

/**
 * The model that picks an account when no rule or past choice does. An
 * interface, so tests and an org with no AI key run without one.
 */
export interface CategoryModel {
  readonly available: boolean;
  choose(input: CategoryChoiceInput): Promise<CategoryChoice | null>;
}

const KIND_LABEL = { bill: 'a supplier bill', withdrawal: 'money paid out of the bank', deposit: 'money received into the bank' };

export function categoryPrompt(input: CategoryChoiceInput): string {
  const rupees = (input.amountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  return [
    'You file transactions into the books of a small Indian business.',
    'Choose the ONE account from the list below that this transaction belongs in.',
    'Reply with JSON only: {"code": "<account code>", "confidence": <0 to 1>, "reason": "<under 15 words>"}.',
    'If nothing fits, choose Suspense or Miscellaneous and give a low confidence.',
    '',
    'Accounts:',
    ...input.accounts.map((a) => `${a.code} ${a.name}`),
    '',
    'Transaction:',
    `Kind: ${KIND_LABEL[input.kind]}`,
    input.partyName ? `Party: ${input.partyName}` : null,
    input.narration ? `Bank narration: ${input.narration}` : null,
    ...input.lines.slice(0, 10).map((l) => `Item: ${l.description ?? '—'}${l.hsnSac ? ` (HSN/SAC ${l.hsnSac})` : ''}`),
    `Amount: ₹${rupees}`,
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
}

/** Gemini, the same model family the extraction pipeline uses. */
@Injectable()
export class GeminiCategoryModel implements CategoryModel {
  private readonly logger = new Logger(GeminiCategoryModel.name);
  private readonly apiKey: string;
  private readonly modelName: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('gemini.apiKey') ?? '';
    this.modelName = config.get<string>('gemini.extractionModel') ?? 'gemini-2.5-flash';
  }

  get available(): boolean {
    return this.apiKey.length > 0;
  }

  async choose(input: CategoryChoiceInput): Promise<CategoryChoice | null> {
    if (!this.available) return null;
    const model = new GoogleGenerativeAI(this.apiKey).getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
        maxOutputTokens: 200,
        thinkingConfig: { thinkingBudget: 0 },
      } as GenerationConfig & { thinkingConfig: { thinkingBudget: number } },
    });
    const result = await model.generateContent(categoryPrompt(input));
    const text = result.response.text();
    try {
      const parsed = JSON.parse(text) as { code?: unknown; confidence?: unknown; reason?: unknown };
      if (typeof parsed.code !== 'string') return null;
      return {
        code: parsed.code.trim(),
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 160) : 'Suggested by AI',
      };
    } catch {
      this.logger.warn(`Category model returned unreadable JSON: ${text.slice(0, 120)}`);
      return null;
    }
  }
}
