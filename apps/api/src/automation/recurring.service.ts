import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditService } from '../gl/audit.service';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import {
  RecurringKind,
  RecurringTemplate,
  RecurringTemplateDocument,
} from './schemas/recurring-template.schema';
import { addDays, firstOccurrence, Frequency, nextOccurrence, todayIst } from './schedule';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** At most this many missed occurrences are drafted in one run, so a long-idle template cannot flood the queue. */
const MAX_CATCH_UP = 12;

export interface CreateRecurringInput {
  kind: RecurringKind;
  name: string;
  partyId: string;
  frequency: Frequency;
  dayOfMonth: number;
  startDate: string;
  endDate?: string | null;
  dueInDays?: number;
  amountsPaise: { taxableValue: number; cgst: number; sgst: number; igst: number; cess: number; total: number };
  lineItems?: Array<{
    description: string;
    hsnSac?: string | null;
    qty?: number;
    ratePaise: number;
    amountPaise: number;
    taxRatePct?: number;
  }>;
  isReverseCharge?: boolean;
  notes?: string | null;
}

export interface RecurringRun {
  drafted: Array<{ templateId: string; name: string; kind: RecurringKind; documentId: string; documentDate: string }>;
  failed: Array<{ templateId: string; name: string; error: string }>;
}

/**
 * Recurring bills and invoices.
 *
 * Each due date drafts the document — never posts it. Posting is a person's
 * call (Invariant 4 in spirit: the ledger moves when a human says so), and a
 * draft can still be corrected if this month's rent was different.
 */
@Injectable()
export class RecurringService {
  private readonly logger = new Logger(RecurringService.name);

  constructor(
    @InjectModel(RecurringTemplate.name) private templateModel: Model<RecurringTemplateDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    private bills: PurchaseBillsService,
    private invoices: SalesInvoicesService,
    private audit: AuditService,
  ) {}

  async create(orgId: string, actorId: string, input: CreateRecurringInput): Promise<RecurringTemplateDocument> {
    const a = input.amountsPaise;
    const parts = [a.taxableValue, a.cgst, a.sgst, a.igst, a.cess, a.total];
    if (!parts.every((p) => Number.isInteger(p) && p >= 0)) {
      throw new BadRequestException('Amounts must be whole paise, zero or more.');
    }
    if (a.taxableValue + a.cgst + a.sgst + a.igst + a.cess !== a.total) {
      throw new BadRequestException('The total must be the taxable value plus the taxes.');
    }
    if (a.total <= 0) throw new BadRequestException('A recurring document needs an amount.');
    if (!DATE.test(input.startDate)) throw new BadRequestException('startDate must be a date like 2026-10-01');
    if (input.endDate && (!DATE.test(input.endDate) || input.endDate < input.startDate)) {
      throw new BadRequestException('endDate must be a date on or after startDate');
    }
    if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31) {
      throw new BadRequestException('dayOfMonth must be 1 to 31; 31 means the last day of the month');
    }
    if (input.kind === 'invoice' && input.isReverseCharge) {
      throw new BadRequestException('Reverse charge applies to bills, not invoices.');
    }
    await this.party(orgId, input.kind, input.partyId);

    const nextRunDate = firstOccurrence(input.startDate, input.dayOfMonth, input.frequency);
    if (input.endDate && nextRunDate > input.endDate) {
      throw new BadRequestException(`The first one would fall on ${nextRunDate}, after the end date.`);
    }

