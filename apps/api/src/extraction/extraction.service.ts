import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ExtractedDocument, ExtractedDocumentDocument } from './schemas/extracted-document.schema';
import { GeminiExtractionService, OrgContext } from './gemini-extraction.service';
import { UsageMeterService } from '../ocr/usage-meter.service';
import { Organization, OrganizationDocument } from '../tenancy/schemas/organization.schema';
import { fullGstRates, invoiceProblems, ROUNDING_TOLERANCE_PAISE } from './invoice-checks';
import { paidAtCounter } from '../proposals/checks/bill-checks';

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

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Normalise whatever date the document printed into YYYY-MM-DD.
 *
 * Indian invoices overwhelmingly use dd/mm/yyyy, so an ambiguous pair like 05/04
 * is read day-first. Everything downstream (financial year, posting date, GST
 * period) depends on this, so an unparseable date returns null rather than a guess.
 */
export function normaliseDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const dmy = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    let [, day, month, year] = dmy;
    if (year.length === 2) year = Number(year) > 70 ? `19${year}` : `20${year}`;
    // A value above 12 in the first slot can only be a day, which also rules out
    // the mm/dd ordering some scanned US-style templates use.
    if (Number(month) > 12 && Number(day) <= 12) [day, month] = [month, day];
    if (Number(month) > 12 || Number(day) > 31) return null;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const dMonY = raw.match(/^(\d{1,2})[\s\-/]([A-Za-z]{3,})[\s\-/,]*(\d{2,4})$/);
  if (dMonY) {
    const idx = MONTHS.indexOf(dMonY[2].slice(0, 3).toLowerCase());
    if (idx >= 0) {
      let year = dMonY[3];
      if (year.length === 2) year = `20${year}`;
      return `${year}-${String(idx + 1).padStart(2, '0')}-${dMonY[1].padStart(2, '0')}`;
    }
  }

  const monDY = raw.match(/^([A-Za-z]{3,})[\s\-/]+(\d{1,2})[\s\-/,]+(\d{2,4})$/);
  if (monDY) {
    const idx = MONTHS.indexOf(monDY[1].slice(0, 3).toLowerCase());
    if (idx >= 0) {
      let year = monDY[3];
      if (year.length === 2) year = `20${year}`;
      return `${year}-${String(idx + 1).padStart(2, '0')}-${monDY[2].padStart(2, '0')}`;
    }
  }

  return null;
}

/** The printed due date, if any. Older responses without the field read as absent. */
function dueDateField(raw: unknown): { value: string | null; confidence: number } {
  const field = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const value = normaliseDate(field.value);
  return { value, confidence: value && typeof field.confidence === 'number' ? field.confidence : 0 };
}

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

  if (invoiceDate.value && !normaliseDate(invoiceDate.value)) {
    warnings.push(`could not read the invoice date "${String(invoiceDate.value)}" — set it manually`);
  }

  // Advisory check: line-item amounts should sum to taxable value. Only when the
  // items actually carry amounts — a line list with none read used to warn
  // "line items sum (0 paise) does not match" on every invoice, which taught
  // reviewers to ignore the warnings panel.
  const itemAmounts = (lineItems as Record<string, unknown>[])
    .map((item) => item.amount_paise)
    .filter((amt): amt is number => typeof amt === 'number' && Number.isInteger(amt) && amt > 0);
  if (itemAmounts.length > 0) {
    const itemSum = itemAmounts.reduce((acc, amt) => acc + amt, 0);
    const taxable = amounts.taxable_value as number;
    if (Math.abs(itemSum - taxable) > ROUNDING_TOLERANCE_PAISE) {
      warnings.push(
        `line items sum (${itemSum} paise) does not match taxable_value (${taxable} paise)`,
      );
    }
  }

  // Deterministic checks the model does not reliably make. Any failure caps the
  // confidence below the bulk-approve threshold, so a person has to look.
  const problems = invoiceProblems(
    {
      taxableValue: amounts.taxable_value as number,
      cgst: amounts.cgst as number,
      sgst: amounts.sgst as number,
      igst: amounts.igst as number,
      cess: amounts.cess as number,
      total: amounts.total as number,
    },
    typeof vendor.gstin === 'string' && vendor.gstin.trim() ? vendor.gstin : null,
  );
  warnings.push(...problems);

  const payload = buildDbPayload(d, amounts, vendor, invoiceNumber, invoiceDate, lineItems, warnings);
  payload.lineItems = fullGstRates(payload.lineItems, payload.amountsPaise);
  if (problems.length > 0) {
    payload.confidenceOverall = Math.min(payload.confidenceOverall, CHECK_FAILED_CONFIDENCE_CAP);
  }
  return payload;
}

