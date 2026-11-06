import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PeriodLockDocument = HydratedDocument<PeriodLock>;

@Schema({ _id: false })
class LockChange {
  @Prop({ type: String, default: null }) lockedThrough: string | null;
  @Prop({ type: String, required: true }) changedBy: string;
  @Prop({ type: Date, required: true }) changedAt: Date;
  @Prop({ type: String, default: null }) reason: string | null;
  /** sales, purchases, banking or accountant; null for the lock on the whole books. */
  @Prop({ type: String, default: null }) module?: string | null;
}

/** One module's lock: the date it is locked through, who set it and why. */
@Schema({ _id: false })
export class ModuleLock {
  @Prop({ type: String, default: null }) lockedThrough: string | null;
  @Prop({ type: String, default: null }) reason: string | null;
  @Prop({ type: String, default: null }) changedBy: string | null;
  @Prop({ type: Date, default: null }) changedAt: Date | null;
}
const ModuleLockSchema = SchemaFactory.createForClass(ModuleLock);

@Schema({ _id: false })
class ModuleLocks {
  @Prop({ type: ModuleLockSchema, default: null }) sales: ModuleLock | null;
  @Prop({ type: ModuleLockSchema, default: null }) purchases: ModuleLock | null;
  @Prop({ type: ModuleLockSchema, default: null }) banking: ModuleLock | null;
  @Prop({ type: ModuleLockSchema, default: null }) accountant: ModuleLock | null;
}

/**
 * How far an org's books are closed. Nothing may be posted dated on or before
 * `lockedThrough` — PostingService refuses it, so a filed month or a closed
 * year cannot change underneath the return or the accounts that relied on it.
 *
 * `modules` locks Sales, Purchases, Banking and Accountant separately (see
 * gl/module-locks.ts); an entry is refused when either lock covers it.
 *
 * Not tenant-scoped by the plugin: PostingService reads it by explicit orgId
 * inside the posting transaction, the same way it writes journals.
 */
@Schema({ collection: 'period_locks', timestamps: true })
export class PeriodLock {
  @Prop({ required: true, unique: true }) orgId: string;

  /** YYYY-MM-DD, or null when nothing is locked. */
  @Prop({ type: String, default: null }) lockedThrough: string | null;

  @Prop({ type: SchemaFactory.createForClass(ModuleLocks), default: () => ({}) }) modules?: ModuleLocks;

  /** Every change, newest last — locking and unlocking are both decisions worth keeping. */
  @Prop({ type: [SchemaFactory.createForClass(LockChange)], default: [] }) history: LockChange[];
}

export const PeriodLockSchema = SchemaFactory.createForClass(PeriodLock);
