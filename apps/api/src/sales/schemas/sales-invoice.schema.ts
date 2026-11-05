import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { PartyAsIssued } from '../../gl/party-as-issued';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { InvoiceStatus } from '@ai-accounting/shared';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';
import {
  Adjustment,
  AdjustmentSchema,
  Settlement,
  SettlementSchema,
  settledAmountProp,
} from '../../gl/schemas/settlement.schema';

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
  /** The item picked for this line, if any. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Item', default: null }) itemId: Types.ObjectId | null;
  /** GST unit (UQC) for the HSN summary; from the item when one is picked. */
  @Prop({ type: String, default: null }) uqc: string | null;
  /** Where this line's value posts, from the item; the default account when null. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', default: null }) accountId: Types.ObjectId | null;
  /** Marked by a person as not a stock item (packing, a one-off), so it stops asking to be linked. */
  @Prop({ type: Boolean, default: false }) notStock: boolean;
  /** The project this line's income or cost belongs to; its journal line carries it. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project', default: null }) projectId: Types.ObjectId | null;
  /**
   * This line's share of the invoice's discount, before tax. amountPaise is
   * quantity times rate; amountPaise less this is the line's taxable value,
   * which the return and the ledger use.
   */
  @Prop({ type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' } }) discountPaise: number;
}

/** A discount on the whole invoice, before tax: the percent asked for (null for an amount), and what it came to. */
@Schema({ _id: false })
class InvoiceDiscount {
  @Prop({ type: Number, default: null }) percent: number | null;
  @Prop({ type: Number, required: true, min: 0, validate: { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' } }) amountPaise: number;
}

/** Added after tax and not taxed, at most ₹99.99 either way; it posts to Round Off. Signed paise. */
@Schema({ _id: false })
class InvoiceAdjustment {
  @Prop({ type: String, default: 'Adjustment' }) label: string;
  @Prop({ type: Number, required: true, validate: { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' } }) paise: number;
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

  /** The total includes any adjustment: total − (taxable value + tax) is the adjustment. */
  @Prop({ type: InvoiceAmounts, required: true }) amountsPaise: InvoiceAmounts;
  @Prop({ type: [InvoiceLineItem], default: [] }) lineItems: InvoiceLineItem[];
  @Prop({ type: InvoiceDiscount, default: null }) discount: InvoiceDiscount | null;
  @Prop({ type: InvoiceAdjustment, default: null }) adjustment: InvoiceAdjustment | null;

  /** The customer's order number, or ours. */
  @Prop({ type: String, default: null }) referenceNumber: string | null;
  /** What the invoice is for, in a line. */
  @Prop({ type: String, default: null }) subject: string | null;
  @Prop({ type: String, default: null }) salespersonName: string | null;
  @Prop({ type: String, default: null }) termsAndConditions: string | null;
  /** Days the customer has to pay; the due date follows from it when none is given. */
  @Prop({ type: Number, default: null, min: 0, max: 365 }) paymentTermsDays: number | null;

  @Prop({ type: String, default: null }) financialYear: string | null;

  /** Set after PostingService.post() succeeds. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', default: null })
  journalId: Types.ObjectId | null;

  /**
   * Integer paise paid so far, across every receipt in `payments`. The
   * document stays posted until this reaches the total, then becomes paid.
   */
  @Prop(settledAmountProp) amountPaidPaise: number;

  /** Each receipt against this document — part payments add one each. */
  @Prop({ type: [SettlementSchema], default: [] }) payments: Settlement[];

  /** Reduced by credit notes, in integer paise — counted against what is owed. */
  @Prop(settledAmountProp) adjustedPaise: number;

  /** Each credit note against this document. */
  @Prop({ type: [AdjustmentSchema], default: [] }) adjustments: Adjustment[];

  @Prop({ type: String, default: null }) postedBy: string | null;
  /** Timestamp when the invoice was sent to the customer. */
  @Prop({ type: Date, default: null }) sentAt: Date | null;
  @Prop({ type: String, default: null }) paidBy: string | null;
  @Prop({ type: String, default: null }) notes: string | null;

  /**
   * The uploaded document this came from, when it came from one.
   *
   * Null for a manual entry. Lets Purchase and Sales show which rows were read
   * off a scan and link back to the file, rather than the two kinds of entry
   * being indistinguishable once posted.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Document', default: null, index: true })
  sourceDocumentId?: MongooseSchema.Types.ObjectId | null;

  /** The recurring template that drafted this, when one did. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'RecurringTemplate', default: null })
  recurringTemplateId?: MongooseSchema.Types.ObjectId | null;

  /**
   * An opening balance brought in from another system: what the party owed
   * on the day the books moved here. It has no posting of its own (the
   * opening journal carries it) and is not a supply, so GST returns skip it.
   */
  @Prop({ type: Boolean, default: false }) isOpeningBalance: boolean;

  /** The last time the PDF was emailed, and to whom. */
  @Prop({ type: String, default: null }) emailedTo: string | null;
  @Prop({ type: Date, default: null }) emailedAt: Date | null;

  /**
   * An online payment link for what the invoice owes. created → paid (the
   * gateway says so; nothing posted) → confirmed (a person recorded the
   * receipt, receiptId).
   */
  @Prop({ type: Object, default: null })
  paymentLink: {
    provider: string;
    linkId: string;
    url: string;
    referenceId: string;
    amountPaise: number;
    status: 'created' | 'paid' | 'confirmed';
    createdAt: Date;
    paidPaise: number | null;
    paidOn: string | null;
    gatewayPaymentId: string | null;
    receiptId: Types.ObjectId | null;
  } | null;

  /**
   * The party as it stood when this was issued, stamped before the party's
   * name, GSTIN or state is edited. Null: read the party as it is now.
   */
  @Prop({ type: Object, default: null }) partyAtIssue: PartyAsIssued | null;

  /** Made from a quote or a sales order; for an order, how much of each of its lines this invoice bills. */
  @Prop({ type: Object, default: null })
  source: { kind: 'quote' | 'sales_order' | 'project'; id: string; lines?: Array<{ orderLine: number; qty: number }> } | null;

  /**
   * A document in a foreign currency: its own amounts in that currency's
   * minor units and the rate it was booked at. amountsPaise and the journal
   * are INR, converted once at that rate; this is kept beside them.
   */
  @Prop({ type: Object, default: null })
  foreign: { currency: string; digits: number; rate: number; taxableMinor: number; totalMinor: number; paidMinor: number; linesMinor: number[] } | null;

  /** An export: zero-rated under a letter of undertaking (LUT), reported in GSTR-1 table 6A. */
  @Prop({ type: String, enum: ['lut', null], default: null }) exportType: 'lut' | null;
  /** The shipping bill for exported goods; services have none. */
  @Prop({ type: Object, default: null }) shippingBill: { number: string; date: string; portCode: string } | null;

}

export const SalesInvoiceSchema = SchemaFactory.createForClass(SalesInvoice);
SalesInvoiceSchema.index({ orgId: 1, customerId: 1, status: 1 });
SalesInvoiceSchema.plugin(tenantIsolationPlugin);
