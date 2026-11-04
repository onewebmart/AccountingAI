import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type BudgetDocument = HydratedDocument<Budget>;

/**
 * What an income or expense account is planned to do each month of a
 * financial year, April first. Both read as a person says them: income and
 * expense alike as positive amounts. Advice only; it never touches the books.
 */
@Schema({ collection: 'budgets', timestamps: true })
export class Budget {
  @Prop({ required: true, index: true }) orgId: string;
  /** e.g. 2026-27 */
  @Prop({ type: String, required: true }) financialYear: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', required: true }) accountId: Types.ObjectId;
  @Prop({
    type: [Number],
    required: true,
    validate: {
      validator: (v: number[]) => Array.isArray(v) && v.length === 12 && v.every((n) => Number.isInteger(n) && n >= 0),
      message: 'A budget is twelve whole-paise amounts, April to March, none negative.',
    },
  })
  monthsPaise: number[];
  @Prop({ type: String, required: true }) updatedBy: string;
}

export const BudgetSchema = SchemaFactory.createForClass(Budget);
BudgetSchema.index({ orgId: 1, financialYear: 1, accountId: 1 }, { unique: true });
BudgetSchema.plugin(tenantIsolationPlugin);
