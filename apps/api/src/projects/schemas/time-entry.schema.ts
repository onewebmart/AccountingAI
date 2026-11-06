import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type TimeEntryDocument = HydratedDocument<TimeEntry>;

const clock = {
  type: String,
  default: null,
  validate: { validator: (v: string | null) => v === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), message: 'A time of day looks like 09:30.' },
};

/**
 * Hours a person spent on a project. Billable time not yet invoiced is
 * unbilled; drafting an invoice from it marks it billed on that invoice.
 */
@Schema({ collection: 'time_entries', timestamps: true })
export class TimeEntry {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project', required: true, index: true }) projectId: Types.ObjectId;
  /** Whose time it is. */
  @Prop({ type: String, required: true, index: true }) userId: string;
  @Prop({ type: String, required: true }) userName: string;
  /** Who logged it: the person themself, or a manager logging it for them. Null on entries from before this was kept. */
  @Prop({ type: String, default: null }) loggedBy: string | null;
  /** YYYY-MM-DD */
  @Prop({ type: String, required: true }) date: string;
  @Prop({
    type: Number,
    required: true,
    validate: { validator: (v: number) => v > 0 && v <= 24 && Math.abs(Math.round(v * 100) - v * 100) < 1e-6, message: 'Hours are more than nothing, a day at most, to two decimals.' },
  })
  hours: number;
  /** When given instead of the hours (or by the timer): HH:MM, the same day. */
  @Prop(clock) startTime: string | null;
  @Prop(clock) endTime: string | null;
  /** The project's task it was spent on, when it is one of them. */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null }) taskId: Types.ObjectId | null;
  /** What kind of work: Design, Audit fieldwork, Meetings. The task's name when it is one; lines on the invoice group by it. */
  @Prop({ type: String, required: true, trim: true }) task: string;
  @Prop({ type: String, default: null, trim: true }) notes: string | null;
  @Prop({ type: Boolean, default: true }) billable: boolean;
  /** Per hour, from the project's method unless given. */
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
  /** The timer this time came from: one entry per timer, however many times it is stopped. */
  @Prop({ type: String, default: null }) timerId: string | null;
}

export const TimeEntrySchema = SchemaFactory.createForClass(TimeEntry);
TimeEntrySchema.index({ orgId: 1, projectId: 1, status: 1, date: 1 });
TimeEntrySchema.index({ orgId: 1, userId: 1, date: 1 });
TimeEntrySchema.index({ orgId: 1, timerId: 1 }, { unique: true, partialFilterExpression: { timerId: { $type: 'string' } } });
TimeEntrySchema.plugin(tenantIsolationPlugin);
