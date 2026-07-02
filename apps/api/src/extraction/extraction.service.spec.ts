/**
 * Phase 7 Integration Tests — AI extraction to the canonical contract.
 *
 * Done when:
 *  ✓ Valid Groq response produces an ExtractedDocument with status='extracted'
 *  ✓ All monetary fields are integer paise (Invariant 1)
 *  ✓ Line-item sum mismatch adds a raw_warning but document still saves
 *  ✓ Bad JSON on attempt 1 → retry → success on attempt 2
 *  ✓ Both attempts produce bad JSON → status='manual_required'
 *  ✓ Groq tokens metered to UsageMeter
 *
 * GroqExtractionService is overridden with a deterministic fake — no real API calls.
 */
import 'reflect-metadata';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import configuration from '../config/configuration';
import { ExtractionService } from './extraction.service';
import { GroqExtractionService } from './groq-extraction.service';
import { ExtractedDocument, ExtractedDocumentSchema, ExtractedDocumentDocument } from './schemas/extracted-document.schema';
import { UsageMeter, UsageMeterSchema, UsageMeterDocument } from '../ocr/schemas/usage-meter.schema';
import { UsageMeterService } from '../ocr/usage-meter.service';

const ORG_ID = new Types.ObjectId().toString();
const DOC_ID = new Types.ObjectId().toString();
const OCR_RESULT_ID = new Types.ObjectId().toString();
const SAMPLE_OCR_TEXT = 'Invoice No: INV-2025-001\nVendor: Acme Pvt Ltd\nGSTIN: 27AAPFU0939F1ZV\nDate: 01-Mar-2025\nTotal: Rs 11,800\nCGST: Rs 900  SGST: Rs 900  Taxable: Rs 10,000';

// ── Helpers ───────────────────────────────────────────────────────────────

/** Build a valid canonical JSON response as Groq would return it. */
function makeValidResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    document_type: 'purchase_invoice',
    confidence_overall: 0.92,
    vendor: { name: 'Acme Pvt Ltd', gstin: '27AAPFU0939F1ZV', confidence: 0.95 },
    invoice_number: { value: 'INV-2025-001', confidence: 0.98 },
    invoice_date: { value: '2025-03-01', confidence: 0.97 },
    place_of_supply: 'Maharashtra',
    currency: 'INR',
    amounts_paise: {
      taxable_value: 1000000, // Rs 10,000 × 100
      cgst: 90000,            // Rs 900 × 100
      sgst: 90000,
      igst: 0,
      cess: 0,
      total: 1180000,         // Rs 11,800 × 100
      confidence: 0.93,
    },
    line_items: [
      { description: 'Office Supplies', hsn_sac: '8472', qty: 10, rate_paise: 100000, amount_paise: 1000000, tax_rate_pct: 18 },
    ],
    is_reverse_charge: false,
    raw_warnings: [],
    ...overrides,
  });
}

const fakeGroq = {
  extract: jest.fn(),
};

let replSet: MongoMemoryReplSet;
let moduleRef: TestingModule;
let svc: ExtractionService;
let usageMeter: UsageMeterService;
let extractedModel: Model<ExtractedDocumentDocument>;
let usageMeterModel: Model<UsageMeterDocument>;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(replSet.getUri()),
      MongooseModule.forFeature([
        { name: ExtractedDocument.name, schema: ExtractedDocumentSchema },
        { name: UsageMeter.name, schema: UsageMeterSchema },
      ]),
    ],
    providers: [
      ExtractionService,
      UsageMeterService,
      { provide: GroqExtractionService, useValue: fakeGroq },
    ],
  }).compile();

  svc = moduleRef.get(ExtractionService);
  usageMeter = moduleRef.get(UsageMeterService);
  extractedModel = moduleRef.get<Model<ExtractedDocumentDocument>>(getModelToken(ExtractedDocument.name));
  usageMeterModel = moduleRef.get<Model<UsageMeterDocument>>(getModelToken(UsageMeter.name));
}, 60_000);

