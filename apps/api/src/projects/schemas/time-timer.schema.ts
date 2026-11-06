import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type TimeTimerDocument = HydratedDocument<TimeTimer>;

/**
 * A person's running timer: kept on the server, so it survives a reload and
 * shows wherever they look. One per person per org. Stopping it logs the
 * time and removes it.
 */
@Schema({ collection: 'time_timers', timestamps: true })
export class TimeTimer {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, required: true }) userId: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project', required: true }) projectId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null }) taskId: Types.ObjectId | null;
  @Prop({ type: String, required: true, trim: true }) task: string;
  @Prop({ type: Boolean, default: true }) billable: boolean;
  @Prop({ type: String, default: null, trim: true }) notes: string | null;
  @Prop({ type: Date, required: true }) startedAt: Date;
}

export const TimeTimerSchema = SchemaFactory.createForClass(TimeTimer);
TimeTimerSchema.index({ orgId: 1, userId: 1 }, { unique: true });
TimeTimerSchema.plugin(tenantIsolationPlugin);
