import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type PaymentRunDocument = HydratedDocument<PaymentRun>;

const integerPaise = { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' };

@Schema({ _id: false })
export class PaymentRunItem {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) billId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) vendorId: Types.ObjectId;
  @Prop({ type: String, required: true }) vendorName: string;
  @Prop({ type: String, default: null }) billNumber: string | null;
  @Prop({ type: Number, required: true, min: 1, validate: integerPaise }) amountPaise: number;
}
const PaymentRunItemSchema = SchemaFactory.createForClass(PaymentRunItem);

/**
 * A batch of vendor bills to pay together. Drafted, its bank file
 * downloaded and paid through the bank's portal, then recorded as paid,
 * which posts one payment per vendor. Nothing is paid from here.
 */
@Schema({ collection: 'payment_runs', timestamps: true })
export class PaymentRun {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, enum: ['draft', 'paid', 'cancelled'], default: 'draft', index: true }) status: 'draft' | 'paid' | 'cancelled';
  /** The day the run is meant to go out. */
  @Prop({ type: String, required: true }) payOn: string;
  @Prop({ type: [PaymentRunItemSchema], default: [] }) items: PaymentRunItem[];
  @Prop({ type: Number, required: true, min: 0, validate: integerPaise }) totalPaise: number;
  /** When its bank file was last downloaded. */
  @Prop({ type: Date, default: null }) exportedAt: Date | null;
  /** The day the bank paid it, and the payments recorded for it. */
  @Prop({ type: String, default: null }) paidOn: string | null;
  @Prop({ type: [MongooseSchema.Types.ObjectId], default: [] }) paymentIds: Types.ObjectId[];
  @Prop({ type: String, required: true }) createdBy: string;
}

export const PaymentRunSchema = SchemaFactory.createForClass(PaymentRun);
PaymentRunSchema.plugin(tenantIsolationPlugin);
