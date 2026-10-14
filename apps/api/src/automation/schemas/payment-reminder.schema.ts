import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type PaymentReminderDocument = HydratedDocument<PaymentReminder>;

/** Where on the ladder a reminder sits, or `manual` when someone pressed the button. */
export type ReminderRung = 'before_due' | 'on_due' | 'late_7' | 'late_15' | 'late_30' | 'manual';

/** Days from the due date each rung goes out on. */
export const REMINDER_LADDER: Array<{ rung: Exclude<ReminderRung, 'manual'>; daysFromDue: number }> = [
  { rung: 'before_due', daysFromDue: -3 },
  { rung: 'on_due', daysFromDue: 0 },
  { rung: 'late_7', daysFromDue: 7 },
  { rung: 'late_15', daysFromDue: 15 },
  { rung: 'late_30', daysFromDue: 30 },
];

/**
 * One payment reminder to a customer about one invoice — the record of what
 * was said, to whom, and whether it went.
 */
@Schema({ collection: 'payment_reminders', timestamps: true })
export class PaymentReminder {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true }) invoiceId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) customerId: Types.ObjectId;

  @Prop({ type: String, required: true }) rung: ReminderRung;
  /** Sent by the daily ladder (true) or by a person (false). */
  @Prop({ type: Boolean, required: true }) automatic: boolean;

  @Prop({ type: String, enum: ['email', 'whatsapp'], required: true }) channel: 'email' | 'whatsapp';
  @Prop({ type: String, required: true }) to: string;
  @Prop({ type: String, default: null }) subject: string | null;
  @Prop({ type: String, required: true }) body: string;
  /** Outstanding on the invoice when the reminder was written. */
  @Prop({ type: Number, required: true }) outstandingPaise: number;

  @Prop({ type: String, enum: ['queued', 'sent', 'failed'], default: 'queued', index: true })
  status: 'queued' | 'sent' | 'failed';
  @Prop({ type: String, default: null }) providerMessageId: string | null;
  /** True while the messaging adapter is the mock: nothing actually left. */
  @Prop({ type: Boolean, default: false }) isMock: boolean;
  @Prop({ type: String, default: null }) error: string | null;
  @Prop({ type: Date, default: null }) sentAt: Date | null;
  @Prop({ type: String, required: true }) createdBy: string;
}

export const PaymentReminderSchema = SchemaFactory.createForClass(PaymentReminder);
// Each rung of the ladder goes out once per invoice, even if two sweeps race.
PaymentReminderSchema.index(
  { orgId: 1, invoiceId: 1, rung: 1 },
  { unique: true, partialFilterExpression: { automatic: true } },
);
PaymentReminderSchema.plugin(tenantIsolationPlugin);
