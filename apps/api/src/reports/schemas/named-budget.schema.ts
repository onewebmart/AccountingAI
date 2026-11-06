import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';
import { BUDGET_PERIODS, BudgetPeriod } from '../budget-periods';

export type NamedBudgetDocument = HydratedDocument<NamedBudget>;

/** One account's plan: twelve monthly amounts, April to March, in whole paise. */
@Schema({ _id: false })
export class NamedBudgetRow {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', required: true }) accountId: Types.ObjectId;
  @Prop({
    type: [Number],
    required: true,
    validate: {
      validator: (v: number[]) => Array.isArray(v) && v.length === 12 && v.every((n) => Number.isInteger(n)),
      message: 'A budget row is twelve whole-paise amounts, April to March.',
    },
  })
  monthsPaise: number[];
}
const NamedBudgetRowSchema = SchemaFactory.createForClass(NamedBudgetRow);

/**
 * A budget with a name, for one financial year: several can exist side by
 * side (a plan and a stretch plan, say). Amounts are typed per period but
 * always kept as twelve months, so budget against actual reads every budget
 * the same way. A plan only: it never touches the books.
 *
 * One budget a year is the default, which budget against actual uses when
 * none is chosen. The per-year budgets kept before named budgets existed
 * (the `budgets` collection) are copied once into a budget named
 * "Budget <year>" the first time budgets are read; see budget-migration.ts.
 */
@Schema({ collection: 'named_budgets', timestamps: true })
export class NamedBudget {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, required: true, trim: true }) name: string;
  /** e.g. 2026-27 */
  @Prop({ type: String, required: true }) financialYear: string;
  /** How amounts are typed: by month, quarter, half-year or for the year. */
  @Prop({ type: String, enum: BUDGET_PERIODS, required: true }) period: BudgetPeriod;
  /** Asset, liability and capital accounts may be budgeted too (their movement). */
  @Prop({ type: Boolean, default: false }) includeBalanceSheet: boolean;
  @Prop({ type: [NamedBudgetRowSchema], default: [] }) rows: NamedBudgetRow[];
  @Prop({ type: Boolean, default: false }) isDefault: boolean;
  /** archived: kept, out of the way. deleted: gone from every list; kept for the audit trail. */
  @Prop({ type: String, enum: ['active', 'archived', 'deleted'], default: 'active', index: true }) status: 'active' | 'archived' | 'deleted';
  /** Set on a budget copied from the old per-year budgets: 'budgets:2026-27'. */
  @Prop({ type: String, default: null }) migratedFrom: string | null;
  @Prop({ type: String, required: true }) createdBy: string;
  @Prop({ type: String, required: true }) updatedBy: string;
}

export const NamedBudgetSchema = SchemaFactory.createForClass(NamedBudget);
NamedBudgetSchema.index({ orgId: 1, financialYear: 1, status: 1 });
// One default a year.
NamedBudgetSchema.index({ orgId: 1, financialYear: 1 }, { unique: true, partialFilterExpression: { isDefault: true } });
// The old per-year budget is copied once, however many reads race for it.
NamedBudgetSchema.index({ orgId: 1, migratedFrom: 1 }, { unique: true, partialFilterExpression: { migratedFrom: { $type: 'string' } } });
NamedBudgetSchema.plugin(tenantIsolationPlugin);
