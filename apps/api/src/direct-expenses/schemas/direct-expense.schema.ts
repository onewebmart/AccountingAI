import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

/** Money is integer paise (Invariant 1): checked on every save. */
const paise = { type: Number, required: true, min: 0, validate: { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' } };

export type DirectExpenseDocument = HydratedDocument<DirectExpense>;
export type DirectExpenseStatus = 'draft' | 'posted';

/**
 * Money paid straight from the bank or cash for a cost, with no bill to
 * pay later: a courier, a fuel slip, a software subscription on the card.
 * A draft until a person posts it; posting is one payment voucher, and a
 * posted expense is never changed (Invariant 3).
 */
@Schema({ collection: 'expenses', timestamps: true })
export class DirectExpense {
  @Prop({ required: true, index: true }) orgId: string;
  /** EXP/2026-27/0001: from the EXPENSE series, gapless per financial year. */
  @Prop({ type: String, required: true }) number: string;
  @Prop({ type: String, required: true }) date: string;
  /** Who was paid, when they are a vendor in the books; optional. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Vendor', default: null }) vendorId: Types.ObjectId | null;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', required: true }) expenseAccountId: Types.ObjectId;
  /** The bank or cash account the money left from. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', required: true }) paidThroughAccountId: Types.ObjectId;
  /** The amount before tax. */
  @Prop(paise) taxablePaise: number;
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

/** The parts add up: total = taxable + taxes. */
DirectExpenseSchema.pre('validate', function (this: DirectExpense) {
  if (this.taxablePaise + this.cgstPaise + this.sgstPaise + this.igstPaise !== this.totalPaise) {
    throw new Error('An expense total must be its amount before tax plus its GST.');
  }
});

DirectExpenseSchema.plugin(tenantIsolationPlugin);
