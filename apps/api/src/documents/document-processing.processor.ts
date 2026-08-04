import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DocumentStatus } from '@ai-accounting/shared';
import { DOCUMENT_PROCESSING_QUEUE } from './documents.service';
import { DocumentsService } from './documents.service';
import { StorageService } from './storage.service';
import { OcrCascadeService } from '../ocr/ocr-cascade.service';
import { ExtractionService } from '../extraction/extraction.service';
import { ProposalsService } from '../proposals/proposals.service';
import { SpreadsheetIngestService } from '../ingest/spreadsheet-ingest.service';
import { isSpreadsheet } from '../ingest/spreadsheet-parser.service';

export interface DocumentProcessingJob {
  documentId: string;
  orgId: string;
  s3Key: string;
  mimeType: string;
  isDuplicate: boolean;
  originalName?: string;
}

@Processor(DOCUMENT_PROCESSING_QUEUE)
export class DocumentProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentProcessingProcessor.name);

  constructor(
    private docs: DocumentsService,
    private storage: StorageService,
    private ocrCascade: OcrCascadeService,
    private extraction: ExtractionService,
    private proposals: ProposalsService,
    private spreadsheets: SpreadsheetIngestService,
  ) {
    super();
  }

  async process(job: Job<DocumentProcessingJob>): Promise<void> {
    const { documentId, orgId, s3Key, mimeType, isDuplicate, originalName } = job.data;

    // Duplicates keep their DUPLICATE status — a human decides the next action.
    if (isDuplicate) {
      this.logger.log(`Document ${documentId} is a duplicate — skipping OCR/extraction`);
      return;
    }

    await this.docs.updateStatus(documentId, DocumentStatus.CLASSIFYING);

    try {
      const buffer = await this.storage.download(s3Key);

      // Spreadsheets carry their own structure — parse the cells instead of
      // running OCR over a rendering of them.
      if (isSpreadsheet(mimeType, originalName ?? '')) {
        await this.processSpreadsheet(documentId, orgId, originalName ?? 'upload.xlsx', buffer);
        return;
      }

      // Step 1: OCR cascade
      const { tier, ocrResult } = await this.ocrCascade.process({
        documentId,
        orgId,
        buffer,
        mimeType,
      });
      this.logger.log(
        `Document ${documentId}: OCR tier ${tier}, confidence ${ocrResult.confidence.toFixed(2)}`,
      );

      // Step 2: AI extraction
      await this.docs.updateStatus(documentId, DocumentStatus.EXTRACTING);
      const extracted = await this.extraction.extract({
        documentId,
        orgId,
        ocrResultId: ocrResult._id.toString(),
        ocrText: ocrResult.rawText,
      });

      // Step 3: Create ProposedEntry (AI writes only here — Invariant 4)
      await this.proposals.createFromExtracted(extracted._id.toString(), orgId);

      await this.docs.updateStatus(documentId, DocumentStatus.PROPOSED);
      this.logger.log(
        `Document ${documentId}: proposal created (extraction status=${extracted.status}, confidence=${extracted.confidenceOverall.toFixed(2)})`,
      );
    } catch (err) {
      this.logger.error(`Document ${documentId} pipeline failed: ${String(err)}`);
      await this.docs.updateStatus(documentId, DocumentStatus.FAILED);
      throw err; // re-throw so BullMQ retries per job config
    }
  }

  private async processSpreadsheet(
    documentId: string,
    orgId: string,
    fileName: string,
    buffer: Buffer,
  ): Promise<void> {
    await this.docs.updateStatus(documentId, DocumentStatus.EXTRACTING);

    const results = await this.spreadsheets.ingest({
      orgId,
      documentId,
      fileName,
      buffer,
    });

    const imported = results.reduce((s, r) => s + r.rowsImported, 0);
    const proposals = results.reduce((s, r) => s + r.proposalsCreated, 0);

    this.logger.log(
      `Document ${documentId}: spreadsheet ingested — ` +
        results.map((r) => `${r.sheetName}:${r.kind}=${r.rowsImported}`).join(', '),
    );

    await this.docs.setSpreadsheetOutcome(documentId, results);

    // Bank statements land in reconciliation rather than the review queue, so a
    // statement-only import is complete even with zero proposals.
    await this.docs.updateStatus(
      documentId,
      imported > 0 || proposals > 0 ? DocumentStatus.PROPOSED : DocumentStatus.FAILED,
    );
  }
}
