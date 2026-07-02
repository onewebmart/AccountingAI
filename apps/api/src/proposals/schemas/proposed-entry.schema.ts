import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { ProposedEntryStatus } from '@ai-accounting/shared';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type ProposedEntryDocument = HydratedDocument<ProposedEntry>;

@Schema({ _id: false })
class SuggestedLine {
  /** Human-readable account name — Phase 9 will resolve to real CoA objectId */
  @Prop({ type: String, required: true }) accountName: string;
  /** Optional CoA code for display */
  @Prop({ type: String, default: null }) accountCode: string | null;
  /** Placeholder ObjectId — replaced with real CoA account once CoA module is built */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: () => new Types.ObjectId() })
  accountId: Types.ObjectId;
  @Prop({ type: Number, required: true, min: 0 }) debitPaise: number;
  @Prop({ type: Number, required: true, min: 0 }) creditPaise: number;
  @Prop({ type: Number, required: true, min: 0, max: 1 }) confidence: number;
  @Prop({ type: Boolean, default: true }) isAiSuggested: boolean;
}

@Schema({ _id: false })
class AmountSummary {
  @Prop({ type: Number, required: true }) taxableValue: number;
  @Prop({ type: Number, required: true }) cgst: number;
  @Prop({ type: Number, required: true }) sgst: number;
  @Prop({ type: Number, required: true }) igst: number;
  @Prop({ type: Number, required: true }) cess: number;
  @Prop({ type: Number, required: true }) total: number;
}

@Schema({ _id: false })
class FieldConfidence {
  @Prop({ type: Number, required: true, min: 0, max: 1 }) vendor: number;
  @Prop({ type: Number, required: true, min: 0, max: 1 }) invoiceNumber: number;
  @Prop({ type: Number, required: true, min: 0, max: 1 }) invoiceDate: number;
  @Prop({ type: Number, required: true, min: 0, max: 1 }) amounts: number;
}

@Schema({ collection: 'proposed_entries', timestamps: true })
export class ProposedEntry {
  @Prop({ required: true, index: true }) orgId: string;

  /** Null for entries created from GSTR-2B lines (sourceType: 'gst2b'). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Document', index: true, default: null })
  documentId: Types.ObjectId | null;

  /** Null for entries created from GSTR-2B lines (sourceType: 'gst2b'). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ExtractedDocument', default: null })
  extractedDocumentId: Types.ObjectId | null;

  /** 'document' (default) | 'gst2b' — determines which source the entry came from. */
  @Prop({ type: String, default: 'document' }) sourceType: string;

  /** Set when sourceType === 'gst2b'. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Gstr2bLine', default: null })
  gstr2bLineId: Types.ObjectId | null;

  @Prop({
    type: String,
    enum: Object.values(ProposedEntryStatus),
    default: ProposedEntryStatus.PROPOSED,
  })
  status: ProposedEntryStatus;

  // ── Extracted data (copied for quick display — source of truth is ExtractedDocument) ──
  @Prop({ type: String, required: true }) documentType: string;
  @Prop({ type: String, default: null }) vendorName: string | null;
  @Prop({ type: String, default: null }) vendorGstin: string | null;
  @Prop({ type: String, default: null }) invoiceNumber: string | null;
  @Prop({ type: String, default: null }) invoiceDate: string | null;
  @Prop({ type: AmountSummary, required: true }) amountsPaise: AmountSummary;
  @Prop({ type: Number, required: true, min: 0, max: 1 }) confidenceOverall: number;
  @Prop({ type: FieldConfidence, required: true }) fieldConfidence: FieldConfidence;
  @Prop({ type: [String], default: [] }) rawWarnings: string[];

  // ── AI-suggested journal lines ────────────────────────────────────────
  @Prop({ type: [SuggestedLine], required: true }) suggestedLines: SuggestedLine[];

  // ── Financial year for posting ────────────────────────────────────────
  @Prop({ type: String, required: true }) financialYear: string;

  // ── Outcome fields (set on approve/reject) ────────────────────────────
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', default: null })
  journalId: Types.ObjectId | null;

  @Prop({ type: String, default: null }) approvedBy: string | null;
  @Prop({ type: String, default: null }) rejectedBy: string | null;
  @Prop({ type: String, default: null }) rejectionReason: string | null;
}

export const ProposedEntrySchema = SchemaFactory.createForClass(ProposedEntry);
ProposedEntrySchema.index({ orgId: 1, status: 1 });
ProposedEntrySchema.plugin(tenantIsolationPlugin);
