import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type BankAccountDocument = HydratedDocument<BankAccount>;

@Schema({ collection: 'bank_accounts', timestamps: true })
export class BankAccount {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ required: true }) name: string;
  @Prop({ type: String, default: null }) accountNumber: string | null;
  @Prop({ type: String, default: null }) bankName: string | null;
  @Prop({ type: String, default: null }) ifsc: string | null;
  /** Opening balance in paise as of openingBalanceDate. */
  @Prop({ type: Number, default: 0 }) openingBalancePaise: number;
  @Prop({ type: String, default: null }) openingBalanceDate: string | null;
}

export const BankAccountSchema = SchemaFactory.createForClass(BankAccount);
BankAccountSchema.index({ orgId: 1, name: 1 });
BankAccountSchema.plugin(tenantIsolationPlugin);
