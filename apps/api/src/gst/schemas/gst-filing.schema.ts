import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type GstFilingDocument = HydratedDocument<GstFiling>;
export type FilingStatus = 'saved' | 'otp_sent' | 'filed';

/**
 * A return on its way to the GST portal: saved, waiting for the OTP, filed.
 * Filing is final, so the figures saved are kept, and the return must still
 * read the same when it is filed.
 */
@Schema({ collection: 'gst_filings', timestamps: true })
export class GstFiling {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, enum: ['GSTR1', 'GSTR3B'], required: true }) returnType: 'GSTR1' | 'GSTR3B';
  /** YYYY-MM */
  @Prop({ type: String, required: true }) period: string;
  @Prop({ type: String, required: true }) gstin: string;
  @Prop({ type: String, enum: ['saved', 'otp_sent', 'filed'], required: true }) status: FilingStatus;
  /** SHA-256 of the JSON saved: what is filed must be what was saved. */
  @Prop({ type: String, required: true }) payloadHash: string;
  /** The headline figures as saved, for the record and the payment. */
  @Prop({ type: Object, required: true }) snapshot: Record<string, unknown>;
  @Prop({ type: String, default: null }) portalReference: string | null;
  @Prop({ type: String, required: true }) savedBy: string;
  @Prop({ type: Date, required: true }) savedAt: Date;
  @Prop({ type: String, default: null }) arn: string | null;
  @Prop({ type: Date, default: null }) filedAt: Date | null;
  @Prop({ type: String, default: null }) filedBy: string | null;
  @Prop({ type: String, required: true }) provider: string;
  @Prop({ type: Boolean, default: false }) isTest: boolean;
  /** GSTR-3B: the voucher that set off credit and paid the cash. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', default: null }) paymentJournalId: Types.ObjectId | null;
}

export const GstFilingSchema = SchemaFactory.createForClass(GstFiling);
GstFilingSchema.index({ orgId: 1, returnType: 1, period: 1 }, { unique: true });
GstFilingSchema.plugin(tenantIsolationPlugin);
