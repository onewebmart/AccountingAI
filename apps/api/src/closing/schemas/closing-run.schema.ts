import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type ClosingRunDocument = HydratedDocument<ClosingRun>;

/** One financial year's close — and, if it happened, its reopening. One per org and year. */
@Schema({ collection: 'closing_runs', timestamps: true })
export class ClosingRun {
  @Prop({ required: true, index: true }) orgId: string;

  /** e.g. 2025-26 */
  @Prop({ type: String, required: true }) financialYear: string;

  @Prop({ type: String, enum: ['closed', 'reopened'], required: true }) status: 'closed' | 'reopened';

  /** The closing entry; null when the year had no income or expense to move. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', default: null })
  journalId: Types.ObjectId | null;

  /** Profit (positive) or loss moved to retained earnings, in integer paise. */
  @Prop({ type: Number, required: true }) netIncomePaise: number;

  @Prop({ type: String, required: true }) closedBy: string;
  @Prop({ type: Date, required: true }) closedAt: Date;
  @Prop({ type: String, default: null }) reopenedBy: string | null;
  @Prop({ type: Date, default: null }) reopenedAt: Date | null;
}

export const ClosingRunSchema = SchemaFactory.createForClass(ClosingRun);
ClosingRunSchema.index({ orgId: 1, financialYear: 1 }, { unique: true });
ClosingRunSchema.plugin(tenantIsolationPlugin);
