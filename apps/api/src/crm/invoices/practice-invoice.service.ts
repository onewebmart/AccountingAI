import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import {
  FirmService,
  MessageChannel,
  MessageTemplateKey,
  PracticeInvoiceStatus,
  ReminderRung,
} from '@ai-accounting/shared';
import {
  PracticeInvoice,
  PracticeInvoiceDocument,
} from '../schemas/practice-invoice.schema';
import { Counter, CounterDocument } from '../../gl/schemas/counter.schema';
import { Organization, OrganizationDocument } from '../../tenancy/schemas/organization.schema';
import { Firm, FirmDocument } from '../../tenancy/schemas/firm.schema';
import { AuditLog, AuditLogDocument } from '../../gl/schemas/audit-log.schema';
import { MessagingService } from '../messaging/messaging.service';

export interface InvoiceLineInput {
  description: string;
  service?: FirmService;
  amountPaise: number;
}

export interface CreateInvoiceInput {
  firmId: string;
  clientOrgId: string;
  issueDate: string;
  dueDate: string;
  lines: InvoiceLineInput[];
  notes?: string;
}

export interface RecordPaymentInput {
  amountPaise: number;
  receivedOn: string;
  reference?: string;
  actorId: string;
}

/** Ageing buckets, by days past the due date. */
export interface AgeingSummary {
  totalBilledPaise: number;
  collectedPaise: number;
  outstandingPaise: number;
  buckets: {
    notYetDuePaise: number;
    days0to30Paise: number;
    days31to60Paise: number;
    days61to90Paise: number;
    over90Paise: number;
  };
}

export interface CollectionRun {
  remindersQueued: number;
  skippedNoContact: number;
  escalated: number;
}

/** Days relative to the due date at which each rung fires. */
const RUNG_OFFSETS: { rung: ReminderRung; daysFromDue: number }[] = [
  { rung: ReminderRung.BEFORE_DUE, daysFromDue: -7 },
  { rung: ReminderRung.ON_DUE, daysFromDue: 0 },
  { rung: ReminderRung.OVERDUE_7, daysFromDue: 7 },
  { rung: ReminderRung.OVERDUE_15, daysFromDue: 15 },
];

