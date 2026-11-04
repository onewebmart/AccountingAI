import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import { InvoiceStatus } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { ItemsService } from '../items/items.service';
import { Item, ItemDocument } from '../items/schemas/item.schema';
import { nameKey } from '../items/hsn';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import { User, UserDocument } from '../tenancy/schemas/user.schema';
import { AiSuggestion, AiSuggestionDocument } from '../ai-suggestions/schemas/ai-suggestion.schema';
import { UsageMeterService } from '../ocr/usage-meter.service';
import { ManagementReportsService } from '../reports/management.service';
import { REPORT_MODEL, ReportModel } from '../reports/report-model';
import { addDays, todayIst } from '../automation/schedule';
import { docAmounts, isInterState, lineAmount } from '../orders/doc-lines';
import { Project, ProjectDocument } from './schemas/project.schema';
import { TimeEntry, TimeEntryDocument } from './schemas/time-entry.schema';
import { TimeGroup, budgetAlerts, groupTime, lineDescription, missingTimesheets, readTimeLines, timeLinesPrompt } from './time-billing';

export const PROJECT_AI_QUEUE = 'project-ai';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const paise = (v: number | null | undefined, what: string) => {
  if (v == null) return null;
  if (!Number.isInteger(v) || v < 0) throw new BadRequestException(`${what} is a whole number of paise, not negative.`);
  return v;
};

export interface ProjectInput {
  name?: string;
  code?: string | null;
  customerId?: string | null;
  billing?: 'time' | 'fixed';
  budgetPaise?: number | null;
  budgetHours?: number | null;
  ratePaise?: number | null;
  serviceItemId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
}

export interface TimeInput {
  projectId: string;
  date: string;
  hours: number;
  task: string;
  notes?: string | null;
  billable?: boolean;
  ratePaise?: number | null;
}

/**
 * Projects and the time logged on them. A project's income and costs come
 * from the lines tagged with it when they post; its unbilled time becomes a
 * draft invoice, which a person checks and posts like any other.
 */
@Injectable()
export class ProjectsService {
  constructor(
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(TimeEntry.name) private timeModel: Model<TimeEntryDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(Item.name) private itemModel: Model<ItemDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(OrgSettings.name) private settingsModel: Model<OrgSettingsDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(AiSuggestion.name) private suggestionModel: Model<AiSuggestionDocument>,
    @InjectQueue(PROJECT_AI_QUEUE) private queue: Queue,
    @Inject(REPORT_MODEL) private model: ReportModel,
    private items: ItemsService,
    private invoices: SalesInvoicesService,
    private management: ManagementReportsService,
    private usageMeter: UsageMeterService,
    private audit: AuditService,
  ) {}

  // ── Projects ──────────────────────────────────────────────────────────

  async find(orgId: string, id: string): Promise<ProjectDocument> {
    const p = Types.ObjectId.isValid(id) ? await this.projectModel.findOne({ _id: id, orgId }).exec() : null;
    if (!p) throw new NotFoundException('No such project.');
    return p;
  }

  private async checked(orgId: string, input: ProjectInput) {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Give the project a name.');
    if (input.billing !== 'time' && input.billing !== 'fixed') throw new BadRequestException('Say whether it is billed by time or for a fixed fee.');
    let customerId: Types.ObjectId | null = null;
    if (input.customerId) {
      const c = Types.ObjectId.isValid(input.customerId) ? await this.customerModel.findOne({ _id: input.customerId, orgId }, { _id: 1 }).lean().exec() : null;
      if (!c) throw new BadRequestException('No such customer.');
      customerId = c._id as Types.ObjectId;
    }
    let serviceItemId: Types.ObjectId | null = null;
    if (input.serviceItemId) {
      const item = Types.ObjectId.isValid(input.serviceItemId) ? await this.itemModel.findOne({ _id: input.serviceItemId, orgId }).lean().exec() : null;
      if (!item) throw new BadRequestException('No such item.');
      if (item.kind !== 'service') throw new BadRequestException(`${item.name} is goods; time is invoiced as a service.`);
      serviceItemId = item._id as Types.ObjectId;
    }
    for (const d of [input.startDate, input.endDate]) if (d && !DATE.test(d)) throw new BadRequestException('Dates look like 2026-11-04.');
    if (input.budgetHours != null && !(input.budgetHours >= 0)) throw new BadRequestException('Budgeted hours are not negative.');
    return {
      name, nameKey: nameKey(name), code: input.code?.trim() || null, customerId, billing: input.billing,
      budgetPaise: paise(input.budgetPaise, 'The budget'), budgetHours: input.budgetHours ?? null, ratePaise: paise(input.ratePaise, 'The rate'), serviceItemId,
      startDate: input.startDate || null, endDate: input.endDate || null, notes: input.notes?.trim() || null,
    };
  }

