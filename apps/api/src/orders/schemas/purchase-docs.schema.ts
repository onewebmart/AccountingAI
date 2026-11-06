import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';
import { DocAdjustmentProp, DocAdjustmentSchema, DocAmounts, DocDiscountProp, DocDiscountSchema, DocLine } from './sales-docs.schema';

const AmountsSchema = SchemaFactory.createForClass(DocAmounts);

export type PurchaseOrderDocument = HydratedDocument<PurchaseOrder>;

/** A PO line: a document line with the account the bill made from it books it to. */
@Schema({ _id: false })
export class PurchaseOrderLine extends DocLine {
  /** Where the bill made from this line books it: chosen on the PO, else the item's; null for Purchases. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', default: null }) accountId: Types.ObjectId | null;
}
export const PurchaseOrderLineSchema = SchemaFactory.createForClass(PurchaseOrderLine);

/** Where the goods go: our own address, or straight to a customer's. The address is kept as it was when the PO was raised. */
export interface PoDeliverTo {
  kind: 'organisation' | 'customer';
  customerId: Types.ObjectId | null;
  name: string;
  address: string | null;
}

/** What we ordered from a vendor. Never posted; received and billed quantities come from GRNs and bills. */
@Schema({ collection: 'purchase_orders', timestamps: true })
export class PurchaseOrder {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Vendor', required: true, index: true }) vendorId: Types.ObjectId;
  @Prop({ type: String, required: true }) number: string;
  @Prop({ type: String, required: true }) date: string;
  /** The delivery date: when the goods are needed by. */
  @Prop({ type: String, default: null }) expectedBy: string | null;
  @Prop({ type: String, enum: ['open', 'closed', 'cancelled'], default: 'open', index: true }) status: 'open' | 'closed' | 'cancelled';
  @Prop({ type: [PurchaseOrderLineSchema], default: [] }) lines: PurchaseOrderLine[];
  @Prop({ type: AmountsSchema, required: true }) amountsPaise: DocAmounts;
  /** A discount on the whole PO, before tax, spread over its lines; carried onto the bills made from it. */
  @Prop({ type: DocDiscountSchema, default: null }) discount: DocDiscountProp | null;
  /** After tax, not taxed, at most ₹99.99 either way; carried onto a bill that bills the whole PO at once. */
  @Prop({ type: DocAdjustmentSchema, default: null }) adjustment: DocAdjustmentProp | null;
  /** The vendor's quotation, or our own reference. */
  @Prop({ type: String, default: null }) referenceNumber: string | null;
  /** The terms agreed with the vendor: due_on_receipt, net_30, end_of_month. The bills made from it are due by them. */
  @Prop({ type: String, default: null }) paymentTerms: string | null;
  /** How the goods come: road, courier, hand delivery. */
  @Prop({ type: String, default: null }) shipmentPreference: string | null;
  @Prop({ type: Object, default: null }) deliverTo: PoDeliverTo | null;
  /** Printed on the PO: notes for the vendor, and the terms. */
  @Prop({ type: String, default: null }) notes: string | null;
  @Prop({ type: String, default: null }) termsAndConditions: string | null;
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
