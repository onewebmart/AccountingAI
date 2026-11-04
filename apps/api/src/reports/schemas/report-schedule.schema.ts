import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type ReportScheduleDocument = HydratedDocument<ReportSchedule>;

/**
 * A report emailed as a PDF on a rhythm: last month's P&L on the 2nd, the
 * receivables every Monday. The period is said relative to the day it runs,
 * so each email covers its own month.
 */
@Schema({ collection: 'report_schedules', timestamps: true })
export class ReportSchedule {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, required: true }) report: string;
  @Prop({ type: String, enum: ['last_month', 'this_month', 'last_quarter', 'this_fy', 'last_fy'], default: 'last_month' }) period: string;
  @Prop({ type: String, enum: ['monthly', 'weekly'], required: true }) frequency: 'monthly' | 'weekly';
  /** Monthly: the day of the month (1–28). Weekly: 1 Monday to 7 Sunday. */
  @Prop({ type: Number, required: true, min: 1, max: 28 }) day: number;
  @Prop({ type: [String], required: true }) recipients: string[];
  /** The next day it goes out, YYYY-MM-DD. */
  @Prop({ type: String, required: true, index: true }) nextRunOn: string;
  @Prop({ type: String, default: null }) lastSentOn: string | null;
  @Prop({ type: String, default: null }) lastError: string | null;
  @Prop({ type: Boolean, default: true, index: true }) active: boolean;
  @Prop({ type: String, required: true }) createdBy: string;
}

export const ReportScheduleSchema = SchemaFactory.createForClass(ReportSchedule);
ReportScheduleSchema.plugin(tenantIsolationPlugin);
