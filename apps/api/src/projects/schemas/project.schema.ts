import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type ProjectDocument = HydratedDocument<Project>;

const optionalPaise = {
  type: Number,
  default: null,
  validate: { validator: (v: number | null) => v === null || (Number.isInteger(v) && v >= 0), message: 'An amount is a whole number of paise, not negative.' },
};

/** A piece of work on the project. Time is logged to it; billed by task hours, its rate prices that time. */
export interface ProjectTask {
  _id: Types.ObjectId;
  name: string;
  description: string | null;
  /** Time logged to this task starts as billable, or not. */
  billable: boolean;
  /** Per hour, used when the project is billed by task hours. */
  ratePaise: number | null;
}

/** A person on the project. Billed by staff hours, their rate prices their time. */
export interface ProjectMember {
  userId: string;
  ratePaise: number | null;
}

const ProjectTaskSchema = new MongooseSchema<ProjectTask>({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: null, trim: true },
  billable: { type: Boolean, default: true },
  ratePaise: optionalPaise,
});

const ProjectMemberSchema = new MongooseSchema<ProjectMember>(
  {
    userId: { type: String, required: true },
    ratePaise: optionalPaise,
  },
  { _id: false },
);

/**
 * Work for a customer, or the business's own. Invoice, bill and journal
 * lines can carry its id, so its income and costs add up to a project P&L;
 * time logged against it becomes an invoice draft.
 *
 * Budgets: costBudgetPaise is checked against costs booked to the project,
 * revenueBudgetPaise against its income. budgetPaise is the single budget
 * projects had before (the fee for fixed work, the cap for hourly work): it
 * is read as the revenue budget, and cleared once either new budget is saved.
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
  /**
   * fixed, project_hours (one rate), task_hours (a rate per task) or
   * staff_hours (a rate per person). 'time' is how projects billed by the
   * hour were saved before: read it as project_hours (billingMethod), and
   * anything newly written as 'time' is stored as project_hours.
   */
  @Prop({
    type: String,
    enum: ['fixed', 'project_hours', 'task_hours', 'staff_hours', 'time'],
    required: true,
    set: (v: string) => (v === 'time' ? 'project_hours' : v),
  })
  billing: 'fixed' | 'project_hours' | 'task_hours' | 'staff_hours' | 'time';
  /** The old single budget: see the class note. */
  @Prop(optionalPaise) budgetPaise: number | null;
  @Prop(optionalPaise) costBudgetPaise: number | null;
  @Prop(optionalPaise) revenueBudgetPaise: number | null;
  @Prop({ type: Number, default: null, min: 0 }) budgetHours: number | null;
  /** Per hour: the project's rate when billed by project hours, and for a fixed fee's billable time. */
  @Prop(optionalPaise) ratePaise: number | null;
  /** The service item its time is invoiced as: SAC, GST rate and income account come from it. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Item', default: null }) serviceItemId: Types.ObjectId | null;
  @Prop({ type: String, enum: ['active', 'on_hold', 'completed'], default: 'active', index: true }) status: 'active' | 'on_hold' | 'completed';
  @Prop({ type: String, default: null }) startDate: string | null;
  @Prop({ type: String, default: null }) endDate: string | null;
  /** What the work is, up to 2,000 characters. */
  @Prop({ type: String, default: null }) description: string | null;
  /** Before projects had a description: shown as one until a description is saved. */
  @Prop({ type: String, default: null }) notes: string | null;
  @Prop({ type: [ProjectMemberSchema], default: [] }) members: ProjectMember[];
  @Prop({ type: [ProjectTaskSchema], default: [] }) tasks: ProjectTask[];
  /** Shown first in the dashboard's Projects card. */
  @Prop({ type: Boolean, default: false }) watchlist: boolean;
  @Prop({ type: String, required: true }) createdBy: string;
  /** Held while an invoice is drafted from its time, so two drafts cannot take the same hours. */
  @Prop({ type: String, default: null }) billingLock: string | null;
  @Prop({ type: Date, default: null }) billingLockAt: Date | null;
}

export const ProjectSchema = SchemaFactory.createForClass(Project);
ProjectSchema.index({ orgId: 1, nameKey: 1 }, { unique: true });
ProjectSchema.plugin(tenantIsolationPlugin);
