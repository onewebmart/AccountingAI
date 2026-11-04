import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type EWayBillDocument = HydratedDocument<EWayBill>;

/** The e-way bill for moving an invoice's goods: Part A from the invoice, Part B the vehicle. */
@Schema({ collection: 'e_way_bills', timestamps: true })
export class EWayBill {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'SalesInvoice', required: true, index: true }) invoiceId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Customer', default: null }) customerId: Types.ObjectId | null;
  @Prop({ type: String, enum: ['active', 'cancelled'], required: true }) status: 'active' | 'cancelled';
  @Prop({ type: String, required: true }) ewbNo: string;
  @Prop({ type: Date, required: true }) ewbDate: Date;
  @Prop({ type: Date, required: true }) validUpto: Date;
  @Prop({ type: String, required: true }) fromPincode: string;
  @Prop({ type: String, required: true }) toPincode: string;
  @Prop({ type: Number, required: true }) distanceKm: number;
  /** The consignment's value, in paise. */
  @Prop({ type: Number, required: true }) valuePaise: number;
  @Prop({ type: String, enum: ['road', 'rail', 'air', 'ship'], required: true }) mode: 'road' | 'rail' | 'air' | 'ship';
  @Prop({ type: String, default: null }) vehicleNo: string | null;
  @Prop({ type: String, enum: ['regular', 'odc'], default: 'regular' }) vehicleType: 'regular' | 'odc';
  @Prop({ type: String, default: null }) transporterId: string | null;
  @Prop({ type: String, default: null }) transporterName: string | null;
  @Prop({ type: String, default: null }) transDocNo: string | null;
  @Prop({ type: String, default: null }) transDocDate: string | null;
  @Prop({ type: [{ vehicleNo: String, at: Date, reason: String, by: String }], default: [] })
  vehicleHistory: Array<{ vehicleNo: string; at: Date; reason: string; by: string }>;
  @Prop({ type: [{ at: Date, remainingKm: Number, reason: String, validUpto: Date, by: String }], default: [] })
  extensions: Array<{ at: Date; remainingKm: number; reason: string; validUpto: Date; by: string }>;
  @Prop({ type: Date, default: null }) cancelledAt: Date | null;
  @Prop({ type: String, default: null }) cancelReason: string | null;
  @Prop({ type: String, required: true }) provider: string;
  @Prop({ type: Boolean, default: false }) isTest: boolean;
  @Prop({ type: String, required: true }) createdBy: string;
}

export const EWayBillSchema = SchemaFactory.createForClass(EWayBill);
EWayBillSchema.plugin(tenantIsolationPlugin);
