import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';
import type { ExpenseKind, MileageUnit } from '../expense-lines';

/** Money is integer paise (Invariant 1): checked on every save. */
const paise = { type: Number, required: true, min: 0, validate: { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' } };

export type DirectExpenseDocument = HydratedDocument<DirectExpense>;
export type DirectExpenseStatus = 'draft' | 'posted';

/**
 * One account an expense is booked to, with its share before tax and its own
 * GST. A single-account expense has one; an itemized one splits across several.
 */
@Schema({ _id: false })
export class ExpenseLine {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', required: true }) expenseAccountId: Types.ObjectId;
  @Prop({ type: String, default: null }) description: string | null;
  /** Before tax. */
  @Prop(paise) amountPaise: number;
  @Prop({ type: Number, enum: [0, 3, 5, 12, 18, 28, 40], default: 0 }) gstRatePct: number;
  @Prop(paise) cgstPaise: number;
  @Prop(paise) sgstPaise: number;
  @Prop(paise) igstPaise: number;
}
const ExpenseLineSchema = SchemaFactory.createForClass(ExpenseLine);

/** A mileage expense: how far, in what, at what rate. The amount is round(distance × rate). */
@Schema({ _id: false })
export class ExpenseMileage {
  /** Up to two decimals. */
  @Prop({ type: Number, required: true, min: 0.01 }) distance: number;
  @Prop({ type: String, enum: ['km', 'mile'], required: true }) unit: MileageUnit;
  /** Per unit. */
  @Prop({ ...paise, min: 1 }) ratePaise: number;
  /** The rate in the mileage preferences on the expense's date, or one typed on the expense. */
  @Prop({ type: String, enum: ['preferences', 'typed'], required: true }) rateSource: 'preferences' | 'typed';
  /** Who drove, when it was not a vendor: free text, optional. */
  @Prop({ type: String, default: null }) employeeName: string | null;
}
const ExpenseMileageSchema = SchemaFactory.createForClass(ExpenseMileage);

/**
 * Money paid straight from the bank or cash for a cost, with no bill to
 * pay later: a courier, a fuel slip, a software subscription on the card.
 * A draft until a person posts it; posting is one payment voucher, and a
 * posted expense is never changed (Invariant 3).
 *
 * The totals at the top are the sums of the lines: GSTR-3B reads its input
 * credit from them, so they are kept whole for an itemized expense too.
 */
@Schema({ collection: 'expenses', timestamps: true })
export class DirectExpense {
  @Prop({ required: true, index: true }) orgId: string;
  /** EXP/2026-27/0001: from the EXPENSE series, gapless per financial year. */
  @Prop({ type: String, required: true }) number: string;
  /** An ordinary expense, or a mileage expense (distance × rate, no GST). */
  @Prop({ type: String, enum: ['expense', 'mileage'], default: 'expense' }) kind: ExpenseKind;
  @Prop({ type: String, required: true }) date: string;
  /** Who was paid, when they are a vendor in the books; optional. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Vendor', default: null }) vendorId: Types.ObjectId | null;
  /** The first line's account: what a list shows. Each line carries its own. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', required: true }) expenseAccountId: Types.ObjectId;
  /** Where the cost is booked: one line, or several when itemized. Older expenses have none and use the fields here. */
  @Prop({ type: [ExpenseLineSchema], default: [] }) lines: ExpenseLine[];
  @Prop({ type: ExpenseMileageSchema, default: null }) mileage: ExpenseMileage | null;
  /** The bank or cash account the money left from. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', required: true }) paidThroughAccountId: Types.ObjectId;
  /** The amount before tax: the lines' sum. */
  @Prop(paise) taxablePaise: number;
  /** The lines' rate when they share one, else the highest. Each line keeps its own. */
  @Prop({ type: Number, enum: [0, 3, 5, 12, 18, 28, 40], default: 0 }) gstRatePct: number;
  /** IGST rather than CGST and SGST. */
  @Prop({ type: Boolean, default: false }) interState: boolean;
  /** The GST goes to input credit; otherwise it is part of the cost. */
  @Prop({ type: Boolean, default: false }) claimable: boolean;
  /** The supplier's GSTIN, which a claim of input credit needs. */
  @Prop({ type: String, default: null }) vendorGstin: string | null;
  @Prop(paise) cgstPaise: number;
  @Prop(paise) sgstPaise: number;
  @Prop(paise) igstPaise: number;
  @Prop(paise) totalPaise: number;
  @Prop({ type: String, default: null }) reference: string | null;
  @Prop({ type: String, default: null }) notes: string | null;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project', default: null }) projectId: Types.ObjectId | null;
  /** The customer the cost was incurred for, optional. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Customer', default: null, index: true }) customerId: Types.ObjectId | null;
  /** To be billed on to that customer. */
  @Prop({ type: Boolean, default: false }) billable: boolean;
  /** Set once a billable expense is put on an invoice (not built yet: always null for now). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'SalesInvoice', default: null }) invoiceId: Types.ObjectId | null;
  @Prop({ type: String, enum: ['draft', 'posted'], default: 'draft', index: true }) status: DirectExpenseStatus;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', default: null }) journalId: Types.ObjectId | null;
  /** Set when a recurring expense drafted this one. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'RecurringTemplate', default: null }) recurringTemplateId: Types.ObjectId | null;
  @Prop({ type: String, required: true }) createdBy: string;
  @Prop({ type: String, default: null }) postedBy: string | null;
}

export const DirectExpenseSchema = SchemaFactory.createForClass(DirectExpense);
DirectExpenseSchema.index({ orgId: 1, date: -1 });
DirectExpenseSchema.index({ orgId: 1, number: 1 }, { unique: true });

/** The parts add up: total = taxable + taxes, and the lines add up to both. */
DirectExpenseSchema.pre('validate', function (this: DirectExpense) {
  if (this.taxablePaise + this.cgstPaise + this.sgstPaise + this.igstPaise !== this.totalPaise) {
    throw new Error('An expense total must be its amount before tax plus its GST.');
  }
  const lines = this.lines ?? [];
  if (lines.length) {
    const sum = (k: 'amountPaise' | 'cgstPaise' | 'sgstPaise' | 'igstPaise') => lines.reduce((s, l) => s + l[k], 0);
    if (sum('amountPaise') !== this.taxablePaise || sum('cgstPaise') !== this.cgstPaise || sum('sgstPaise') !== this.sgstPaise || sum('igstPaise') !== this.igstPaise) {
      throw new Error("An expense's lines must add up to its amount before tax and its GST.");
    }
  }
  if (this.billable && !this.customerId) throw new Error('A billable expense needs the customer it is billed to.');
});

DirectExpenseSchema.plugin(tenantIsolationPlugin);
