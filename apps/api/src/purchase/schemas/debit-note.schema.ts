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

/** A line of a vendor credit typed line by line: what goes back, at what value, off which account. */
@Schema({ _id: false })
export class DebitNoteLine {
  @Prop({ type: String, required: true }) description: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Item', default: null }) itemId: Types.ObjectId | null;
  @Prop({ type: String, default: null }) hsnSac: string | null;
  @Prop({ type: String, default: null }) uqc: string | null;
  @Prop({ type: Number, required: true, min: 0 }) qty: number;
  @Prop({ type: Number, required: true, min: 0, validate: { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' } }) ratePaise: number;
  @Prop({ type: Number, required: true, min: 0, validate: { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' } }) amountPaise: number;
  /** Its discount before tax: its own, or its share of the note's. amountPaise less this is what is taxed. */
  @Prop({ type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' } }) discountPaise: number;
  @Prop({ type: Number, default: null }) discountPercent: number | null;
  @Prop({ type: Number, default: 0 }) taxRatePct: number;
  /** The account it comes back off. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', required: true }) accountId: Types.ObjectId;
}
const DebitNoteLineSchema = SchemaFactory.createForClass(DebitNoteLine);

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

  /** By value (tax in the bill's proportions), or typed line by line as a vendor credit. */
  @Prop({ type: String, enum: ['value', 'itemised'], default: 'value' }) kind: 'value' | 'itemised';
  /** Itemised: the lines, and the discount and adjustment they were priced with (the adjustment is in amountsPaise.total). */
  @Prop({ type: [DebitNoteLineSchema], default: [] }) lines: DebitNoteLine[];
  @Prop({ type: Object, default: null }) discount: { percent: number | null; amountPaise: number } | null;
  @Prop({ type: String, enum: ['transaction', 'line', null], default: null }) discountLevel: 'transaction' | 'line' | null;
  @Prop({ type: Object, default: null }) adjustment: { label: string; paise: number } | null;
  /** The vendor's own credit note number, our order number, and words for the note. */
  @Prop({ type: String, default: null }) vendorCreditNumber: string | null;
  @Prop({ type: String, default: null }) orderNumber: string | null;
  @Prop({ type: String, default: null }) subject: string | null;
  @Prop({ type: String, default: null }) notes: string | null;

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
