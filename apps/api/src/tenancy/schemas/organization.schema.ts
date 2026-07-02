import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

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
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);
