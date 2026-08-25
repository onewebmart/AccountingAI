import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerationConfig, GoogleGenerativeAI } from '@google/generative-ai';
import { FirmService, LeadSource, LeadStage } from '@ai-accounting/shared';

const DEFAULT_MODEL = 'gemini-2.5-flash';

/**
 * Output budget, which on a thinking model must also cover the thinking.
 *
 * gemini-2.5-flash spends its reasoning tokens out of `maxOutputTokens`, and on
 * this prompt that is ~1,200 before a single character of JSON is written. The
 * previous 1,024 meant reasoning consumed the entire budget: the response came
 * back `MAX_TOKENS`, truncated mid-sentence, and every qualification failed.
 * Measured need is ~1,440 (1,176 thinking + 262 output); this leaves headroom
 * for a longer enquiry without paying for tokens the model never uses.
 */
const MAX_OUTPUT_TOKENS = 4096;

export interface QualifyInput {
  name: string;
  contactName?: string;
  source: LeadSource;
  services: FirmService[];
  enquiryNotes?: string;
  estimatedValuePaise?: number;
}

export interface QualifyResult {
  score: number;
  summary: string;
  signals: string[];
  openQuestions: string[];
  recommendedStage: LeadStage;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * The model is asked to assess, not to decide.
 *
 * `recommended_stage` is explicitly framed as advice, and the caller never
 * applies it — a partner does. Stages it may recommend are limited to the two
 * that are reversible; WON and LOST are commercial facts a human owns.
 */
const QUALIFICATION_PROMPT = `You are assisting an Indian chartered accountancy firm to triage an inbound enquiry.

Assess how well this enquiry fits a CA practice offering GST filing, income-tax
returns, TDS, ROC/MCA compliance, statutory audit and bookkeeping.

Return ONLY JSON matching exactly this shape:
{
  "score": <integer 0-100, how strong this lead is>,
  "summary": "<one or two sentences a partner can read in five seconds>",
  "signals": ["<concrete reason drawn from the enquiry>", ...],
  "open_questions": ["<what the firm must still ask before proposing>", ...],
  "recommended_stage": "QUALIFYING" | "PROPOSAL_SENT"
}

Scoring guidance:
- Higher: a clear statutory need, a registered entity, recurring work, an
  explicit budget or timeline, a referral.
- Lower: vague enquiries, one-off tasks, price-only questions, no entity
  details, or work outside the services listed above.

Rules:
- Base every signal on what the enquiry actually says. Do not invent turnover,
  entity type or budget that was not stated.
- Put anything you are unsure about in open_questions instead of assuming it.
- Recommend PROPOSAL_SENT only when the enquiry already contains enough detail
  to price the work. Otherwise recommend QUALIFYING.
- Write in English. Keep signals and open_questions short.`;

function rupees(paise?: number): string {
  if (paise === undefined || paise === null) return 'not stated';
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

@Injectable()
export class LeadQualifierService {
  private readonly logger = new Logger(LeadQualifierService.name);
  private genAI: GoogleGenerativeAI;
  private readonly modelName: string;

  constructor(private config: ConfigService) {
    this.genAI = new GoogleGenerativeAI(this.config.get<string>('gemini.apiKey') ?? '');
    this.modelName = this.config.get<string>('gemini.extractionModel') ?? DEFAULT_MODEL;
  }

  async qualify(lead: QualifyInput): Promise<QualifyResult> {
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // Same reasoning as the extraction service: 2.5's thinking tokens are
        // billed against the output budget and truncate the JSON mid-string.
        thinkingConfig: { thinkingBudget: 0 },
      } as GenerationConfig & { thinkingConfig: { thinkingBudget: number } },
    });

    const enquiry = [
      `Lead name: ${lead.name}`,
      lead.contactName ? `Contact person: ${lead.contactName}` : null,
      `Source: ${lead.source}`,
      `Services requested: ${lead.services.length ? lead.services.join(', ') : 'not specified'}`,
      `Estimated annual fee: ${rupees(lead.estimatedValuePaise)}`,
      lead.enquiryNotes ? `What they said:\n${lead.enquiryNotes}` : 'What they said: (nothing recorded)',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await model.generateContent(`${QUALIFICATION_PROMPT}\n\nEnquiry:\n${enquiry}`);
    const usage = result.response.usageMetadata;
    const finishReason = result.response.candidates?.[0]?.finishReason;

    if (finishReason === 'MAX_TOKENS') {
      throw new Error(
        `Gemini hit the ${MAX_OUTPUT_TOKENS}-token output limit while qualifying the lead.`,
      );
    }

    const parsed = this.parse(result.response.text());

    this.logger.log(
      `Qualified lead "${lead.name}": score=${parsed.score} stage=${parsed.recommendedStage} ` +
        `(${usage?.totalTokenCount ?? 0} tokens)`,
    );

    return {
      ...parsed,
      model: this.modelName,
      tokensIn: usage?.promptTokenCount ?? 0,
      tokensOut: usage?.candidatesTokenCount ?? 0,
    };
  }

  /**
   * Parses and clamps the model's JSON.
   *
   * Everything is validated rather than trusted: a score of 950 or a
   * recommended stage of "WON" is the model misbehaving, and silently storing
   * either would put nonsense in front of a partner.
   */
  private parse(raw: string): Omit<QualifyResult, 'model' | 'tokensIn' | 'tokensOut'> {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error(`Gemini returned invalid JSON while qualifying the lead: ${raw.slice(0, 200)}`);
    }

    const rawScore = Number(json['score']);
    const score = Number.isFinite(rawScore) ? Math.min(100, Math.max(0, Math.round(rawScore))) : 0;

    const asStrings = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, 8)
        : [];

    // Only the two reversible stages may be recommended. WON and LOST are
    // commercial facts, not model output.
    const suggested = String(json['recommended_stage'] ?? '');
    const recommendedStage =
      suggested === LeadStage.PROPOSAL_SENT ? LeadStage.PROPOSAL_SENT : LeadStage.QUALIFYING;

    const summary =
      typeof json['summary'] === 'string' && json['summary'].trim()
        ? json['summary'].trim()
        : 'No summary returned.';

    return {
      score,
      summary,
      signals: asStrings(json['signals']),
      openQuestions: asStrings(json['open_questions']),
      recommendedStage,
    };
  }
}
