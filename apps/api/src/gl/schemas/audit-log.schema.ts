import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

/**
 * Audit log — append-only record of every state change.
 * orgId is stored for tenant-scoped queries but the collection itself
 * is NOT tenant-isolated (platform admins need cross-org audit access).
 */
@Schema({ timestamps: true, collection: 'auditLogs' })
export class AuditLog {
  @Prop({ required: true, index: true })
  orgId: string;

  @Prop({ required: true })
  entityType: string;

  @Prop({ required: true, index: true })
  entityId: string;

  @Prop({ required: true })
  action: string;

  @Prop({ required: true })
  performedBy: string;

  /** The entity's relevant fields before and after the change (Invariant 6). */
  @Prop({ type: Object, default: null })
  before?: Record<string, unknown> | null;

  @Prop({ type: Object, default: null })
  after?: Record<string, unknown> | null;

  @Prop({ type: Object })
  meta?: Record<string, unknown>;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

// Append-only: an audit trail that can be edited proves nothing.
AuditLogSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
    'deleteOne', 'deleteMany', 'findOneAndDelete'],
  function () {
    throw new Error('Audit log entries are append-only and cannot be changed or deleted.');
  },
);
