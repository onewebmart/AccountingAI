import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type ReminderSettingsDocument = HydratedDocument<ReminderSettings>;

/**
 * Whether the daily ladder writes to this org's customers, and how. Off until
 * someone turns it on: messages to customers are not something to start
 * sending on an org's behalf by default.
 */
@Schema({ collection: 'reminder_settings', timestamps: true })
export class ReminderSettings {
  @Prop({ required: true, unique: true }) orgId: string;
  @Prop({ type: Boolean, default: false }) enabled: boolean;
  /** auto: email when the customer has one, else WhatsApp. */
  @Prop({ type: String, enum: ['auto', 'email', 'whatsapp'], default: 'auto' }) channel: 'auto' | 'email' | 'whatsapp';
  @Prop({ type: String, default: null }) updatedBy: string | null;
}

export const ReminderSettingsSchema = SchemaFactory.createForClass(ReminderSettings);
ReminderSettingsSchema.plugin(tenantIsolationPlugin);
