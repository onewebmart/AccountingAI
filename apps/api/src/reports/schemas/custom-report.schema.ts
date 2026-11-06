import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type CustomReportDocument = HydratedDocument<CustomReport>;

/** One condition on a column or field: "Customer contains Asha", "Total at least ₹10,000". */
export interface ReportCondition {
  field: string;
  op: 'contains' | 'equals' | 'not_equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_true' | 'is_false';
  /** Text as typed; money in integer paise; a date as YYYY-MM-DD. */
  value: string | number | null;
}

/**
 * A report someone saved: either a built-in report with its columns chosen,
 * its rows filtered, grouped and sorted, or a new report read from one
 * module's fields. Only the definition is kept; every run reads the books
 * afresh. Private to its creator unless shared with the organisation.
 */
@Schema({ collection: 'custom_reports', timestamps: true })
export class CustomReport {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, required: true, trim: true, maxlength: 120 }) name: string;
  @Prop({ type: String, default: null, maxlength: 500 }) description: string | null;
  @Prop({ type: String, enum: ['derived', 'module'], required: true }) kind: 'derived' | 'module';
  /** derived: the built-in report it starts from. */
  @Prop({ type: String, default: null }) baseKey: string | null;
  /** module: the module it reads, such as invoices. */
  @Prop({ type: String, default: null }) module: string | null;
  /** The period and the base report's own filters, as saved; a relative period moves with the date it runs. */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} }) params: Record<string, string>;
  @Prop({ type: String, enum: ['last_month', 'this_month', 'last_quarter', 'this_fy', 'last_fy', null], default: null }) period: string | null;
  /** Column or field keys, in the order shown. Empty: all of the base report's columns. */
  @Prop({ type: [String], default: [] }) columns: string[];
  @Prop({ type: [Object], default: [] }) conditions: ReportCondition[];
  @Prop({ type: String, default: null }) groupBy: string | null;
  @Prop({ type: Boolean, default: false }) groupTotalsOnly: boolean;
  @Prop({ type: String, default: null }) sortBy: string | null;
  @Prop({ type: String, enum: ['asc', 'desc'], default: 'asc' }) sortDir: 'asc' | 'desc';
  /** Shared with everyone in the organisation (Shared Reports), or only its creator's (My Reports). */
  @Prop({ type: Boolean, default: false, index: true }) shared: boolean;
  @Prop({ type: String, required: true, index: true }) createdBy: string;
  @Prop({ type: String, default: null }) createdByName: string | null;
}

export const CustomReportSchema = SchemaFactory.createForClass(CustomReport);
CustomReportSchema.plugin(tenantIsolationPlugin);
CustomReportSchema.index({ orgId: 1, createdBy: 1 });
// Money conditions are integer paise (Invariant 1).
CustomReportSchema.pre('validate', function (next) {
  const bad = (this.conditions ?? []).find((c) => typeof c.value === 'number' && !Number.isFinite(c.value));
  next(bad ? new Error(`The condition on ${bad.field} is not a number.`) : undefined);
});
