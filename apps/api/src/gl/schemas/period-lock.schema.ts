import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PeriodLockDocument = HydratedDocument<PeriodLock>;

@Schema({ _id: false })
class LockChange {
  @Prop({ type: String, default: null }) lockedThrough: string | null;
  @Prop({ type: String, required: true }) changedBy: string;
  @Prop({ type: Date, required: true }) changedAt: Date;
  @Prop({ type: String, default: null }) reason: string | null;
}

/**
 * How far an org's books are closed. Nothing may be posted dated on or before
 * `lockedThrough` — PostingService refuses it, so a filed month or a closed
 * year cannot change underneath the return or the accounts that relied on it.
 *
 * Not tenant-scoped by the plugin: PostingService reads it by explicit orgId
 * inside the posting transaction, the same way it writes journals.
 */
@Schema({ collection: 'period_locks', timestamps: true })
export class PeriodLock {
  @Prop({ required: true, unique: true }) orgId: string;

  /** YYYY-MM-DD, or null when nothing is locked. */
  @Prop({ type: String, default: null }) lockedThrough: string | null;

  /** Every change, newest last — locking and unlocking are both decisions worth keeping. */
  @Prop({ type: [SchemaFactory.createForClass(LockChange)], default: [] }) history: LockChange[];
}

export const PeriodLockSchema = SchemaFactory.createForClass(PeriodLock);
