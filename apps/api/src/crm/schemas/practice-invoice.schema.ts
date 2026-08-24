import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { FirmService, PracticeInvoiceStatus, ReminderRung } from '@ai-accounting/shared';
import { firmIsolationPlugin } from '../../database/tenant.plugin';

export type PracticeInvoiceDocument = HydratedDocument<PracticeInvoice>;

/** A billable line on a fee invoice. */
@Schema({ _id: false })
export class InvoiceLine {
  @Prop({ required: true }) description: string;

  /** Which service this line bills for — drives the service summary in reminders. */
  @Prop({ type: String, enum: Object.values(FirmService) })
  service?: FirmService;

  /**
   * Integer paise (Invariant 1). Validated here as well as in the service so no
   * write path can slip a float in.
   */
  @Prop({
    required: true,
    min: 0,
    validate: {
      validator: Number.isInteger,
      message: 'amountPaise must be an integer number of paise',
    },
  })
  amountPaise: number;
}

export const InvoiceLineSchema = SchemaFactory.createForClass(InvoiceLine);

/** A payment received against an invoice. */
@Schema({ _id: false })
export class Payment {
  @Prop({
    required: true,
    min: 1,
    validate: {
      validator: Number.isInteger,
      message: 'amountPaise must be an integer number of paise',
    },
  })
  amountPaise: number;

  /** YYYY-MM-DD. */
  @Prop({ required: true }) receivedOn: string;
  @Prop() reference?: string;
  @Prop({ required: true }) recordedBy: string;
  @Prop({ required: true }) recordedAt: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

/** A rung of the collection ladder that has already been climbed. */
@Schema({ _id: false })
export class SentCollectionReminder {
  @Prop({ type: String, enum: Object.values(ReminderRung), required: true })
  rung: ReminderRung;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'CrmMessage' })
  messageId?: Types.ObjectId;
  @Prop({ required: true }) sentAt: Date;
}

export const SentCollectionReminderSchema =
  SchemaFactory.createForClass(SentCollectionReminder);

/**
 * A fee invoice the firm raises on a client.
 *
 * Per decision D3 in the build plan these are practice-management records and
 * never post to the double-entry ledger — so Invariants 2 and 3 are not
 * engaged. Invariants 1 (integer paise) and 7 (gapless numbering) very much are.
 */
@Schema({ timestamps: true, collection: 'crm_practice_invoices' })
export class PracticeInvoice {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Firm', required: true, index: true })
  firmId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization', required: true, index: true })
  clientOrgId: Types.ObjectId;

  @Prop({ required: true })
  clientName: string;

  /**
   * Human-facing number, e.g. "INV-2026-27-0007". Gapless and unique per
   * (firm, financial year) — allocated from the counters collection inside the
   * same transaction as the insert (Invariant 7).
   */
  @Prop({ required: true, index: true })
  invoiceNumber: string;

  /** Financial year the number belongs to, e.g. "FY2026-27". */
  @Prop({ required: true })
  financialYear: string;

  /** The raw sequence, kept so gaplessness is directly assertable. */
  @Prop({ required: true })
  sequence: number;

  /** YYYY-MM-DD. */
  @Prop({ required: true }) issueDate: string;
  @Prop({ required: true, index: true }) dueDate: string;

  @Prop({ type: [InvoiceLineSchema], required: true, default: [] })
  lines: InvoiceLine[];

  /** Sum of line amounts, in integer paise. Denormalised for listing and ageing. */
  @Prop({
    required: true,
    min: 0,
    validate: { validator: Number.isInteger, message: 'totalPaise must be an integer' },
  })
  totalPaise: number;

  @Prop({
    required: true,
    default: 0,
    min: 0,
    validate: { validator: Number.isInteger, message: 'paidPaise must be an integer' },
  })
  paidPaise: number;

  @Prop({ type: [PaymentSchema], default: [] })
  payments: Payment[];

  @Prop({
    type: String,
    enum: Object.values(PracticeInvoiceStatus),
    required: true,
    default: PracticeInvoiceStatus.DRAFT,
    index: true,
  })
  status: PracticeInvoiceStatus;

  @Prop({ type: [SentCollectionReminderSchema], default: [] })
  remindersSent: SentCollectionReminder[];

  @Prop() notes?: string;
}

export const PracticeInvoiceSchema = SchemaFactory.createForClass(PracticeInvoice);

PracticeInvoiceSchema.plugin(firmIsolationPlugin);

/**
 * Invariant 7's safety net: even if two requests raced past the counter, the
 * database refuses a duplicate number for a firm.
 */
PracticeInvoiceSchema.index({ firmId: 1, invoiceNumber: 1 }, { unique: true });

// The outstanding table reads "this firm's unpaid invoices, oldest due first".
PracticeInvoiceSchema.index({ firmId: 1, status: 1, dueDate: 1 });
