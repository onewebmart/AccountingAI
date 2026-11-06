import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';
import type { MileageUnit } from '../expense-lines';

export type MileageSettingsDocument = HydratedDocument<MileageSettings>;

/** A rate per unit from a date: the one in force on an expense's date applies. */
@Schema({ _id: false })
export class MileageRate {
  @Prop({ type: String, required: true }) startDate: string;
  @Prop({ type: Number, required: true, min: 1, validate: { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' } }) ratePaise: number;
}
const MileageRateSchema = SchemaFactory.createForClass(MileageRate);

/**
 * The org's mileage preferences, one document each (as the expense-claim
 * rules are, in their own small collection rather than in org settings):
 * the account mileage is booked to, the unit, and the rates by start date.
 */
@Schema({ collection: 'mileage_settings', timestamps: true })
export class MileageSettings {
  @Prop({ required: true, unique: true }) orgId: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', default: null }) defaultAccountId: Types.ObjectId | null;
  @Prop({ type: String, enum: ['km', 'mile'], default: 'km' }) unit: MileageUnit;
  @Prop({ type: [MileageRateSchema], default: [] }) rates: MileageRate[];
}

export const MileageSettingsSchema = SchemaFactory.createForClass(MileageSettings);
MileageSettingsSchema.plugin(tenantIsolationPlugin);
