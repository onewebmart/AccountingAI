import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { ComplianceAuthority, ComplianceStatus, ComplianceType } from '@ai-accounting/shared';
import { firmIsolationPlugin } from '../../database/tenant.plugin';

export type ComplianceItemDocument = HydratedDocument<ComplianceItem>;

/** A reminder that has already gone out, so the daily job never repeats one. */
export class SentReminder {
  /** Days before the due date this reminder was for: 7, 3 or 1. */
  @Prop({ required: true }) offsetDays: number;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'CrmMessage' })
  messageId?: Types.ObjectId;
  @Prop({ required: true }) sentAt: Date;
}

/**
 * One statutory obligation, for one client, for one period.
 *
 * Modelled per-client rather than one row per (type, period) with embedded
 * clients: reminders, filing state and audit are all per-client, and the
 * dashboard's "14 clients pending" is a cheap group-by over these rows. At
 * ~250 clients x 5 obligations a month this stays small.
 */
@Schema({ timestamps: true, collection: 'crm_compliance_items' })
export class ComplianceItem {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Firm', required: true, index: true })
  firmId: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', required: true, index: true })
  clientOrgId: MongooseSchema.Types.ObjectId;

  /** Denormalised so deadline lists don't need a join per row. */
  @Prop({ required: true })
  clientName: string;

  @Prop({ type: String, enum: Object.values(ComplianceType), required: true, index: true })
  complianceType: ComplianceType;

  /**
   * Machine key for the period this filing covers — the idempotency handle for
   * the calendar generator. Monthly: "2026-08". Quarterly: "2026-Q2".
   * Annual: "FY2025-26".
   */
  @Prop({ required: true })
  periodKey: string;

  /** Human label for the UI, e.g. "August 2026" or "Q1 (Apr–Jun 2026)". */
  @Prop({ required: true })
  periodLabel: string;

  /** Statutory due date, YYYY-MM-DD — matches the date convention used elsewhere. */
  @Prop({ required: true, index: true })
  dueDate: string;

  @Prop({ type: String, enum: Object.values(ComplianceAuthority), required: true })
  authority: ComplianceAuthority;

  @Prop({
    type: String,
    enum: Object.values(ComplianceStatus),
    required: true,
    default: ComplianceStatus.PENDING,
    index: true,
  })
  status: ComplianceStatus;

  @Prop() filedAt?: Date;
  @Prop() filedBy?: string;

  @Prop({ type: [SentReminder], default: [] })
  remindersSent: SentReminder[];
}

export const ComplianceItemSchema = SchemaFactory.createForClass(ComplianceItem);

ComplianceItemSchema.plugin(firmIsolationPlugin);

/**
 * The generator's idempotency guarantee: re-running it can never duplicate an
 * obligation for the same client and period.
 */
ComplianceItemSchema.index(
  { firmId: 1, clientOrgId: 1, complianceType: 1, periodKey: 1 },
  { unique: true },
);

// Deadline lists are "this firm's items, soonest first".
ComplianceItemSchema.index({ firmId: 1, dueDate: 1, status: 1 });