  async create(orgId: string, actorId: string, input: ProjectInput) {
    const fields = await this.checked(orgId, input);
    try {
      const p = await this.projectModel.create({ orgId, ...fields, createdBy: actorId });
      await this.audit.record({ orgId, entityType: 'Project', entityId: p._id.toString(), action: 'CREATE', performedBy: actorId, after: { ...fields, customerId: fields.customerId ? String(fields.customerId) : null } });
      return p;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictException(`A project called "${fields.name}" already exists.`);
      throw err;
    }
  }

  async update(orgId: string, actorId: string, id: string, input: ProjectInput) {
    const p = await this.find(orgId, id);
    const before = p.toObject();
    const fields = await this.checked(orgId, {
      name: p.name, code: p.code, customerId: p.customerId ? String(p.customerId) : null, billing: p.billing, budgetPaise: p.budgetPaise, budgetHours: p.budgetHours,
      ratePaise: p.ratePaise, serviceItemId: p.serviceItemId ? String(p.serviceItemId) : null, startDate: p.startDate, endDate: p.endDate, notes: p.notes, ...input,
    });
    p.set(fields);
    try {
      await p.save();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictException(`A project called "${fields.name}" already exists.`);
      throw err;
    }
    await this.audit.record({ orgId, entityType: 'Project', entityId: id, action: 'UPDATE', performedBy: actorId, before: { name: before.name, billing: before.billing, budgetPaise: before.budgetPaise, ratePaise: before.ratePaise }, after: { name: p.name, billing: p.billing, budgetPaise: p.budgetPaise, ratePaise: p.ratePaise } });
    return p;
  }

  async setStatus(orgId: string, actorId: string, id: string, status: 'active' | 'on_hold' | 'completed') {
    const p = await this.find(orgId, id);
    const before = p.status;
    p.status = status;
    await p.save();
    await this.audit.record({ orgId, entityType: 'Project', entityId: id, action: 'STATUS', performedBy: actorId, before: { status: before }, after: { status } });
    return p;
  }

  /** Every project with its income, costs, hours, unbilled time and budget alerts. */
  async list(orgId: string): Promise<Array<Record<string, unknown>>> {
    const [projects, figures] = await Promise.all([this.projectModel.find({ orgId }).sort({ status: 1, name: 1 }).lean().exec(), this.management.projectFigures(orgId)]);
    const customers = await this.customerModel.find({ orgId, _id: { $in: projects.map((p) => p.customerId).filter(Boolean) } }, { name: 1 }).lean().exec();
    const customerName = new Map(customers.map((c) => [String(c._id), c.name]));
    return projects.map((p) => {
      const f = figures.get(String(p._id)) ?? { incomePaise: 0, costPaise: 0, hours: 0, unbilledHours: 0, unbilledPaise: 0 };
      return {
        id: String(p._id), name: p.name, code: p.code, status: p.status, billing: p.billing,
        customerId: p.customerId ? String(p.customerId) : null, customerName: p.customerId ? customerName.get(String(p.customerId)) ?? null : null,
        budgetPaise: p.budgetPaise, budgetHours: p.budgetHours, ratePaise: p.ratePaise, serviceItemId: p.serviceItemId ? String(p.serviceItemId) : null,
        startDate: p.startDate, endDate: p.endDate, notes: p.notes, ...f, profitPaise: f.incomePaise - f.costPaise,
        alerts: budgetAlerts({ billing: p.billing, budgetPaise: p.budgetPaise, budgetHours: p.budgetHours, hours: f.hours, billedPaise: f.incomePaise, unbilledPaise: f.unbilledPaise, costPaise: f.costPaise }),
      };
    });
  }

  // ── Time ──────────────────────────────────────────────────────────────

