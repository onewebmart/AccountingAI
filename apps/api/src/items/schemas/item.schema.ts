import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';
import { ITEM_GST_RATES, UQC_CODES } from '../hsn';

export type ItemDocument = HydratedDocument<Item>;

const optionalPaise = {
  type: Number,
  default: null,
  validate: { validator: (v: number | null) => v === null || (Number.isInteger(v) && v >= 0), message: 'A price is a whole number of paise, not negative.' },
};

/** Where an item's HSN/SAC came from, kept so anyone can see whether a person or a suggestion set it. */
@Schema({ _id: false })
class HsnSource {
  @Prop({ type: String, enum: ['person', 'history', 'rule', 'model'], required: true }) by: 'person' | 'history' | 'rule' | 'model';
  @Prop({ type: String, default: null }) reason: string | null;
  @Prop({ type: Number, default: null }) confidence: number | null;
}

/**
 * Something the business sells or buys. An item fills a line's HSN/SAC,
 * unit, rate and account; goods are counted in stock from the lines linked
 * to them (see stock/).
 */
@Schema({ collection: 'items', timestamps: true })
export class Item {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, required: true, trim: true }) name: string;
  /** The name for matching; unique per org. */
  @Prop({ type: String, required: true }) nameKey: string;
  @Prop({ type: String, default: null, trim: true }) code: string | null;
  @Prop({ type: String, enum: ['goods', 'service'], required: true }) kind: 'goods' | 'service';
  @Prop({ type: String, default: null }) hsnSac: string | null;
  @Prop({ type: HsnSource, default: null }) hsnSource: HsnSource | null;
  @Prop({ type: String, enum: UQC_CODES, required: true }) uqc: string;
  @Prop({ type: Number, enum: ITEM_GST_RATES, default: null }) gstRatePct: number | null;
  @Prop(optionalPaise) salePricePaise: number | null;
  @Prop(optionalPaise) purchasePricePaise: number | null;
  /** Where its sales are credited; the Sales account when not set. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', default: null }) incomeAccountId: Types.ObjectId | null;
  /** Where its purchases are debited; the Purchases account when not set. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LedgerAccount', default: null }) expenseAccountId: Types.ObjectId | null;
  @Prop({ type: String, default: null }) description: string | null;
  /** What a purchase line says, when it is not the sales description. */
  @Prop({ type: String, default: null }) purchaseDescription: string | null;
  /** The vendor it is usually bought from. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Vendor', default: null }) preferredVendorId: Types.ObjectId | null;
  /** Sold, bought, or both: an item is offered on the documents of the side it is on. */
  @Prop({ type: Boolean, default: true }) forSale: boolean;
  @Prop({ type: Boolean, default: true }) forPurchase: boolean;
  /** Goods are counted in stock unless this is off (a consumable nobody counts). */
  @Prop({ type: Boolean, default: true }) trackStock: boolean;
  /** Buy more at or under this many; none set, the sales rate decides. */
  @Prop({ type: Number, default: null, min: 0 }) reorderLevel: number | null;
  @Prop({ type: Number, default: null, min: 0 }) reorderQty: number | null;
  @Prop({ type: Boolean, default: true, index: true }) isActive: boolean;
}

export const ItemSchema = SchemaFactory.createForClass(Item);
ItemSchema.index({ orgId: 1, nameKey: 1 }, { unique: true });
ItemSchema.plugin(tenantIsolationPlugin);
