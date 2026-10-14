import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, Schema as MongooseSchema } from 'mongoose';

const integerPaise = {
  validator: (v: number) => Number.isInteger(v),
  message: 'Money must be an integer number of paise (Invariant 1)',
};

/**
 * One payment against a sales invoice or purchase bill — a receipt or payment
 * voucher for part or all of what is owed. An invoice can carry several.
 */
@Schema({ _id: true })
export class Settlement {
  _id: Types.ObjectId;

  /** The receipt (money in) or payment (money out) voucher that recorded it. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', required: true })
  journalId: Types.ObjectId;

  /** Integer paise settled by this payment. */
  @Prop({ type: Number, required: true, min: 1, validate: integerPaise })
  amountPaise: number;

  /** The day the money moved (YYYY-MM-DD). */
  @Prop({ type: String, required: true })
  paidOn: string;

  /** The bank statement line it was matched from, if it came from reconciliation. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'BankStatementLine', default: null })
  bankLineId: Types.ObjectId | null;
}

export const SettlementSchema = SchemaFactory.createForClass(Settlement);

/** Field definitions shared by sales invoices and purchase bills. */
export const settledAmountProp = { type: Number, default: 0, min: 0, validate: integerPaise };

/**
 * What is still owed on an invoice or bill, in integer paise.
 *
 * A PAID document owes nothing even if it predates part payments and so has no
 * amountPaidPaise recorded.
 */
export function outstandingPaise(doc: {
  status: string;
  amountsPaise: { total: number };
  amountPaidPaise?: number | null;
}): number {
  if (doc.status === 'paid') return 0;
  return Math.max(0, doc.amountsPaise.total - (doc.amountPaidPaise ?? 0));
}
