import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

const paise = { type: Number, required: true, min: 0, validate: { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' } };

@Schema({ _id: false })
class ClaimLineDoc {
  @Prop({ type: String, required: true }) date: string;
  @Prop({ type: String, enum: ['expense', 'mileage'], default: 'expense' }) kind: 'expense' | 'mileage';
  @Prop({ type: String, default: null }) merchant: string | null;
  @Prop({ type: String, required: true }) description: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', required: true }) expenseAccountId: Types.ObjectId;
  @Prop(paise) amountPaise: number;
  @Prop({ ...paise, default: 0 }) gstPaise: number;
  @Prop({ type: String, default: null }) merchantGstin: string | null;
  @Prop({ type: String, default: null }) hsnSac: string | null;
  @Prop({ type: Number, default: null }) km: number | null;
  /** The receipt, kept as an attachment on the claim. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Attachment', default: null }) receiptId: Types.ObjectId | null;
}
const ClaimLineSchema = SchemaFactory.createForClass(ClaimLineDoc);

export type ExpenseClaimDocument = HydratedDocument<ExpenseClaim>;
export type ClaimStatus = 'draft' | 'submitted' | 'approved' | 'posted' | 'paid';

/**
 * An employee's claim for what they paid for the business. Submitted, it
 * waits for someone else's approval; an accountant posts it; the
 * reimbursement clears it.
 */
@Schema({ collection: 'expense_claims', timestamps: true })
export class ExpenseClaim {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, required: true }) number: string;
  @Prop({ type: String, required: true, index: true }) employeeId: string;
  @Prop({ type: String, required: true }) employeeName: string;
  @Prop({ type: String, required: true, trim: true }) title: string;
  @Prop({ type: String, enum: ['draft', 'submitted', 'approved', 'posted', 'paid'], default: 'draft', index: true }) status: ClaimStatus;
  @Prop({ type: [ClaimLineSchema], default: [] }) lines: ClaimLineDoc[];
  @Prop(paise) totalPaise: number;
  /** What the policy found at submission. */
  @Prop({ type: [Object], default: [] }) flags: Array<{ line: number; code: string; message: string }>;
  @Prop({ type: String, default: null }) approvalRequestId: string | null;
  @Prop({ type: String, default: null }) sentBackReason: string | null;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', default: null }) journalId: Types.ObjectId | null;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', default: null }) paymentJournalId: Types.ObjectId | null;
  @Prop({ type: String, default: null }) paidOn: string | null;
}
export const ExpenseClaimSchema = SchemaFactory.createForClass(ExpenseClaim);
ExpenseClaimSchema.index({ orgId: 1, number: 1 }, { unique: true });
ExpenseClaimSchema.plugin(tenantIsolationPlugin);

export type ExpenseRulesDocument = HydratedDocument<ExpenseRulesDoc>;

/** The org's expense policy: one each. */
@Schema({ collection: 'expense_rules', timestamps: true })
export class ExpenseRulesDoc {
  @Prop({ required: true, unique: true }) orgId: string;
  @Prop({ ...paise, default: 500_00 }) receiptRequiredAbovePaise: number;
  @Prop({ type: Number, default: null }) lineLimitPaise: number | null;
  /** Per kilometre. */
  @Prop({ ...paise, default: 10_00 }) mileageRatePaise: number;
}
export const ExpenseRulesSchema = SchemaFactory.createForClass(ExpenseRulesDoc);
ExpenseRulesSchema.plugin(tenantIsolationPlugin);
