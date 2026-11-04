import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type AttachmentDocument = HydratedDocument<Attachment>;

export const ATTACHABLE = ['SalesInvoice', 'PurchaseBill', 'Journal', 'PartyPayment', 'Customer', 'Vendor'] as const;
export type AttachableType = (typeof ATTACHABLE)[number];

/**
 * A file kept against a record: the signed delivery note behind a bill, the
 * agreement behind a vendor, the bank advice behind a payment. Kept, not
 * read: it does not go through the reading pipeline. Removing one hides it;
 * the file and the record of it stay.
 */
@Schema({ collection: 'attachments', timestamps: true })
export class Attachment {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, enum: ATTACHABLE, required: true }) entityType: AttachableType;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) entityId: Types.ObjectId;
  @Prop({ type: String, required: true }) fileName: string;
  @Prop({ type: String, required: true }) mimeType: string;
  @Prop({ type: Number, required: true, min: 0 }) sizeBytes: number;
  @Prop({ type: String, required: true }) sha256: string;
  @Prop({ type: String, required: true }) storageKey: string;
  @Prop({ type: String, required: true }) uploadedBy: string;
  @Prop({ type: Date, default: null }) removedAt: Date | null;
  @Prop({ type: String, default: null }) removedBy: string | null;
}

export const AttachmentSchema = SchemaFactory.createForClass(Attachment);
AttachmentSchema.index({ orgId: 1, entityType: 1, entityId: 1 });
AttachmentSchema.plugin(tenantIsolationPlugin);
