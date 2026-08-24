import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { ChecklistItemStatus, DocumentRequestStatus } from '@ai-accounting/shared';
import { firmIsolationPlugin } from '../../database/tenant.plugin';

export type DocumentRequestDocument = HydratedDocument<DocumentRequest>;

/** One required document on a client's checklist. */
@Schema({ _id: false })
export class ChecklistItem {
  /** Stable key from the template — the handle used by the API and matcher. */
  @Prop({ required: true }) key: string;

  @Prop({ required: true }) label: string;

  @Prop({
    type: String,
    enum: Object.values(ChecklistItemStatus),
    required: true,
    default: ChecklistItemStatus.PENDING,
  })
  status: ChecklistItemStatus;

  /** The upload that satisfied this item, once one has. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Document' })
  documentId?: Types.ObjectId;

  /** Filename at the time of matching — survives the document being replaced. */
  @Prop() documentName?: string;

  /**
   * True when the link was proposed by the auto-matcher rather than chosen by a
   * person. Surfaced in the UI so staff know what still needs a real look.
   */
  @Prop({ default: false }) autoMatched: boolean;

  @Prop() receivedAt?: Date;
  @Prop() verifiedAt?: Date;
  @Prop() verifiedBy?: string;
}

export const ChecklistItemSchema = SchemaFactory.createForClass(ChecklistItem);

/** A reminder already sent for this request, so bulk sends don't spam. */
@Schema({ _id: false })
export class RequestReminder {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'CrmMessage' })
  messageId?: Types.ObjectId;
  @Prop({ required: true }) sentAt: Date;
  /** Which documents were outstanding when it went out. */
  @Prop({ type: [String], default: [] }) missingKeys: string[];
}

export const RequestReminderSchema = SchemaFactory.createForClass(RequestReminder);

/**
 * A set of documents the firm is collecting from one client for one purpose —
 * "ITR filing", "GST filing for August".
 *
 * Firm-scoped, like the rest of the CRM: chasing documents is practice work
 * across the client book, not bookkeeping inside one org's ledger.
 */
@Schema({ timestamps: true, collection: 'crm_document_requests' })
export class DocumentRequest {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Firm', required: true, index: true })
  firmId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', required: true, index: true })
  clientOrgId: Types.ObjectId;

  /** Denormalised so the collection board needs no join per card. */
  @Prop({ required: true })
  clientName: string;

  /** What the documents are for, e.g. "ITR filing". */
  @Prop({ required: true })
  purpose: string;

  /** Optional link to the deadline that motivated the request. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ComplianceItem', index: true })
  complianceItemId?: Types.ObjectId;

  /** When the documents are needed by, YYYY-MM-DD. */
  @Prop({ required: true, index: true })
  dueDate: string;

  @Prop({ type: [ChecklistItemSchema], required: true, default: [] })
  items: ChecklistItem[];

  @Prop({
    type: String,
    enum: Object.values(DocumentRequestStatus),
    required: true,
    default: DocumentRequestStatus.OPEN,
    index: true,
  })
  status: DocumentRequestStatus;

  @Prop({ type: [RequestReminderSchema], default: [] })
  remindersSent: RequestReminder[];
}

export const DocumentRequestSchema = SchemaFactory.createForClass(DocumentRequest);

DocumentRequestSchema.plugin(firmIsolationPlugin);

// The collection board reads "this firm's open requests, soonest due first".
DocumentRequestSchema.index({ firmId: 1, status: 1, dueDate: 1 });

// The auto-matcher looks up open requests for the org that just uploaded.
DocumentRequestSchema.index({ clientOrgId: 1, status: 1 });
