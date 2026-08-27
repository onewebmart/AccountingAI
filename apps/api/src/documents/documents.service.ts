import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Model, Types } from 'mongoose';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { DocumentStatus } from '@ai-accounting/shared';
import { Document, DocumentDocument } from './schemas/document.schema';
import { OcrResult, OcrResultDocument } from '../ocr/schemas/ocr-result.schema';
import { ProposedEntry, ProposedEntryDocument } from '../proposals/schemas/proposed-entry.schema';
import { StorageService } from './storage.service';
import { withOrg } from '../database/tenant.plugin';

export const DOCUMENT_PROCESSING_QUEUE = 'document-processing';

export interface UploadInput {
  orgId: string;
  uploadedBy: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}

export interface DocumentListItem {
  /** Both spellings are sent: the web client keys off _id, older callers off id. */
  _id: string;
  id: string;
  originalName: string;
  status: DocumentStatus;
  type?: string;
  /** Document type detected by extraction (purchase_invoice, sales_invoice, …). */
  documentType?: string;
  /** Party name pulled off the document, once extraction has run. */
  vendor: string | null;
  invoiceNumber: string | null;
  totalAmountPaise: number | null;
  confidence: number | null;
  /** Set once a proposal exists, so the Inbox can deep-link into review. */
  proposalId: string | null;
  sizeBytes: number;
  sha256: string;
  duplicateOf?: string;
  duplicateOfName?: string;
  jobId?: string;
  /** Present only on failed documents — why the pipeline gave up. */
  failureReason?: string;
  uploadedAt: Date;
  createdAt: Date;
}

@Injectable()
export class DocumentsService {
  constructor(
    @InjectModel(Document.name) private documentModel: Model<DocumentDocument>,
    @InjectModel(ProposedEntry.name) private proposalModel: Model<ProposedEntryDocument>,
    @InjectModel(OcrResult.name) private ocrResultModel: Model<OcrResultDocument>,
    @InjectQueue(DOCUMENT_PROCESSING_QUEUE) private processingQueue: Queue,
    private storage: StorageService,
  ) {}

  async upload(input: UploadInput): Promise<DocumentDocument> {
    const { orgId, uploadedBy, originalName, mimeType, buffer } = input;

    // 1. Compute SHA-256 hash of raw file bytes
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    // 2. Dedup check — look for a document with the same hash in this org
    const existing = await withOrg(orgId, () =>
      this.documentModel.findOne({ sha256 }).exec(),
    );

    // 3. Build the S3 key — scoped to org to prevent cross-tenant key collision
    const ext = originalName.split('.').pop() ?? 'bin';
    const s3Key = `orgs/${orgId}/${sha256}.${ext}`;

    // 4. Upload to S3 (idempotent — same hash = same key, safe to overwrite)
    await this.storage.upload(s3Key, buffer, mimeType);

    // 5. Save document record
    const doc = await this.documentModel.create({
      orgId,
      status: existing ? DocumentStatus.DUPLICATE : DocumentStatus.UPLOADED,
      s3Key,
      originalName,
      mimeType,
      sizeBytes: buffer.length,
      sha256,
      uploadedBy: new Types.ObjectId(uploadedBy),
      duplicateOf: existing ? existing._id : undefined,
    });

    // 6. Enqueue processing job — even duplicates get enqueued so a human can decide
    const job = await this.processingQueue.add(
      'process-document',
      {
        documentId: doc._id.toString(),
        orgId,
        s3Key,
        mimeType,
        isDuplicate: !!existing,
        originalName,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: false,
      },
    );

    // 7. Store jobId for tracking
    await this.documentModel
      .findByIdAndUpdate(doc._id, { $set: { jobId: job.id } })
      .exec();

    return this.documentModel.findById(doc._id).exec() as Promise<DocumentDocument>;
  }