beforeEach(() => jest.clearAllMocks());

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
  await replSet.stop();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Happy path — valid Groq response', () => {
  it('saves ExtractedDocument with status=extracted', async () => {
    fakeGroq.extract.mockResolvedValue({ rawJson: makeValidResponse(), tokensIn: 500, tokensOut: 200 });

    const result = await svc.extract({ documentId: DOC_ID, orgId: ORG_ID, ocrResultId: OCR_RESULT_ID, ocrText: SAMPLE_OCR_TEXT });

    expect(result.status).toBe('extracted');
    expect(result.documentType).toBe('purchase_invoice');
    expect(result.vendor.name).toBe('Acme Pvt Ltd');
    expect(result.vendor.gstin).toBe('27AAPFU0939F1ZV');
    expect(result.invoiceNumber.value).toBe('INV-2025-001');
    expect(result.invoiceDate.value).toBe('2025-03-01');
    expect(result.confidenceOverall).toBeCloseTo(0.92);
    expect(result.rawWarnings).toHaveLength(0);
  });

  it('all monetary fields are non-negative integers (Invariant 1)', async () => {
    fakeGroq.extract.mockResolvedValue({ rawJson: makeValidResponse(), tokensIn: 500, tokensOut: 200 });

    const result = await svc.extract({ documentId: DOC_ID, orgId: ORG_ID, ocrResultId: OCR_RESULT_ID, ocrText: SAMPLE_OCR_TEXT });

    const a = result.amountsPaise;
    expect(Number.isInteger(a.taxableValue)).toBe(true);
    expect(Number.isInteger(a.cgst)).toBe(true);
    expect(Number.isInteger(a.sgst)).toBe(true);
    expect(Number.isInteger(a.igst)).toBe(true);
    expect(Number.isInteger(a.cess)).toBe(true);
    expect(Number.isInteger(a.total)).toBe(true);
    expect(a.taxableValue).toBe(1000000);
    expect(a.total).toBe(1180000);
    for (const li of result.lineItems) {
      expect(Number.isInteger(li.amountPaise)).toBe(true);
      expect(Number.isInteger(li.ratePaise)).toBe(true);
    }
  });

  it('persists in MongoDB with correct orgId and documentId', async () => {
    const docId = new Types.ObjectId().toString();
    fakeGroq.extract.mockResolvedValue({ rawJson: makeValidResponse(), tokensIn: 400, tokensOut: 150 });

    const result = await svc.extract({ documentId: docId, orgId: ORG_ID, ocrResultId: OCR_RESULT_ID, ocrText: SAMPLE_OCR_TEXT });

    const saved = await extractedModel.findById(result._id).exec();
    expect(saved).not.toBeNull();
    expect(saved!.orgId).toBe(ORG_ID);
    expect(saved!.documentId.toString()).toBe(docId);
    expect(saved!.status).toBe('extracted');
  });

  it('meters Groq tokens in UsageMeter', async () => {
    const orgId = new Types.ObjectId().toString();
    fakeGroq.extract.mockResolvedValue({ rawJson: makeValidResponse(), tokensIn: 750, tokensOut: 300 });

    await svc.extract({ documentId: DOC_ID, orgId, ocrResultId: OCR_RESULT_ID, ocrText: SAMPLE_OCR_TEXT });

    const meter = await usageMeter.getUsage(orgId);
    expect(meter).not.toBeNull();
    expect(meter!.groqTokensIn).toBe(750);
    expect(meter!.groqTokensOut).toBe(300);
  });
});

describe('Warnings — data quality issues', () => {
  it('adds a raw_warning when line items do not sum to taxable_value', async () => {
    const mismatchedJson = makeValidResponse({
      amounts_paise: {
        taxable_value: 1000000,
        cgst: 90000,
        sgst: 90000,
        igst: 0,
        cess: 0,
        total: 1180000,
        confidence: 0.85,
      },
      line_items: [
        // amount_paise (500000) ≠ taxable_value (1000000)
        { description: 'Widget A', hsn_sac: null, qty: 5, rate_paise: 100000, amount_paise: 500000, tax_rate_pct: 18 },
      ],
    });
    fakeGroq.extract.mockResolvedValue({ rawJson: mismatchedJson, tokensIn: 500, tokensOut: 200 });

    const result = await svc.extract({ documentId: DOC_ID, orgId: ORG_ID, ocrResultId: OCR_RESULT_ID, ocrText: SAMPLE_OCR_TEXT });

    expect(result.status).toBe('extracted'); // document still saves
    expect(result.rawWarnings.some((w) => w.includes('sum'))).toBe(true);
  });

  it('preserves raw_warnings from Groq alongside computed warnings', async () => {
    const jsonWithWarning = makeValidResponse({ raw_warnings: ['GST number could not be verified'] });
    fakeGroq.extract.mockResolvedValue({ rawJson: jsonWithWarning, tokensIn: 500, tokensOut: 200 });

    const result = await svc.extract({ documentId: DOC_ID, orgId: ORG_ID, ocrResultId: OCR_RESULT_ID, ocrText: SAMPLE_OCR_TEXT });

    expect(result.rawWarnings).toContain('GST number could not be verified');
  });
});

