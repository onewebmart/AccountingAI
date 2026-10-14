import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import { InvoiceStatus, MessageChannel } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { outstandingPaise } from '../gl/schemas/settlement.schema';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import { MESSAGING_PROVIDER, MessagingProvider } from '../crm/messaging/messaging.provider.interface';
import {
  PaymentReminder,
  PaymentReminderDocument,
  REMINDER_LADDER,
  ReminderRung,
} from './schemas/payment-reminder.schema';
import { ReminderSettings, ReminderSettingsDocument } from './schemas/reminder-settings.schema';
import { daysBetween, todayIst } from './schedule';

export const BOOKS_AUTOMATION_QUEUE = 'books-automation';
export const SEND_REMINDER_JOB = 'send-reminder';
export const DAILY_BOOKS_JOB = 'daily-books-sweep';

export interface SendReminderJob {
  reminderId: string;
  orgId: string;
}

/** Open invoices: sent to the customer and not yet paid in full. */
const OPEN = [InvoiceStatus.SENT, InvoiceStatus.POSTED];

/** A person can chase the same invoice at most once in this window. */
const MANUAL_GAP_MS = 20 * 60 * 60 * 1000;

function rupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(paise / 100);
}

function longDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The words of a reminder. Polite before the due date and firm after it.
 * Every reminder says what to ignore if the money has already gone.
 */
export function composeReminder(input: {
  rung: ReminderRung;
  customerName: string;
  orgName: string;
  invoiceNumber: string;
  outstandingPaise: number;
  dueDate: string;
  daysLate: number;
}): { subject: string; body: string } {
  const { customerName, orgName, invoiceNumber, daysLate } = input;
  const amount = rupees(input.outstandingPaise);
  const due = longDate(input.dueDate);
  const late = input.rung.startsWith('late_') || (input.rung === 'manual' && daysLate > 0);
  const today = input.rung === 'on_due' || (input.rung === 'manual' && daysLate === 0);

  const subject = late
    ? `Invoice ${invoiceNumber} is ${daysLate} day${daysLate === 1 ? '' : 's'} overdue`
    : today
      ? `Invoice ${invoiceNumber} is due today`
      : `Invoice ${invoiceNumber} is due on ${due}`;
  const middle = late
    ? `Invoice ${invoiceNumber} was due on ${due}, and ${amount} is still outstanding. Please arrange the payment at the earliest.`
    : today
      ? `Invoice ${invoiceNumber} for ${amount} is due today.`
      : `This is a reminder that invoice ${invoiceNumber} for ${amount} is due on ${due}.`;
  const body = [
    `Dear ${customerName},`,
    '',
    middle,
    '',
    'If you have already paid, thank you, and please ignore this message.',
    '',
    'Regards,',
    orgName,
  ].join('\n');
  return { subject, body };
}

