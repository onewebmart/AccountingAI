import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type PartyPaymentDocument = HydratedDocument<PartyPayment>;

const integerPaise = { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' };

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
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true }) partyId: Types.ObjectId;
  @Prop({ type: String, required: true }) partyName: string;
  /** YYYY-MM-DD, the day the money moved. */
  @Prop({ type: String, required: true }) date: string;
  /** What moved through the bank or cash. */
  @Prop({ type: Number, required: true, min: 0, validate: integerPaise }) amountPaise: number;
  /** TDS the customer deducted, across the invoices (receipts only). */
  @Prop({ type: Number, default: 0, min: 0, validate: integerPaise }) tdsPaise: number;
  /** gateway: paid online; it reaches the bank when the gateway settles. */
  @Prop({ type: String, enum: ['bank', 'cash', 'gateway'], default: 'bank' }) via: 'bank' | 'cash' | 'gateway';
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
PartyPaymentSchema.plugin(tenantIsolationPlugin);
