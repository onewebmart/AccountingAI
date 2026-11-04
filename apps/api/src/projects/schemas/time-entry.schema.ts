import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type TimeEntryDocument = HydratedDocument<TimeEntry>;

/**
 * Hours a person spent on a project. Billable time not yet invoiced is
 * unbilled; drafting an invoice from it marks it billed on that invoice.
 */
@Schema({ collection: 'time_entries', timestamps: true })
export class TimeEntry {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project', required: true, index: true }) projectId: Types.ObjectId;
  @Prop({ type: String, required: true, index: true }) userId: string;
  @Prop({ type: String, required: true }) userName: string;
  /** YYYY-MM-DD */
  @Prop({ type: String, required: true }) date: string;
  @Prop({
    type: Number,
    required: true,
    validate: { validator: (v: number) => v > 0 && v <= 24 && Math.abs(Math.round(v * 100) - v * 100) < 1e-6, message: 'Hours are more than nothing, a day at most, to two decimals.' },
  })
  hours: number;
  /** What kind of work: Design, Audit fieldwork, Meetings. Lines on the invoice group by it. */
  @Prop({ type: String, required: true, trim: true }) task: string;
  @Prop({ type: String, default: null, trim: true }) notes: string | null;
  @Prop({ type: Boolean, default: true }) billable: boolean;
  /** Per hour, from the project unless given. */
  @Prop({
    type: Number,
    default: null,
    validate: { validator: (v: number | null) => v === null || (Number.isInteger(v) && v >= 0), message: 'A rate is a whole number of paise, not negative.' },
  })
  ratePaise: number | null;
  /** billing: held while an invoice is being drafted from it. */
  @Prop({ type: String, enum: ['unbilled', 'billing', 'billed'], default: 'unbilled', index: true }) status: 'unbilled' | 'billing' | 'billed';
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'SalesInvoice', default: null }) invoiceId: Types.ObjectId | null;
  @Prop({ type: String, default: null }) claim: string | null;
}

export const TimeEntrySchema = SchemaFactory.createForClass(TimeEntry);
TimeEntrySchema.index({ orgId: 1, projectId: 1, status: 1, date: 1 });
TimeEntrySchema.index({ orgId: 1, userId: 1, date: 1 });
TimeEntrySchema.plugin(tenantIsolationPlugin);
