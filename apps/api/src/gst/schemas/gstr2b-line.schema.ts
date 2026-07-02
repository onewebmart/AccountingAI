import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { GstReconStatus, GstMismatchType } from '@ai-accounting/shared';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type Gstr2bLineDocument = HydratedDocument<Gstr2bLine>;

@Schema({ collection: 'gstr_2b_lines', timestamps: true })
export class Gstr2bLine {
  @Prop({ required: true, index: true }) orgId: string;

  /** Period this line belongs to (YYYY-MM, e.g. "2025-03"). */
  @Prop({ required: true, index: true }) period: string;

  // ── Supplier details from GSTN ───────────────────────────────────────────
  @Prop({ type: String, default: null }) supplierGstin: string | null;
  @Prop({ type: String, default: null }) supplierName: string | null;

  // ── Document details ─────────────────────────────────────────────────────
  /** Invoice / debit-note / credit-note number as per 2B. */
  @Prop({ type: String, default: null }) invoiceNumber: string | null;
  /** Document date (YYYY-MM-DD). */
  @Prop({ type: String, default: null }) invoiceDate: string | null;
  /** B2B | CDNR | RCM | ISD etc. — raw from GSTN JSON. */
  @Prop({ type: String, default: 'B2B' }) documentType: string;
  @Prop({ type: Boolean, default: false }) isReverseCharge: boolean;

  // ── Tax amounts — all integer paise (Invariant 1) ────────────────────────
  @Prop({ type: Number, required: true }) taxableValuePaise: number;
  @Prop({ type: Number, default: 0 }) cgstPaise: number;
  @Prop({ type: Number, default: 0 }) sgstPaise: number;
  @Prop({ type: Number, default: 0 }) igstPaise: number;
  @Prop({ type: Number, default: 0 }) cessPaise: number;

  /** ITC claimable = cgst + sgst + igst (cess excluded per 17(5)); 0 for B2C. */
  @Prop({ type: Number, default: 0 }) itcEligiblePaise: number;

  // ── Reconciliation result ────────────────────────────────────────────────
  @Prop({
    type: String,
    enum: Object.values(GstReconStatus),
    default: GstReconStatus.PENDING,
    index: true,
  })
  reconStatus: GstReconStatus;

  @Prop({ type: String, enum: [...Object.values(GstMismatchType), null], default: null })
  mismatchType: GstMismatchType | null;

  /** Set when this line is matched to a PurchaseBill. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'PurchaseBill', default: null })
  matchedBillId: Types.ObjectId | null;
}

export const Gstr2bLineSchema = SchemaFactory.createForClass(Gstr2bLine);
Gstr2bLineSchema.index({ orgId: 1, period: 1, reconStatus: 1 });
Gstr2bLineSchema.index({ orgId: 1, supplierGstin: 1, invoiceNumber: 1 });
Gstr2bLineSchema.plugin(tenantIsolationPlugin);