    const template = await this.templateModel.create({
      orgId,
      kind: input.kind,
      name: input.name.trim(),
      partyId: new Types.ObjectId(input.partyId),
      frequency: input.frequency,
      dayOfMonth: input.dayOfMonth,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      nextRunDate,
      dueInDays: input.dueInDays ?? 15,
      amountsPaise: a,
      lineItems: input.lineItems ?? [],
      isReverseCharge: input.isReverseCharge ?? false,
      notes: input.notes ?? null,
      status: 'active',
      createdBy: actorId,
    });
    await this.audit.record({
      orgId,
      entityType: 'RecurringTemplate',
      entityId: template._id.toString(),
      action: 'CREATE',
      performedBy: actorId,
      after: { kind: template.kind, name: template.name, frequency: template.frequency, nextRunDate, totalPaise: a.total },
    });
    return template;
  }

  async list(orgId: string) {
    const templates = await this.templateModel.find({ orgId }).sort({ status: 1, nextRunDate: 1 }).lean().exec();
    const ids = (kind: RecurringKind) => templates.filter((t) => t.kind === kind).map((t) => t.partyId);
    const [vendors, customers] = await Promise.all([
      this.vendorModel.find({ orgId, _id: { $in: ids('bill') } }).lean().exec(),
      this.customerModel.find({ orgId, _id: { $in: ids('invoice') } }).lean().exec(),
    ]);
    const names = new Map([...vendors, ...customers].map((p) => [p._id.toString(), p.name]));
    return templates.map((t) => ({
      _id: t._id.toString(),
      kind: t.kind,
      name: t.name,
      partyId: t.partyId.toString(),
      partyName: names.get(t.partyId.toString()) ?? 'Unknown',
      frequency: t.frequency,
      dayOfMonth: t.dayOfMonth,
      startDate: t.startDate,
      endDate: t.endDate,
      nextRunDate: t.nextRunDate,
      dueInDays: t.dueInDays,
      totalPaise: t.amountsPaise.total,
      amountsPaise: t.amountsPaise,
      isReverseCharge: t.isReverseCharge,
      status: t.status,
      draftedCount: t.generated.length,
      lastDraftedOn: t.generated.at(-1)?.documentDate ?? null,
      lastError: t.lastError,
    }));
  }

  /**
   * Pause, resume or end a template. Resuming picks up from the next date on
   * or after today: the months it was paused are skipped, not drafted in a
   * burst.
   */
  async setStatus(
    orgId: string,
    id: string,
    actorId: string,
    status: 'active' | 'paused' | 'ended',
    today = todayIst(),
  ): Promise<RecurringTemplateDocument> {
    const template = await this.templateModel.findOne({ _id: id, orgId }).exec();
    if (!template) throw new NotFoundException('Recurring template not found');
    if (template.status === 'ended') throw new BadRequestException('This template has ended. Create a new one.');
    if (template.status === status) return template;

    const before = { status: template.status, nextRunDate: template.nextRunDate };
    template.status = status;
    if (status === 'ended') {
      template.nextRunDate = null;
    } else if (status === 'active') {
      // Step the old cadence past today, so a quarterly one keeps its months.
      let next = template.nextRunDate ?? firstOccurrence(template.startDate, template.dayOfMonth, template.frequency);
      while (next < today) next = nextOccurrence(next, template.dayOfMonth, template.frequency);
      if (template.endDate && next > template.endDate) {
        template.status = 'ended';
        template.nextRunDate = null;
      } else {
        template.nextRunDate = next;
      }
    }
    await template.save();
    await this.audit.record({
      orgId,
      entityType: 'RecurringTemplate',
      entityId: id,
      action: 'UPDATE',
      performedBy: actorId,
      before,
      after: { status: template.status, nextRunDate: template.nextRunDate },
    });
    return template;
  }

  /**
   * Drafts every document due on or before `today`.
   *
   * Each occurrence is claimed first, by moving nextRunDate on only if it is
   * still the date this run read. Two sweeps at once therefore cannot draft
   * the same month twice. If drafting then fails, the claim is handed back so
   * tomorrow's run tries again.
   */
  async runDue(
    orgId: string,
    today = todayIst(),
    actorId = 'system:recurring',
    kinds: RecurringKind[] = ['bill', 'invoice'],
  ): Promise<RecurringRun> {
    const run: RecurringRun = { drafted: [], failed: [] };
    const due = await this.templateModel
      .find({ orgId, kind: { $in: kinds }, status: 'active', nextRunDate: { $ne: null, $lte: today } })
      .exec();

    for (const template of due) {
      for (let i = 0; i < MAX_CATCH_UP; i++) {
        const current = await this.templateModel.findOne({ _id: template._id, orgId }).lean().exec();
        const date = current?.nextRunDate;
        if (!current || current.status !== 'active' || !date || date > today) break;

        const following = nextOccurrence(date, current.dayOfMonth, current.frequency);
        const ends = !!current.endDate && following > current.endDate;
        const claimed = await this.templateModel
          .findOneAndUpdate(
            { _id: current._id, orgId, status: 'active', nextRunDate: date },
            { $set: { nextRunDate: ends ? null : following, status: ends ? 'ended' : 'active' } },
          )
          .exec();
        if (!claimed) break;

        try {
          const documentId = await this.draft(orgId, current, date, actorId);
          await this.templateModel.updateOne(
            { _id: current._id, orgId },
            { $push: { generated: { documentId, documentDate: date, createdAt: new Date() } }, $set: { lastError: null } },
          );
          run.drafted.push({ templateId: current._id.toString(), name: current.name, kind: current.kind, documentId: documentId.toString(), documentDate: date });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          await this.templateModel.updateOne(
            { _id: current._id, orgId, nextRunDate: ends ? null : following },
            { $set: { nextRunDate: date, status: 'active', lastError: error } },
          );
          run.failed.push({ templateId: current._id.toString(), name: current.name, error });
          this.logger.warn(`Recurring ${current._id} could not draft ${date}: ${error}`);
          break;
        }
      }
    }
    return run;
  }

  /** Bill or invoice: which rights a change to this template needs. */
  async kindOf(orgId: string, id: string): Promise<RecurringKind> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Recurring template not found');
    const template = await this.templateModel.findOne({ _id: id, orgId }, { kind: 1 }).lean().exec();
    if (!template) throw new NotFoundException('Recurring template not found');
    return template.kind;
  }

  /** Every org with a template due by `today`, for the daily sweep. */
  async orgIdsDue(today = todayIst()): Promise<string[]> {
    return this.templateModel.distinct('orgId', { status: 'active', nextRunDate: { $ne: null, $lte: today } }).exec();
  }

  private async draft(
    orgId: string,
    t: RecurringTemplate & { _id: Types.ObjectId },
    date: string,
    actorId: string,
  ): Promise<Types.ObjectId> {
    const common = {
      orgId,
      actorId,
      dueDate: addDays(date, t.dueInDays),
      amountsPaise: t.amountsPaise,
      lineItems: t.lineItems,
      notes: t.notes ? `${t.name} — ${t.notes}` : t.name,
      recurringTemplateId: t._id.toString(),
    };
    if (t.kind === 'bill') {
      const bill = await this.bills.create({
        ...common,
        vendorId: t.partyId.toString(),
        billDate: date,
        isReverseCharge: t.isReverseCharge,
      });
      return bill._id;
    }
    const invoice = await this.invoices.create({ ...common, customerId: t.partyId.toString(), invoiceDate: date });
    return invoice._id;
  }

  private async party(orgId: string, kind: RecurringKind, partyId: string) {
    if (!Types.ObjectId.isValid(partyId)) throw new BadRequestException('partyId is not a valid id');
    const found =
      kind === 'bill'
        ? await this.vendorModel.findOne({ _id: partyId, orgId }).lean().exec()
        : await this.customerModel.findOne({ _id: partyId, orgId }).lean().exec();
    if (!found) throw new NotFoundException(kind === 'bill' ? 'Vendor not found' : 'Customer not found');
  }
}
