import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OrgSettingsDocument = HydratedDocument<OrgSettings>;

@Schema({ collection: 'org_settings', timestamps: true })
export class OrgSettings {
  /** Unique per org — 1:1 with Organization. */
  @Prop({ required: true, unique: true, index: true })
  orgId: string;

  // ── Company profile ──────────────────────────────────────────────────────────

  @Prop({ type: String, default: null }) displayName: string | null;
  @Prop({ type: String, default: null }) gstin: string | null;
  @Prop({ type: String, default: null }) pan: string | null;

  /** Two-digit GST state code (e.g. "27" for Maharashtra). */
  @Prop({ type: String, default: '27' }) stateCode: string;

  @Prop({ type: String, default: 'Asia/Kolkata' }) timezone: string;
  @Prop({ type: String, default: 'INR' }) currencyCode: string;

  /** Financial year start month, 1-indexed. India default = 4 (April). */
  @Prop({ type: Number, default: 4, min: 1, max: 12 }) financialYearStartMonth: number;

  // ── GST ─────────────────────────────────────────────────────────────────────

  @Prop({
    type: String,
    enum: ['monthly', 'quarterly'],
    default: 'monthly',
  })
  gstFilingFrequency: 'monthly' | 'quarterly';

  // ── Integrations ─────────────────────────────────────────────────────────────

  /** Tally company name for Tally connector matching. */
  @Prop({ type: String, default: null }) tallyCompanyName: string | null;
  /** Razorpay key ID (secret never stored here). */
  @Prop({ type: String, default: null }) razorpayKeyId: string | null;
  /** Custom S3 bucket name override (if the org brings their own bucket). */
  @Prop({ type: String, default: null }) awsBucketName: string | null;

  // ── Branding (white-label only) ───────────────────────────────────────────────

  @Prop({ type: String, default: null }) brandingLogoUrl: string | null;
  @Prop({ type: String, default: null }) brandingAccentColor: string | null;
  @Prop({ type: String, default: null }) customDomain: string | null;
  @Prop({ type: Boolean, default: false }) clientPortalEnabled: boolean;
}

export const OrgSettingsSchema = SchemaFactory.createForClass(OrgSettings);