/**
 * Payment reminders to customers: a ladder the daily job climbs (three days
 * before the due date, on it, and 7, 15 and 30 days after), and a button for
 * chasing one invoice now.
 *
 * Each rung goes out once per invoice. Nothing is sent from a request: the
 * reminder is written, and a queued job hands it to the messaging adapter,
 * which is the mock until a real WhatsApp or email provider is configured.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    @InjectModel(PaymentReminder.name) private reminderModel: Model<PaymentReminderDocument>,
    @InjectModel(ReminderSettings.name) private settingsModel: Model<ReminderSettingsDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(OrgSettings.name) private orgSettingsModel: Model<OrgSettingsDocument>,
    @InjectQueue(BOOKS_AUTOMATION_QUEUE) private queue: Queue<SendReminderJob>,
    @Inject(MESSAGING_PROVIDER) private provider: MessagingProvider,
    private audit: AuditService,
  ) {}

  async settings(orgId: string) {
    const s = await this.settingsModel.findOne({ orgId }).lean().exec();
    return {
      enabled: s?.enabled ?? false,
      channel: s?.channel ?? 'auto',
      provider: this.provider.name,
      ladder: REMINDER_LADDER,
    };
  }

  async updateSettings(orgId: string, actorId: string, patch: { enabled?: boolean; channel?: 'auto' | 'email' | 'whatsapp' }) {
    const before = await this.settings(orgId);
    await this.settingsModel
      .findOneAndUpdate(
        { orgId },
        { $set: { ...patch, updatedBy: actorId }, $setOnInsert: { orgId } },
        { upsert: true, new: true },
      )
      .exec();
    const after = await this.settings(orgId);
    await this.audit.record({
      orgId,
      entityType: 'ReminderSettings',
      entityId: orgId,
      action: 'UPDATE',
      performedBy: actorId,
      before: { enabled: before.enabled, channel: before.channel },
      after: { enabled: after.enabled, channel: after.channel },
    });
    return after;
  }

  /**
   * Climbs the ladder for every open invoice. An invoice is sent the highest
   * rung it has reached, if that one has not gone yet. So switching reminders
   * on for an invoice already 40 days late sends one 30-day reminder, not five.
   */
  async runDue(orgId: string, today = todayIst()) {
    const settings = await this.settings(orgId);
    if (!settings.enabled) return { enabled: false, queued: 0, noContact: [] as Array<{ customerName: string; invoiceNumber: string }> };

    const invoices = await this.invoiceModel.find({ orgId, status: { $in: OPEN }, dueDate: { $ne: null } }).exec();
    const customers = await this.customers(orgId, invoices.map((i) => i.customerId));
    const orgName = await this.orgName(orgId);
    const noContact: Array<{ customerName: string; invoiceNumber: string }> = [];
    let queued = 0;

    for (const invoice of invoices) {
      const owed = outstandingPaise(invoice);
      if (owed <= 0) continue;
      const daysLate = daysBetween(invoice.dueDate!, today);
      const step = [...REMINDER_LADDER].reverse().find((r) => r.daysFromDue <= daysLate);
      if (!step) continue;
      if (await this.reminderModel.exists({ orgId, invoiceId: invoice._id, rung: step.rung, automatic: true })) continue;

      const customer = customers.get(invoice.customerId.toString());
      const contact = customer && this.contact(customer, settings.channel);
      if (!customer || !contact) {
        noContact.push({ customerName: customer?.name ?? 'Unknown customer', invoiceNumber: this.number(invoice) });
        continue;
      }
      const reminder = await this.write(orgId, invoice, customer.name, contact, step.rung, true, owed, daysLate, orgName, 'system:reminders');
      if (reminder) queued += 1;
    }
    return { enabled: true, queued, noContact };
  }

  /** Chase one invoice now, whatever the ladder says. A person's call, so it works with the ladder off. */
  async sendNow(orgId: string, invoiceId: string, actorId: string, today = todayIst()): Promise<PaymentReminderDocument> {
    if (!Types.ObjectId.isValid(invoiceId)) throw new NotFoundException('Invoice not found');
    const invoice = await this.invoiceModel.findOne({ _id: invoiceId, orgId }).exec();
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.PAID) throw new BadRequestException('This invoice is already paid.');
    if (!OPEN.includes(invoice.status)) throw new BadRequestException('Send or post the invoice before chasing payment on it.');
    const owed = outstandingPaise(invoice);
    if (owed <= 0) throw new BadRequestException('Nothing is outstanding on this invoice.');

    const recent = await this.reminderModel
      .findOne({ orgId, invoiceId: invoice._id, createdAt: { $gte: new Date(Date.now() - MANUAL_GAP_MS) } })
      .lean()
      .exec();
    if (recent) {
      throw new BadRequestException(`A reminder about this invoice went to ${recent.to} within the last day. Give them time to reply.`);
    }

    const customer = (await this.customers(orgId, [invoice.customerId])).get(invoice.customerId.toString());
    const settings = await this.settings(orgId);
    const contact = customer && this.contact(customer, settings.channel);
    if (!customer || !contact) {
      throw new BadRequestException(`${customer?.name ?? 'This customer'} has no email or phone number on record. Add one first.`);
    }
    const daysLate = invoice.dueDate ? daysBetween(invoice.dueDate, today) : 0;
    const reminder = await this.write(orgId, invoice, customer.name, contact, 'manual', false, owed, daysLate, await this.orgName(orgId), actorId);
    return reminder!;
  }

  async list(orgId: string, invoiceId?: string, limit = 50) {
    const filter: Record<string, unknown> = { orgId };
    if (invoiceId && Types.ObjectId.isValid(invoiceId)) filter.invoiceId = new Types.ObjectId(invoiceId);
    const reminders = await this.reminderModel.find(filter).sort({ createdAt: -1 }).limit(Math.min(limit, 200)).lean().exec();
    const [invoices, customers] = await Promise.all([
      this.invoiceModel.find({ orgId, _id: { $in: reminders.map((r) => r.invoiceId) } }).lean().exec(),
      this.customers(orgId, reminders.map((r) => r.customerId)),
    ]);
    const numbers = new Map(invoices.map((i) => [i._id.toString(), i.invoiceNumber ?? 'Unnumbered']));
    return reminders.map((r) => ({
      _id: r._id.toString(),
      invoiceId: r.invoiceId.toString(),
      invoiceNumber: numbers.get(r.invoiceId.toString()) ?? '—',
      customerName: customers.get(r.customerId.toString())?.name ?? 'Unknown customer',
      rung: r.rung,
      automatic: r.automatic,
      channel: r.channel,
      to: r.to,
      subject: r.subject,
      body: r.body,
      outstandingPaise: r.outstandingPaise,
      status: r.status,
      isMock: r.isMock,
      error: r.error,
      createdAt: (r as unknown as { createdAt: Date }).createdAt,
      sentAt: r.sentAt,
    }));
  }

  /**
   * Hands one reminder to the messaging adapter. Called only from the queue
   * processor. Throws on failure so BullMQ retries; the reminder records why.
   */
  async deliver(reminderId: string): Promise<void> {
    const reminder = await this.reminderModel.findById(reminderId).exec();
    if (!reminder || reminder.status === 'sent') return;
    try {
      const result = await this.provider.send({
        channel: reminder.channel === 'email' ? MessageChannel.EMAIL : MessageChannel.WHATSAPP,
        to: reminder.to,
        subject: reminder.subject ?? undefined,
        body: reminder.body,
      });
      reminder.status = 'sent';
      reminder.providerMessageId = result.providerMessageId ?? null;
      reminder.isMock = result.isMock;
      reminder.sentAt = new Date();
      reminder.error = null;
      await reminder.save();
    } catch (err) {
      reminder.status = 'failed';
      reminder.error = err instanceof Error ? err.message : String(err);
      await reminder.save();
      throw err;
    }
  }

  /** Every org with the ladder switched on, for the daily sweep. */
  async orgIdsEnabled(): Promise<string[]> {
    return this.settingsModel.distinct('orgId', { enabled: true }).exec();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async write(
    orgId: string,
    invoice: SalesInvoiceDocument,
    customerName: string,
    contact: { channel: 'email' | 'whatsapp'; to: string },
    rung: ReminderRung,
    automatic: boolean,
    owed: number,
    daysLate: number,
    orgName: string,
    actorId: string,
  ): Promise<PaymentReminderDocument | null> {
    const { subject, body } = composeReminder({
      rung,
      customerName,
      orgName,
      invoiceNumber: this.number(invoice),
      outstandingPaise: owed,
      dueDate: invoice.dueDate ?? invoice.invoiceDate,
      daysLate,
    });
    let reminder: PaymentReminderDocument;
    try {
      reminder = await this.reminderModel.create({
        orgId,
        invoiceId: invoice._id,
        customerId: invoice.customerId,
        rung,
        automatic,
        channel: contact.channel,
        to: contact.to,
        subject: contact.channel === 'email' ? subject : null,
        body,
        outstandingPaise: owed,
        createdBy: actorId,
      });
    } catch (err) {
      // Another sweep wrote this rung first: it is going out once already.
      if ((err as { code?: number }).code === 11000) return null;
      throw err;
    }
    await this.audit.record({
      orgId,
      entityType: 'SalesInvoice',
      entityId: invoice._id.toString(),
      action: 'REMIND',
      performedBy: actorId,
      after: { rung, channel: contact.channel, to: contact.to, outstandingPaise: owed, reminderId: reminder._id.toString() },
    });
    await this.queue.add(
      SEND_REMINDER_JOB,
      { reminderId: reminder._id.toString(), orgId },
      { jobId: reminder._id.toString(), attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: true },
    );
    return reminder;
  }

  private contact(customer: { email: string | null; phone: string | null }, channel: 'auto' | 'email' | 'whatsapp') {
    const email = customer.email?.trim() || null;
    const phone = customer.phone?.trim() || null;
    if ((channel === 'email' || channel === 'auto') && email) return { channel: 'email' as const, to: email };
    if ((channel === 'whatsapp' || channel === 'auto') && phone) return { channel: 'whatsapp' as const, to: phone };
    return null;
  }

  private async customers(orgId: string, ids: Types.ObjectId[]) {
    const found = await this.customerModel.find({ orgId, _id: { $in: ids } }).lean().exec();
    return new Map(found.map((c) => [c._id.toString(), c]));
  }

  private async orgName(orgId: string): Promise<string> {
    const s = await this.orgSettingsModel.findOne({ orgId }).lean().exec();
    return s?.displayName?.trim() || 'Accounts team';
  }

  private number(invoice: { invoiceNumber: string | null; invoiceDate: string }): string {
    return invoice.invoiceNumber ?? `dated ${invoice.invoiceDate}`;
  }
}
