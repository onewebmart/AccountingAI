import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { BillStatus } from '@ai-accounting/shared';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type PurchaseBillDocument = HydratedDocument<PurchaseBill>;

@Schema({ _id: false })
class BillAmounts {
  @Prop({ type: Number, required: true }) taxableValue: number;
  @Prop({ type: Number, required: true }) cgst: number;
  @Prop({ type: Number, required: true }) sgst: number;
  @Prop({ type: Number, required: true }) igst: number;
  @Prop({ type: Number, required: true }) cess: number;
  @Prop({ type: Number, required: true }) total: number;
}

@Schema({ _id: false })
class BillLineItem {
  @Prop({ type: String, required: true }) description: string;
  @Prop({ type: String, default: null }) hsnSac: string | null;
  @Prop({ type: Number, default: 1 }) qty: number;
  @Prop({ type: Number, required: true }) ratePaise: number;
  @Prop({ type: Number, required: true }) amountPaise: number;
  @Prop({ type: Number, default: 0 }) taxRatePct: number;
}

@Schema({ collection: 'purchase_bills', timestamps: true })
export class PurchaseBill {
  @Prop({ required: true, index: true }) orgId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'Vendor', index: true })
  vendorId: Types.ObjectId;

  /** Human-readable bill reference number (from vendor). */
  @Prop({ type: String, default: null }) billNumber: string | null;
  /** Date of the bill (YYYY-MM-DD). */
  @Prop({ type: String, required: true }) billDate: string;
  /** Payment due date (YYYY-MM-DD). */
  @Prop({ type: String, default: null }) dueDate: string | null;

  @Prop({
    type: String,
    enum: Object.values(BillStatus),
    default: BillStatus.DRAFT,
    index: true,
  })
  status: BillStatus;

  @Prop({ type: BillAmounts, required: true }) amountsPaise: BillAmounts;
  @Prop({ type: [BillLineItem], default: [] }) lineItems: BillLineItem[];

  /** Financial year computed at post time (e.g. "2025-26"). */
  @Prop({ type: String, default: null }) financialYear: string | null;

  /** Set after PostingService.post() succeeds. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', default: null })
  journalId: Types.ObjectId | null;

  /** Actor who posted this bill to the ledger. */
  @Prop({ type: String, default: null }) postedBy: string | null;
  /** Actor who marked this bill as paid. */
  @Prop({ type: String, default: null }) paidBy: string | null;
  @Prop({ type: String, default: null }) notes: string | null;
}

export const PurchaseBillSchema = SchemaFactory.createForClass(PurchaseBill);
PurchaseBillSchema.index({ orgId: 1, vendorId: 1, status: 1 });
PurchaseBillSchema.plugin(tenantIsolationPlugin);
