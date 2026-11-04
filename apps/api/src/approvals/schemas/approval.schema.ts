import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { tenantIsolationPlugin } from '../../database/tenant.plugin';

export type ApprovalDocType = 'bill' | 'payment' | 'journal' | 'expense_claim';

export type ApprovalPolicyDocument = HydratedDocument<ApprovalPolicy>;

/**
 * Who must approve what, before it posts. Several can apply: the strictest
 * wins. A high-risk document always needs two, whatever the policy says.
 */
@Schema({ collection: 'approval_policies', timestamps: true })
export class ApprovalPolicy {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, required: true, trim: true }) name: string;
  @Prop({ type: String, enum: ['bill', 'payment', 'journal', 'expense_claim'], required: true }) docType: ApprovalDocType;
  /** From this amount up (paise); 0 for everything. */
  @Prop({ type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'Money must be integer paise' } }) minAmountPaise: number;
  /** Only a vendor's first bill. */
  @Prop({ type: Boolean, default: false }) newVendorOnly: boolean;
  @Prop({ type: Number, enum: [1, 2], default: 1 }) approvalsRequired: 1 | 2;
  /** Roles that may approve; none set means anyone who may approve postings. */
  @Prop({ type: [String], default: [] }) approverRoles: string[];
  @Prop({ type: Boolean, default: true, index: true }) active: boolean;
  @Prop({ type: String, required: true }) createdBy: string;
}
export const ApprovalPolicySchema = SchemaFactory.createForClass(ApprovalPolicy);
ApprovalPolicySchema.plugin(tenantIsolationPlugin);

export type ApprovalRequestDocument = HydratedDocument<ApprovalRequest>;

/**
 * A document waiting for its approvals. Bills point at the draft; payments
 * and vouchers have no draft, so the request keeps what to post, and posts
 * it when the last approval comes.
 */
@Schema({ collection: 'approval_requests', timestamps: true })
export class ApprovalRequest {
  @Prop({ required: true, index: true }) orgId: string;
  @Prop({ type: String, enum: ['bill', 'payment', 'journal', 'expense_claim'], required: true }) docType: ApprovalDocType;
  /** The draft it is for, when there is one. */
  @Prop({ type: String, default: null, index: true }) docId: string | null;
  /** What to post on approval, when there is no draft: { kind, ... }. */
  @Prop({ type: Object, default: null }) payload: Record<string, unknown> | null;
  @Prop({ type: String, required: true }) summary: string;
  @Prop({ type: Number, required: true }) amountPaise: number;
  /** Who made it: they cannot approve it. */
  @Prop({ type: String, default: null }) makerId: string | null;
  @Prop({ type: Number, enum: [1, 2], required: true }) required: 1 | 2;
  @Prop({ type: [String], default: [] }) approverRoles: string[];
  @Prop({ type: [String], default: [] }) policyNames: string[];
  @Prop({ type: Object, required: true }) risk: { score: number; level: 'low' | 'medium' | 'high'; reasons: string[] };
  @Prop({ type: [{ userId: String, role: String, at: Date, note: String }], default: [] }) approvals: Array<{ userId: string; role: string; at: Date; note: string | null }>;
  @Prop({ type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true }) status: 'pending' | 'approved' | 'rejected';
  @Prop({ type: Date, default: null }) postedAt: Date | null;
  /** What posting it made: the journal, payment or bill. */
  @Prop({ type: String, default: null }) result: string | null;
  @Prop({ type: String, default: null }) lastError: string | null;
  @Prop({ type: String, default: null }) rejectedBy: string | null;
  @Prop({ type: String, default: null }) rejectionReason: string | null;
}
export const ApprovalRequestSchema = SchemaFactory.createForClass(ApprovalRequest);
ApprovalRequestSchema.plugin(tenantIsolationPlugin);
