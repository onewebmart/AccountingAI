/**
 * Phase 6 Integration Tests — OCR cascade service.
 *
 * Done when:
 *  ✓ Native-text PDF → Tier 1 (pdf-parse), confidence ≥ 0.9
 *  ✓ PNG image → Tier 2 (OCR provider), OcrResult saved
 *  ✓ Low-confidence OCR → Tier 3 (Groq vision LLM), tokens metered
 *  ✓ OcrResult document persisted in MongoDB with correct fields
 *  ✓ UsageMeter incremented correctly per tier
 *
 * OcrProvider and GroqVisionService are overridden with deterministic fakes.
 * No real Groq API calls or Textract calls made.
 */
import 'reflect-metadata';
import mongoose, { Types } from 'mongoose';
import { testMongoUri } from '../test-utils/mongo';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import configuration from '../config/configuration';
import { OcrCascadeService } from './ocr-cascade.service';
import { UsageMeterService } from './usage-meter.service';
import { GeminiVisionService } from './gemini-vision.service';
import { PdfTextExtractorService } from './pdf-text-extractor.service';
import { DocumentTextExtractorService } from './document-text-extractor.service';
import { OcrResult, OcrResultSchema, OcrResultDocument } from './schemas/ocr-result.schema';
import { UsageMeter, UsageMeterSchema, UsageMeterDocument } from './schemas/usage-meter.schema';
import { OCR_PROVIDER, OcrProvider } from './providers/ocr.provider.interface';

const ORG_ID = new Types.ObjectId().toString();
const DOC_ID = new Types.ObjectId().toString();

let moduleRef: TestingModule;
let ocrCascade: OcrCascadeService;
let usageMeter: UsageMeterService;
let ocrResultModel: Model<OcrResultDocument>;
let usageMeterModel: Model<UsageMeterDocument>;

// Fake OCR provider — configurable confidence for each test
const fakeOcrProvider: OcrProvider = {
  recognize: jest.fn(),
};

// Fake vision service standing in for Gemini
const fakeGroqVision = {
  extractText: jest.fn(),
};

// Fake PDF extractor — avoids pdfjs-dist dynamic-import issues in Jest
const fakePdfExtractor = {
  extract: jest.fn(),
};

beforeAll(async () => {
  const uri = testMongoUri();

  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(uri),
      MongooseModule.forFeature([
        { name: OcrResult.name, schema: OcrResultSchema },
        { name: UsageMeter.name, schema: UsageMeterSchema },
      ]),
    ],
    providers: [
      OcrCascadeService,
      UsageMeterService,
      { provide: OCR_PROVIDER, useValue: fakeOcrProvider },
      { provide: GeminiVisionService, useValue: fakeGroqVision },
      { provide: PdfTextExtractorService, useValue: fakePdfExtractor },
      DocumentTextExtractorService,
    ],
  }).compile();

  ocrCascade = moduleRef.get(OcrCascadeService);
  usageMeter = moduleRef.get(UsageMeterService);
  ocrResultModel = moduleRef.get<Model<OcrResultDocument>>(getModelToken(OcrResult.name));
  usageMeterModel = moduleRef.get<Model<UsageMeterDocument>>(getModelToken(UsageMeter.name));
}, 60_000);

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Tier 0 — files that already contain text', () => {
  it('reads a .txt upload without calling OCR or the vision model', async () => {
    const { ocrResult, tier } = await ocrCascade.process({
      documentId: DOC_ID,
      orgId: ORG_ID,
      buffer: Buffer.from('TAX INVOICE\nVendor: Gupta Hardware\nTotal: 11800.00\n', 'utf8'),
      mimeType: 'text/plain',
      fileName: 'bill.txt',
    });

    expect(tier).toBe(0);
    expect(ocrResult.rawText).toContain('Gupta Hardware');
    expect(ocrResult.confidence).toBe(1);
    expect(fakeOcrProvider.recognize).not.toHaveBeenCalled();
    expect(fakeGroqVision.extractText).not.toHaveBeenCalled();
  });

  it('detects .docx by extension even when the browser sends a generic mime type', async () => {
    // Browsers frequently send text/plain or an empty type for .docx uploads.
    const isNative = (await import('./document-text-extractor.service'))
      .DocumentTextExtractorService.isNativeText('application/octet-stream', 'invoice.docx');
    expect(isNative).toBe(true);
  });

  it('does not meter Tier 0 as an OCR page — it costs nothing', async () => {
    await ocrCascade.process({
      documentId: DOC_ID,
      orgId: ORG_ID,
      buffer: Buffer.from('Some readable invoice text for the meter check.', 'utf8'),
      mimeType: 'text/plain',
      fileName: 'note.txt',
    });

    const meter = await usageMeterModel.findOne({ orgId: ORG_ID }).lean().exec();
    // Either no meter row at all, or one with no tier-0 bucket written.
    expect((meter as Record<string, unknown> | null)?.['ocrPagesTier0']).toBeUndefined();
  });
});

