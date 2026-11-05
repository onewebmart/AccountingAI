import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type PartyPaymentDocument = HydratedDocument<PartyPayment>;

const integerPaise = { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' };

/** How the money moved, as the person recording it says. */
export const PAYMENT_MODES = ['cash', 'bank_transfer', 'cheque', 'upi', 'card', 'other'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** Part of a receipt or payment applied to one invoice or bill. */
@Schema({ _id: false })
export class PaymentAllocation {
  /** The invoice (receipt) or bill (payment). */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) documentId: Types.ObjectId;
  @Prop({ type: String, default: null }) documentNumber: string | null;
  /** Money applied, beside any TDS the customer deducted on this invoice. */
  @Prop({ type: Number, required: true, min: 0, validate: integerPaise }) amountPaise: number;
  @Prop({ type: Number, default: 0, min: 0, validate: integerPaise }) tdsPaise: number;
  /**
   * The voucher that applied it: the receipt or payment itself, or a later
   * journal that applied part of the advance. Reversing that voucher takes
   * this allocation back.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', required: true }) journalId: Types.ObjectId;
  @Prop({ type: String, required: true }) appliedOn: string;
}
const PaymentAllocationSchema = SchemaFactory.createForClass(PaymentAllocation);

/**
 * One receipt from a customer, or one payment to a vendor, however many
 * invoices or bills it settles. What is not applied to any is an advance,
 * held on the advances ledger until it is applied.
 */
@Schema({ collection: 'party_payments', timestamps: true })
export class PartyPayment {
  @Prop({ required: true, index: true }) orgId: string;
  /** receipt: money in from a customer. payment: money out to a vendor. */
  @Prop({ type: String, enum: ['receipt', 'payment'], required: true }) kind: 'receipt' | 'payment';
  /**
   * RCT/2026-27/0001 (receipts) or PMT/2026-27/0001 (payments): gapless per
   * org and financial year, taken in the posting's transaction. Null on the
   * credit a note leaves, and on payments recorded before numbering began.
   */
  @Prop({ type: String, default: null }) number: string | null;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true }) partyId: Types.ObjectId;
  @Prop({ type: String, required: true }) partyName: string;
  /** YYYY-MM-DD, the day the money moved. */
  @Prop({ type: String, required: true }) date: string;
  /** What the party paid, or was paid. Bank charges come out of it (receipt) or on top of it (payment). */
  @Prop({ type: Number, required: true, min: 0, validate: integerPaise }) amountPaise: number;
  /** TDS the customer deducted, across the invoices (receipts only). */
  @Prop({ type: Number, default: 0, min: 0, validate: integerPaise }) tdsPaise: number;
  /** gateway: paid online; it reaches the bank when the gateway settles. */
  @Prop({ type: String, enum: ['bank', 'cash', 'gateway'], default: 'bank' }) via: 'bank' | 'cash' | 'gateway';
  /** Cash, bank transfer, cheque, UPI, card or other; null when not said. */
  @Prop({ type: String, enum: [...PAYMENT_MODES, null], default: null }) mode: PaymentMode | null;
  /**
   * The bank or cash ledger the money went into (receipt) or left from
   * (payment): the one chosen, or the system Bank or Cash account from `via`.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', default: null }) depositAccountId: Types.ObjectId | null;
  @Prop({ type: String, default: null }) depositAccountName: string | null;
  /**
   * What the bank kept, booked to Bank Charges: taken out of a receipt (the
   * customer is credited with the whole amount), added to a payment.
   */
  @Prop({ type: Number, default: 0, min: 0, validate: integerPaise }) bankChargesPaise: number;
  /** Internal notes; not shown to the party. */
  @Prop({ type: String, default: null }) notes: string | null;
  /**
   * money: a receipt or payment. credit_note / debit_note: a note that took
   * back more than was still owed; the excess is the party's credit, held
   * like an advance.
   */
  @Prop({ type: String, enum: ['money', 'credit_note', 'debit_note'], default: 'money' }) source: 'money' | 'credit_note' | 'debit_note';
  /** Credit given back as money: to the customer, or from the vendor. */
  @Prop({ type: [Object], default: [] }) refunds: Array<{ journalId: Types.ObjectId; amountPaise: number; date: string; via: 'bank' | 'cash' }>;
  @Prop({ type: String, default: null }) reference: string | null;
  /** The receipt or payment voucher. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', required: true }) journalId: Types.ObjectId;
  @Prop({ type: [PaymentAllocationSchema], default: [] }) allocations: PaymentAllocation[];
  /** Still held as an advance. */
  @Prop({ type: Number, required: true, min: 0, validate: integerPaise }) unappliedPaise: number;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'BankStatementLine', default: null }) bankLineId: Types.ObjectId | null;
  @Prop({ type: String, enum: ['posted', 'reversed'], default: 'posted', index: true }) status: 'posted' | 'reversed';
  @Prop({ type: String, required: true }) createdBy: string;
}

export const PartyPaymentSchema = SchemaFactory.createForClass(PartyPayment);
PartyPaymentSchema.index({ orgId: 1, kind: 1, partyId: 1, status: 1 });
PartyPaymentSchema.index({ orgId: 1, 'allocations.journalId': 1 });
// A number is used once per org; older payments and note credits have none.
PartyPaymentSchema.index({ orgId: 1, number: 1 }, { unique: true, partialFilterExpression: { number: { $type: 'string' } } });
PartyPaymentSchema.plugin(tenantIsolationPlugin);
