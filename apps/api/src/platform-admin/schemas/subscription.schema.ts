import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SubscriptionDocument = HydratedDocument<Subscription>;

export type SubscriptionPlan = 'free' | 'starter' | 'business' | 'enterprise';
export type SubscriptionStatus = 'active' | 'cancelled' | 'past_due';

@Schema({ collection: 'subscriptions', timestamps: true })
export class Subscription {
  /** One subscription per org — unique. */
  @Prop({ required: true, unique: true, index: true })
  orgId: string;

  @Prop({
    type: String,
    enum: ['free', 'starter', 'business', 'enterprise'],
    default: 'free',
  })
  plan: SubscriptionPlan;

  @Prop({
    type: String,
    enum: ['active', 'cancelled', 'past_due'],
    default: 'active',
  })
  status: SubscriptionStatus;

  @Prop({ type: Date, default: null })
  currentPeriodEnd: Date | null;

  /** OCR page quota per billing cycle (0 = unlimited). */
  @Prop({ type: Number, default: 100 })
  ocrPageQuota: number;

  /** Groq token quota per billing cycle (0 = unlimited). */
  @Prop({ type: Number, default: 100_000 })
  groqTokenQuota: number;

  /** Platform actor who last changed this subscription. */
  @Prop({ type: String, default: null })
  changedBy: string | null;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
