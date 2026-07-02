import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type FirmDocument = HydratedDocument<Firm>;

export class WhiteLabelConfig {
  @Prop() logoUrl?: string;
  @Prop() accentColor?: string;
  @Prop() customDomain?: string;
  @Prop({ default: false }) clientPortalEnabled: boolean;
}

@Schema({ timestamps: true, collection: 'firms' })
export class Firm {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Platform' })
  platformId?: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  name: string;

  /** URL-safe slug — used as subdomain for white-label */
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @Prop() gstin?: string;
  @Prop() pan?: string;

  @Prop({ type: Object, default: () => ({ clientPortalEnabled: false }) })
  whiteLabelConfig: WhiteLabelConfig;

  @Prop({ default: true })
  isActive: boolean;
}

export const FirmSchema = SchemaFactory.createForClass(Firm);
