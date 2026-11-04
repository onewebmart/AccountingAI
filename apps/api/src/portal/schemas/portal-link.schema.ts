import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type PortalLinkDocument = HydratedDocument<PortalLink>;

/**
 * A customer's read-only link to their invoices. Only the token's hash is
 * kept: whoever holds the link can read that one customer's invoices until
 * it expires or is withdrawn, and no one can rebuild it from the database.
 */
@Schema({ collection: 'portal_links', timestamps: true })
export class PortalLink {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true }) customerId: Types.ObjectId;
  /** SHA-256 of the token, hex. */
  @Prop({ type: String, required: true, unique: true }) tokenHash: string;
  @Prop({ type: Date, required: true }) expiresAt: Date;
  @Prop({ type: Date, default: null }) revokedAt: Date | null;
  @Prop({ type: Date, default: null }) lastViewedAt: Date | null;
  @Prop({ type: String, required: true }) createdBy: string;
}

export const PortalLinkSchema = SchemaFactory.createForClass(PortalLink);
PortalLinkSchema.plugin(tenantIsolationPlugin);
