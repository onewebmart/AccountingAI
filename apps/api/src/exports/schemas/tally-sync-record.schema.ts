import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { TallySyncStatus } from '@ai-accounting/shared';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type TallySyncRecordDocument = HydratedDocument<TallySyncRecord>;

@Schema({ collection: 'tally_sync_records', timestamps: true })
export class TallySyncRecord {
  @Prop({ required: true, index: true }) orgId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'Journal', index: true })
  journalId: Types.ObjectId;

  /**
   * GUID assigned by Tally after a successful import.
   * Used as the idempotency key: if Tally already has this GUID, it ignores re-imports.
   * Set by the local connector when it calls mark-synced.
   */
  @Prop({ type: String, default: null }) tallyGuid: string | null;

  @Prop({
    type: String,
    enum: Object.values(TallySyncStatus),
    default: TallySyncStatus.PENDING,
    index: true,
  })
  status: TallySyncStatus;

  @Prop({ type: Date, default: null }) syncedAt: Date | null;

  /** Number of times this record has been attempted. */
  @Prop({ type: Number, default: 0 }) retries: number;

  @Prop({ type: String, default: null }) errorMessage: string | null;
}

export const TallySyncRecordSchema = SchemaFactory.createForClass(TallySyncRecord);
TallySyncRecordSchema.index({ orgId: 1, journalId: 1 }, { unique: true });
TallySyncRecordSchema.plugin(tenantIsolationPlugin);
