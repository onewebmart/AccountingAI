import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type CreditNoteDocument = HydratedDocument<CreditNote>;

@Schema({ _id: false })
class NoteAmounts {
  @Prop({ type: Number, required: true }) taxableValue: number;
  @Prop({ type: Number, required: true }) cgst: number;
  @Prop({ type: Number, required: true }) sgst: number;
  @Prop({ type: Number, required: true }) igst: number;
  @Prop({ type: Number, required: true }) cess: number;
  @Prop({ type: Number, required: true }) total: number;
}

const paise = { type: Number, required: true, min: 0, validate: { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' } };

/** One line of an itemised credit note. amountPaise is qty × rate; less discountPaise, it is the line's taxable value. */
@Schema({ _id: false })
export class NoteLine {
  @Prop({ type: String, required: true }) description: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Item', default: null }) itemId: Types.ObjectId | null;
  @Prop({ type: String, default: null }) hsnSac: string | null;
  @Prop({ type: String, default: null }) uqc: string | null;
  @Prop({ type: Number, required: true, min: 0 }) qty: number;
  @Prop(paise) ratePaise: number;
  @Prop(paise) amountPaise: number;
  @Prop({ type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' } }) discountPaise: number;
  @Prop({ type: Number, default: 0 }) taxRatePct: number;
  /** The income account the line came back off. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', required: true }) accountId: Types.ObjectId;
}
const NoteLineSchema = SchemaFactory.createForClass(NoteLine);

/**
 * A credit note against a posted invoice: goods returned, a discount agreed after the fact, or an overcharge. It reduces what is owed
 * on the invoice and reverses the ledger entries in proportion. Numbered by its
 * CREDIT_NOTE voucher, so the sequence is gapless per financial year.
 */
@Schema({ collection: 'sales_credit_notes', timestamps: true })
export class CreditNote {
  @Prop({ required: true, index: true }) orgId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'SalesInvoice', index: true })
  invoiceId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'Customer', index: true })
  customerId: Types.ObjectId;

  /** e.g. CRN/2026-27/0001 — the voucher number of its journal. */
  @Prop({ type: String, required: true }) noteNumber: string;
  @Prop({ type: String, required: true }) noteDate: string;
  @Prop({ type: String, required: true }) financialYear: string;
  @Prop({ type: String, required: true }) reason: string;

  @Prop({ type: NoteAmounts, required: true }) amountsPaise: NoteAmounts;

  /**
   * value: a taxable value taken off the invoice, tax in its proportions.
   * itemised: lines of what is credited, each to an income account, taxed at
   * its own slab; GSTR-1 splits the note by these lines.
   */
  @Prop({ type: String, enum: ['value', 'itemised'], default: 'value' }) kind: 'value' | 'itemised';
  @Prop({ type: [NoteLineSchema], default: [] }) lines: NoteLine[];
  @Prop({ type: Object, default: null }) discount: { percent: number | null; amountPaise: number } | null;
  @Prop({ type: String, default: null }) referenceNumber: string | null;
  @Prop({ type: String, default: null }) subject: string | null;
  @Prop({ type: String, default: null }) salespersonName: string | null;
  @Prop({ type: String, default: null }) notes: string | null;
  @Prop({ type: String, default: null }) termsAndConditions: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', required: true })
  journalId: Types.ObjectId;

  /** reversed once its voucher has been reversed. */
  @Prop({ type: String, enum: ['posted', 'reversed'], default: 'posted', index: true })
  status: 'posted' | 'reversed';

  @Prop({ type: String, required: true }) createdBy: string;
}

export const CreditNoteSchema = SchemaFactory.createForClass(CreditNote);
CreditNoteSchema.index({ orgId: 1, invoiceId: 1, status: 1 });
CreditNoteSchema.plugin(tenantIsolationPlugin);