describe('Tier 1 — native-text PDF', () => {
  it('extracts text via pdf-parse and does NOT call the OCR provider', async () => {
    const nativeText = 'Invoice No: INV-2025-001  Vendor: Acme Pvt Ltd  Date: 01-Mar-2025  Amount: Rs 50,000  GSTIN: 27AAPFU0939F1ZV  Payment Terms: Net 30 days';
    (fakePdfExtractor.extract as jest.Mock).mockResolvedValue({ text: nativeText, pageCount: 1 });

    const { ocrResult, tier } = await ocrCascade.process({
      documentId: DOC_ID,
      orgId: ORG_ID,
      buffer: Buffer.from('%PDF-1.4 fake'),
      mimeType: 'application/pdf',
    });

    expect(tier).toBe(1);
    expect(ocrResult.tier).toBe(1);
    expect(ocrResult.confidence).toBeGreaterThanOrEqual(0.9);
    expect(ocrResult.rawText).toContain('Invoice');
    expect(fakeOcrProvider.recognize).not.toHaveBeenCalled();
    expect(fakeGroqVision.extractText).not.toHaveBeenCalled();
  });

  it('persists OcrResult in MongoDB with correct orgId and documentId', async () => {
    (fakePdfExtractor.extract as jest.Mock).mockResolvedValue({
      text: 'Tax invoice for Acme Corp Pvt Ltd  Date: 01-Jan-2025  Invoice#: INV-2025-100  Total: Rs 1,20,000  GST: Rs 21,600  Grand Total: Rs 1,41,600',
      pageCount: 2,
    });

    const { ocrResult } = await ocrCascade.process({
      documentId: DOC_ID,
      orgId: ORG_ID,
      buffer: Buffer.from('%PDF-1.4 fake'),
      mimeType: 'application/pdf',
    });

    const saved = await ocrResultModel.findById(ocrResult._id).exec();
    expect(saved).not.toBeNull();
    expect(saved!.orgId).toBe(ORG_ID);
    expect(saved!.documentId.toString()).toBe(DOC_ID);
    expect(saved!.tier).toBe(1);
    expect(saved!.pageCount).toBe(2);
    expect(saved!.processingMs).toBeGreaterThanOrEqual(0);
  });

  it('meters Tier 1 OCR pages in UsageMeter', async () => {
    const orgId = new Types.ObjectId().toString();
    (fakePdfExtractor.extract as jest.Mock).mockResolvedValue({
      text: 'Debit Note  Vendor: ABC Trading Ltd  Ref: DN-001  Date: 15-Feb-2025  Original Invoice: INV-100  Debit Amount: Rs 25,000  Reason: Goods returned',
      pageCount: 3,
    });

    await ocrCascade.process({ documentId: DOC_ID, orgId, buffer: Buffer.from('%PDF'), mimeType: 'application/pdf' });

    const meter = await usageMeter.getUsage(orgId);
    expect(meter).not.toBeNull();
    expect(meter!.ocrPagesTier1).toBe(3);
    expect(meter!.ocrPagesTier2).toBe(0);
    expect(meter!.ocrPagesTier3).toBe(0);
  });
});

