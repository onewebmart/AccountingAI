import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerationConfig } from '@google/generative-ai';

export interface GeminiExtractionResult {
  rawJson: string;
  tokensIn: number;
  tokensOut: number;
}

/** Who "we" are, so the model can tell an inward bill from an outward invoice. */
export interface OrgContext {
  name: string;
  gstin?: string | null;
  state?: string | null;
}

const DEFAULT_EXTRACTION_MODEL = 'gemini-2.5-flash';

/** Enough headroom for a long invoice with many line items. */
const MAX_OUTPUT_TOKENS = 8192;

const EXTRACTION_PROMPT = `You are a structured data extractor for Indian accounting documents.
Extract the document data into the EXACT JSON format specified below.

MANDATORY RULES — any violation is a critical failure:
1. Output ONLY the raw JSON object. No markdown, no code fences, no explanation text.
2. Every absent field must be null. NEVER invent, guess, or hallucinate values.
3. All monetary amounts are INTEGER PAISE (1 rupee = 100 paise). Multiply rupee values by 100 and round to nearest integer. Never use decimals for money.
4. confidence values are floats 0.0–1.0. Use ≥0.9 only when the value is clear and unambiguous.
5. document_type must be exactly one of: purchase_invoice, sales_invoice, bank_statement, receipt, bill
5a. invoice_date must be ISO format YYYY-MM-DD. Indian invoices print dd/mm/yyyy — read them day-first (13/04/2025 is 2025-04-13, NOT 2025-13-04).
5b. document_type is from the buyer's point of view: a bill received from a supplier is purchase_invoice; an invoice raised to a customer is sales_invoice.
6. raw_warnings: list every data quality concern as a short string (e.g. "line items do not sum to total", "GSTIN format invalid", "date ambiguous"). Use [] if none.

OUTPUT SCHEMA (fill in values, do not modify keys):
{
  "document_type": "purchase_invoice",
  "confidence_overall": 0.0,
  "vendor": { "name": null, "gstin": null, "confidence": 0.0 },
  "invoice_number": { "value": null, "confidence": 0.0 },
  "invoice_date": { "value": null, "confidence": 0.0 },
  "place_of_supply": null,
  "currency": "INR",
  "amounts_paise": {
    "taxable_value": 0, "cgst": 0, "sgst": 0, "igst": 0, "cess": 0, "total": 0,
    "confidence": 0.0
  },
  "line_items": [],
  "is_reverse_charge": false,
  "raw_warnings": []
}`;

/**
 * Direction is the one thing the document itself cannot tell you: the same PDF is
 * a purchase to the buyer and a sale to the seller. Naming the account holder lets
 * the model classify it correctly and pick the counterparty as the vendor.
 */
function orgContextBlock(org?: OrgContext): string {
  if (!org?.name) return '';
  return `WHO YOU ARE WORKING FOR (the account holder):
- Business name: ${org.name}
${org.gstin ? `- GSTIN: ${org.gstin}\n` : ''}${org.state ? `- State: ${org.state}\n` : ''}
Use this to set document_type:
- If the account holder is the BUYER / "Bill To" / recipient, this is a purchase_invoice.
- If the account holder is the SELLER / issuer of the invoice, this is a sales_invoice.
The "vendor" object must always describe the OTHER party (the counterparty), never the account holder.`;
}

@Injectable()
export class GeminiExtractionService {
  private readonly logger = new Logger(GeminiExtractionService.name);
  private genAI: GoogleGenerativeAI;
  private readonly modelName: string;

  constructor(private config: ConfigService) {
    this.genAI = new GoogleGenerativeAI(this.config.get<string>('gemini.apiKey') ?? '');
    this.modelName =
      this.config.get<string>('gemini.extractionModel') ?? DEFAULT_EXTRACTION_MODEL;
  }

  async extract(ocrText: string, org?: OrgContext): Promise<GeminiExtractionResult> {
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // Gemini 2.5 reasons before answering and those thinking tokens are billed
        // against the same output budget. Left on, they exhaust the budget and the
        // JSON comes back truncated mid-string. This extraction is a transcription
        // task with a fixed schema, so no reasoning budget is needed.
        thinkingConfig: { thinkingBudget: 0 },
      } as GenerationConfig & { thinkingConfig: { thinkingBudget: number } },
    });

    const prompt = [
      EXTRACTION_PROMPT,
      orgContextBlock(org),
      `Extract data from this document:\n\n${ocrText}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const result = await model.generateContent(prompt);
    const rawJson = result.response.text();
    const usage = result.response.usageMetadata;
    const finishReason = result.response.candidates?.[0]?.finishReason;

    this.logger.log(
      `Gemini extraction (${this.modelName}): ${usage?.totalTokenCount ?? 0} tokens ` +
        `for ${ocrText.length} char input, finish=${finishReason ?? 'unknown'}`,
    );

    if (finishReason === 'MAX_TOKENS') {
      // Truncated output is invalid JSON — say so plainly instead of letting the
      // caller puzzle over a "Unterminated string" parse error.
      throw new Error(
        `Gemini hit the ${MAX_OUTPUT_TOKENS}-token output limit — the document is too long to extract in one pass.`,
      );
    }

    return {
      rawJson,
      tokensIn: usage?.promptTokenCount ?? 0,
      tokensOut: usage?.candidatesTokenCount ?? 0,
    };
  }
}
