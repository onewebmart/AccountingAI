import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

const paise = { type: Number, required: true, min: 0, validate: { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' } };

@Schema({ _id: false })
export class DocLine {
  @Prop({ type: String, required: true }) description: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Item', default: null }) itemId: Types.ObjectId | null;
  @Prop({ type: String, default: null }) hsnSac: string | null;
  @Prop({ type: String, default: null }) uqc: string | null;
  @Prop({ type: Number, required: true, min: 0 }) qty: number;
  @Prop(paise) ratePaise: number;
  @Prop(paise) amountPaise: number;
  @Prop({ type: Number, default: 0 }) taxRatePct: number;
  /** This line's share of the document's discount, before tax; amountPaise less this is what is taxed. */
  @Prop({ type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' } }) discountPaise: number;
}
export const DocLineSchema = SchemaFactory.createForClass(DocLine);

/** A discount on the whole document, before tax: the percent asked for (null for an amount) and what it came to. */
@Schema({ _id: false })
export class DocDiscountProp {
  @Prop({ type: Number, default: null }) percent: number | null;
  @Prop(paise) amountPaise: number;
}
export const DocDiscountSchema = SchemaFactory.createForClass(DocDiscountProp);

/** Added after tax, not taxed: rounding the total, at most ₹99.99 either way. Signed paise. */
@Schema({ _id: false })
export class DocAdjustmentProp {
  @Prop({ type: String, default: 'Adjustment' }) label: string;
  @Prop({ type: Number, required: true, validate: { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' } }) paise: number;
}
export const DocAdjustmentSchema = SchemaFactory.createForClass(DocAdjustmentProp);

@Schema({ _id: false })
export class DocAmounts {
  @Prop(paise) taxableValue: number;
  @Prop(paise) cgst: number;
  @Prop(paise) sgst: number;
  @Prop(paise) igst: number;
  @Prop(paise) cess: number;
  @Prop(paise) total: number;
}
const DocAmountsSchema = SchemaFactory.createForClass(DocAmounts);

export type QuoteDocument = HydratedDocument<Quote>;
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'converted';

/** A price offered to a customer. Never posted: an accepted quote becomes an order or an invoice. */
@Schema({ collection: 'quotes', timestamps: true })
export class Quote {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Customer', required: true, index: true }) customerId: Types.ObjectId;
  @Prop({ type: String, required: true }) number: string;
  @Prop({ type: String, required: true }) date: string;
  @Prop({ type: String, required: true }) validUntil: string;
  /** Sent and past its date reads as expired; it is not rewritten. */
  @Prop({ type: String, enum: ['draft', 'sent', 'accepted', 'declined', 'converted'], default: 'draft', index: true }) status: QuoteStatus;
  @Prop({ type: [DocLineSchema], default: [] }) lines: DocLine[];
  @Prop({ type: DocAmountsSchema, required: true }) amountsPaise: DocAmounts;
  @Prop({ type: DocDiscountSchema, default: null }) discount: DocDiscountProp | null;
  @Prop({ type: DocAdjustmentSchema, default: null }) adjustment: DocAdjustmentProp | null;
  /** What the customer sees: notes, and the terms. */
  @Prop({ type: String, default: null }) notes: string | null;
  @Prop({ type: String, default: null }) termsAndConditions: string | null;
  /** The customer's enquiry or our reference. */
  @Prop({ type: String, default: null }) referenceNumber: string | null;
  /** What the quote is for, in a line. */
  @Prop({ type: String, default: null }) subject: string | null;
  @Prop({ type: String, default: null }) salespersonName: string | null;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project', default: null }) projectId: Types.ObjectId | null;
  @Prop({ type: Date, default: null }) sentAt: Date | null;
  @Prop({ type: String, default: null }) sentTo: string | null;
  /** What it became. */
  @Prop({ type: Object, default: null }) convertedTo: { kind: 'sales_order' | 'invoice'; id: string } | null;
  /** Drafted from a customer's message: what was read, and what was not. */
  @Prop({ type: Object, default: null }) drafted: { source: 'rules' | 'model'; message: string; unread: string[] } | null;
  @Prop({ type: String, required: true }) createdBy: string;
}
export const QuoteSchema = SchemaFactory.createForClass(Quote);
QuoteSchema.index({ orgId: 1, number: 1 }, { unique: true });
QuoteSchema.plugin(tenantIsolationPlugin);

export type SalesOrderDocument = HydratedDocument<SalesOrder>;

/** What a customer has ordered. Invoiced and delivered quantities are read from the invoices and challans made from it. */
@Schema({ collection: 'sales_orders', timestamps: true })
export class SalesOrder {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Customer', required: true, index: true }) customerId: Types.ObjectId;
  @Prop({ type: String, required: true }) number: string;
  @Prop({ type: String, required: true }) date: string;
  @Prop({ type: String, default: null }) expectedBy: string | null;
  @Prop({ type: String, default: null }) customerPoNumber: string | null;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Quote', default: null }) quoteId: Types.ObjectId | null;
  @Prop({ type: String, enum: ['open', 'closed', 'cancelled'], default: 'open', index: true }) status: 'open' | 'closed' | 'cancelled';
  @Prop({ type: [DocLineSchema], default: [] }) lines: DocLine[];
  @Prop({ type: DocAmountsSchema, required: true }) amountsPaise: DocAmounts;
  @Prop({ type: DocDiscountSchema, default: null }) discount: DocDiscountProp | null;
  @Prop({ type: DocAdjustmentSchema, default: null }) adjustment: DocAdjustmentProp | null;
  @Prop({ type: String, default: null }) notes: string | null;
  @Prop({ type: String, default: null }) termsAndConditions: string | null;
  @Prop({ type: String, default: null }) subject: string | null;
  @Prop({ type: String, default: null }) salespersonName: string | null;
  /** How the goods go: courier, our transport, collected. */
  @Prop({ type: String, default: null }) deliveryMethod: string | null;
  /** Days the customer has to pay; the invoices made from it are due that many days after their date. */
  @Prop({ type: Number, default: null, min: 0, max: 365 }) paymentTermsDays: number | null;
  @Prop({ type: String, required: true }) createdBy: string;
}
export const SalesOrderSchema = SchemaFactory.createForClass(SalesOrder);
SalesOrderSchema.index({ orgId: 1, number: 1 }, { unique: true });
SalesOrderSchema.plugin(tenantIsolationPlugin);

export type DeliveryChallanDocument = HydratedDocument<DeliveryChallan>;
export const CHALLAN_REASONS = ['supply', 'liquid_gas', 'job_work', 'approval', 'other'] as const;
export type ChallanReason = (typeof CHALLAN_REASONS)[number];

/**
 * Goods leaving without an invoice: against an order before it is billed,
 * for job work, or on approval. Never posted.
 */
@Schema({ collection: 'delivery_challans', timestamps: true })
export class DeliveryChallan {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Customer', required: true, index: true }) customerId: Types.ObjectId;
  @Prop({ type: String, required: true }) number: string;
  @Prop({ type: String, required: true }) date: string;
  /**
   * Why goods move on a challan (rule 55 of the CGST Rules): liquid gas whose
   * quantity is not known at removal, job work, on approval, a supply invoiced
   * later, or another reason that is not a supply.
   */
  @Prop({ type: String, enum: CHALLAN_REASONS, required: true }) reason: ChallanReason;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'SalesOrder', default: null, index: true }) salesOrderId: Types.ObjectId | null;
  /** Each line, with the order line it delivers when there is an order. */
  @Prop({ type: [{ line: DocLineSchema, orderLine: { type: Number, default: null } }], default: [] }) lines: Array<{ line: DocLine; orderLine: number | null }>;
  @Prop({ type: String, enum: ['issued', 'returned', 'cancelled'], default: 'issued' }) status: 'issued' | 'returned' | 'cancelled';
  @Prop({ type: String, default: null }) vehicleNo: string | null;
  @Prop({ type: String, default: null }) notes: string | null;
  @Prop({ type: String, default: null }) termsAndConditions: string | null;
  @Prop({ type: String, default: null }) referenceNumber: string | null;
  @Prop({ type: String, default: null }) subject: string | null;
  @Prop({ type: String, default: null }) salespersonName: string | null;
  @Prop({ type: String, required: true }) createdBy: string;
}
export const DeliveryChallanSchema = SchemaFactory.createForClass(DeliveryChallan);
DeliveryChallanSchema.index({ orgId: 1, number: 1 }, { unique: true });
DeliveryChallanSchema.plugin(tenantIsolationPlugin);
