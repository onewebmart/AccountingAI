import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Model, Types } from 'mongoose';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { DocumentStatus } from '@ai-accounting/shared';
import { Document, DocumentDocument } from './schemas/document.schema';
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
  id: string;
  originalName: string;
  status: DocumentStatus;
  type?: string;
  sizeBytes: number;
  sha256: string;
  duplicateOf?: string;
  jobId?: string;
  createdAt: Date;
}

@Injectable()
export class DocumentsService {
  constructor(
    @InjectModel(Document.name) private documentModel: Model<DocumentDocument>,
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

    return docs.map((d) => ({
      id: d._id.toString(),
      originalName: d.originalName,
      status: d.status,
      type: d.type,
      sizeBytes: d.sizeBytes,
      sha256: d.sha256,
      duplicateOf: d.duplicateOf?.toString(),
      jobId: d.jobId,
      createdAt: (d as unknown as { createdAt: Date }).createdAt,
    }));
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

  async updateStatus(documentId: string, status: DocumentStatus): Promise<void> {
    await this.documentModel
      .findByIdAndUpdate(documentId, { $set: { status } })
      .exec();
  }
}