  async logTime(orgId: string, userId: string, input: TimeInput) {
    const p = await this.find(orgId, input.projectId);
    if (p.status === 'completed') throw new BadRequestException(`${p.name} is completed: reopen it to log time.`);
    if (!DATE.test(input.date ?? '')) throw new BadRequestException('date must look like 2026-11-04');
    if (input.date > todayIst()) throw new BadRequestException('Time is logged for today or before.');
    if (!input.task?.trim()) throw new BadRequestException('Say what the time was spent on.');
    const user = Types.ObjectId.isValid(userId) ? await this.userModel.findById(userId, { name: 1, email: 1 }).lean().exec() : null;
    const t = await this.timeModel.create({
      orgId, projectId: p._id, userId, userName: user?.name || user?.email || 'Someone', date: input.date, hours: input.hours, task: input.task.trim().slice(0, 80),
      notes: input.notes?.trim().slice(0, 1000) || null, billable: input.billable ?? p.billing === 'time', ratePaise: paise(input.ratePaise, 'The rate'),
    });
    await this.audit.record({ orgId, entityType: 'TimeEntry', entityId: t._id.toString(), action: 'CREATE', performedBy: userId, after: { project: p.name, date: t.date, hours: t.hours, task: t.task, billable: t.billable } });
    return t;
  }

  private async ownUnbilled(orgId: string, userId: string, id: string) {
    const t = Types.ObjectId.isValid(id) ? await this.timeModel.findOne({ _id: id, orgId }).exec() : null;
    if (!t) throw new NotFoundException('No such time entry.');
    if (t.userId !== userId) throw new ForbiddenException('Only the person who logged it can change it.');
    if (t.status !== 'unbilled') throw new ConflictException('This time is on an invoice: change the invoice instead.');
    return t;
  }

  async updateTime(orgId: string, userId: string, id: string, input: Partial<Omit<TimeInput, 'projectId'>>) {
    const t = await this.ownUnbilled(orgId, userId, id);
    const before = { date: t.date, hours: t.hours, task: t.task, billable: t.billable };
    if (input.date !== undefined) {
      if (!DATE.test(input.date) || input.date > todayIst()) throw new BadRequestException('Time is logged for a date like 2026-11-04, today or before.');
      t.date = input.date;
    }
    if (input.hours !== undefined) t.hours = input.hours;
    if (input.task !== undefined) t.task = input.task.trim().slice(0, 80);
    if (input.notes !== undefined) t.notes = input.notes?.trim().slice(0, 1000) || null;
    if (input.billable !== undefined) t.billable = input.billable;
    if (input.ratePaise !== undefined) t.ratePaise = paise(input.ratePaise, 'The rate');
    await t.save();
    await this.audit.record({ orgId, entityType: 'TimeEntry', entityId: id, action: 'UPDATE', performedBy: userId, before, after: { date: t.date, hours: t.hours, task: t.task, billable: t.billable } });
    return t;
  }

  async deleteTime(orgId: string, userId: string, id: string) {
    const t = await this.ownUnbilled(orgId, userId, id);
    await t.deleteOne();
    await this.audit.record({ orgId, entityType: 'TimeEntry', entityId: id, action: 'DELETE', performedBy: userId, before: { date: t.date, hours: t.hours, task: t.task } });
    return { deleted: true };
  }

  async listTime(orgId: string, q: { projectId?: string; userId?: string; from?: string; to?: string }): Promise<Array<Record<string, unknown>>> {
    const filter: Record<string, unknown> = { orgId };
    if (q.projectId && Types.ObjectId.isValid(q.projectId)) filter.projectId = new Types.ObjectId(q.projectId);
    if (q.userId) filter.userId = q.userId;
    if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    const rows = await this.timeModel.find(filter).sort({ date: -1, createdAt: -1 }).limit(500).lean().exec();
    const names = new Map((await this.projectModel.find({ orgId, _id: { $in: [...new Set(rows.map((r) => String(r.projectId)))] } }, { name: 1 }).lean().exec()).map((p) => [String(p._id), p.name]));
    return rows.map((r) => ({
      id: String(r._id), projectId: String(r.projectId), projectName: names.get(String(r.projectId)) ?? '', userId: r.userId, userName: r.userName, date: r.date, hours: r.hours,
      task: r.task, notes: r.notes, billable: r.billable, ratePaise: r.ratePaise, status: r.status, invoiceId: r.invoiceId ? String(r.invoiceId) : null,
    }));
  }

