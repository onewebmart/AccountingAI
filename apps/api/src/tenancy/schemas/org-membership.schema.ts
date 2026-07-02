import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { UserRole } from '@ai-accounting/shared';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type OrgMembershipDocument = HydratedDocument<OrgMembership>;

/**
 * OrgMembership — tenant-scoped junction between User and Organization.
 *
 * orgId is always the primary isolation key (injected automatically
 * by the tenantIsolationPlugin from AsyncLocalStorage context).
 * firmId is stored for efficient firm-level queries (e.g. list all
 * members across a CA firm's client orgs).
 */
@Schema({ timestamps: true, collection: 'orgMemberships' })
export class OrgMembership {
  /** Tenant isolation key — indexed, auto-injected by the plugin */
  @Prop({ required: true, index: true })
  orgId: string;

  /** Optional firm scope for cross-client CA queries */
  @Prop({ index: true, sparse: true })
  firmId?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ type: String, enum: Object.values(UserRole), required: true })
  role: UserRole;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  invitedBy?: MongooseSchema.Types.ObjectId;

  @Prop()
  joinedAt?: Date;
}

export const OrgMembershipSchema = SchemaFactory.createForClass(OrgMembership);

// Enforce unique user per org (one membership per user-org pair)
OrgMembershipSchema.index({ orgId: 1, userId: 1 }, { unique: true });

// Apply the tenant isolation plugin — auto-injects orgId on every query
OrgMembershipSchema.plugin(tenantIsolationPlugin);
