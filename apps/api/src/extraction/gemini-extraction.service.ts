import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface GeminiExtractionResult {
  rawJson: string;
  tokensIn: number;
  tokensOut: number;
}

const EXTRACTION_MODEL = 'gemini-1.5-flash';

const EXTRACTION_PROMPT = `You are a structured data extractor for Indian accounting documents.
Extract the document data into the EXACT JSON format specified below.

MANDATORY RULES — any violation is a critical failure:
1. Output ONLY the raw JSON object. No markdown, no code fences, no explanation text.
2. Every absent field must be null. NEVER invent, guess, or hallucinate values.
3. All monetary amounts are INTEGER PAISE (1 rupee = 100 paise). Multiply rupee values by 100 and round to nearest integer. Never use decimals for money.
4. confidence values are floats 0.0–1.0. Use ≥0.9 only when the value is clear and unambiguous.
5. document_type must be exactly one of: purchase_invoice, sales_invoice, bank_statement, receipt, bill
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

@Injectable()
export class GeminiExtractionService {
  private readonly logger = new Logger(GeminiExtractionService.name);
  private genAI: GoogleGenerativeAI;

  constructor(private config: ConfigService) {
    this.genAI = new GoogleGenerativeAI(this.config.get<string>('gemini.apiKey') ?? '');
  }

  async extract(ocrText: string): Promise<GeminiExtractionResult> {
    const model = this.genAI.getGenerativeModel({
      model: EXTRACTION_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
        maxOutputTokens: 2048,
      },
    });

    const prompt = `${EXTRACTION_PROMPT}\n\nExtract data from this document:\n\n${ocrText}`;
    const result = await model.generateContent(prompt);
    const rawJson = result.response.text();
    const usage = result.response.usageMetadata;

    this.logger.log(
      `Gemini extraction: ${usage?.totalTokenCount ?? 0} tokens for ${ocrText.length} char input`,
    );

    return {
      rawJson,
      tokensIn: usage?.promptTokenCount ?? 0,
      tokensOut: usage?.candidatesTokenCount ?? 0,
    };
  }
}
