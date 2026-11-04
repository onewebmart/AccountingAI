import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type AiSuggestionDocument = HydratedDocument<AiSuggestion>;

export type SuggestionStatus = 'queued' | 'done' | 'none' | 'failed';

/**
 * Advice from the AI layer: an HSN code, an explanation, a flag. It changes
 * nothing in the books; a person reads it and decides. Anything that would
 * change the ledger is a proposal in the review queue instead.
 */
@Schema({ collection: 'ai_suggestions', timestamps: true })
export class AiSuggestion {
  @Prop({ required: true, index: true }) orgId: string;
  /** What it is advice about, e.g. 'hsn'. */
  @Prop({ type: String, required: true, index: true }) kind: string;
  @Prop({ type: String, enum: ['queued', 'done', 'none', 'failed'], default: 'queued' }) status: SuggestionStatus;
  /** What was asked. */
  @Prop({ type: Object, required: true }) input: Record<string, unknown>;
  @Prop({ type: Object, default: null }) result: Record<string, unknown> | null;
  /** Where the answer came from: the org's history, a rule, or the model. */
  @Prop({ type: String, default: null }) source: 'history' | 'rule' | 'model' | null;
  /** Capped below 1 for the model, so a person always checks. */
  @Prop({ type: Number, default: null }) confidence: number | null;
  @Prop({ type: String, default: null }) reason: string | null;
  @Prop({ type: String, default: null }) entityType: string | null;
  @Prop({ type: String, default: null }) entityId: string | null;
  @Prop({ type: String, required: true }) requestedBy: string;
}

export const AiSuggestionSchema = SchemaFactory.createForClass(AiSuggestion);
AiSuggestionSchema.plugin(tenantIsolationPlugin);
