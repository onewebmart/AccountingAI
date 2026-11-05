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
  /** The project the line's money belongs to, carried onto the posted voucher. */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null }) projectId?: Types.ObjectId | null;
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

  /** 'document' (default) | 'gst2b' | 'bank' — determines which source the entry came from. */
  @Prop({ type: String, default: 'document' }) sourceType: string;

  /** Set when sourceType === 'bank': the statement line this entry would account for. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'BankStatementLine', default: null, index: true })
  bankLineId: Types.ObjectId | null;

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
  /** Printed due date, else derived from the payment terms; null when neither says. */
  @Prop({ type: String, default: null }) dueDate: string | null;
  @Prop({ type: String, default: null }) paymentTerms: string | null;
  /** GST on this purchase is ours to pay (reverse charge), as extraction read it. */
  @Prop({ type: Boolean, default: false }) isReverseCharge: boolean;
  /** TDS the suggested lines withhold, from the vendor's section — null when none. */
  @Prop({ type: Object, default: null }) tds: { section: string; rateBps: number; amountPaise: number } | null;
  @Prop({ type: AmountSummary, required: true }) amountsPaise: AmountSummary;
  @Prop({ type: Number, required: true, min: 0, max: 1 }) confidenceOverall: number;
  @Prop({ type: FieldConfidence, required: true }) fieldConfidence: FieldConfidence;
  @Prop({ type: [String], default: [] }) rawWarnings: string[];

  /**
   * What the bill checks found: a possible duplicate, a GSTIN that is not
   * the vendor's on file, GST that is likely blocked. A proposal with any
   * is left out of the bulk approve: a person looks at it.
   */
  @Prop({ type: [Object], default: [] })
  checks: Array<{ code: string; severity: 'high' | 'medium'; message: string }>;

  /**
   * Why the main account was chosen: a past choice, an HSN/SAC or keyword
   * rule, the model, or nothing fitting. Shown to the reviewer beside it.
   */
  @Prop({ type: Object, default: null })
  category: { source: 'learned' | 'rule' | 'ai' | 'default'; reason: string; accountName: string; confidence: number } | null;

  /**
   * Month-end adjustments (sourceType 'adjustment'): what made it, for which
   * period, and why. Assets lists each asset's depreciation in the entry.
   */
  @Prop({ type: Object, default: null })
  adjustment: {
    kind: 'recurring_journal' | 'accrual' | 'prepaid' | 'depreciation' | 'capitalise' | 'disposal' | 'reclass' | 'closing_stock' | 'opening_stock' | 'fx_revaluation';
    refId: string | null;
    period: string | null;
    reason: string;
    /** An accrual reverses itself on this date once approved. */
    reverseOn?: string | null;
    /** Set once the accrual has been reversed ('manual' when a person did it). */
    reversalJournalId?: string;
    assets?: Array<{ assetId: string; amountPaise: number; from: string; to: string }>;
    /** A bulk reclassification: the posted lines it moves, by journal and line index. */
    sources?: Array<{ journalId: string; index: number }>;
  } | null;

  /** kind:refId:period, unique while in review or approved; cleared on reject so it can be drafted again. */
  @Prop({ type: String, default: undefined }) adjustmentKey?: string;

  /** The voucher narration, when the proposal is not a document's. */
  @Prop({ type: String, default: null }) narration: string | null;

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
// One proposal in review per bank line, however many times it is sent to be categorised.
ProposedEntrySchema.index(
  { orgId: 1, bankLineId: 1 },
  { unique: true, partialFilterExpression: { bankLineId: { $type: 'objectId' }, status: ProposedEntryStatus.PROPOSED } },
);
ProposedEntrySchema.index({ orgId: 1, adjustmentKey: 1 }, { unique: true, partialFilterExpression: { adjustmentKey: { $type: 'string' } } });
ProposedEntrySchema.plugin(tenantIsolationPlugin);
