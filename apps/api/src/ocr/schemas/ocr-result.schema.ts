import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type OcrResultDocument = HydratedDocument<OcrResult>;

@Schema({ collection: 'ocr_results', timestamps: true })
export class OcrResult {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ type: Types.ObjectId, required: true, ref: 'Document', index: true })
  documentId: Types.ObjectId;

  /** 1 = native PDF text, 2 = OCR provider, 3 = vision LLM */
  @Prop({ required: true, min: 1, max: 3 })
  tier: number;

  @Prop({ required: true })
  rawText: string;

  @Prop({ type: Object, default: {} })
  layoutJson: Record<string, unknown>;

  /** 0–1 confidence score for the extracted text quality */
  @Prop({ required: true, min: 0, max: 1 })
  confidence: number;

  @Prop({ required: true, min: 1 })
  pageCount: number;

  @Prop({ required: true })
  processingMs: number;
}

export const OcrResultSchema = SchemaFactory.createForClass(OcrResult);
OcrResultSchema.plugin(tenantIsolationPlugin);
