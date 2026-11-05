import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';
import type { ContactPerson, PartyAddress, PartySocial, PartyType, PaymentTerms } from '../../gl/party-profile';

export type CustomerDocument = HydratedDocument<Customer>;

@Schema({ collection: 'customers', timestamps: true })
export class Customer {
  @Prop({ required: true, index: true }) orgId: string;
  /** The display name: what every list, invoice and report shows. */
  @Prop({ required: true }) name: string;
  @Prop({ type: String, default: null }) gstin: string | null;
  /** The work phone. */
  @Prop({ type: String, default: null }) phone: string | null;
  @Prop({ type: String, default: null }) email: string | null;
  /** The billing address's street lines, as documents print them; kept in step with billingAddress. */
  @Prop({ type: String, default: null }) address: string | null;
  @Prop({ type: String, default: null }) city: string | null;
  @Prop({ type: String, default: null }) pincode: string | null;
  /**
   * GST state code of the customer, which is the place of supply on GSTR-1.
   * Taken from the GSTIN when there is one; an unregistered customer needs it
   * set, or an inter-state sale to them cannot be reported against a state.
   */
  @Prop({ type: String, default: null }) stateCode: string | null;
  /** The remarks: for internal use, never printed. */
  @Prop({ type: String, default: null }) notes: string | null;
  /** The currency its invoices or bills are in; INR unless it trades abroad. */
  @Prop({ type: String, default: 'INR' }) currency: string;

  // ── Who they are (all optional; see gl/party-profile.ts) ──────────────────
  @Prop({ type: String, default: null }) customerType: PartyType | null;
  @Prop({ type: String, default: null }) salutation: string | null;
  @Prop({ type: String, default: null }) firstName: string | null;
  @Prop({ type: String, default: null }) lastName: string | null;
  @Prop({ type: String, default: null }) companyName: string | null;
  @Prop({ type: String, default: null }) mobile: string | null;
  @Prop({ type: String, default: null }) language: string | null;
  /** From the GSTIN when not typed. */
  @Prop({ type: String, default: null }) pan: string | null;
  /** The default due date on a new invoice to them; null leaves it to the form. */
  @Prop({ type: String, default: null }) paymentTerms: PaymentTerms | null;
  /** False stops portal links being made for them, and closes the ones out. */
  @Prop({ type: Boolean, default: true }) portalEnabled: boolean;
  @Prop({ type: String, default: null }) website: string | null;
  @Prop({ type: String, default: null }) department: string | null;
  @Prop({ type: String, default: null }) designation: string | null;
  @Prop({ type: Object, default: null }) social: PartySocial | null;
  @Prop({ type: Object, default: null }) billingAddress: PartyAddress | null;
  @Prop({ type: Object, default: null }) shippingAddress: PartyAddress | null;
  @Prop({ type: [Object], default: [] }) contactPersons: ContactPerson[];
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);
CustomerSchema.index({ orgId: 1, name: 1 });
CustomerSchema.plugin(tenantIsolationPlugin);
// The work phone and the remarks are the phone and the notes; the API gives them under both names.
CustomerSchema.set('toJSON', {
  transform: (_doc, ret) => ({ ...ret, workPhone: ret.phone ?? null, remarks: ret.notes ?? null }),
});
