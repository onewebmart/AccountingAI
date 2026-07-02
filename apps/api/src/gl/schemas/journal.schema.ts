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

  /** Links a reversal back to the original journal */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', index: true })
  reversalOf?: MongooseSchema.Types.ObjectId;

  @Prop()
  narration?: string;

  @Prop({ type: String })
  date: string;

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
