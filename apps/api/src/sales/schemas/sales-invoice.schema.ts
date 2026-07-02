import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { InvoiceStatus } from '@ai-accounting/shared';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type SalesInvoiceDocument = HydratedDocument<SalesInvoice>;

@Schema({ _id: false })
class InvoiceAmounts {
  @Prop({ type: Number, required: true }) taxableValue: number;
  @Prop({ type: Number, required: true }) cgst: number;
  @Prop({ type: Number, required: true }) sgst: number;
  @Prop({ type: Number, required: true }) igst: number;
  @Prop({ type: Number, required: true }) cess: number;
  @Prop({ type: Number, required: true }) total: number;
}

@Schema({ _id: false })
class InvoiceLineItem {
  @Prop({ type: String, required: true }) description: string;
  @Prop({ type: String, default: null }) hsnSac: string | null;
  @Prop({ type: Number, default: 1 }) qty: number;
  @Prop({ type: Number, required: true }) ratePaise: number;
  @Prop({ type: Number, required: true }) amountPaise: number;
  @Prop({ type: Number, default: 0 }) taxRatePct: number;
}

@Schema({ collection: 'sales_invoices', timestamps: true })
export class SalesInvoice {
  @Prop({ required: true, index: true }) orgId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'Customer', index: true })
  customerId: Types.ObjectId;

  /** Sequential invoice number (gapless within org+FY — assigned at draft creation). */
  @Prop({ type: String, default: null }) invoiceNumber: string | null;
  @Prop({ type: String, required: true }) invoiceDate: string;
  @Prop({ type: String, default: null }) dueDate: string | null;

  @Prop({
    type: String,
    enum: Object.values(InvoiceStatus),
    default: InvoiceStatus.DRAFT,
    index: true,
  })
  status: InvoiceStatus;

  @Prop({ type: InvoiceAmounts, required: true }) amountsPaise: InvoiceAmounts;
  @Prop({ type: [InvoiceLineItem], default: [] }) lineItems: InvoiceLineItem[];

  @Prop({ type: String, default: null }) financialYear: string | null;

  /** Set after PostingService.post() succeeds. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', default: null })
  journalId: Types.ObjectId | null;

  @Prop({ type: String, default: null }) postedBy: string | null;
  /** Timestamp when the invoice was sent to the customer. */
  @Prop({ type: Date, default: null }) sentAt: Date | null;
  @Prop({ type: String, default: null }) paidBy: string | null;
  @Prop({ type: String, default: null }) notes: string | null;
}

export const SalesInvoiceSchema = SchemaFactory.createForClass(SalesInvoice);
SalesInvoiceSchema.index({ orgId: 1, customerId: 1, status: 1 });
SalesInvoiceSchema.plugin(tenantIsolationPlugin);
