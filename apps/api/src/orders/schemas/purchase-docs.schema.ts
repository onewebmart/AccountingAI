import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';
import { DocAmounts, DocLine, DocLineSchema } from './sales-docs.schema';

const AmountsSchema = SchemaFactory.createForClass(DocAmounts);

export type PurchaseOrderDocument = HydratedDocument<PurchaseOrder>;

/** What we ordered from a vendor. Never posted; received and billed quantities come from GRNs and bills. */
@Schema({ collection: 'purchase_orders', timestamps: true })
export class PurchaseOrder {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Vendor', required: true, index: true }) vendorId: Types.ObjectId;
  @Prop({ type: String, required: true }) number: string;
  @Prop({ type: String, required: true }) date: string;
  @Prop({ type: String, default: null }) expectedBy: string | null;
  @Prop({ type: String, enum: ['open', 'closed', 'cancelled'], default: 'open', index: true }) status: 'open' | 'closed' | 'cancelled';
  @Prop({ type: [DocLineSchema], default: [] }) lines: DocLine[];
  @Prop({ type: AmountsSchema, required: true }) amountsPaise: DocAmounts;
  @Prop({ type: String, default: null }) notes: string | null;
  @Prop({ type: Date, default: null }) sentAt: Date | null;
  @Prop({ type: String, required: true }) createdBy: string;
}
export const PurchaseOrderSchema = SchemaFactory.createForClass(PurchaseOrder);
PurchaseOrderSchema.index({ orgId: 1, number: 1 }, { unique: true });
PurchaseOrderSchema.plugin(tenantIsolationPlugin);

export type GoodsReceiptDocument = HydratedDocument<GoodsReceipt>;

/** Goods that came in, against a purchase order's lines. Not posted under periodic inventory. */
@Schema({ collection: 'goods_receipts', timestamps: true })
export class GoodsReceipt {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Vendor', required: true }) vendorId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'PurchaseOrder', required: true, index: true }) purchaseOrderId: Types.ObjectId;
  @Prop({ type: String, required: true }) number: string;
  @Prop({ type: String, required: true }) date: string;
  @Prop({ type: [{ poLine: { type: Number, required: true }, qty: { type: Number, required: true, min: 0 }, rejectedQty: { type: Number, default: 0, min: 0 } }], default: [] })
  lines: Array<{ poLine: number; qty: number; rejectedQty: number }>;
  @Prop({ type: String, default: null }) vendorChallanNo: string | null;
  @Prop({ type: String, enum: ['received', 'cancelled'], default: 'received' }) status: 'received' | 'cancelled';
  @Prop({ type: String, default: null }) notes: string | null;
  @Prop({ type: String, required: true }) createdBy: string;
}
export const GoodsReceiptSchema = SchemaFactory.createForClass(GoodsReceipt);
GoodsReceiptSchema.index({ orgId: 1, number: 1 }, { unique: true });
GoodsReceiptSchema.plugin(tenantIsolationPlugin);