describe('Retry and failure handling', () => {
  it('succeeds on retry when first attempt returns malformed JSON', async () => {
    fakeGroq.extract
      .mockResolvedValueOnce({ rawJson: 'not valid json }{', tokensIn: 100, tokensOut: 10 })
      .mockResolvedValueOnce({ rawJson: makeValidResponse(), tokensIn: 500, tokensOut: 200 });

    const result = await svc.extract({ documentId: DOC_ID, orgId: ORG_ID, ocrResultId: OCR_RESULT_ID, ocrText: SAMPLE_OCR_TEXT });

    expect(result.status).toBe('extracted');
    expect(result.retryCount).toBe(1);
    expect(fakeGroq.extract).toHaveBeenCalledTimes(2);
  });

  it('succeeds on retry when first attempt fails schema validation', async () => {
    const invalidSchema = JSON.stringify({ document_type: 'bad_type', confidence_overall: 0.5 }); // bad doc_type
    fakeGroq.extract
      .mockResolvedValueOnce({ rawJson: invalidSchema, tokensIn: 200, tokensOut: 50 })
      .mockResolvedValueOnce({ rawJson: makeValidResponse(), tokensIn: 500, tokensOut: 200 });

    const result = await svc.extract({ documentId: DOC_ID, orgId: ORG_ID, ocrResultId: OCR_RESULT_ID, ocrText: SAMPLE_OCR_TEXT });

    expect(result.status).toBe('extracted');
    expect(result.retryCount).toBe(1);
  });

  it('routes to manual entry when both attempts fail', async () => {
    fakeGroq.extract
      .mockResolvedValueOnce({ rawJson: '{broken json}', tokensIn: 100, tokensOut: 10 })
      .mockResolvedValueOnce({ rawJson: '{"missing_fields": true}', tokensIn: 100, tokensOut: 10 });

    const result = await svc.extract({ documentId: DOC_ID, orgId: ORG_ID, ocrResultId: OCR_RESULT_ID, ocrText: SAMPLE_OCR_TEXT });

    expect(result.status).toBe('manual_required');
    expect(result.rawWarnings).toContain('AI extraction failed after 2 attempts — manual entry required');
    expect(result.retryCount).toBeGreaterThanOrEqual(1);
    expect(fakeGroq.extract).toHaveBeenCalledTimes(2);
  });

  it('routes to manual entry when Groq throws an exception', async () => {
    fakeGroq.extract
      .mockRejectedValueOnce(new Error('Groq rate limit'))
      .mockRejectedValueOnce(new Error('Groq rate limit'));

    const result = await svc.extract({ documentId: DOC_ID, orgId: ORG_ID, ocrResultId: OCR_RESULT_ID, ocrText: SAMPLE_OCR_TEXT });

    expect(result.status).toBe('manual_required');
    expect(fakeGroq.extract).toHaveBeenCalledTimes(2);
  });

  it('rejects decimal (non-integer) paise values', async () => {
    const decimalPaiseJson = makeValidResponse({
      amounts_paise: {
        taxable_value: 1000000,
        cgst: 900.5,   // invalid — decimal paise
        sgst: 90000,
        igst: 0,
        cess: 0,
        total: 1180000,
        confidence: 0.9,
      },
    });
    fakeGroq.extract
      .mockResolvedValueOnce({ rawJson: decimalPaiseJson, tokensIn: 200, tokensOut: 50 })
      .mockResolvedValueOnce({ rawJson: makeValidResponse(), tokensIn: 500, tokensOut: 200 });

    const result = await svc.extract({ documentId: DOC_ID, orgId: ORG_ID, ocrResultId: OCR_RESULT_ID, ocrText: SAMPLE_OCR_TEXT });

    // First attempt rejected because of decimal; second succeeds
    expect(result.status).toBe('extracted');
    expect(result.retryCount).toBe(1);
    expect(Number.isInteger(result.amountsPaise.cgst)).toBe(true);
  });
});