  async findAll(orgId: string, status?: DocumentStatus): Promise<DocumentListItem[]> {
    const filter = status ? { status } : {};
    const docs = await withOrg(orgId, () =>
      this.documentModel
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(100)
        .exec(),
    );

    // Fold in what the AI read off each document so the Inbox can show vendor,
    // amount and confidence without a request per row.
    const docIds = docs.map((d) => d._id);
    const proposals = await withOrg(orgId, () =>
      this.proposalModel
        .find({ documentId: { $in: docIds } })
        .sort({ createdAt: -1 })
        .exec(),
    );

    const byDocId = new Map<string, (typeof proposals)[number]>();
    for (const p of proposals) {
      const key = p.documentId?.toString();
      if (key && !byDocId.has(key)) byDocId.set(key, p);
    }

    // Which tier read each file. Stored on the OCR result and never surfaced
    // before, so there was no way to tell from the Inbox whether a document
    // cost nothing (tier 0, read straight out of the file) or went to the
    // vision model (tier 3).
    const ocrResults = await withOrg(orgId, () =>
      this.ocrResultModel
        .find({ documentId: { $in: docIds } })
        .select('documentId tier confidence')
        .sort({ createdAt: -1 })
        .exec(),
    );
    const tierByDocId = new Map<string, number>();
    for (const r of ocrResults) {
      const key = r.documentId?.toString();
      if (key && !tierByDocId.has(key)) tierByDocId.set(key, r.tier);
    }

    // Duplicate rows name the original file they collided with.
    const originalIds = docs.map((d) => d.duplicateOf).filter(Boolean);
    const originals = originalIds.length
      ? await withOrg(orgId, () =>
          this.documentModel.find({ _id: { $in: originalIds } }).select('originalName').exec(),
        )
      : [];
    const originalNames = new Map(
      originals.map((o) => [o._id.toString(), o.originalName]),
    );

    return docs.map((d) => {
      const proposal = byDocId.get(d._id.toString());
      const createdAt = (d as unknown as { createdAt: Date }).createdAt;

      return {
        _id: d._id.toString(),
        id: d._id.toString(),
        originalName: d.originalName,
        status: d.status,
        type: d.type,
        documentType: proposal?.documentType ?? d.type,
        vendor: proposal?.vendorName ?? null,
        invoiceNumber: proposal?.invoiceNumber ?? null,
        totalAmountPaise: proposal?.amountsPaise?.total ?? null,
        confidence: proposal?.confidenceOverall ?? null,
        ocrTier: tierByDocId.get(d._id.toString()) ?? null,
        proposalId: proposal?._id.toString() ?? null,
        sizeBytes: d.sizeBytes,
        sha256: d.sha256,
        duplicateOf: d.duplicateOf?.toString(),
        duplicateOfName: d.duplicateOf
          ? originalNames.get(d.duplicateOf.toString())
          : undefined,
        jobId: d.jobId,
        // Carried to the Inbox so a failed row can say what went wrong.
        failureReason: d.failureReason,
        uploadedAt: createdAt,
        createdAt,
      };
    });
  }

  async findById(documentId: string, orgId: string): Promise<DocumentDocument | null> {
    return withOrg(orgId, () =>
      this.documentModel.findById(documentId).exec(),
    );
  }

  async getPresignedUrl(documentId: string, orgId: string): Promise<string> {
    const doc = await this.findById(documentId, orgId);
    if (!doc) throw new BadRequestException('Document not found.');
    return this.storage.presignedUrl(doc.s3Key);
  }

  /**
   * Re-runs the pipeline on a document that failed.
   *
   * The three automatic attempts cover a blip; this covers everything they do
   * not — a model outage that outlasted the backoff, a quota that has since
   * reset. Without it a transient failure is permanent, and the only recourse
   * is uploading the same file again and living with a duplicate.
   */
  async retryProcessing(documentId: string, orgId: string): Promise<{ jobId: string }> {
    const doc = await this.documentModel.findOne({ _id: documentId, orgId }).exec();
    if (!doc) throw new NotFoundException('Document not found');

    if (doc.status !== DocumentStatus.FAILED) {
      throw new BadRequestException(
        `Only a failed document can be retried — this one is ${doc.status}.`,
      );
    }

    await this.updateStatus(documentId, DocumentStatus.UPLOADED);

    const job = await this.processingQueue.add(
      'process-document',
      {
        documentId,
        orgId,
        s3Key: doc.s3Key,
        mimeType: doc.mimeType,
        // A retry is a deliberate act — process it properly rather than
        // parking it as a duplicate again.
        isDuplicate: false,
        originalName: doc.originalName,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: false,
      },
    );

    await this.documentModel
      .findByIdAndUpdate(documentId, { $set: { jobId: job.id } })
      .exec();

    return { jobId: String(job.id) };
  }

  async updateStatus(
    documentId: string,
    status: DocumentStatus,
    failureReason?: string,
  ): Promise<void> {
    // A reason is only meaningful alongside a failure — clear it on any other
    // move, so a retried document does not keep showing the old error.
    const update =
      status === DocumentStatus.FAILED && failureReason
        ? { $set: { status, failureReason } }
        : { $set: { status }, $unset: { failureReason: '' } };

    await this.documentModel.findByIdAndUpdate(documentId, update).exec();
  }

  /** Record what an imported spreadsheet produced, so the Inbox can explain itself. */
  async setSpreadsheetOutcome(
    documentId: string,
    results: Array<{
      kind: string;
      sheetName: string;
      rowsRead: number;
      rowsImported: number;
      proposalsCreated: number;
      statementId?: string;
      warnings: string[];
    }>,
  ): Promise<void> {
    const primary = results.find((r) => r.rowsImported > 0) ?? results[0];

    await this.documentModel
      .findByIdAndUpdate(documentId, {
        $set: {
          importSummary: {
            kind: primary?.kind ?? 'unknown',
            sheets: results.map((r) => ({
              name: r.sheetName,
              kind: r.kind,
              rowsRead: r.rowsRead,
              rowsImported: r.rowsImported,
              proposalsCreated: r.proposalsCreated,
              statementId: r.statementId ?? null,
              warnings: r.warnings.slice(0, 20),
            })),
            totalRowsImported: results.reduce((s, r) => s + r.rowsImported, 0),
            totalProposals: results.reduce((s, r) => s + r.proposalsCreated, 0),
          },
        },
      })
      .exec();
  }
}
