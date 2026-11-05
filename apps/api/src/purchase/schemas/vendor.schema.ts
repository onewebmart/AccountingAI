import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';
import { VendorMsme } from '../msme';
import type { ContactPerson, PartyAddress, PartySocial, PartyType, PaymentTerms } from '../../gl/party-profile';

export type VendorDocument = HydratedDocument<Vendor>;

@Schema({ collection: 'vendors', timestamps: true })
export class Vendor {
  @Prop({ required: true, index: true }) orgId: string;
  /** The display name: what every list, bill and report shows. */
  @Prop({ required: true }) name: string;
  @Prop({ type: String, default: null }) gstin: string | null;
  /** The work phone. */
  @Prop({ type: String, default: null }) phone: string | null;
  @Prop({ type: String, default: null }) email: string | null;
  /** The billing address's street lines, as documents print them; kept in step with billingAddress. */
  @Prop({ type: String, default: null }) address: string | null;
  @Prop({ type: String, default: null }) city: string | null;
  @Prop({ type: String, default: null }) pincode: string | null;
  /** The remarks: for internal use, never printed. */
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

  // ── Who they are (all optional; see gl/party-profile.ts) ──────────────────
  @Prop({ type: String, default: null }) vendorType: PartyType | null;
  @Prop({ type: String, default: null }) salutation: string | null;
  @Prop({ type: String, default: null }) firstName: string | null;
  @Prop({ type: String, default: null }) lastName: string | null;
  @Prop({ type: String, default: null }) companyName: string | null;
  @Prop({ type: String, default: null }) mobile: string | null;
  @Prop({ type: String, default: null }) language: string | null;
  /** The default due date on a new bill from them; null leaves it to the form. */
  @Prop({ type: String, default: null }) paymentTerms: PaymentTerms | null;
  @Prop({ type: String, default: null }) website: string | null;
  @Prop({ type: String, default: null }) department: string | null;
  @Prop({ type: String, default: null }) designation: string | null;
  @Prop({ type: Object, default: null }) social: PartySocial | null;
  @Prop({ type: Object, default: null }) billingAddress: PartyAddress | null;
  @Prop({ type: Object, default: null }) shippingAddress: PartyAddress | null;
  @Prop({ type: [Object], default: [] }) contactPersons: ContactPerson[];
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
// The work phone and the remarks are the phone and the notes; the API gives them under both names.
VendorSchema.set('toJSON', {
  transform: (_doc, ret) => ({ ...ret, workPhone: ret.phone ?? null, remarks: ret.notes ?? null }),
});
