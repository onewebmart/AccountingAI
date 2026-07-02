import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { StatementStatus } from '@ai-accounting/shared';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type BankStatementDocument = HydratedDocument<BankStatement>;

@Schema({ collection: 'bank_statements', timestamps: true })
export class BankStatement {
  @Prop({ required: true, index: true }) orgId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'BankAccount', index: true })
  bankAccountId: Types.ObjectId;

  @Prop({ type: String, required: true }) periodStart: string;
  @Prop({ type: String, required: true }) periodEnd: string;

  /** Balance at start of the statement period (from bank). */
  @Prop({ type: Number, required: true }) openingBalancePaise: number;
  /** Balance at end of the statement period (from bank). */
  @Prop({ type: Number, required: true }) closingBalancePaise: number;

  @Prop({
    type: String,
    enum: Object.values(StatementStatus),
    default: StatementStatus.PENDING,
  })
  status: StatementStatus;

  @Prop({ type: Number, default: 0 }) totalLines: number;
  @Prop({ type: Number, default: 0 }) matchedLines: number;
}

export const BankStatementSchema = SchemaFactory.createForClass(BankStatement);
BankStatementSchema.index({ orgId: 1, bankAccountId: 1, periodStart: -1 });
BankStatementSchema.plugin(tenantIsolationPlugin);
