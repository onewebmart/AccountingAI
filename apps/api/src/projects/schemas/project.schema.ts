import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type ProjectDocument = HydratedDocument<Project>;

const optionalPaise = {
  type: Number,
  default: null,
  validate: { validator: (v: number | null) => v === null || (Number.isInteger(v) && v >= 0), message: 'An amount is a whole number of paise, not negative.' },
};

/**
 * Work for a customer, or the business's own. Invoice, bill and journal
 * lines can carry its id, so its income and costs add up to a project P&L;
 * time logged against it becomes an invoice draft.
 */
@Schema({ collection: 'projects', timestamps: true })
export class Project {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, required: true, trim: true }) name: string;
  /** The name for matching; unique per org. */
  @Prop({ type: String, required: true }) nameKey: string;
  @Prop({ type: String, default: null, trim: true }) code: string | null;
  /** Null for internal work. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Customer', default: null, index: true }) customerId: Types.ObjectId | null;
  /** time: billed by the hour from timesheets. fixed: an agreed fee, invoiced by hand. */
  @Prop({ type: String, enum: ['time', 'fixed'], required: true }) billing: 'time' | 'fixed';
  /** The fee for fixed work, the cap for time-billed work. */
  @Prop(optionalPaise) budgetPaise: number | null;
  @Prop({ type: Number, default: null, min: 0 }) budgetHours: number | null;
  /** Per hour, for time not given a rate of its own. */
  @Prop(optionalPaise) ratePaise: number | null;
  /** The service item its time is invoiced as: SAC, GST rate and income account come from it. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Item', default: null }) serviceItemId: Types.ObjectId | null;
  @Prop({ type: String, enum: ['active', 'on_hold', 'completed'], default: 'active', index: true }) status: 'active' | 'on_hold' | 'completed';
  @Prop({ type: String, default: null }) startDate: string | null;
  @Prop({ type: String, default: null }) endDate: string | null;
  @Prop({ type: String, default: null }) notes: string | null;
  @Prop({ type: String, required: true }) createdBy: string;
  /** Held while an invoice is drafted from its time, so two drafts cannot take the same hours. */
  @Prop({ type: String, default: null }) billingLock: string | null;
  @Prop({ type: Date, default: null }) billingLockAt: Date | null;
}

export const ProjectSchema = SchemaFactory.createForClass(Project);
ProjectSchema.index({ orgId: 1, nameKey: 1 }, { unique: true });
ProjectSchema.plugin(tenantIsolationPlugin);
