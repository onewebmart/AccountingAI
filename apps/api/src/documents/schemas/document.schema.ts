import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { DocumentStatus, DocumentType } from '@ai-accounting/shared';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type DocumentDocument = HydratedDocument<Document>;

@Schema({ timestamps: true, collection: 'documents' })
export class Document {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ type: String, enum: Object.values(DocumentType) })
  type?: DocumentType;

  @Prop({
    type: String,
    enum: Object.values(DocumentStatus),
    default: DocumentStatus.UPLOADED,
    index: true,
  })
  status: DocumentStatus;

  /** S3 object key — use to construct presigned URLs */
  @Prop({ required: true })
  s3Key: string;

  @Prop({ required: true })
  originalName: string;

  @Prop({ required: true })
  mimeType: string;

  /** File size in bytes */
  @Prop({ required: true })
  sizeBytes: number;

  /** SHA-256 hex hash of the raw file bytes — used for dedup */
  @Prop({ required: true, index: true })
  sha256: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  uploadedBy: MongooseSchema.Types.ObjectId;

  /** Points to the earlier document when this one is flagged as a suspected duplicate */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Document', index: true })
  duplicateOf?: MongooseSchema.Types.ObjectId;

  /** BullMQ job ID — set after the processing job is enqueued */
  @Prop()
  jobId?: string;
}

export const DocumentSchema = SchemaFactory.createForClass(Document);

DocumentSchema.index({ orgId: 1, sha256: 1 });
DocumentSchema.index({ orgId: 1, status: 1, createdAt: -1 });

DocumentSchema.plugin(tenantIsolationPlugin);