  /** Who logged time lately but nothing this past week: a nudge, not a rule. */
  async nudges(orgId: string, today = todayIst()) {
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - 35 * 86_400_000).toISOString().slice(0, 10);
    const rows = await this.timeModel.find({ orgId, date: { $gte: since } }, { userId: 1, userName: 1, date: 1 }).lean().exec();
    return missingTimesheets(rows, today);
  }

  // ── Billing time ──────────────────────────────────────────────────────

  /** What would go on the invoice: unbilled billable time to a date, as lines. */
  async unbilled(orgId: string, projectId: string, through = todayIst()) {
    const p = await this.find(orgId, projectId);
    const entries = await this.timeModel.find({ orgId, projectId: p._id, status: 'unbilled', billable: true, date: { $lte: through } }).lean().exec();
    const { groups, unpriced } = groupTime(entries.map((e) => ({ id: String(e._id), date: e.date, hours: e.hours, task: e.task, notes: e.notes, ratePaise: e.ratePaise, userName: e.userName })), p.ratePaise);
    return {
      project: p,
      groups,
      unpriced,
      lines: groups.map((g) => ({ description: lineDescription(g), hours: g.hours, ratePaise: g.ratePaise, amountPaise: lineAmount({ qty: g.hours, ratePaise: g.ratePaise }), entries: g.entryIds.length })),
    };
  }

  /**
   * A draft invoice from unbilled time: a line per task and rate, at the
   * project's service item. The time is held while the draft is made, so it
   * cannot go on two invoices. With a model, a job words each line from the
   * time notes afterwards, if the draft is still untouched.
   */
  async draftInvoice(orgId: string, actorId: string, projectId: string, through = todayIst()) {
    if (!DATE.test(through)) throw new BadRequestException('through must look like 2026-11-04');
    const found = await this.find(orgId, projectId);
    // One draft at a time per project; a lock left by a crash lapses after five minutes.
    const lock = new Types.ObjectId().toString();
    const locked = await this.projectModel
      .findOneAndUpdate({ _id: found._id, orgId, $or: [{ billingLock: null }, { billingLockAt: { $lt: new Date(Date.now() - 5 * 60_000) } }] }, { $set: { billingLock: lock, billingLockAt: new Date() } })
      .exec();
    if (!locked) throw new ConflictException('An invoice is being drafted from this time right now: try again in a moment.');
    try {
      return await this.draftLocked(orgId, actorId, projectId, through);
    } finally {
      await this.projectModel.updateOne({ _id: found._id, orgId, billingLock: lock }, { $set: { billingLock: null, billingLockAt: null } }).exec();
    }
  }

  private async draftLocked(orgId: string, actorId: string, projectId: string, through: string) {
    const { project: p, groups } = await this.unbilled(orgId, projectId, through);
    if (!p.customerId) throw new BadRequestException('An internal project has no one to invoice.');
    if (!groups.length) throw new BadRequestException('No unbilled time with a rate to invoice. Give the project a rate per hour, or the time its own.');
    const ids = groups.flatMap((g) => g.entryIds.map((id) => new Types.ObjectId(id)));
    const claim = new Types.ObjectId().toString();
    const held = await this.timeModel.updateMany({ orgId, _id: { $in: ids }, status: 'unbilled' }, { $set: { status: 'billing', claim } }).exec();
    const release = () => this.timeModel.updateMany({ orgId, claim, status: 'billing' }, { $set: { status: 'unbilled', claim: null } }).exec();
    if (held.modifiedCount !== ids.length) {
      await release();
      throw new ConflictException('Some of this time was just invoiced: reload and try again.');
    }
    try {
      const resolved = await this.items.resolveLines(
        orgId,
        groups.map((g) => ({
          description: lineDescription(g), itemId: p.serviceItemId ? String(p.serviceItemId) : null, qty: g.hours, ratePaise: g.ratePaise,
          amountPaise: lineAmount({ qty: g.hours, ratePaise: g.ratePaise }), ...(p.serviceItemId ? {} : { taxRatePct: 18 }), projectId: String(p._id),
        })),
        'sale',
      );
      const lines = resolved.map((l) => ({ ...l, qty: l.qty ?? 1, taxRatePct: l.taxRatePct ?? 0 }));
      const [customer, settings] = await Promise.all([this.customerModel.findOne({ _id: p.customerId, orgId }).lean().exec(), this.settingsModel.findOne({ orgId }).lean().exec()]);
      const ours = settings?.gstin?.slice(0, 2) ?? settings?.stateCode ?? null;
      const theirs = customer?.gstin?.slice(0, 2) ?? customer?.stateCode ?? null;
      const today = todayIst();
      const from = groups.map((g) => g.from).sort()[0];
      const to = groups.map((g) => g.to).sort().reverse()[0];
      const invoice = await this.invoices.create({
        orgId, actorId, customerId: String(p.customerId), invoiceDate: today, dueDate: addDays(today, 15), amountsPaise: docAmounts(lines, isInterState(ours, theirs)), lineItems: lines,
        notes: `Time on ${p.name}, ${from} to ${to}.${p.serviceItemId ? '' : ' Set the SAC code and GST rate on the lines before sending: the project has no service item.'}`,
        source: { kind: 'project', id: String(p._id) },
      });
      await this.timeModel.updateMany({ orgId, claim }, { $set: { status: 'billed', invoiceId: invoice._id, claim: null } }).exec();
      const hours = Math.round(groups.reduce((s, g) => s + g.hours, 0) * 100) / 100;
      await this.audit.record({ orgId, entityType: 'Project', entityId: String(p._id), action: 'BILL_TIME', performedBy: actorId, after: { invoiceId: String(invoice._id), entries: ids.length, hours, through } });

      let wording: string | null = null;
      if (this.model.available && groups.some((g) => g.notes.length)) {
        const s = await this.suggestionModel.create({
          orgId, kind: 'time_lines', status: 'queued', requestedBy: actorId, entityType: 'SalesInvoice', entityId: String(invoice._id),
          input: { project: p.name, groups, stamp: (invoice as unknown as { updatedAt: Date }).updatedAt.toISOString() },
        });
        await this.queue.add('time-lines', { orgId, suggestionId: s._id.toString() }, { attempts: 2, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 100 });
        wording = s._id.toString();
      }
      return { invoiceId: String(invoice._id), lines: groups.length, hours, entries: ids.length, wording };
    } catch (err) {
      await release();
      throw err;
    }
  }

  /** Words each line from its time notes, on a draft no one has touched since. */
  async runTimeLines(orgId: string, suggestionId: string) {
    const s = await this.suggestionModel.findOne({ _id: suggestionId, orgId, kind: 'time_lines' }).exec();
    if (!s || s.status !== 'queued') return;
    const { project, groups, stamp } = s.input as { project: string; groups: TimeGroup[]; stamp: string };
    const answer = await this.model.json(timeLinesPrompt(project, groups), 500);
    if (answer) await this.usageMeter.recordAiTokens(orgId, answer.tokensIn, answer.tokensOut);
    const read = answer ? readTimeLines(answer.raw, groups) : new Map<number, string>();
    if (!read.size) {
      s.set({ status: 'none', reason: 'The AI wrote nothing usable: the lines keep the task and dates.' });
      await s.save();
      return;
    }
    const invoice = await this.invoiceModel.findOne({ _id: s.entityId, orgId }).lean().exec();
    const set: Record<string, string> = {};
    const before: Record<number, string> = {};
    for (const [i, text] of read) {
      set[`lineItems.${i}.description`] = text;
      before[i] = invoice?.lineItems[i]?.description ?? '';
    }
    const res = await this.invoiceModel.updateOne({ _id: s.entityId, orgId, status: InvoiceStatus.DRAFT, updatedAt: new Date(stamp) }, { $set: set }).exec();
    if (!res.matchedCount) {
      s.set({ status: 'none', reason: 'The draft was changed first, so its lines were left as they were.' });
      await s.save();
      return;
    }
    await this.audit.record({ orgId, entityType: 'SalesInvoice', entityId: String(s.entityId), action: 'AI_WORDED_LINES', performedBy: s.requestedBy, before, after: Object.fromEntries(read) });
    s.set({ status: 'done', source: 'model', confidence: 0.8, result: { lines: Object.fromEntries(read) }, reason: 'Line descriptions worded by AI from the time notes: read them before sending.' });
    await s.save();
  }

  async wordingStatus(orgId: string, id: string) {
    const s = Types.ObjectId.isValid(id) ? await this.suggestionModel.findOne({ _id: id, orgId, kind: 'time_lines' }).lean().exec() : null;
    if (!s) throw new NotFoundException('Not found');
    return { status: s.status, reason: s.reason, invoiceId: s.entityId };
  }
}