/** Statuses that still owe money. */
const OPEN_STATUSES = [
  PracticeInvoiceStatus.SENT,
  PracticeInvoiceStatus.PARTIALLY_PAID,
  PracticeInvoiceStatus.OVERDUE,
  PracticeInvoiceStatus.LEGAL_NOTICE,
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

function formatDateForClient(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Display only — storage and arithmetic stay in integer paise (Invariant 1). */
function formatRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

/**
 * Readable service names for client-facing copy. A client reading a WhatsApp
 * should see "GST filing", not the enum constant GST_FILING.
 */
const SERVICE_LABELS: Record<FirmService, string> = {
  [FirmService.GST_FILING]: 'GST filing',
  [FirmService.ITR]: 'ITR filing',
  [FirmService.TDS]: 'TDS return',
  [FirmService.ROC_MCA]: 'ROC filing',
  [FirmService.AUDIT]: 'audit',
  [FirmService.BOOKKEEPING]: 'bookkeeping',
};

/** Indian financial year (1 Apr – 31 Mar) containing an ISO date. */
export function financialYearForDate(dateIso: string): string {
  const [year, month] = dateIso.split('-').map(Number);
  const startYear = month >= 4 ? year : year - 1;
  return `FY${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

@Injectable()
export class PracticeInvoiceService {
  private readonly logger = new Logger(PracticeInvoiceService.name);

  constructor(
    @InjectModel(PracticeInvoice.name) private invoiceModel: Model<PracticeInvoiceDocument>,
    @InjectModel(Counter.name) private counterModel: Model<CounterDocument>,
    @InjectModel(Organization.name) private orgModel: Model<OrganizationDocument>,
    @InjectModel(Firm.name) private firmModel: Model<FirmDocument>,
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
    @InjectConnection() private connection: Connection,
    private messaging: MessagingService,
  ) {}

  /**
   * Raises an invoice with a gapless number.
   *
   * Invariant 7: the counter `$inc` and the invoice insert share one
   * transaction, so a crash between them cannot burn a number, and concurrent
   * requests cannot collide. The unique index on (firmId, invoiceNumber) is the
   * database-level backstop.
   */
  async create(input: CreateInvoiceInput): Promise<PracticeInvoiceDocument> {
    if (input.lines.length === 0) {
      throw new BadRequestException('An invoice needs at least one line.');
    }
    for (const line of input.lines) {
      if (!Number.isInteger(line.amountPaise) || line.amountPaise < 0) {
        throw new BadRequestException(
          `Line "${line.description}": amountPaise must be a non-negative integer number of paise`,
        );
      }
    }
    if (input.dueDate < input.issueDate) {
      throw new BadRequestException('An invoice cannot fall due before it is issued.');
    }

    const client = await this.orgModel.findById(input.clientOrgId).exec();
    if (!client) throw new NotFoundException('Client not found');
    // Organization is the tenant root and carries no firm scope, so the link
    // has to be checked explicitly — see the same guard on document requests.
    if (client.firmId?.toString() !== input.firmId) {
      throw new NotFoundException('Client not found');
    }

    const financialYear = financialYearForDate(input.issueDate);
    const totalPaise = input.lines.reduce((sum, l) => sum + l.amountPaise, 0);

    const session = await this.connection.startSession();
    let invoice: PracticeInvoiceDocument | undefined;

    try {
      await session.withTransaction(async () => {
        const counterId = `firm:${input.firmId}:PRACTICE_INVOICE:${financialYear}`;
        const counter = await this.counterModel
          .findByIdAndUpdate(counterId, { $inc: { seq: 1 } }, { upsert: true, new: true, session })
          .exec();

        if (!counter) throw new Error('Failed to allocate an invoice number.');

        const created = await this.invoiceModel.create(
          [
            {
              firmId: new Types.ObjectId(input.firmId),
              clientOrgId: client._id,
              clientName: client.name,
              invoiceNumber: `INV-${financialYear.slice(2)}-${String(counter.seq).padStart(4, '0')}`,
              financialYear,
              sequence: counter.seq,
              issueDate: input.issueDate,
              dueDate: input.dueDate,
              lines: input.lines,
              totalPaise,
              paidPaise: 0,
              status: PracticeInvoiceStatus.DRAFT,
              notes: input.notes,
            },
          ],
          { session },
        );

        invoice = created[0];
      });
    } finally {
      await session.endSession();
    }

    if (!invoice) throw new Error('Invoice creation failed.');

    this.logger.log(`Raised ${invoice.invoiceNumber} for ${client.name} (${formatRupees(totalPaise)})`);
    return invoice;
  }

  async list(filter: { status?: PracticeInvoiceStatus } = {}): Promise<PracticeInvoiceDocument[]> {
    const query: Record<string, unknown> = {};
    if (filter.status) query.status = filter.status;
    return this.invoiceModel.find(query).sort({ dueDate: 1 }).exec();
  }

  async findById(id: string): Promise<PracticeInvoiceDocument> {
    const invoice = await this.invoiceModel.findById(id).exec();
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  /** Moves a draft to SENT, which is what starts the collection ladder. */
  async issue(id: string, actorId: string): Promise<PracticeInvoiceDocument> {
    const invoice = await this.findById(id);

    if (invoice.status !== PracticeInvoiceStatus.DRAFT) {
      throw new BadRequestException(
        `Only a draft can be issued — ${invoice.invoiceNumber} is ${invoice.status}.`,
      );
    }

    invoice.status = PracticeInvoiceStatus.SENT;
    await invoice.save();

    await this.audit(invoice, 'practice_invoice_issued', actorId, {
      totalPaise: invoice.totalPaise,
    });

    return invoice;
  }

  /**
   * Records a receipt against an invoice.
   *
   * Overpayment is refused rather than silently absorbed — a payment larger
   * than the balance is a data-entry error worth surfacing, not something to
   * quietly round away.
   */
  async recordPayment(id: string, input: RecordPaymentInput): Promise<PracticeInvoiceDocument> {
    if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
      throw new BadRequestException('amountPaise must be a positive integer number of paise');
    }

    const invoice = await this.findById(id);

    if (invoice.status === PracticeInvoiceStatus.DRAFT) {
      throw new BadRequestException('Issue the invoice before recording a payment against it.');
    }
    if (invoice.status === PracticeInvoiceStatus.CANCELLED) {
      throw new BadRequestException('This invoice was cancelled.');
    }

    const balance = invoice.totalPaise - invoice.paidPaise;
    if (input.amountPaise > balance) {
      throw new BadRequestException(
        `Payment of ${formatRupees(input.amountPaise)} exceeds the ${formatRupees(balance)} still outstanding on ${invoice.invoiceNumber}.`,
      );
    }

    invoice.payments.push({
      amountPaise: input.amountPaise,
      receivedOn: input.receivedOn,
      reference: input.reference,
      recordedBy: input.actorId,
      recordedAt: new Date(),
    });
    invoice.paidPaise += input.amountPaise;

    invoice.status =
      invoice.paidPaise >= invoice.totalPaise
        ? PracticeInvoiceStatus.PAID
        : PracticeInvoiceStatus.PARTIALLY_PAID;

    await invoice.save();

    await this.audit(invoice, 'practice_invoice_payment', input.actorId, {
      amountPaise: input.amountPaise,
      paidPaise: invoice.paidPaise,
      status: invoice.status,
    });

    return invoice;
  }

  async cancel(id: string, actorId: string, reason?: string): Promise<PracticeInvoiceDocument> {
    const invoice = await this.findById(id);

    if (invoice.paidPaise > 0) {
      throw new BadRequestException(
        `${invoice.invoiceNumber} has payments recorded against it — raise a credit note instead of cancelling.`,
      );
    }

    invoice.status = PracticeInvoiceStatus.CANCELLED;
    await invoice.save();

    // The number is deliberately NOT reused: gapless means no gaps in the
    // sequence, not that every number ends up on a live invoice.
    await this.audit(invoice, 'practice_invoice_cancelled', actorId, { reason: reason ?? null });

    return invoice;
  }

  /** Outstanding money, bucketed by how late it is. */
  async ageing(today = todayIso()): Promise<AgeingSummary> {
    const invoices = await this.invoiceModel
      .find({ status: { $ne: PracticeInvoiceStatus.CANCELLED } })
      .exec();

    const summary: AgeingSummary = {
      totalBilledPaise: 0,
      collectedPaise: 0,
      outstandingPaise: 0,
      buckets: {
        notYetDuePaise: 0,
        days0to30Paise: 0,
        days31to60Paise: 0,
        days61to90Paise: 0,
        over90Paise: 0,
      },
    };

    for (const invoice of invoices) {
      // Drafts are not receivables yet — they have not been sent to anyone.
      if (invoice.status === PracticeInvoiceStatus.DRAFT) continue;

      summary.totalBilledPaise += invoice.totalPaise;
      summary.collectedPaise += invoice.paidPaise;

      const balance = invoice.totalPaise - invoice.paidPaise;
      if (balance <= 0) continue;

      summary.outstandingPaise += balance;

      const daysLate = daysBetween(invoice.dueDate, today);
      if (daysLate < 0) summary.buckets.notYetDuePaise += balance;
      else if (daysLate <= 30) summary.buckets.days0to30Paise += balance;
      else if (daysLate <= 60) summary.buckets.days31to60Paise += balance;
      else if (daysLate <= 90) summary.buckets.days61to90Paise += balance;
      else summary.buckets.over90Paise += balance;
    }

    return summary;
  }

  /**
   * Climbs the collection ladder for everything due today.
   *
   * Each rung fires at most once per invoice, so running this daily and by hand
   * on the same day chases nobody twice. Passing the last rung marks the
   * invoice for legal escalation — a flag for a human, not an automated threat.
   */
  async runCollections(firmId: string, today = todayIso()): Promise<CollectionRun> {
    const firm = await this.firmModel.findById(firmId).exec();
    const firmName = firm?.name ?? 'your CA firm';

    const invoices = await this.invoiceModel.find({ status: { $in: OPEN_STATUSES } }).exec();

    let remindersQueued = 0;
    let skippedNoContact = 0;
    let escalated = 0;

    for (const invoice of invoices) {
      const balance = invoice.totalPaise - invoice.paidPaise;
      if (balance <= 0) continue;

      const daysLate = daysBetween(invoice.dueDate, today);

      // Keep the status honest before deciding what to send.
      if (daysLate > 0 && invoice.status === PracticeInvoiceStatus.SENT) {
        invoice.status = PracticeInvoiceStatus.OVERDUE;
      }

      const rung = RUNG_OFFSETS.find((r) => r.daysFromDue === daysLate);

      if (daysLate > 15 && invoice.status !== PracticeInvoiceStatus.LEGAL_NOTICE) {
        invoice.status = PracticeInvoiceStatus.LEGAL_NOTICE;
        escalated++;
      }

      if (!rung) {
        await invoice.save();
        continue;
      }
      if (invoice.remindersSent.some((r) => r.rung === rung.rung)) {
        await invoice.save();
        continue;
      }

      const client = await this.orgModel.findById(invoice.clientOrgId).exec();
      const address = client?.whatsappNumber ?? client?.contactEmail;
      const channel = client?.whatsappNumber ? MessageChannel.WHATSAPP : MessageChannel.EMAIL;

      if (!address) {
        skippedNoContact++;
        await invoice.save();
        continue;
      }

      const overdue = rung.daysFromDue > 0;
      const services = invoice.lines
        .map((l) => l.service)
        .filter((s): s is FirmService => Boolean(s));
      const serviceSummary = services.length
        ? [...new Set(services)].map((s) => SERVICE_LABELS[s]).join(', ')
        : invoice.lines[0]?.description ?? 'professional fees';

      const message = await this.messaging.enqueue({
        firmId,
        channel,
        templateKey: overdue
          ? MessageTemplateKey.INVOICE_OVERDUE
          : MessageTemplateKey.INVOICE_DUE,
        recipientAddress: address,
        recipientName: client?.contactName ?? invoice.clientName,
        clientOrgId: invoice.clientOrgId.toString(),
        cause: { type: 'practiceInvoice', id: invoice._id.toString() },
        variables: overdue
          ? {
              clientName: client?.contactName ?? invoice.clientName,
              invoiceNumber: invoice.invoiceNumber,
              amount: formatRupees(balance),
              daysOverdue: String(daysLate),
              firmName,
            }
          : {
              clientName: client?.contactName ?? invoice.clientName,
              invoiceNumber: invoice.invoiceNumber,
              serviceSummary,
              amount: formatRupees(balance),
              dueDate: formatDateForClient(invoice.dueDate),
              firmName,
            },
      });

      invoice.remindersSent.push({ rung: rung.rung, messageId: message._id, sentAt: new Date() });
      await invoice.save();
      remindersQueued++;
    }

    return { remindersQueued, skippedNoContact, escalated };
  }

  /** Every firm with practice invoices — used by the daily cross-firm sweep. */
  async firmIdsWithInvoices(): Promise<string[]> {
    const ids = await this.invoiceModel.distinct('firmId').exec();
    return (ids as unknown[]).map((id) => String(id));
  }

  private async audit(
    invoice: PracticeInvoiceDocument,
    action: string,
    actorId: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogModel.create({
      orgId: invoice.clientOrgId.toString(),
      entityType: 'PracticeInvoice',
      entityId: invoice._id.toString(),
      action,
      performedBy: actorId,
      meta: { firmId: invoice.firmId.toString(), invoiceNumber: invoice.invoiceNumber, ...meta },
    });
  }
}
