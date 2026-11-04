import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type EInvoiceDocument = HydratedDocument<EInvoice>;
export type EInvoiceStatus = 'pending' | 'active' | 'failed' | 'cancelled';

/** An invoice's registration with the IRP: its IRN, acknowledgement and signed QR. */
@Schema({ collection: 'e_invoices', timestamps: true })
export class EInvoice {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'SalesInvoice', required: true }) invoiceId: Types.ObjectId;
  /** pending while the request is out; failed with the IRP's reasons; active once registered. */
  @Prop({ type: String, enum: ['pending', 'active', 'failed', 'cancelled'], required: true }) status: EInvoiceStatus;
  @Prop({ type: String, default: null }) irn: string | null;
  @Prop({ type: String, default: null }) ackNo: string | null;
  @Prop({ type: Date, default: null }) ackDate: Date | null;
  @Prop({ type: String, default: null }) signedQrCode: string | null;
  /** The IRP's reasons, when it refused. */
  @Prop({ type: [{ code: String, message: String }], default: [] }) irpErrors: Array<{ code: string; message: string }>;
  @Prop({ type: Number, default: 0 }) attempts: number;
  @Prop({ type: String, required: true }) provider: string;
  /** Made by the mock: not registered with the IRP. */
  @Prop({ type: Boolean, default: false }) isTest: boolean;
  @Prop({ type: String, default: null }) generatedBy: string | null;
  @Prop({ type: Date, default: null }) cancelledAt: Date | null;
  @Prop({ type: String, default: null }) cancelReason: string | null;
  @Prop({ type: String, default: null }) cancelledBy: string | null;
}

export const EInvoiceSchema = SchemaFactory.createForClass(EInvoice);
EInvoiceSchema.index({ orgId: 1, invoiceId: 1 }, { unique: true });
EInvoiceSchema.plugin(tenantIsolationPlugin);
