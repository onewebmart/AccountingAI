import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type RecurringTemplateDocument = HydratedDocument<RecurringTemplate>;

export type RecurringKind = 'bill' | 'invoice' | 'journal' | 'expense';
export type RecurringStatus = 'active' | 'paused' | 'ended';

const paise = { type: Number, required: true, validate: { validator: Number.isInteger, message: 'must be whole paise' } };

@Schema({ _id: false })
class TemplateAmounts {
  @Prop(paise) taxableValue: number;
  @Prop(paise) cgst: number;
  @Prop(paise) sgst: number;
  @Prop(paise) igst: number;
  @Prop(paise) cess: number;
  @Prop(paise) total: number;
}

@Schema({ _id: false })
class TemplateLine {
  @Prop({ type: String, required: true }) description: string;
  @Prop({ type: String, default: null }) hsnSac: string | null;
  @Prop({ type: Number, default: 1 }) qty: number;
  @Prop(paise) ratePaise: number;
  @Prop(paise) amountPaise: number;
  @Prop({ type: Number, default: 0 }) taxRatePct: number;
}

/** Expenses only: what each drafted expense is booked to and paid from. */
@Schema({ _id: false })
export class TemplateExpense {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', required: true }) expenseAccountId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', required: true }) paidThroughAccountId: Types.ObjectId;
  @Prop(paise) taxablePaise: number;
  @Prop({ type: Number, default: 0 }) gstRatePct: number;
  @Prop({ type: Boolean, default: false }) interState: boolean;
  @Prop({ type: Boolean, default: false }) claimable: boolean;
  @Prop({ type: String, default: null }) vendorGstin: string | null;
  @Prop({ type: String, default: null }) reference: string | null;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project', default: null }) projectId: Types.ObjectId | null;
}

@Schema({ _id: false })
class Generated {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) documentId: Types.ObjectId;
  /** The date the document carries. */
  @Prop({ type: String, required: true }) documentDate: string;
  @Prop({ type: Date, required: true }) createdAt: Date;
}

/**
 * A bill or invoice that repeats: rent, a retainer, a subscription. Or an
 * expense paid straight from the bank each month, drafted for a person to post.
 *
 * On each due date the daily job drafts the document from this template. It
 * drafts and never posts: a person still looks at each one and posts it, so
 * nothing reaches the ledger that nobody saw.
 */
@Schema({ collection: 'recurring_templates', timestamps: true })
export class RecurringTemplate {
  @Prop({ required: true, index: true }) orgId: string;

  @Prop({ type: String, enum: ['bill', 'invoice', 'journal', 'expense'], required: true }) kind: RecurringKind;
  /** What people call it: "Office rent". */
  @Prop({ type: String, required: true }) name: string;
  /** The vendor for a bill, the customer for an invoice; none for a journal. */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null }) partyId: Types.ObjectId | null;

  @Prop({ type: String, enum: ['monthly', 'quarterly', 'yearly'], required: true })
  frequency: 'monthly' | 'quarterly' | 'yearly';
  /** Day of the month each document is dated; 31 means the month's last day. */
  @Prop({ type: Number, required: true, min: 1, max: 31 }) dayOfMonth: number;
  @Prop({ type: String, required: true }) startDate: string;
  @Prop({ type: String, default: null }) endDate: string | null;
  /** When the next document is due to be drafted; null once ended. */
  @Prop({ type: String, default: null, index: true }) nextRunDate: string | null;
  /** Days from the document date to its due date. */
  @Prop({ type: Number, default: 15, min: 0, max: 365 }) dueInDays: number;

  @Prop({ type: TemplateAmounts, default: null }) amountsPaise: TemplateAmounts | null;
  /** Journals only: the lines each one carries. Drafted into the review queue, never posted by the template. */
  @Prop({ type: [{ accountId: { type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount' }, debitPaise: paise, creditPaise: paise }], default: [] })
  journalLines: Array<{ accountId: Types.ObjectId; debitPaise: number; creditPaise: number }>;
  @Prop({ type: [TemplateLine], default: [] }) lineItems: TemplateLine[];
  /** Expenses only: the accounts, amount and GST each drafted expense carries. */
  @Prop({ type: TemplateExpense, default: null }) expense: TemplateExpense | null;
  /** Bills only: GST on this purchase is ours to pay. */
  @Prop({ type: Boolean, default: false }) isReverseCharge: boolean;
  @Prop({ type: String, default: null }) notes: string | null;

  @Prop({ type: String, enum: ['active', 'paused', 'ended'], default: 'active', index: true })
  status: RecurringStatus;
  @Prop({ type: [Generated], default: [] }) generated: Generated[];
  /** Why the last run could not draft the document, until one succeeds. */
  @Prop({ type: String, default: null }) lastError: string | null;
  @Prop({ type: String, required: true }) createdBy: string;
}

export const RecurringTemplateSchema = SchemaFactory.createForClass(RecurringTemplate);
RecurringTemplateSchema.index({ status: 1, nextRunDate: 1 });
RecurringTemplateSchema.plugin(tenantIsolationPlugin);
