import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerationConfig, GoogleGenerativeAI } from '@google/generative-ai';
import { HsnGuess, ITEM_GST_RATES, ItemKind, UQC_CODES, hsnProblem } from './hsn';

export const HSN_MODEL = Symbol('HSN_MODEL');

export interface HsnModelInput {
  name: string;
  description: string | null;
  kind: ItemKind | null;
}

export interface HsnModelAnswer {
  raw: unknown;
  tokensIn: number;
  tokensOut: number;
}

/** The model asked when neither the org's history nor a rule knows the code. */
export interface HsnModel {
  readonly available: boolean;
  ask(input: HsnModelInput): Promise<HsnModelAnswer | null>;
}

/** The model's confidence is capped, so a person always checks its code. */
export const MODEL_CONFIDENCE_CAP = 0.8;

export function hsnPrompt(input: HsnModelInput): string {
  return [
    'You classify items for GST in India.',
    'Give the HSN code (goods) or SAC code (services) for the item below, and its usual GST rate.',
    'Reply with JSON only: {"hsnSac": "<digits>", "kind": "goods" | "service", "gstRatePct": <number or null>, "uqc": "<GST unit code>", "confidence": <0 to 1>, "reason": "<under 20 words>"}.',
    'Goods: a 4, 6 or 8 digit HSN code. Services: a 6 digit SAC code starting 99.',
    `gstRatePct is one of ${ITEM_GST_RATES.join(', ')}, or null if it depends on details not given.`,
    'uqc is a GST unit code such as NOS, KGS, LTR, MTR, BOX or PCS; NA for services.',
    'If you are not sure, give your best code with a low confidence.',
    '',
    `Item: ${input.name}`,
    input.description ? `Description: ${input.description}` : null,
    input.kind ? `It is ${input.kind === 'goods' ? 'goods' : 'a service'}.` : null,
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
}

/**
 * The model's answer, checked. A malformed code, a code of the wrong kind or
 * a rate outside the slabs is dropped rather than passed on.
 */
export function readHsnAnswer(raw: unknown, askedKind: ItemKind | null): (HsnGuess & { confidence: number }) | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const code = typeof a.hsnSac === 'string' ? a.hsnSac.replace(/\s/g, '') : typeof a.hsnSac === 'number' ? String(a.hsnSac) : '';
  const kind: ItemKind = a.kind === 'service' || a.kind === 'goods' ? a.kind : code.startsWith('99') ? 'service' : 'goods';
  if (askedKind && kind !== askedKind) return null;
  if (!code || hsnProblem(code, kind)) return null;
  const rate = typeof a.gstRatePct === 'number' && (ITEM_GST_RATES as readonly number[]).includes(a.gstRatePct) ? a.gstRatePct : null;
  const uqcRaw = typeof a.uqc === 'string' ? a.uqc.trim().toUpperCase() : '';
  const uqc = kind === 'service' ? 'NA' : (UQC_CODES as readonly string[]).includes(uqcRaw) && uqcRaw !== 'NA' ? uqcRaw : 'NOS';
  const confidence = Math.min(MODEL_CONFIDENCE_CAP, Math.max(0, typeof a.confidence === 'number' ? a.confidence : 0.5));
  const reason = typeof a.reason === 'string' && a.reason.trim() ? a.reason.trim().slice(0, 200) : 'Suggested by AI';
  return { hsnSac: code, kind, gstRatePct: rate, uqc, reason, confidence };
}

@Injectable()
export class GeminiHsnModel implements HsnModel {
  private readonly logger = new Logger(GeminiHsnModel.name);
  private readonly apiKey: string;
  private readonly modelName: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('gemini.apiKey') ?? '';
    this.modelName = config.get<string>('gemini.extractionModel') ?? 'gemini-2.5-flash';
  }

  get available(): boolean {
    return this.apiKey.length > 0;
  }

  async ask(input: HsnModelInput): Promise<HsnModelAnswer | null> {
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
    const result = await model.generateContent(hsnPrompt(input));
    const usage = result.response.usageMetadata;
    const text = result.response.text();
    try {
      return { raw: JSON.parse(text), tokensIn: usage?.promptTokenCount ?? 0, tokensOut: usage?.candidatesTokenCount ?? 0 };
    } catch {
      this.logger.warn(`HSN model returned unreadable JSON: ${text.slice(0, 120)}`);
      return { raw: null, tokensIn: usage?.promptTokenCount ?? 0, tokensOut: usage?.candidatesTokenCount ?? 0 };
    }
  }
}
