import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type VendorDocument = HydratedDocument<Vendor>;

@Schema({ collection: 'vendors', timestamps: true })
export class Vendor {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ required: true }) name: string;
  @Prop({ type: String, default: null }) gstin: string | null;
  @Prop({ type: String, default: null }) phone: string | null;
  @Prop({ type: String, default: null }) email: string | null;
  @Prop({ type: String, default: null }) address: string | null;
  /** Opening balance in paise (positive = amount owed to vendor). */
  @Prop({ type: Number, default: 0 }) openingBalancePaise: number;
  @Prop({ type: String, default: null }) notes: string | null;

  /** From the GSTIN when there is one; needed on every TDS return line. */
  @Prop({ type: String, default: null }) pan: string | null;

  /** Section TDS is deducted under on this vendor's bills (e.g. 194C), or null. */
  @Prop({ type: String, default: null }) tdsSection: string | null;

  /** Rate in basis points (100 = 1%). */
  @Prop({ type: Number, default: null }) tdsRateBps: number | null;
}

export const VendorSchema = SchemaFactory.createForClass(Vendor);
VendorSchema.index({ orgId: 1, name: 1 });
VendorSchema.plugin(tenantIsolationPlugin);
