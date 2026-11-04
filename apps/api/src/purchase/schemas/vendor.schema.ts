import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';
import { VendorMsme } from '../msme';

export type VendorDocument = HydratedDocument<Vendor>;

@Schema({ collection: 'vendors', timestamps: true })
export class Vendor {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ required: true }) name: string;
  @Prop({ type: String, default: null }) gstin: string | null;
  @Prop({ type: String, default: null }) phone: string | null;
  @Prop({ type: String, default: null }) email: string | null;
  @Prop({ type: String, default: null }) address: string | null;
  @Prop({ type: String, default: null }) city: string | null;
  @Prop({ type: String, default: null }) pincode: string | null;
  @Prop({ type: String, default: null }) notes: string | null;

  /** From the GSTIN when there is one; needed on every TDS return line. */
  @Prop({ type: String, default: null }) pan: string | null;

  /** Section TDS is deducted under on this vendor's bills (e.g. 194C), or null. */
  @Prop({ type: String, default: null }) tdsSection: string | null;

  /** Rate in basis points (100 = 1%). */
  @Prop({ type: Number, default: null }) tdsRateBps: number | null;

  /**
   * Where this vendor is paid. A payment run pays here, and a bill asking
   * to be paid somewhere else is worth a phone call before it is paid.
   */
  @Prop({ type: Object, default: null })
  bankAccount: VendorBankAccount | null;

  /** Udyam registration, when the vendor is an MSME: decides the 43B(h) pay-by date. */
  @Prop({ type: Object, default: null })
  msme: VendorMsme | null;

  /** The currency its invoices or bills are in; INR unless it trades abroad. */
  @Prop({ type: String, default: 'INR' }) currency: string;
}

export interface VendorBankAccount {
  accountName: string | null;
  accountNumber: string;
  ifsc: string;
  bankName: string | null;
}

export const VendorSchema = SchemaFactory.createForClass(Vendor);
VendorSchema.index({ orgId: 1, name: 1 });
VendorSchema.plugin(tenantIsolationPlugin);
