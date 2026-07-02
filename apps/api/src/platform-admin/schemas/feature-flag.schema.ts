import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FeatureFlagDocument = HydratedDocument<FeatureFlag>;

@Schema({ collection: 'feature_flags', timestamps: true })
export class FeatureFlag {
  /** Which org this flag override applies to. */
  @Prop({ required: true, index: true })
  orgId: string;

  /** e.g. "vision_ocr_enabled", "tally_sync", "white_label" */
  @Prop({ required: true })
  flagName: string;

  @Prop({ default: false })
  enabled: boolean;

  /** Platform actor who toggled this flag. */
  @Prop({ type: String, default: null })
  overriddenBy: string | null;
}

export const FeatureFlagSchema = SchemaFactory.createForClass(FeatureFlag);

/** One flag per (org, flagName) — platform admin controls each independently. */
FeatureFlagSchema.index({ orgId: 1, flagName: 1 }, { unique: true });
