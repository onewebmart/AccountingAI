import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type CustomerDocument = HydratedDocument<Customer>;

@Schema({ collection: 'customers', timestamps: true })
export class Customer {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ required: true }) name: string;
  @Prop({ type: String, default: null }) gstin: string | null;
  @Prop({ type: String, default: null }) phone: string | null;
  @Prop({ type: String, default: null }) email: string | null;
  @Prop({ type: String, default: null }) address: string | null;
  /** Opening balance in paise (positive = amount owed by customer). */
  @Prop({ type: Number, default: 0 }) openingBalancePaise: number;
  @Prop({ type: String, default: null }) notes: string | null;
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);
CustomerSchema.index({ orgId: 1, name: 1 });
CustomerSchema.plugin(tenantIsolationPlugin);
