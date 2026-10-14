import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type DebitNoteDocument = HydratedDocument<DebitNote>;

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
 * A debit note against a posted bill: goods returned to the vendor, short supply, or an overcharge. It reduces what is owed
 * on the bill and reverses the ledger entries in proportion. Numbered by its
 * DEBIT_NOTE voucher, so the sequence is gapless per financial year.
 */
@Schema({ collection: 'purchase_debit_notes', timestamps: true })
export class DebitNote {
  @Prop({ required: true, index: true }) orgId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'PurchaseBill', index: true })
  billId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'Vendor', index: true })
  vendorId: Types.ObjectId;

  /** e.g. DBN/2026-27/0001 — the voucher number of its journal. */
  @Prop({ type: String, required: true }) noteNumber: string;
  @Prop({ type: String, required: true }) noteDate: string;
  @Prop({ type: String, required: true }) financialYear: string;
  @Prop({ type: String, required: true }) reason: string;

  @Prop({ type: NoteAmounts, required: true }) amountsPaise: NoteAmounts;

  /** The share of the bill's TDS this note gave back (debited to TDS Payable). */
  @Prop({ type: Number, default: 0 }) tdsPaise: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', required: true })
  journalId: Types.ObjectId;

  /** reversed once its voucher has been reversed. */
  @Prop({ type: String, enum: ['posted', 'reversed'], default: 'posted', index: true })
  status: 'posted' | 'reversed';

  @Prop({ type: String, required: true }) createdBy: string;
}

export const DebitNoteSchema = SchemaFactory.createForClass(DebitNote);
DebitNoteSchema.index({ orgId: 1, billId: 1, status: 1 });
DebitNoteSchema.plugin(tenantIsolationPlugin);
