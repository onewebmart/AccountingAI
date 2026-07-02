import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UsageMeterDocument = HydratedDocument<UsageMeter>;

/**
 * One document per (orgId, period). All fields are incremented atomically via $inc.
 * Index is compound (orgId + period) with unique constraint.
 */
@Schema({ collection: 'usage_meters', timestamps: true })
export class UsageMeter {
  @Prop({ required: true, index: true })
  orgId: string;

  /** ISO YYYY-MM, e.g. "2025-03" */
  @Prop({ required: true })
  period: string;

  @Prop({ default: 0 }) ocrPagesTier1: number;
  @Prop({ default: 0 }) ocrPagesTier2: number;
  @Prop({ default: 0 }) ocrPagesTier3: number;

  @Prop({ default: 0 }) groqTokensIn: number;
  @Prop({ default: 0 }) groqTokensOut: number;
}

export const UsageMeterSchema = SchemaFactory.createForClass(UsageMeter);
UsageMeterSchema.index({ orgId: 1, period: 1 }, { unique: true });