describe('Tier 2 — scanned PDF / image via OCR provider', () => {
  it('image (PNG) goes directly to OCR provider', async () => {
    const mockOcrResult = {
      text: 'PURCHASE INVOICE\nVendor: XYZ Trading\nAmount: 75000',
      layoutJson: { pages: [{ blocks: [{ text: 'PURCHASE INVOICE' }] }] },
      confidence: 0.88,
      pageCount: 1,
    };
    (fakeOcrProvider.recognize as jest.Mock).mockResolvedValue(mockOcrResult);

    const { ocrResult, tier } = await ocrCascade.process({
      documentId: DOC_ID,
      orgId: ORG_ID,
      buffer: Buffer.from('fake-png-data'),
      mimeType: 'image/png',
    });

    expect(tier).toBe(2);
    expect(ocrResult.tier).toBe(2);
    expect(ocrResult.rawText).toContain('PURCHASE INVOICE');
    expect(ocrResult.confidence).toBe(0.88);
    expect(fakeOcrProvider.recognize).toHaveBeenCalledTimes(1);
    expect(fakeGroqVision.extractText).not.toHaveBeenCalled();
  });

  it('scanned PDF (minimal text from pdf-parse) escalates to OCR provider', async () => {
    // pdf-parse returns very little text → scanned document
    (fakePdfExtractor.extract as jest.Mock).mockResolvedValue({ text: 'hi', pageCount: 1 });
    (fakeOcrProvider.recognize as jest.Mock).mockResolvedValue({
      text: 'Scanned bill content here vendor Sharma Enterprises amount 18000',
      layoutJson: {},
      confidence: 0.82,
      pageCount: 2,
    });

    const { ocrResult, tier } = await ocrCascade.process({
      documentId: DOC_ID,
      orgId: ORG_ID,
      buffer: Buffer.from('%PDF-1.4 scanned'),
      mimeType: 'application/pdf',
    });

    expect(tier).toBe(2);
    expect(ocrResult.pageCount).toBe(2);
    expect(fakeOcrProvider.recognize).toHaveBeenCalledTimes(1);
  });

  it('meters Tier 2 OCR pages', async () => {
    const orgId = new Types.ObjectId().toString();
    (fakeOcrProvider.recognize as jest.Mock).mockResolvedValue({
      text: 'Some scanned content',
      layoutJson: {},
      confidence: 0.80,
      pageCount: 3,
    });

    await ocrCascade.process({
      documentId: DOC_ID,
      orgId,
      buffer: Buffer.from('fake-jpeg'),
      mimeType: 'image/jpeg',
    });

    const meter = await usageMeter.getUsage(orgId);
    expect(meter!.ocrPagesTier2).toBe(3);
    expect(meter!.ocrPagesTier1).toBe(0);
  });
});

describe('Tier 3 — Groq vision LLM fallback', () => {
  it('escalates to Groq when OCR confidence is below threshold', async () => {
    // OCR returns low confidence
    (fakeOcrProvider.recognize as jest.Mock).mockResolvedValue({
      text: 'partial illegible text',
      layoutJson: {},
      confidence: 0.45, // below 0.7 threshold
      pageCount: 1,
    });
    // Groq returns high-quality result
    (fakeGroqVision.extractText as jest.Mock).mockResolvedValue({
      text: 'Handwritten bill: Ramu Kirana Store Date: 15/03/2025 Total: Rs 3500',
      confidence: 0.78,
      tokensIn: 1200,
      tokensOut: 150,
    });

    const { ocrResult, tier } = await ocrCascade.process({
      documentId: DOC_ID,
      orgId: ORG_ID,
      buffer: Buffer.from('fake-handwritten-image'),
      mimeType: 'image/jpeg',
    });

    expect(tier).toBe(3);
    expect(ocrResult.tier).toBe(3);
    expect(ocrResult.rawText).toContain('Ramu Kirana');
    expect(ocrResult.confidence).toBe(0.78);
    expect(fakeGroqVision.extractText).toHaveBeenCalledTimes(1);
  });

  it('meters Tier 3 pages AND Groq tokens', async () => {
    const orgId = new Types.ObjectId().toString();
    (fakeOcrProvider.recognize as jest.Mock).mockResolvedValue({
      text: '',
      layoutJson: {},
      confidence: 0.2, // very low
      pageCount: 1,
    });
    (fakeGroqVision.extractText as jest.Mock).mockResolvedValue({
      text: 'Invoice from Gupta Traders',
      confidence: 0.72,
      tokensIn: 800,
      tokensOut: 90,
    });

    await ocrCascade.process({
      documentId: DOC_ID,
      orgId,
      buffer: Buffer.from('blurry-scan'),
      mimeType: 'image/png',
    });

    const meter = await usageMeter.getUsage(orgId);
    expect(meter!.ocrPagesTier3).toBe(1);
    expect(meter!.groqTokensIn).toBe(800);
    expect(meter!.groqTokensOut).toBe(90);
  });
});

describe('UsageMeter — cumulative increments', () => {
  it('accumulates across multiple calls in the same period', async () => {
    const orgId = new Types.ObjectId().toString();
    (fakeOcrProvider.recognize as jest.Mock).mockResolvedValue({
      text: 'some text content',
      layoutJson: {},
      confidence: 0.85,
      pageCount: 2,
    });

    // Three image uploads
    for (let i = 0; i < 3; i++) {
      await ocrCascade.process({
        documentId: new Types.ObjectId().toString(),
        orgId,
        buffer: Buffer.from(`image-${i}`),
        mimeType: 'image/png',
      });
    }

    const meter = await usageMeter.getUsage(orgId);
    expect(meter!.ocrPagesTier2).toBe(6); // 3 uploads × 2 pages each
  });
});
