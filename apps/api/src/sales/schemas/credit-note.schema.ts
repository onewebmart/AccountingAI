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
