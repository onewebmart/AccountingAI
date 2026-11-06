import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type ReportPreferenceDocument = HydratedDocument<ReportPreference>;

/**
 * One person's standing with one report in one organisation: whether they
 * starred it, and when they last opened it. Kept per org and user, so the
 * Reports Center's Favorites and Last visited are their own.
 */
@Schema({ collection: 'report_preferences', timestamps: true })
export class ReportPreference {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, required: true }) userId: string;
  /** A built-in report's key, or custom.<id>. */
  @Prop({ type: String, required: true }) key: string;
  @Prop({ type: Boolean, default: false }) favourite: boolean;
  @Prop({ type: Date, default: null }) lastVisitedAt: Date | null;
}

export const ReportPreferenceSchema = SchemaFactory.createForClass(ReportPreference);
ReportPreferenceSchema.plugin(tenantIsolationPlugin);
ReportPreferenceSchema.index({ orgId: 1, userId: 1, key: 1 }, { unique: true });