/** Below the 0.9 bulk-approve threshold and the review screen's "high" band. */
const CHECK_FAILED_CONFIDENCE_CAP = 0.5;

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
      // Stored ISO so the financial year, posting date and GST period all derive
      // from one unambiguous format regardless of how the invoice printed it.
      value: normaliseDate(invoiceDate.value),
      confidence:
        typeof invoiceDate.confidence === 'number' && normaliseDate(invoiceDate.value)
          ? (invoiceDate.confidence as number)
          : 0,
    },
    dueDate: dueDateField(d.due_date),
    paymentTerms:
      typeof d.payment_terms === 'string' && d.payment_terms.trim() ? d.payment_terms.trim() : null,
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

/**
 * Why the AI could not read a document, in words a person can act on: the
 * provider's credit used up, a limit reached, a refused key, or an answer that
 * could not be read as a bill. Retrying only helps once the first three are sorted.
 */
export function readFailureReason(lastError: string): string {
  const e = lastError.toLowerCase();
  if (/\b402\b|payment required|credits? (are )?depleted|billing|prepay/.test(e)) {
    return 'The AI service has no credit left, so the document could not be read. Top up the AI account (Google AI Studio for Gemini), then press Retry.';
  }
  if (/\b429\b|quota|rate limit|resource.?exhausted|too many requests/.test(e)) {
    return 'The AI service is over its limit just now. Press Retry in a few minutes.';
  }
  if (/\b40[13]\b|api key|permission denied|unauthori[sz]ed/.test(e)) {
    return 'The AI key was refused. Check GEMINI_API_KEY in the server settings, then press Retry.';
  }
  if (/fetch failed|enotfound|econn|etimedout|network/.test(e)) {
    return 'The AI service could not be reached. Press Retry when the connection is back.';
  }
  return "The AI's answer could not be read as a bill or invoice. Press Retry, or enter it by hand with Add to.";
}

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);

  constructor(
    @InjectModel(ExtractedDocument.name)
    private extractedModel: Model<ExtractedDocumentDocument>,
    @InjectModel(Organization.name)
    private orgModel: Model<OrganizationDocument>,
    private gemini: GeminiExtractionService,
    private usageMeter: UsageMeterService,
  ) {}

  /** The org's own identity, so extraction can tell inward bills from outward invoices. */
  private async orgContext(orgId: string): Promise<OrgContext | undefined> {
    try {
      const org = await this.orgModel.findById(orgId).select('name gstin state').exec();
      if (!org) return undefined;
      return { name: org.name, gstin: org.gstin ?? null, state: org.state ?? null };
    } catch (err) {
      this.logger.warn(`Could not load org context for ${orgId}: ${String(err)}`);
      return undefined;
    }
  }

  async extract(input: ExtractionInput): Promise<ExtractedDocumentDocument> {
    const { documentId, orgId, ocrResultId, ocrText } = input;

    let normalized: ReturnType<typeof buildDbPayload> | null = null;
    let retryCount = 0;
    let lastRawJson = '';
    let lastError = '';
    let totalTokensIn = 0;
    let totalTokensOut = 0;

    const org = await this.orgContext(orgId);

    // Attempt extraction up to twice (one try + one retry on parse/validation failure)
    for (let attempt = 0; attempt <= 1; attempt++) {
      try {
        const { rawJson, tokensIn, tokensOut } = await this.gemini.extract(ocrText, org);
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
        lastError = String(err);
        this.logger.warn(`Document ${documentId}: attempt ${attempt + 1} — ${lastError}`);
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
      return this.extractedModel.create({ ...base, status: 'extracted', ...normalized, paidAtCounter: paidAtCounter(ocrText) });
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
      rawWarnings: [readFailureReason(lastError)],
    });
  }
}
