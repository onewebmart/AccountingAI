import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { MatchStatus } from '@ai-accounting/shared';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type BankStatementLineDocument = HydratedDocument<BankStatementLine>;

@Schema({ collection: 'bank_statement_lines', timestamps: true })
export class BankStatementLine {
  @Prop({ required: true, index: true }) orgId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'BankStatement', index: true })
  statementId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'BankAccount', index: true })
  bankAccountId: Types.ObjectId;

  /** Transaction date from the bank statement (YYYY-MM-DD). */
  @Prop({ type: String, required: true }) date: string;

  @Prop({ type: String, required: true }) description: string;

  /** Reference / cheque number / UTR from the bank. */
  @Prop({ type: String, default: null }) reference: string | null;

  /** Money leaving the account (debit from bank perspective). 0 if this is a credit. */
  @Prop({ type: Number, required: true, min: 0 }) debitPaise: number;

  /** Money entering the account (credit from bank perspective). 0 if this is a debit. */
  @Prop({ type: Number, required: true, min: 0 }) creditPaise: number;

  /** Running balance after this transaction (from bank statement). */
  @Prop({ type: Number, default: null }) runningBalancePaise: number | null;

  @Prop({
    type: String,
    enum: Object.values(MatchStatus),
    default: MatchStatus.UNMATCHED,
    index: true,
  })
  matchStatus: MatchStatus;

  /** Journal matched to this bank line (null until matched). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', default: null })
  matchedJournalId: Types.ObjectId | null;
}

export const BankStatementLineSchema = SchemaFactory.createForClass(BankStatementLine);
BankStatementLineSchema.index({ orgId: 1, statementId: 1, matchStatus: 1 });
BankStatementLineSchema.plugin(tenantIsolationPlugin);
