import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { ClientType, FirmService } from '@ai-accounting/shared';

export type OrganizationDocument = HydratedDocument<Organization>;

/**
 * Organization is the tenant. Its _id.toString() is the orgId
 * that every tenant-scoped document carries.
 *
 * Direct SME signups have no firmId.
 * CA-managed companies have firmId pointing to a Firm.
 */
@Schema({ timestamps: true, collection: 'organizations' })
export class Organization {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Firm', index: true })
  firmId?: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop() gstin?: string;
  @Prop() pan?: string;

  /** State for GST place-of-supply default */
  @Prop() state?: string;

  /** Financial year start month (1-based). India default = 4 (April). */
  @Prop({ default: 4, min: 1, max: 12 })
  financialYearStart: number;

  @Prop({ default: 'INR' })
  currency: string;

  @Prop({ default: 'Asia/Kolkata' })
  timezone: string;

  @Prop({ default: true })
  isActive: boolean;

  // ── CRM fields ──────────────────────────────────────────────────────────────
  // Populated when a CA firm adds this org as a client. Direct SME signups
  // leave them empty. Contact details drive the CRM's WhatsApp/email reminders;
  // `services` drives which statutory deadlines and document checklists apply.

  /** Legal constitution — decides which filings are applicable. */
  @Prop({ type: String, enum: Object.values(ClientType) })
  clientType?: ClientType;

  /** E.164-ish digits used for WhatsApp reminders. */
  @Prop() whatsappNumber?: string;

  /** Primary contact email for document requests and invoices. */
  @Prop() contactEmail?: string;

  /** Primary contact person at the client. */
  @Prop() contactName?: string;

  /** Services the firm provides — drives compliance + document checklists. */
  @Prop({ type: [String], enum: Object.values(FirmService), default: [] })
  services: FirmService[];
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);
