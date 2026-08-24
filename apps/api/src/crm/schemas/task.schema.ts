import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { TaskPriority, TaskStatus } from '@ai-accounting/shared';
import { firmIsolationPlugin } from '../../database/tenant.plugin';

export type TaskDocument = HydratedDocument<Task>;

/**
 * A piece of work someone at the firm owes.
 *
 * Deliberately thin. Tasks a CA firm actually tracks are mostly "chase X for
 * Y" — the structured obligations already live as compliance items and document
 * requests, and duplicating them here would give two places to mark the same
 * thing done.
 */
@Schema({ timestamps: true, collection: 'crm_tasks' })
export class Task {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Firm', required: true, index: true })
  firmId: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop() description?: string;

  /** Optional link to the client the work is for. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', index: true })
  clientOrgId?: Types.ObjectId;

  /** Denormalised so the board needs no join per card. */
  @Prop() clientName?: string;

  /** User id of the team member responsible. */
  @Prop({ index: true }) assignedTo?: string;

  /** Display name, kept so a reassigned or removed user still renders. */
  @Prop() assigneeName?: string;

  @Prop({
    type: String,
    enum: Object.values(TaskStatus),
    required: true,
    default: TaskStatus.TODO,
    index: true,
  })
  status: TaskStatus;

  @Prop({
    type: String,
    enum: Object.values(TaskPriority),
    required: true,
    default: TaskPriority.NORMAL,
  })
  priority: TaskPriority;

  /** YYYY-MM-DD. */
  @Prop({ index: true }) dueDate?: string;

  @Prop() completedAt?: Date;
  @Prop() completedBy?: string;

  @Prop({ required: true }) createdBy: string;
}

export const TaskSchema = SchemaFactory.createForClass(Task);

TaskSchema.plugin(firmIsolationPlugin);

// The board reads "this firm's open tasks, soonest due first".
TaskSchema.index({ firmId: 1, status: 1, dueDate: 1 });
