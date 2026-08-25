import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { OcrResult, OcrResultDocument } from './schemas/ocr-result.schema';
import { OCR_PROVIDER, OcrProvider, OcrProviderResult } from './providers/ocr.provider.interface';
import { GeminiVisionService } from './gemini-vision.service';
import { UsageMeterService } from './usage-meter.service';
import { PdfTextExtractorService } from './pdf-text-extractor.service';
import { DocumentTextExtractorService } from './document-text-extractor.service';

export interface CascadeInput {
  documentId: string;
  orgId: string;
  buffer: Buffer;
  mimeType: string;
  /**
   * Original upload name. Browsers frequently send text/plain or an empty type
   * for .docx/.txt, so the extension is the more reliable signal for Tier 0.
   */
  fileName?: string;
}

export interface CascadeOutput {
  ocrResult: OcrResultDocument;
  tier: number;
}

/** Minimum char count for a PDF to be considered "native text" (not a scanned image). */
const NATIVE_TEXT_THRESHOLD = 100;

/** Below this confidence from the OCR provider, escalate to vision LLM. */
const OCR_CONFIDENCE_THRESHOLD = 0.7;

/** Extension → the type the cascade should route on. */
const TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
};

/**
 * The type to route on, trusting the extension when the browser's is useless.
 *
 * Uploads routinely arrive as `application/octet-stream` (or an empty type) —
 * the upload controller already accepts them on the strength of the extension.
 * The cascade has to apply the same trust or the two disagree: a PDF sent as
 * octet-stream skipped the PDF branch entirely, fell through to the image tier,
 * and was posted to the vision model labelled `image/jpeg`, which answered
 * "Unable to process input image" and failed the document outright.
 */
export function effectiveMimeType(mimeType: string, fileName: string): string {
  const generic = !mimeType || mimeType === 'application/octet-stream' || mimeType === 'binary/octet-stream';
  if (!generic) return mimeType;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return TYPE_BY_EXTENSION[ext] ?? mimeType;
}

@Injectable()
export class OcrCascadeService {
  private readonly logger = new Logger(OcrCascadeService.name);

  constructor(
    @InjectModel(OcrResult.name) private ocrResultModel: Model<OcrResultDocument>,
    @Inject(OCR_PROVIDER) private ocrProvider: OcrProvider,
    private geminiVision: GeminiVisionService,
    private usageMeter: UsageMeterService,
    private pdfExtractor: PdfTextExtractorService,
    private textExtractor: DocumentTextExtractorService,
  ) {}

  async process(input: CascadeInput): Promise<CascadeOutput> {
    const { documentId, orgId, buffer, fileName = '' } = input;
    const start = Date.now();

    // Resolved once, then used for every downstream decision and for the label
    // sent to the vision model — so routing and transport can never disagree.
    const mimeType = effectiveMimeType(input.mimeType, fileName);
    if (mimeType !== input.mimeType) {
      this.logger.log(
        `Document ${documentId}: upload type "${input.mimeType}" is generic, reading it as "${mimeType}" from the file name`,
      );
    }

    let tier: number;
    let rawText: string;
    let layoutJson: Record<string, unknown> = {};
    let confidence: number;
    let pageCount = 1;

    if (DocumentTextExtractorService.isNativeText(mimeType, fileName)) {
      // ── Tier 0: the file already contains text (.docx, .txt, .md, .rtf) ──
      // No OCR: running a vision model over bytes that already spell out the
      // words costs tokens and loses fidelity.
      const extracted = await this.textExtractor.extract(buffer, mimeType, fileName);
      tier = 0;
      rawText = extracted.text;
      layoutJson = { source: extracted.source };
      confidence = 1;
      this.logger.log(
        `Document ${documentId}: Tier 0 (${extracted.source}, ${rawText.length} chars)`,
      );
    } else if (mimeType === 'application/pdf') {
      // ── Tier 1: native-text PDF ────────────────────────────────────────
      let extractedText = '';
      let pdfPageCount = 1;
      try {
        const parsed = await this.pdfExtractor.extract(buffer);
        extractedText = parsed.text;
        pdfPageCount = parsed.pageCount;
      } catch (err) {
        // A corrupt or image-only PDF must not kill the pipeline — fall through
        // to the vision tier, which reads scans directly.
        this.logger.warn(`Document ${documentId}: PDF text layer unreadable (${String(err)})`);
      }
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
        pageCount = Math.max(ocr.pageCount, pdfPageCount);
        await this.meterProviderTokens(orgId, ocr);
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
      await this.meterProviderTokens(orgId, ocr);
    }

    // ── Tier 3: vision LLM fallback if confidence is too low ──────────────
    // Skipped when Tier 2 was already a vision LLM — the same bytes through the
    // same model returns the same text for twice the tokens.
    if (confidence < OCR_CONFIDENCE_THRESHOLD && !this.ocrProvider.isVisionLlm) {
      this.logger.log(`Document ${documentId}: low confidence (${confidence.toFixed(2)}), escalating to Tier 3 (Gemini vision)`);

      const visionResult = await this.geminiVision.extractText(buffer, mimeType);

      tier = 3;
      rawText = visionResult.text || rawText; // keep Tier 2 text if vision returns nothing
      confidence = visionResult.confidence;
      layoutJson = { ...layoutJson, tier3Source: 'gemini-vision' };

      await this.usageMeter.recordAiTokens(orgId, visionResult.tokensIn, visionResult.tokensOut);
    }

    if (!rawText.trim()) {
      throw new Error('OCR produced no readable text for this document.');
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

    // Tier 0 read the text straight out of the file: no OCR provider call, no
    // vision tokens, nothing to bill. The meter only tracks tiers 1–3.
    if (tier > 0) {
      await this.usageMeter.recordOcrPages(orgId, tier, pageCount);
    }

    this.logger.log(
      `Document ${documentId}: OcrResult saved (tier=${tier}, confidence=${confidence.toFixed(2)}, ${processingMs}ms)`,
    );

    return { ocrResult, tier };
  }

  /** LLM-backed OCR providers report token spend; meter it against the org. */
  private async meterProviderTokens(orgId: string, result: OcrProviderResult): Promise<void> {
    if (result.tokensIn || result.tokensOut) {
      await this.usageMeter.recordAiTokens(orgId, result.tokensIn ?? 0, result.tokensOut ?? 0);
    }
  }
}
