import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ExtractedDocument, ExtractedDocumentDocument } from './schemas/extracted-document.schema';
import { GeminiExtractionService } from './gemini-extraction.service';
import { UsageMeterService } from '../ocr/usage-meter.service';

export interface ExtractionInput {
  documentId: string;
  orgId: string;
  ocrResultId: string;
  ocrText: string;
}

const VALID_DOC_TYPES = new Set([
  'purchase_invoice',
  'sales_invoice',
  'bank_statement',
  'receipt',
  'bill',
]);

/** Validates the raw Groq JSON against the canonical contract. Returns the normalized object or null. */
function validateAndNormalize(raw: unknown): ReturnType<typeof buildDbPayload> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;

  if (!VALID_DOC_TYPES.has(d.document_type as string)) return null;
  if (typeof d.confidence_overall !== 'number') return null;

  const vendor = d.vendor as Record<string, unknown>;
  if (typeof vendor !== 'object' || vendor === null) return null;
  if (typeof vendor.confidence !== 'number') return null;

  const invoiceNumber = d.invoice_number as Record<string, unknown>;
  if (typeof invoiceNumber !== 'object' || invoiceNumber === null) return null;

  const invoiceDate = d.invoice_date as Record<string, unknown>;
  if (typeof invoiceDate !== 'object' || invoiceDate === null) return null;

  const amounts = d.amounts_paise as Record<string, unknown>;
  if (typeof amounts !== 'object' || amounts === null) return null;

  // All money fields must be non-negative integers (Invariant 1)
  const moneyFields = ['taxable_value', 'cgst', 'sgst', 'igst', 'cess', 'total'] as const;
  for (const f of moneyFields) {
    const v = amounts[f];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null;
  }
  if (typeof amounts.confidence !== 'number') return null;

  const lineItems = Array.isArray(d.line_items) ? d.line_items : [];
  const warnings: string[] = Array.isArray(d.raw_warnings)
    ? (d.raw_warnings as unknown[]).filter((w): w is string => typeof w === 'string')
    : [];

  // Advisory check: line-item amounts should sum to taxable value
  if (lineItems.length > 0) {
    const itemSum = (lineItems as Record<string, unknown>[]).reduce((acc, item) => {
      const amt = item.amount_paise;
      return acc + (typeof amt === 'number' && Number.isInteger(amt) ? amt : 0);
    }, 0);
    const taxable = amounts.taxable_value as number;
    if (Math.abs(itemSum - taxable) > 1) {
      // Allow 1 paise rounding tolerance
      warnings.push(
        `line items sum (${itemSum} paise) does not match taxable_value (${taxable} paise)`,
      );
    }
  }

  return buildDbPayload(d, amounts, vendor, invoiceNumber, invoiceDate, lineItems, warnings);
}

