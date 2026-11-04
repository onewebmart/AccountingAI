import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type FixedAssetDocument = HydratedDocument<FixedAsset>;

const paise = { type: Number, required: true, min: 0, validate: { validator: Number.isInteger, message: 'Money must be integer paise (Invariant 1)' } };

/**
 * One asset in the register. Its depreciation is not stored here: it is
 * worked out from the depreciation entries in the review queue and the
 * ledger, so the register and the books cannot drift apart.
 */
@Schema({ collection: 'fixed_assets', timestamps: true })
export class FixedAsset {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, required: true, trim: true }) name: string;
  @Prop({ type: String, required: true }) category: string;
  /** Where its cost sits. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', required: true }) assetAccountId: Types.ObjectId;
  @Prop(paise) costPaise: number;
  /** Schedule II's default is 5% of cost. */
  @Prop(paise) residualPaise: number;
  @Prop({ type: String, required: true }) purchaseDate: string;
  @Prop({ type: String, required: true }) putToUse: string;
  @Prop({ type: String, enum: ['SLM', 'WDV'], required: true }) method: 'SLM' | 'WDV';
  @Prop({ type: Number, required: true, min: 1, max: 100 }) lifeYears: number;
  /** Brought in already part-depreciated (from earlier books). */
  @Prop({ type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'Money must be integer paise' } }) openingAccumulatedPaise: number;
  @Prop({ type: String, default: null }) openingAsOf: string | null;
  /** The bill it came from, if any. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'PurchaseBill', default: null }) billId: Types.ObjectId | null;
  /**
   * pending: its cost is being moved out of an expense into the asset
   * account, waiting in the review queue. disposing: likewise for its sale.
   */
  @Prop({ type: String, enum: ['pending', 'active', 'disposing', 'disposed', 'cancelled'], required: true, index: true }) status: 'pending' | 'active' | 'disposing' | 'disposed' | 'cancelled';
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ProposedEntry', default: null }) capitaliseProposalId: Types.ObjectId | null;
  @Prop({ type: Object, default: null }) disposal: { date: string; proceedsPaise: number; proposalId: string } | null;
  @Prop({ type: String, required: true }) createdBy: string;
}

export const FixedAssetSchema = SchemaFactory.createForClass(FixedAsset);
FixedAssetSchema.plugin(tenantIsolationPlugin);
