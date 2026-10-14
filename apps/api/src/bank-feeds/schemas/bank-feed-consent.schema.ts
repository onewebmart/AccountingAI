import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';
import { ConsentStatus } from '../provider';

export type BankFeedConsentDocument = HydratedDocument<BankFeedConsent>;

@Schema({ _id: false })
class LinkedAccount {
  @Prop({ type: String, required: true }) linkRef: string;
  @Prop({ type: String, required: true }) maskedAccountNumber: string;
  @Prop({ type: String, required: true }) fipName: string;
  /** Our bank account its lines go to. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'BankAccount', default: null }) bankAccountId: Types.ObjectId | null;
  /** Lines up to and including this date are in; the next pull starts the day after. */
  @Prop({ type: String, default: null }) syncedThrough: string | null;
  @Prop({ type: String, default: null }) lastError: string | null;
}

/**
 * A customer's consent for us to read their bank account through an Account
 * Aggregator, and the accounts it covers.
 */
@Schema({ collection: 'bank_feed_consents', timestamps: true })
export class BankFeedConsent {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, required: true }) provider: string;
  @Prop({ type: String, required: true, unique: true }) consentHandle: string;
  /** The customer's AA handle, e.g. 9876543210@onemoney. */
  @Prop({ type: String, required: true }) customerVua: string;
  @Prop({ type: String, enum: ['PENDING', 'ACTIVE', 'REJECTED', 'REVOKED', 'EXPIRED'], default: 'PENDING', index: true })
  status: ConsentStatus;
  /** How far back the first pull reaches. */
  @Prop({ type: String, required: true }) fromDate: string;
  @Prop({ type: String, default: null }) redirectUrl: string | null;
  @Prop({ type: [LinkedAccount], default: [] }) accounts: LinkedAccount[];
  @Prop({ type: Date, default: null }) lastSyncedAt: Date | null;
  @Prop({ type: String, required: true }) createdBy: string;
}

export const BankFeedConsentSchema = SchemaFactory.createForClass(BankFeedConsent);
BankFeedConsentSchema.plugin(tenantIsolationPlugin);
