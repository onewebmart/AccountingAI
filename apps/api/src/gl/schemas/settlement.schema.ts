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

  /** Integer paise that moved through the bank (or cash). */
  @Prop({ type: Number, required: true, min: 0, validate: integerPaise })
  amountPaise: number;

  /**
   * Tax the customer deducted at source and paid to the government for us —
   * settled against the invoice without reaching the bank (sales only).
   */
  @Prop({ type: Number, default: 0, min: 0, validate: integerPaise })
  tdsPaise: number;

  /** The day the money moved (YYYY-MM-DD). */
  @Prop({ type: String, required: true })
  paidOn: string;

  /** The bank statement line it was matched from, if it came from reconciliation. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'BankStatementLine', default: null })
  bankLineId: Types.ObjectId | null;
}

export const SettlementSchema = SchemaFactory.createForClass(Settlement);

/**
 * A credit note (against an invoice) or debit note (against a bill) that
 * reduced what is owed — a correction to the document, not money moving.
 */
@Schema({ _id: false })
export class Adjustment {
  /** The credit or debit note. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  noteId: Types.ObjectId;

  /** The CREDIT_NOTE / DEBIT_NOTE voucher that posted it. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', required: true })
  journalId: Types.ObjectId;

  /** What the note took off the amount payable. */
  @Prop({ type: Number, required: true, min: 1, validate: integerPaise })
  amountPaise: number;

  /** TDS the note took back off the document's deduction (debit notes on bills with TDS). */
  @Prop({ type: Number, default: 0, min: 0, validate: integerPaise })
  tdsPaise: number;

  @Prop({ type: String, required: true })
  noteDate: string;
}

export const AdjustmentSchema = SchemaFactory.createForClass(Adjustment);

/** Field definitions shared by sales invoices and purchase bills. */
export const settledAmountProp = { type: Number, default: 0, min: 0, validate: integerPaise };

/**
 * What is still owed on an invoice or bill, in integer paise.
 *
 * What the counterparty is owed (payablePaise) less TDS deducted, payments
 * and credit / debit notes. A PAID document owes nothing even if it predates
 * part payments and so has no amountPaidPaise.
 */
export function outstandingPaise(doc: {
  status: string;
  amountsPaise: { total: number; cgst: number; sgst: number; igst: number; cess: number };
  amountPaidPaise?: number | null;
  adjustedPaise?: number | null;
  isReverseCharge?: boolean | null;
  tds?: { amountPaise: number } | null;
}): number {
  if (doc.status === 'paid') return 0;
  return Math.max(
    0,
    payablePaise(doc) - (doc.tds?.amountPaise ?? 0) - (doc.amountPaidPaise ?? 0) - (doc.adjustedPaise ?? 0),
  );
}

/**
 * What the counterparty is owed before TDS, payments and notes: the total —
 * except under reverse charge, where the GST is the buyer's to pay the
 * government, so the vendor is owed the taxable value only.
 */
export function payablePaise(doc: {
  amountsPaise: { total: number; cgst: number; sgst: number; igst: number; cess: number };
  isReverseCharge?: boolean | null;
}): number {
  const a = doc.amountsPaise;
  return doc.isReverseCharge ? a.total - (a.cgst + a.sgst + a.igst + a.cess) : a.total;
}
