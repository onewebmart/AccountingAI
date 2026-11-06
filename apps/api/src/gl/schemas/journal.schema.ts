import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Query } from 'mongoose';
import { VoucherType, JournalStatus } from '@ai-accounting/shared';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';
import { JournalLine, JournalLineSchema } from './journal-line.schema';

export type JournalDocument = HydratedDocument<Journal>;

@Schema({ timestamps: true, collection: 'journals' })
export class Journal {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ type: String, enum: Object.values(VoucherType), required: true })
  voucherType: VoucherType;

  /** Gapless sequential number per org + voucherType + financialYear */
  @Prop({ required: true })
  voucherNumber: number;

  /** e.g. "2024-25" */
  @Prop({ required: true, index: true })
  financialYear: string;

  @Prop({ type: String, enum: Object.values(JournalStatus), default: JournalStatus.POSTED })
  status: JournalStatus;

  /**
   * Set on a reversal (contra) entry, pointing at the journal it cancels. The
   * original is never modified, so "has this been reversed?" is answered by
   * looking for a journal whose reversalOf is its id.
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', index: true })
  reversalOf?: MongooseSchema.Types.ObjectId;

  @Prop()
  narration?: string;

  /**
   * The year-end entry moving a year's income and expense into retained
   * earnings. Left out of that year's P&L and trial balance — which would
   * otherwise read zero — and kept in the balance sheet and ledgers.
   */
  @Prop({ type: Boolean, default: false })
  isClosingEntry: boolean;

  @Prop({ type: String })
  date: string;

  /** Reference# typed on a manual journal: a document or file number of the person's. */
  @Prop({ type: String, default: null })
  reference?: string | null;

  /**
   * Journal# typed by the person in place of the automatic one. The voucher
   * number (JNL series) is still allocated, gapless, as for every journal;
   * this is a second number of their own, unique in the org.
   */
  @Prop({ type: String, default: null })
  journalNumber?: string | null;

  /**
   * Set when posted, never after: this journal reverses itself on `on`.
   * publishOnDate true → the daily job posts the reversal that day;
   * false → it was posted with this journal, dated `on`.
   */
  @Prop({ type: { on: { type: String, required: true }, publishOnDate: { type: Boolean, default: true } }, default: null, _id: false })
  autoReverse?: { on: string; publishOnDate: boolean } | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  postedBy: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  postedAt: Date;

  /** Embedded lines — never a separate collection */
  @Prop({ type: [JournalLineSchema], required: true })
  lines: JournalLine[];
}

export const JournalSchema = SchemaFactory.createForClass(Journal);

// Compound index for uniqueness and efficient queries
JournalSchema.index({ orgId: 1, voucherType: 1, financialYear: 1, voucherNumber: 1 }, { unique: true });
JournalSchema.index({ orgId: 1, status: 1 });
// A journal can be reversed at most once. Keyed on (orgId, reversalOf) rather
// than reversalOf alone, which would clash with the plain reversalOf index
// existing databases already carry.
JournalSchema.index(
  { orgId: 1, reversalOf: 1 },
  { unique: true, partialFilterExpression: { reversalOf: { $type: 'objectId' } } },
);
// A Journal# of the person's own is used once in an org.
JournalSchema.index(
  { orgId: 1, journalNumber: 1 },
  { unique: true, partialFilterExpression: { journalNumber: { $type: 'string' } } },
);
// The daily job's search for reversals falling due.
JournalSchema.index({ 'autoReverse.on': 1 }, { partialFilterExpression: { 'autoReverse.publishOnDate': true } });

// ── Invariant 2: enforce Σdebit = Σcredit (balanced journal) ─────────────
JournalSchema.pre('validate', function (this: Journal) {
  if (!this.lines?.length) throw new Error('A journal must have at least one line.');

  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of this.lines) {
    totalDebit += line.debitPaise;
    totalCredit += line.creditPaise;
  }

  if (totalDebit === 0 && totalCredit === 0) {
    throw new Error('Journal total cannot be zero.');
  }
  if (totalDebit !== totalCredit) {
    throw new Error(
      `Journal is not balanced: Σdebit=${totalDebit} paise ≠ Σcredit=${totalCredit} paise.`,
    );
  }
});

// ── Invariant 3: posted journals are append-only ──────────────────────────
// Reject any mutation attempt on a document already in "posted" status.
type JournalQuery = Query<unknown, JournalDocument>;

JournalSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], async function (this: JournalQuery) {
  const doc = await this.model.findOne(this.getFilter()).lean();
  if (doc && (doc as { status?: string }).status === JournalStatus.POSTED) {
    throw new Error('A posted journal is immutable. Create a reversal entry instead.');
  }
});

JournalSchema.pre('save', function (this: JournalDocument & { isNew: boolean }) {
  // On save, only block if the document EXISTS and is already posted (i.e. not a new insert)
  if (!this.isNew && this.status === JournalStatus.POSTED) {
    throw new Error('A posted journal is immutable. Create a reversal entry instead.');
  }
});

JournalSchema.plugin(tenantIsolationPlugin);
