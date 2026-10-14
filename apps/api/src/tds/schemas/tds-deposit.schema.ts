import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type TdsDepositDocument = HydratedDocument<TdsDeposit>;

/**
 * TDS paid over to the government for one month and section — one challan.
 * Posted as Dr TDS Payable / Cr Bank; the bills it covers point back at it.
 */
@Schema({ collection: 'tds_deposits', timestamps: true })
export class TdsDeposit {
  @Prop({ required: true, index: true }) orgId: string;

  /** The month the TDS was deducted in (YYYY-MM). */
  @Prop({ type: String, required: true }) month: string;

  @Prop({ type: String, required: true }) section: string;

  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' },
  })
  amountPaise: number;

  @Prop({ type: String, required: true }) paidOn: string;

  /** The challan identification number from the bank. */
  @Prop({ type: String, required: true }) challanNumber: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Journal', required: true })
  journalId: Types.ObjectId;

  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'PurchaseBill', default: [] })
  billIds: Types.ObjectId[];

  @Prop({ type: String, enum: ['posted', 'reversed'], default: 'posted' })
  status: 'posted' | 'reversed';

  @Prop({ type: String, required: true }) createdBy: string;
}

export const TdsDepositSchema = SchemaFactory.createForClass(TdsDeposit);
TdsDepositSchema.index({ orgId: 1, month: 1, section: 1 });
TdsDepositSchema.plugin(tenantIsolationPlugin);
