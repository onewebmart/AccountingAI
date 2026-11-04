import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type AdjustmentScheduleDocument = HydratedDocument<AdjustmentSchedule>;

/**
 * A repeating month-end adjustment. Each month it drafts one entry into the
 * review queue; nothing posts until a person approves it.
 *
 * - accrual: an expense of the month whose bill has not come (Dr expense,
 *   Cr Accrued Expenses), reversed on the 1st of the next month, when the
 *   bill arrives and is booked the usual way.
 * - prepaid: an expense paid ahead and held in Prepaid Expenses, brought
 *   into the month it belongs to (Dr expense, Cr Prepaid Expenses).
 */
@Schema({ collection: 'adjustment_schedules', timestamps: true })
export class AdjustmentSchedule {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, enum: ['accrual', 'prepaid'], required: true }) kind: 'accrual' | 'prepaid';
  @Prop({ type: String, required: true, trim: true }) name: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', required: true }) expenseAccountId: Types.ObjectId;
  /** Accrual: each month's amount. Prepaid: the whole amount, spread over the months. */
  @Prop({ type: Number, required: true, min: 1, validate: { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' } }) amountPaise: number;
  /** YYYY-MM */
  @Prop({ type: String, required: true }) startPeriod: string;
  @Prop({ type: Number, required: true, min: 1, max: 120 }) months: number;
  @Prop({ type: String, enum: ['active', 'stopped'], default: 'active', index: true }) status: 'active' | 'stopped';
  @Prop({ type: String, default: null }) note: string | null;
  @Prop({ type: String, required: true }) createdBy: string;
}

export const AdjustmentScheduleSchema = SchemaFactory.createForClass(AdjustmentSchedule);
AdjustmentScheduleSchema.plugin(tenantIsolationPlugin);
