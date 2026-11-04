import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type ExchangeRateDocument = HydratedDocument<ExchangeRate>;

/**
 * Rupees for one unit of a currency on a date: the RBI/FBIL reference rate,
 * or the bank's rate, as a person enters it. Never guessed. A document takes
 * the latest rate on or before its date unless it is given its own.
 */
@Schema({ collection: 'exchange_rates', timestamps: true })
export class ExchangeRate {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, required: true }) currency: string;
  /** YYYY-MM-DD */
  @Prop({ type: String, required: true }) date: string;
  @Prop({ type: Number, required: true }) rate: number;
  @Prop({ type: String, default: null }) source: string | null;
  @Prop({ type: String, required: true }) enteredBy: string;
}

export const ExchangeRateSchema = SchemaFactory.createForClass(ExchangeRate);
ExchangeRateSchema.index({ orgId: 1, currency: 1, date: 1 }, { unique: true });
ExchangeRateSchema.plugin(tenantIsolationPlugin);