function buildDbPayload(
  d: Record<string, unknown>,
  amounts: Record<string, unknown>,
  vendor: Record<string, unknown>,
  invoiceNumber: Record<string, unknown>,
  invoiceDate: Record<string, unknown>,
  lineItems: unknown[],
  warnings: string[],
) {
  return {
    documentType: d.document_type as string,
    confidenceOverall: d.confidence_overall as number,
    vendor: {
      name: typeof vendor.name === 'string' ? vendor.name : null,
      gstin: typeof vendor.gstin === 'string' ? vendor.gstin : null,
      confidence: vendor.confidence as number,
    },
    invoiceNumber: {
      value: typeof invoiceNumber.value === 'string' ? invoiceNumber.value : null,
      confidence: typeof invoiceNumber.confidence === 'number' ? (invoiceNumber.confidence as number) : 0,
    },
    invoiceDate: {
      value: typeof invoiceDate.value === 'string' ? invoiceDate.value : null,
      confidence: typeof invoiceDate.confidence === 'number' ? (invoiceDate.confidence as number) : 0,
    },
    placeOfSupply: typeof d.place_of_supply === 'string' ? d.place_of_supply : null,
    currency: 'INR',
    amountsPaise: {
      taxableValue: amounts.taxable_value as number,
      cgst: amounts.cgst as number,
      sgst: amounts.sgst as number,
      igst: amounts.igst as number,
      cess: amounts.cess as number,
      total: amounts.total as number,
      confidence: amounts.confidence as number,
    },
    lineItems: (lineItems as Record<string, unknown>[]).map((item) => ({
      description: typeof item.description === 'string' ? item.description : '',
      hsnSac: typeof item.hsn_sac === 'string' ? item.hsn_sac : null,
      qty: typeof item.qty === 'number' ? item.qty : 0,
      ratePaise: typeof item.rate_paise === 'number' && Number.isInteger(item.rate_paise) ? item.rate_paise : 0,
      amountPaise: typeof item.amount_paise === 'number' && Number.isInteger(item.amount_paise) ? item.amount_paise : 0,
      taxRatePct: typeof item.tax_rate_pct === 'number' ? item.tax_rate_pct : 0,
    })),
    isReverseCharge: d.is_reverse_charge === true,
    rawWarnings: warnings,
  };
}

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);

  constructor(
    @InjectModel(ExtractedDocument.name)
    private extractedModel: Model<ExtractedDocumentDocument>,
    private gemini: GeminiExtractionService,
    private usageMeter: UsageMeterService,
  ) {}

  async extract(input: ExtractionInput): Promise<ExtractedDocumentDocument> {
    const { documentId, orgId, ocrResultId, ocrText } = input;

    let normalized: ReturnType<typeof buildDbPayload> | null = null;
    let retryCount = 0;
    let lastRawJson = '';
    let totalTokensIn = 0;
    let totalTokensOut = 0;

    // Attempt extraction up to twice (one try + one retry on parse/validation failure)
    for (let attempt = 0; attempt <= 1; attempt++) {
      try {
        const { rawJson, tokensIn, tokensOut } = await this.gemini.extract(ocrText);
        lastRawJson = rawJson;
        totalTokensIn += tokensIn;
        totalTokensOut += tokensOut;

        const parsed: unknown = JSON.parse(rawJson);
        normalized = validateAndNormalize(parsed);

        if (normalized) {
          this.logger.log(`Document ${documentId}: Gemini extraction succeeded on attempt ${attempt + 1}`);
          break;
        }

        this.logger.warn(
          `Document ${documentId}: attempt ${attempt + 1} — JSON parsed but failed validation`,
        );
      } catch (err) {
        this.logger.warn(`Document ${documentId}: attempt ${attempt + 1} — ${String(err)}`);
      }
      retryCount = attempt + 1;
    }

    await this.usageMeter.recordAiTokens(orgId, totalTokensIn, totalTokensOut);

    const base = {
      orgId,
      documentId: new Types.ObjectId(documentId),
      ocrResultId: new Types.ObjectId(ocrResultId),
      retryCount,
      rawGroqResponse: lastRawJson, // field name kept for DB compatibility
    };

    if (normalized) {
      return this.extractedModel.create({ ...base, status: 'extracted', ...normalized });
    }

    // Both attempts failed — route to manual entry
    this.logger.error(
      `Document ${documentId}: extraction failed after ${retryCount + 1} attempts — routing to manual entry`,
    );
    return this.extractedModel.create({
      ...base,
      status: 'manual_required',
      documentType: 'purchase_invoice',
      confidenceOverall: 0,
      vendor: { name: null, gstin: null, confidence: 0 },
      invoiceNumber: { value: null, confidence: 0 },
      invoiceDate: { value: null, confidence: 0 },
      placeOfSupply: null,
      currency: 'INR',
      amountsPaise: { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0, confidence: 0 },
      lineItems: [],
      isReverseCharge: false,
      rawWarnings: ['AI extraction failed after 2 attempts — manual entry required'],
    });
  }
}
