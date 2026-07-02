import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { OcrResult, OcrResultDocument } from './schemas/ocr-result.schema';
import { OCR_PROVIDER, OcrProvider } from './providers/ocr.provider.interface';
import { GeminiVisionService } from './gemini-vision.service';
import { UsageMeterService } from './usage-meter.service';
import { PdfTextExtractorService } from './pdf-text-extractor.service';

export interface CascadeInput {
  documentId: string;
  orgId: string;
  buffer: Buffer;
  mimeType: string;
}

export interface CascadeOutput {
  ocrResult: OcrResultDocument;
  tier: number;
}

/** Minimum char count for a PDF to be considered "native text" (not a scanned image). */
const NATIVE_TEXT_THRESHOLD = 100;

/** Below this confidence from the OCR provider, escalate to vision LLM. */
const OCR_CONFIDENCE_THRESHOLD = 0.7;

@Injectable()
export class OcrCascadeService {
  private readonly logger = new Logger(OcrCascadeService.name);

  constructor(
    @InjectModel(OcrResult.name) private ocrResultModel: Model<OcrResultDocument>,
    @Inject(OCR_PROVIDER) private ocrProvider: OcrProvider,
    private geminiVision: GeminiVisionService,
    private usageMeter: UsageMeterService,
    private pdfExtractor: PdfTextExtractorService,
  ) {}

  async process(input: CascadeInput): Promise<CascadeOutput> {
    const { documentId, orgId, buffer, mimeType } = input;
    const start = Date.now();

    let tier: number;
    let rawText: string;
    let layoutJson: Record<string, unknown> = {};
    let confidence: number;
    let pageCount = 1;

    if (mimeType === 'application/pdf') {
      // ── Tier 1: native-text PDF ────────────────────────────────────────
      const { text: extractedText, pageCount: pdfPageCount } = await this.pdfExtractor.extract(buffer);
      pageCount = pdfPageCount;

      if (extractedText.length >= NATIVE_TEXT_THRESHOLD) {
        tier = 1;
        rawText = extractedText;
        layoutJson = { pages: pageCount, source: 'pdf-parse' };
        confidence = 0.95;
        this.logger.log(`Document ${documentId}: Tier 1 (native PDF, ${extractedText.length} chars)`);
      } else {
        // Scanned PDF — fall through to Tier 2
        this.logger.log(`Document ${documentId}: sparse text (${extractedText.length} chars), escalating to Tier 2`);
        const ocr = await this.ocrProvider.recognize(buffer, mimeType);
        tier = 2;
        rawText = ocr.text;
        layoutJson = ocr.layoutJson;
        confidence = ocr.confidence;
        pageCount = ocr.pageCount;
      }
    } else {
      // ── Tier 2: image (PNG, JPEG, TIFF, WEBP) ─────────────────────────
      this.logger.log(`Document ${documentId}: image type ${mimeType}, using OCR provider`);
      const ocr = await this.ocrProvider.recognize(buffer, mimeType);
      tier = 2;
      rawText = ocr.text;
      layoutJson = ocr.layoutJson;
      confidence = ocr.confidence;
      pageCount = ocr.pageCount;
    }

    // ── Tier 3: vision LLM fallback if confidence is too low ──────────────
    if (confidence < OCR_CONFIDENCE_THRESHOLD) {
      this.logger.log(`Document ${documentId}: low confidence (${confidence.toFixed(2)}), escalating to Tier 3 (Gemini vision)`);

      // Only send images to Groq vision — convert PDFs to first-page image via raw buffer
      const visionMimeType = mimeType === 'application/pdf' ? 'image/jpeg' : mimeType;
      const visionResult = await this.geminiVision.extractText(buffer, visionMimeType);

      tier = 3;
      rawText = visionResult.text || rawText; // keep Tier 2 text if vision returns nothing
      confidence = visionResult.confidence;
      layoutJson = { ...layoutJson, tier3Source: 'gemini-vision' };

      await this.usageMeter.recordAiTokens(orgId, visionResult.tokensIn, visionResult.tokensOut);
    }

    const processingMs = Date.now() - start;

    const ocrResult = await this.ocrResultModel.create({
      orgId,
      documentId: new Types.ObjectId(documentId),
      tier,
      rawText,
      layoutJson,
      confidence,
      pageCount,
      processingMs,
    });

    await this.usageMeter.recordOcrPages(orgId, tier, pageCount);

    this.logger.log(
      `Document ${documentId}: OcrResult saved (tier=${tier}, confidence=${confidence.toFixed(2)}, ${processingMs}ms)`,
    );

    return { ocrResult, tier };
  }
}
