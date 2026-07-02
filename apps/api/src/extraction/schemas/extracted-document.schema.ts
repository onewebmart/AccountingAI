import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type ExtractedDocumentDocument = HydratedDocument<ExtractedDocument>;

export type ExtractionStatus = 'extracted' | 'manual_required';

@Schema({ _id: false })
class ConfidenceField {
  @Prop({ type: String, default: null }) value: string | null;
  @Prop({ type: Number, required: true, min: 0, max: 1 }) confidence: number;
}

@Schema({ _id: false })
class VendorField {
  @Prop({ type: String, default: null }) name: string | null;
  @Prop({ type: String, default: null }) gstin: string | null;
  @Prop({ type: Number, required: true, min: 0, max: 1 }) confidence: number;
}

@Schema({ _id: false })
class AmountsPaise {
  @Prop({ type: Number, required: true, min: 0 }) taxableValue: number;
  @Prop({ type: Number, required: true, min: 0 }) cgst: number;
  @Prop({ type: Number, required: true, min: 0 }) sgst: number;
  @Prop({ type: Number, required: true, min: 0 }) igst: number;
  @Prop({ type: Number, required: true, min: 0 }) cess: number;
  @Prop({ type: Number, required: true, min: 0 }) total: number;
  @Prop({ type: Number, required: true, min: 0, max: 1 }) confidence: number;
}

@Schema({ _id: false })
class LineItem {
  @Prop({ type: String, required: true }) description: string;
  @Prop({ type: String, default: null }) hsnSac: string | null;
  @Prop({ type: Number, required: true }) qty: number;
  @Prop({ type: Number, required: true, min: 0 }) ratePaise: number;
  @Prop({ type: Number, required: true, min: 0 }) amountPaise: number;
  @Prop({ type: Number, required: true, min: 0 }) taxRatePct: number;
}

@Schema({ collection: 'extracted_documents', timestamps: true })
export class ExtractedDocument {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ type: Types.ObjectId, required: true, ref: 'Document', index: true })
  documentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, ref: 'OcrResult' })
  ocrResultId: Types.ObjectId;

  /** 'extracted' — AI produced valid output; 'manual_required' — both attempts failed */
  @Prop({ required: true, enum: ['extracted', 'manual_required'] })
  status: ExtractionStatus;

  @Prop({ required: true, min: 0 })
  retryCount: number;

  @Prop({ default: '' })
  rawGroqResponse: string;

  // ── Canonical contract fields ──────────────────────────────────────────

  @Prop({ required: true })
  documentType: string;

  @Prop({ required: true, min: 0, max: 1 })
  confidenceOverall: number;

  @Prop({ type: VendorField, required: true })
  vendor: VendorField;

  @Prop({ type: ConfidenceField, required: true })
  invoiceNumber: ConfidenceField;

  @Prop({ type: ConfidenceField, required: true })
  invoiceDate: ConfidenceField;

  @Prop({ type: String, default: null })
  placeOfSupply: string | null;

  @Prop({ default: 'INR' })
  currency: string;

  @Prop({ type: AmountsPaise, required: true })
  amountsPaise: AmountsPaise;

  @Prop({ type: [LineItem], default: [] })
  lineItems: LineItem[];

  @Prop({ default: false })
  isReverseCharge: boolean;

  @Prop({ type: [String], default: [] })
  rawWarnings: string[];
}

export const ExtractedDocumentSchema = SchemaFactory.createForClass(ExtractedDocument);
ExtractedDocumentSchema.plugin(tenantIsolationPlugin);
