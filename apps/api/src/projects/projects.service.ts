import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ClientSession, Connection, Model, Types } from 'mongoose';
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
import { OrgMembership, OrgMembershipDocument } from '../tenancy/schemas/org-membership.schema';
import { AiSuggestion, AiSuggestionDocument } from '../ai-suggestions/schemas/ai-suggestion.schema';
import { UsageMeterService } from '../ocr/usage-meter.service';
import { ManagementReportsService } from '../reports/management.service';
import { REPORT_MODEL, ReportModel } from '../reports/report-model';
import { aiFailureReason } from '../common/ai-failure';
import { addDays, todayIst } from '../automation/schedule';
import { docAmounts, isInterState, lineAmount } from '../orders/doc-lines';
import { Project, ProjectDocument, ProjectMember, ProjectTask } from './schemas/project.schema';
import { TimeEntry, TimeEntryDocument } from './schemas/time-entry.schema';
import { TimeTimer, TimeTimerDocument } from './schemas/time-timer.schema';
import {
  BILLING_METHODS,
  BillingMethod,
  TimeGroup,
  billingMethod,
  budgetAlerts,
  clockMinutes,
  durationHours,
  groupTime,
  lineDescription,
  missingRateMessage,
  missingTimesheets,
  rateBook,
  rateFor,
  readTimeLines,
  spanHours,
  timeLinesPrompt,
  timerHours,
} from './time-billing';

export const PROJECT_AI_QUEUE = 'project-ai';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const paise = (v: number | null | undefined, what: string) => {
  if (v == null) return null;
  if (!Number.isInteger(v) || v < 0) throw new BadRequestException(`${what} is a whole number of paise, not negative.`);
  return v;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
/** "9:05" → "09:05". */
const clock = (v: string) => {
  const m = clockMinutes(v)!;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
/** The time of day in India, HH:MM. */
const istClock = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(11, 16);
const defined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export interface TaskInput {
  /** An existing task's id, to keep it (and the time logged to it); none for a new task. */
  id?: string | null;
  name: string;
  description?: string | null;
  billable?: boolean;
  ratePaise?: number | null;
}

export interface MemberInput {
  userId: string;
  ratePaise?: number | null;
}

export interface ProjectInput {
  name?: string;
  code?: string | null;
  customerId?: string | null;
  /** 'time' is the old name for project_hours, still accepted. */
  billing?: BillingMethod | 'time';
  /** The old single budget; see the Project schema. Cleared when a cost or revenue budget is saved. */
  budgetPaise?: number | null;
  costBudgetPaise?: number | null;
  revenueBudgetPaise?: number | null;
  budgetHours?: number | null;
  ratePaise?: number | null;
  serviceItemId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
  notes?: string | null;
  watchlist?: boolean;
  /** The people on the project. On a new project the person creating it is added if missing. */
  members?: MemberInput[];
  /** The whole list: tasks left out are removed, unless they have time waiting to be invoiced. */
  tasks?: TaskInput[];
  /** Copy another project's tasks onto this one (names it already has are skipped). */
  importTasksFrom?: string | null;
}

export interface TimeInput {
  projectId: string;
  date: string;
  /** How long, as hours (2.5); or `duration` as hours and minutes (2:30); or a start and end time. */
  hours?: number | null;
  duration?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  /** One of the project's tasks; or free text in `task`. */
  taskId?: string | null;
  task?: string | null;
  notes?: string | null;
  /** By default the task's setting, else billable unless the project is a fixed fee. */
  billable?: boolean;
  ratePaise?: number | null;
  /** Whose time it is, when not your own: needs a manager (see Actor). */
  userId?: string | null;
}

export interface TimeQuery {
  projectId?: string;
  customerId?: string;
  userId?: string;
  period?: 'all' | 'today' | 'this_week' | 'this_month';
  from?: string;
  to?: string;
  /** billable: all billable time; unbilled: billable, not yet invoiced; billed: invoiced; non_billable. */
  billing?: 'billable' | 'unbilled' | 'billed' | 'non_billable';
}

/**
 * Who is acting. canManage is the MANAGE_SALES permission, the one that
 * manages projects: with it, a person can log time for someone else on the
 * project and change or remove anyone's unbilled time. Without it, people
 * log and change their own. A bare user id is a person without it.
 */
export type Actor = string | { userId: string; canManage?: boolean };
const actorOf = (a: Actor) => (typeof a === 'string' ? { userId: a, canManage: false } : { userId: a.userId, canManage: !!a.canManage });

/** A project's fields as the audit trail summarises them. */
interface ProjectShape {
  name: string;
  code: string | null;
  customerId: Types.ObjectId | null;
  serviceItemId: Types.ObjectId | null;
  billing: string;
  budgetPaise: number | null;
  costBudgetPaise?: number | null;
  revenueBudgetPaise?: number | null;
  budgetHours: number | null;
  ratePaise: number | null;
  watchlist?: boolean;
  description?: string | null;
  members: ProjectMember[];
  tasks: ProjectTask[];
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
    @InjectModel(TimeTimer.name) private timerModel: Model<TimeTimerDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(Item.name) private itemModel: Model<ItemDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(OrgSettings.name) private settingsModel: Model<OrgSettingsDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(OrgMembership.name) private membershipModel: Model<OrgMembershipDocument>,
    @InjectModel(AiSuggestion.name) private suggestionModel: Model<AiSuggestionDocument>,
    @InjectConnection() private connection: Connection,
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

  /** The org's people, for a project's users and whose time it is. */
  async people(orgId: string): Promise<Array<{ userId: string; name: string; email: string }>> {
    const memberships = await this.membershipModel.find({ orgId, isActive: true }, { userId: 1 }).lean().exec();
    if (!memberships.length) return [];
    const users = await this.userModel.find({ _id: { $in: memberships.map((m) => m.userId) } }, { name: 1, email: 1 }).lean().exec();
    return users.map((u) => ({ userId: String(u._id), name: u.name || u.email, email: u.email })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Each person once, each on the org's team; people already on the project are not checked again. */
  private async checkedMembers(orgId: string, list: MemberInput[], already: Set<string>, creator: string | null): Promise<ProjectMember[]> {
    const out: ProjectMember[] = [];
    for (const m of list) {
      const userId = String(m?.userId ?? '');
      if (!Types.ObjectId.isValid(userId)) throw new BadRequestException('Pick each user from your team.');
      if (out.some((x) => x.userId === userId)) throw new BadRequestException('Each person is on the project once.');
      out.push({ userId, ratePaise: paise(m.ratePaise, 'A user’s rate') });
    }
    // The person creating the project is on it unless they say otherwise; they are on the team, by their sign-in.
    if (creator && !out.some((x) => x.userId === creator)) out.unshift({ userId: creator, ratePaise: null });
    const fresh = out.map((m) => m.userId).filter((id) => id !== creator && !already.has(id));
    if (fresh.length) {
      const found = await this.membershipModel.find({ orgId, userId: { $in: fresh.map((id) => new Types.ObjectId(id)) }, isActive: true }, { userId: 1 }).lean().exec();
      if (found.length !== fresh.length) throw new BadRequestException('Only people on your team can be on a project: invite them under Settings → Team first.');
    }
    return out;
  }

  /** Tasks with a name each, no name twice; an existing task keeps its id, so time logged to it stays with it. */
  private async checkedTasks(orgId: string, list: TaskInput[], current: ProjectDocument | null, importFrom: string | null | undefined): Promise<ProjectTask[]> {
    const existing = new Set((current?.tasks ?? []).map((t) => String(t._id)));
    const out: ProjectTask[] = [];
    const names = new Set<string>();
    for (const t of list) {
      const name = t?.name?.trim();
      if (!name) throw new BadRequestException('Give each task a name.');
      if (name.length > 80) throw new BadRequestException(`"${name.slice(0, 30)}…" is a long task name: 80 characters at most.`);
      if (names.has(name.toLowerCase())) throw new BadRequestException(`The task "${name}" is on the project twice.`);
      names.add(name.toLowerCase());
      out.push({
        _id: t.id && existing.has(String(t.id)) ? new Types.ObjectId(String(t.id)) : new Types.ObjectId(),
        name,
        description: t.description?.trim().slice(0, 500) || null,
        billable: t.billable ?? true,
        ratePaise: paise(t.ratePaise, `The rate for ${name}`),
      });
    }
    if (importFrom) {
      const from = Types.ObjectId.isValid(importFrom) ? await this.projectModel.findOne({ _id: importFrom, orgId }, { tasks: 1 }).lean().exec() : null;
      if (!from) throw new BadRequestException('No such project to import tasks from.');
      for (const t of from.tasks ?? []) {
        if (names.has(t.name.trim().toLowerCase())) continue;
        names.add(t.name.trim().toLowerCase());
        out.push({ _id: new Types.ObjectId(), name: t.name, description: t.description ?? null, billable: t.billable ?? true, ratePaise: t.ratePaise ?? null });
      }
    }
    return out;
  }

  /**
   * The project as it would be saved. `given` is what the request set, so a
   * cost or revenue budget there supersedes the old single budget.
   */
  private async checked(orgId: string, input: ProjectInput, given: Partial<ProjectInput>, current: ProjectDocument | null, creator: string | null) {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Give the project a name.');
    const billing = input.billing === 'time' ? 'project_hours' : input.billing;
    if (!billing || !BILLING_METHODS.includes(billing)) throw new BadRequestException('Choose how the project is billed: a fixed fee, or by project, task or staff hours.');
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
    if (input.startDate && input.endDate && input.startDate > input.endDate) throw new BadRequestException('The project ends before it starts.');
    if (input.budgetHours != null && !(input.budgetHours >= 0)) throw new BadRequestException('Budgeted hours are not negative.');
    const description = input.description?.trim() || null;
    if (description && description.length > 2000) throw new BadRequestException('The description is 2,000 characters at most.');
    const supersede = given.costBudgetPaise !== undefined || given.revenueBudgetPaise !== undefined;
    const members = await this.checkedMembers(orgId, input.members ?? [], new Set((current?.members ?? []).map((m) => m.userId)), creator);
    const tasks = await this.checkedTasks(orgId, input.tasks ?? [], current, input.importTasksFrom);
    return {
      name, nameKey: nameKey(name), code: input.code?.trim() || null, customerId, billing,
      budgetPaise: supersede && given.budgetPaise === undefined ? null : paise(input.budgetPaise, 'The budget'),
      costBudgetPaise: paise(input.costBudgetPaise, 'The cost budget'),
      revenueBudgetPaise: paise(input.revenueBudgetPaise, 'The revenue budget'),
      budgetHours: input.budgetHours ?? null, ratePaise: paise(input.ratePaise, 'The rate'), serviceItemId,
      startDate: input.startDate || null, endDate: input.endDate || null,
      description,
      // A description, once saved, takes the place of the old notes.
      notes: given.description !== undefined ? null : input.notes?.trim() || null,
      watchlist: !!input.watchlist, members, tasks,
    };
  }

  /** What the audit trail keeps of a project. */
  private summary(f: ProjectShape) {
    return {
      name: f.name, code: f.code, customerId: f.customerId ? String(f.customerId) : null, billing: billingMethod(f.billing),
      budgetPaise: f.budgetPaise, costBudgetPaise: f.costBudgetPaise ?? null, revenueBudgetPaise: f.revenueBudgetPaise ?? null, budgetHours: f.budgetHours, ratePaise: f.ratePaise,
      serviceItemId: f.serviceItemId ? String(f.serviceItemId) : null, watchlist: !!f.watchlist, description: f.description ?? null,
      members: f.members.map((m) => ({ userId: m.userId, ratePaise: m.ratePaise ?? null })),
      tasks: f.tasks.map((t) => ({ id: String(t._id), name: t.name, billable: t.billable, ratePaise: t.ratePaise ?? null })),
    };
  }

  async create(orgId: string, actor: Actor, input: ProjectInput) {
    const { userId } = actorOf(actor);
    const fields = await this.checked(orgId, input, defined(input), null, userId);
    try {
      const p = await this.projectModel.create({ orgId, ...fields, createdBy: userId });
      await this.audit.record({ orgId, entityType: 'Project', entityId: p._id.toString(), action: 'CREATE', performedBy: userId, after: this.summary(fields) });
      return p;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictException(`A project called "${fields.name}" already exists.`);
      throw err;
    }
  }

  async update(orgId: string, actor: Actor, id: string, input: ProjectInput) {
    const { userId } = actorOf(actor);
    const p = await this.find(orgId, id);
    const before = this.summary({ ...p.toObject(), members: p.members ?? [], tasks: p.tasks ?? [] });
    const given = defined(input);
    const fields = await this.checked(
      orgId,
      {
        name: p.name, code: p.code, customerId: p.customerId ? String(p.customerId) : null, billing: billingMethod(p.billing),
        budgetPaise: p.budgetPaise, costBudgetPaise: p.costBudgetPaise ?? null, revenueBudgetPaise: p.revenueBudgetPaise ?? null, budgetHours: p.budgetHours,
        ratePaise: p.ratePaise, serviceItemId: p.serviceItemId ? String(p.serviceItemId) : null, startDate: p.startDate, endDate: p.endDate,
        description: p.description ?? null, notes: p.notes, watchlist: !!p.watchlist,
        members: (p.members ?? []).map((m) => ({ userId: m.userId, ratePaise: m.ratePaise })),
        tasks: (p.tasks ?? []).map((t) => ({ id: String(t._id), name: t.name, description: t.description, billable: t.billable, ratePaise: t.ratePaise })),
        ...given,
      },
      given,
      p,
      null,
    );
    // A task with time still to be invoiced stays: that time needs its rate and its name.
    const kept = new Set(fields.tasks.map((t) => String(t._id)));
    const removed = (p.tasks ?? []).filter((t) => !kept.has(String(t._id)));
    if (removed.length) {
      const busy = await this.timeModel
        .findOne({ orgId, projectId: p._id, taskId: { $in: removed.map((t) => t._id) }, billable: true, status: { $in: ['unbilled', 'billing'] } }, { taskId: 1 })
        .lean()
        .exec();
      if (busy) {
        const name = removed.find((t) => String(t._id) === String(busy.taskId))?.name ?? 'A task';
        throw new ConflictException(`"${name}" has billable time not yet invoiced: invoice or move that time before removing the task.`);
      }
    }
    p.set(fields);
    try {
      await p.save();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictException(`A project called "${fields.name}" already exists.`);
      throw err;
    }
    await this.audit.record({ orgId, entityType: 'Project', entityId: id, action: 'UPDATE', performedBy: userId, before, after: this.summary(fields) });
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

  /** Every project with its tasks, users, budgets, income, costs, hours, unbilled time and budget alerts. */
  async list(orgId: string): Promise<Array<Record<string, unknown>>> {
    const [projects, figures] = await Promise.all([this.projectModel.find({ orgId }).sort({ status: 1, name: 1 }).lean().exec(), this.management.projectFigures(orgId)]);
    const customers = await this.customerModel.find({ orgId, _id: { $in: projects.map((p) => p.customerId).filter(Boolean) } }, { name: 1 }).lean().exec();
    const customerName = new Map(customers.map((c) => [String(c._id), c.name]));
    const memberIds = [...new Set(projects.flatMap((p) => (p.members ?? []).map((m) => m.userId)))].filter((id) => Types.ObjectId.isValid(id));
    const users = memberIds.length ? await this.userModel.find({ _id: { $in: memberIds } }, { name: 1, email: 1 }).lean().exec() : [];
    const userOf = new Map(users.map((u) => [String(u._id), u]));
    return projects.map((p) => {
      const f = figures.get(String(p._id)) ?? { incomePaise: 0, costPaise: 0, hours: 0, unbilledHours: 0, unbilledPaise: 0 };
      const billing = billingMethod(p.billing);
      return {
        id: String(p._id), name: p.name, code: p.code, status: p.status, billing,
        customerId: p.customerId ? String(p.customerId) : null, customerName: p.customerId ? customerName.get(String(p.customerId)) ?? null : null,
        budgetPaise: p.budgetPaise, costBudgetPaise: p.costBudgetPaise ?? null, revenueBudgetPaise: p.revenueBudgetPaise ?? null,
        budgetHours: p.budgetHours, ratePaise: p.ratePaise, serviceItemId: p.serviceItemId ? String(p.serviceItemId) : null,
        startDate: p.startDate, endDate: p.endDate, description: p.description ?? p.notes ?? null, notes: p.notes, watchlist: !!p.watchlist, createdBy: p.createdBy,
        members: (p.members ?? []).map((m) => ({ userId: m.userId, name: userOf.get(m.userId)?.name || userOf.get(m.userId)?.email || 'Someone', email: userOf.get(m.userId)?.email ?? '', ratePaise: m.ratePaise ?? null })),
        tasks: (p.tasks ?? []).map((t) => ({ id: String(t._id), name: t.name, description: t.description ?? null, billable: t.billable ?? true, ratePaise: t.ratePaise ?? null })),
        ...f, profitPaise: f.incomePaise - f.costPaise,
        alerts: budgetAlerts({
          billing, budgetPaise: p.budgetPaise, costBudgetPaise: p.costBudgetPaise ?? null, revenueBudgetPaise: p.revenueBudgetPaise ?? null, budgetHours: p.budgetHours,
          hours: f.hours, billedPaise: f.incomePaise, unbilledPaise: f.unbilledPaise, costPaise: f.costPaise,
        }),
      };
    });
  }

  // ── Time ──────────────────────────────────────────────────────────────

  /** How long: a start and end time, hours and minutes, or hours; checked, as hours to two decimals. */
  private spent(input: { hours?: number | null; duration?: string | null; startTime?: string | null; endTime?: string | null }): { hours: number; startTime: string | null; endTime: string | null } {
    const range = (h: number) => {
      if (!(h > 0 && h <= 24)) throw new BadRequestException('Time spent is more than nothing and a day at most.');
      return h;
    };
    if (input.startTime || input.endTime) {
      if (!input.startTime || !input.endTime) throw new BadRequestException('Give both the start and the end time, like 09:30 and 13:00.');
      if (clockMinutes(input.startTime) == null || clockMinutes(input.endTime) == null) throw new BadRequestException('Start and end times look like 09:30 and 13:00.');
      const h = spanHours(input.startTime, input.endTime);
      if (h == null) throw new BadRequestException('The end time is after the start time, on the same day.');
      if (input.hours != null && Math.abs(input.hours - h) > 0.005) throw new BadRequestException(`${clock(input.startTime)} to ${clock(input.endTime)} is ${h} hour${h === 1 ? '' : 's'}, not ${input.hours}.`);
      return { hours: range(h), startTime: clock(input.startTime), endTime: clock(input.endTime) };
    }
    if (input.duration) {
      const h = durationHours(input.duration);
      if (h == null) throw new BadRequestException('Time spent looks like 1:30, hours and minutes.');
      return { hours: range(h), startTime: null, endTime: null };
    }
    if (input.hours == null) throw new BadRequestException('Say how long: the time spent, like 1:30, or the start and end times.');
    return { hours: range(input.hours), startTime: null, endTime: null };
  }

  /** One of the project's tasks, or free text; free text that names a task is that task. */
  private taskFor(p: ProjectDocument, taskId: string | null | undefined, text: string | null | undefined): { taskId: Types.ObjectId | null; task: string; billable: boolean | null } {
    const tasks = p.tasks ?? [];
    if (taskId) {
      const t = tasks.find((x) => String(x._id) === String(taskId));
      if (!t) throw new BadRequestException(`That task is not on ${p.name}.`);
      return { taskId: t._id, task: t.name, billable: t.billable ?? true };
    }
    const name = text?.trim();
    if (!name) throw new BadRequestException('Say what the time was spent on.');
    const t = tasks.find((x) => x.name.trim().toLowerCase() === name.toLowerCase());
    return t ? { taskId: t._id, task: t.name, billable: t.billable ?? true } : { taskId: null, task: name.slice(0, 80), billable: null };
  }

  /** Whose time: your own, or, for a manager, another person on the project. */
  private async whose(orgId: string, p: ProjectDocument, a: { userId: string; canManage: boolean }, userId: string | null | undefined): Promise<{ userId: string; userName: string }> {
    const target = userId || a.userId;
    if (target !== a.userId) {
      if (!a.canManage) throw new ForbiddenException('You log your own time. Someone who manages projects can log time for others.');
      if (!(p.members ?? []).some((m) => m.userId === target)) throw new BadRequestException(`They are not on ${p.name}: add them to the project's users first.`);
      const active = Types.ObjectId.isValid(target) ? await this.membershipModel.exists({ orgId, userId: new Types.ObjectId(target), isActive: true }).exec() : null;
      if (!active) throw new BadRequestException('They are no longer on your team.');
    }
    const user = Types.ObjectId.isValid(target) ? await this.userModel.findById(target, { name: 1, email: 1 }).lean().exec() : null;
    return { userId: target, userName: user?.name || user?.email || 'Someone' };
  }

  private snapshot(t: TimeEntryDocument) {
    return {
      projectId: String(t.projectId), userId: t.userId, userName: t.userName, date: t.date, hours: t.hours, startTime: t.startTime ?? null, endTime: t.endTime ?? null,
      taskId: t.taskId ? String(t.taskId) : null, task: t.task, notes: t.notes, billable: t.billable, ratePaise: t.ratePaise,
    };
  }

  /** `from` is for the timer: its transaction, its id (one entry per timer) and what the audit trail notes. */
  async logTime(orgId: string, actor: Actor, input: TimeInput, from?: { session: ClientSession; timerId: string; meta: Record<string, unknown> }) {
    const session = from?.session;
    const a = actorOf(actor);
    const p = await this.find(orgId, input.projectId);
    if (p.status === 'completed') throw new BadRequestException(`${p.name} is completed: reopen it to log time.`);
    if (!DATE.test(input.date ?? '')) throw new BadRequestException('date must look like 2026-11-04');
    if (input.date > todayIst()) throw new BadRequestException('Time is logged for today or before.');
    const spent = this.spent(input);
    const task = this.taskFor(p, input.taskId, input.task);
    const who = await this.whose(orgId, p, a, input.userId);
    const [t] = await this.timeModel.create(
      [
        {
          orgId, projectId: p._id, userId: who.userId, userName: who.userName, loggedBy: a.userId, date: input.date, ...spent,
          taskId: task.taskId, task: task.task, notes: input.notes?.trim().slice(0, 1000) || null,
          billable: input.billable ?? task.billable ?? billingMethod(p.billing) !== 'fixed', ratePaise: paise(input.ratePaise, 'The rate'),
          timerId: from?.timerId ?? null,
        },
      ],
      { session },
    );
    await this.audit.record(
      { orgId, entityType: 'TimeEntry', entityId: t._id.toString(), action: 'CREATE', performedBy: a.userId, after: { project: p.name, ...this.snapshot(t), loggedBy: a.userId }, ...(from ? { meta: from.meta } : {}) },
      session,
    );
    return t;
  }

  /** Your own unbilled time; or anyone's, for a manager. */
  private async editable(orgId: string, a: { userId: string; canManage: boolean }, id: string) {
    const t = Types.ObjectId.isValid(id) ? await this.timeModel.findOne({ _id: id, orgId }).exec() : null;
    if (!t) throw new NotFoundException('No such time entry.');
    if (t.userId !== a.userId && !a.canManage) throw new ForbiddenException('Only the person whose time it is, or someone who manages projects, can change it.');
    if (t.status !== 'unbilled') throw new ConflictException('This time is on an invoice: change the invoice instead.');
    return t;
  }

  async updateTime(orgId: string, actor: Actor, id: string, input: Partial<TimeInput>) {
    const a = actorOf(actor);
    const t = await this.editable(orgId, a, id);
    const before = this.snapshot(t);
    const moved = !!input.projectId && input.projectId !== String(t.projectId);
    const p = await this.find(orgId, input.projectId || String(t.projectId));
    if (moved) {
      if (p.status === 'completed') throw new BadRequestException(`${p.name} is completed: reopen it to log time.`);
      t.projectId = p._id;
    }
    if (input.date !== undefined) {
      if (!DATE.test(input.date) || input.date > todayIst()) throw new BadRequestException('Time is logged for a date like 2026-11-04, today or before.');
      t.date = input.date;
    }
    if (input.hours !== undefined || input.duration !== undefined || input.startTime !== undefined || input.endTime !== undefined) {
      // New hours on their own replace the start and end times they came from.
      const bare = input.hours != null || !!input.duration;
      const spent = this.spent({
        hours: input.hours,
        duration: input.duration,
        startTime: input.startTime !== undefined ? input.startTime : bare ? null : t.startTime,
        endTime: input.endTime !== undefined ? input.endTime : bare ? null : t.endTime,
      });
      t.set(spent);
    }
    if (moved || input.taskId !== undefined || input.task !== undefined) {
      const taskId = input.taskId !== undefined ? input.taskId : input.task !== undefined || moved ? null : t.taskId ? String(t.taskId) : null;
      const task = this.taskFor(p, taskId, input.task ?? t.task);
      t.taskId = task.taskId;
      t.task = task.task;
    }
    if (input.userId !== undefined && input.userId && input.userId !== t.userId) {
      const who = await this.whose(orgId, p, a, input.userId);
      t.userId = who.userId;
      t.userName = who.userName;
    }
    if (input.notes !== undefined) t.notes = input.notes?.trim().slice(0, 1000) || null;
    if (input.billable !== undefined) t.billable = input.billable;
    if (input.ratePaise !== undefined) t.ratePaise = paise(input.ratePaise, 'The rate');
    await t.save();
    await this.audit.record({ orgId, entityType: 'TimeEntry', entityId: id, action: 'UPDATE', performedBy: a.userId, before, after: this.snapshot(t) });
    return t;
  }

  async deleteTime(orgId: string, actor: Actor, id: string) {
    const a = actorOf(actor);
    const t = await this.editable(orgId, a, id);
    await t.deleteOne();
    await this.audit.record({ orgId, entityType: 'TimeEntry', entityId: id, action: 'DELETE', performedBy: a.userId, before: this.snapshot(t) });
    return { deleted: true };
  }

  /** The dates a period covers, in India: this week is Monday to Sunday. */
  private periodRange(q: TimeQuery): { from?: string; to?: string } {
    const today = todayIst();
    if (q.period === 'today') return { from: today, to: today };
    if (q.period === 'this_week') {
      const monday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
      return { from: monday, to: addDays(monday, 6) };
    }
    if (q.period === 'this_month') {
      const first = `${today.slice(0, 7)}-01`;
      return { from: first, to: addDays(`${addDays(first, 32).slice(0, 7)}-01`, -1) };
    }
    if (q.period === 'all') return {};
    return { from: q.from && DATE.test(q.from) ? q.from : undefined, to: q.to && DATE.test(q.to) ? q.to : undefined };
  }

  /** Time, filtered by period, customer, project, person and billing; the latest 500, with totals for all that match. */
  async listTime(orgId: string, q: TimeQuery) {
    const filter: Record<string, unknown> = { orgId };
    const none = { entries: [], totals: { entries: 0, hours: 0, billableHours: 0, unbilledHours: 0, unbilledPaise: 0 }, truncated: false };
    if (q.projectId) {
      if (!Types.ObjectId.isValid(q.projectId)) return none;
      filter.projectId = new Types.ObjectId(q.projectId);
    }
    if (q.customerId) {
      if (!Types.ObjectId.isValid(q.customerId)) return none;
      const ids = (await this.projectModel.find({ orgId, customerId: new Types.ObjectId(q.customerId) }, { _id: 1 }).lean().exec()).map((p) => String(p._id));
      const pick = q.projectId ? ids.filter((id) => id === q.projectId) : ids;
      if (!pick.length) return none;
      filter.projectId = { $in: pick.map((id) => new Types.ObjectId(id)) };
    }
    if (q.userId) filter.userId = q.userId;
    const { from, to } = this.periodRange(q);
    if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    if (q.billing === 'billable') filter.billable = true;
    else if (q.billing === 'unbilled') Object.assign(filter, { billable: true, status: 'unbilled' });
    else if (q.billing === 'billed') filter.status = 'billed';
    else if (q.billing === 'non_billable') filter.billable = false;

    const rows = await this.timeModel.find(filter).sort({ date: -1, createdAt: -1 }).lean().exec();
    const projects = await this.projectModel
      .find({ orgId, _id: { $in: [...new Set(rows.map((r) => String(r.projectId)))].map((id) => new Types.ObjectId(id)) } }, { name: 1, customerId: 1, billing: 1, ratePaise: 1, tasks: 1, members: 1 })
      .lean()
      .exec();
    const byId = new Map(projects.map((p) => [String(p._id), { p, book: rateBook(p) }]));
    const customers = await this.customerModel.find({ orgId, _id: { $in: projects.map((p) => p.customerId).filter(Boolean) } }, { name: 1 }).lean().exec();
    const customerName = new Map(customers.map((c) => [String(c._id), c.name]));

    const totals = { entries: rows.length, hours: 0, billableHours: 0, unbilledHours: 0, unbilledPaise: 0 };
    for (const r of rows) {
      totals.hours += r.hours;
      if (!r.billable) continue;
      totals.billableHours += r.hours;
      if (r.status !== 'unbilled') continue;
      totals.unbilledHours += r.hours;
      const book = byId.get(String(r.projectId))?.book;
      const rate = book ? rateFor(book, { ratePaise: r.ratePaise, task: r.task, taskId: r.taskId ? String(r.taskId) : null, userId: r.userId, userName: r.userName }).ratePaise : r.ratePaise;
      totals.unbilledPaise += Math.round(r.hours * (rate ?? 0));
    }
    totals.hours = round2(totals.hours);
    totals.billableHours = round2(totals.billableHours);
    totals.unbilledHours = round2(totals.unbilledHours);

    const entries = rows.slice(0, 500).map((r) => {
      const found = byId.get(String(r.projectId));
      const task = r.taskId ? (found?.p.tasks ?? []).find((t) => String(t._id) === String(r.taskId)) : null;
      return {
        id: String(r._id), projectId: String(r.projectId), projectName: found?.p.name ?? '',
        customerId: found?.p.customerId ? String(found.p.customerId) : null, customerName: found?.p.customerId ? customerName.get(String(found.p.customerId)) ?? null : null,
        userId: r.userId, userName: r.userName, loggedBy: r.loggedBy ?? r.userId, date: r.date, hours: r.hours, startTime: r.startTime ?? null, endTime: r.endTime ?? null,
        taskId: r.taskId ? String(r.taskId) : null, task: task?.name ?? r.task, notes: r.notes, billable: r.billable, ratePaise: r.ratePaise, status: r.status, invoiceId: r.invoiceId ? String(r.invoiceId) : null,
      };
    });
    return { entries, totals, truncated: rows.length > entries.length };
  }

  /** Who logged time lately but nothing this past week: a nudge, not a rule. */
  async nudges(orgId: string, today = todayIst()) {
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - 35 * 86_400_000).toISOString().slice(0, 10);
    const rows = await this.timeModel.find({ orgId, date: { $gte: since } }, { userId: 1, userName: 1, date: 1 }).lean().exec();
    return missingTimesheets(rows, today);
  }

  // ── The timer ─────────────────────────────────────────────────────────

  private async timerView(orgId: string, t: { _id: unknown; projectId: Types.ObjectId; taskId: Types.ObjectId | null; task: string; billable: boolean; notes: string | null; startedAt: Date }) {
    const p = await this.projectModel.findOne({ _id: t.projectId, orgId }, { name: 1 }).lean().exec();
    return { id: String(t._id), projectId: String(t.projectId), projectName: p?.name ?? '', taskId: t.taskId ? String(t.taskId) : null, task: t.task, billable: t.billable, notes: t.notes, startedAt: t.startedAt.toISOString() };
  }

  /** Your running timer, or null. */
  async currentTimer(orgId: string, userId: string) {
    const t = await this.timerModel.findOne({ orgId, userId }).lean().exec();
    return t ? this.timerView(orgId, t) : null;
  }

  /** Start your timer: one at a time. */
  async startTimer(orgId: string, userId: string, input: { projectId: string; taskId?: string | null; task?: string | null; billable?: boolean; notes?: string | null }, now = new Date()) {
    const p = await this.find(orgId, input.projectId);
    if (p.status === 'completed') throw new BadRequestException(`${p.name} is completed: reopen it to log time.`);
    const task = this.taskFor(p, input.taskId, input.task);
    try {
      const t = await this.timerModel.create({
        orgId, userId, projectId: p._id, taskId: task.taskId, task: task.task, billable: input.billable ?? task.billable ?? billingMethod(p.billing) !== 'fixed',
        notes: input.notes?.trim().slice(0, 1000) || null, startedAt: now,
      });
      await this.audit.record({ orgId, entityType: 'TimeTimer', entityId: t._id.toString(), action: 'START', performedBy: userId, after: { project: p.name, task: t.task, billable: t.billable, startedAt: now.toISOString() } });
      return this.timerView(orgId, t);
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      const running = await this.currentTimer(orgId, userId);
      throw new ConflictException(`Your timer is already running${running?.projectName ? ` on ${running.projectName}` : ''}: stop it first.`);
    }
  }

  /**
   * Stop your timer: the time from start to now, rounded to the minute (at
   * least one), becomes a time entry on the day it started. The timer goes
   * and the entry comes in one transaction, so the time is never lost; and
   * the entry carries the timer's id under a unique index, so a timer
   * stopped twice at once is logged once, whatever the storage engine's
   * isolation.
   */
  async stopTimer(orgId: string, userId: string, now = new Date()) {
    const session = await this.connection.startSession();
    try {
      let entry: TimeEntryDocument | null = null;
      await session.withTransaction(async () => {
        const t = await this.timerModel.findOneAndDelete({ orgId, userId }, { session }).lean().exec();
        if (!t) throw new NotFoundException('No timer is running.');
        const { minutes, hours } = timerHours(t.startedAt, now);
        if (hours > 24) throw new BadRequestException('The timer ran for more than a day: discard it and log the time by hand.');
        const date = todayIst(t.startedAt);
        const [startTime, endTime] = [istClock(t.startedAt), istClock(now)];
        // The clock times go on the entry when they say the same as the minutes counted.
        const clocks = date === todayIst(now) && spanHours(startTime, endTime) === hours ? { startTime, endTime } : {};
        const p = await this.find(orgId, String(t.projectId));
        const taskId = t.taskId && (p.tasks ?? []).some((x) => String(x._id) === String(t.taskId)) ? String(t.taskId) : null;
        entry = await this.logTime(
          orgId, userId,
          { projectId: String(t.projectId), date, hours, ...clocks, taskId, task: t.task, billable: t.billable, notes: t.notes },
          { session, timerId: String(t._id), meta: { fromTimer: { timerId: String(t._id), startedAt: t.startedAt.toISOString(), stoppedAt: now.toISOString(), minutes } } },
        );
      });
      return entry!;
    } catch (err) {
      // The same timer, logged a moment ago by another stop.
      if ((err as { code?: number }).code === 11000) throw new NotFoundException('No timer is running: it was just stopped.');
      throw err;
    } finally {
      await session.endSession();
    }
  }

  /** Throw your timer away without logging anything. */
  async discardTimer(orgId: string, userId: string) {
    const t = await this.timerModel.findOneAndDelete({ orgId, userId }).lean().exec();
    if (!t) throw new NotFoundException('No timer is running.');
    await this.audit.record({ orgId, entityType: 'TimeTimer', entityId: String(t._id), action: 'DISCARD', performedBy: userId, before: { projectId: String(t.projectId), task: t.task, startedAt: t.startedAt.toISOString() } });
    return { discarded: true };
  }

  // ── Billing time ──────────────────────────────────────────────────────

  /** What would go on the invoice: unbilled billable time to a date, as lines at the method's rates. */
  async unbilled(orgId: string, projectId: string, through = todayIst()) {
    const p = await this.find(orgId, projectId);
    const entries = await this.timeModel.find({ orgId, projectId: p._id, status: 'unbilled', billable: true, date: { $lte: through } }).lean().exec();
    const method = billingMethod(p.billing);
    const { groups, unpriced, missing } = groupTime(
      entries.map((e) => ({ id: String(e._id), date: e.date, hours: e.hours, task: e.task, taskId: e.taskId ? String(e.taskId) : null, notes: e.notes, ratePaise: e.ratePaise, userId: e.userId, userName: e.userName })),
      rateBook(p),
    );
    return {
      project: p,
      method,
      groups,
      unpriced,
      missing,
      lines: groups.map((g) => ({ description: lineDescription(g), hours: g.hours, ratePaise: g.ratePaise, amountPaise: lineAmount({ qty: g.hours, ratePaise: g.ratePaise }), entries: g.entryIds.length })),
    };
  }

  /**
   * A draft invoice from unbilled time: a line per task and rate (and person,
   * by staff hours), at the project's service item. Each hour is priced by
   * the billing method: the project's rate, the task's, or the person's; time
   * with no rate under its method stops the draft, naming the task or person.
   * A fixed fee bills only time with a rate, as before. The time is held
   * while the draft is made, so it cannot go on two invoices. With a model, a
   * job words each line from the time notes afterwards, if the draft is
   * still untouched.
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
    const { project: p, method, groups, missing } = await this.unbilled(orgId, projectId, through);
    if (!p.customerId) throw new BadRequestException('An internal project has no one to invoice.');
    if (method !== 'fixed' && missing.length) throw new BadRequestException(missingRateMessage(method, missing));
    if (!groups.length) throw new BadRequestException(method === 'fixed' ? 'No unbilled time with a rate to invoice. Give the project a rate per hour, or the time its own.' : 'No unbilled time to invoice.');
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
      await this.audit.record({ orgId, entityType: 'Project', entityId: String(p._id), action: 'BILL_TIME', performedBy: actorId, after: { invoiceId: String(invoice._id), entries: ids.length, hours, through, method } });

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
    let answer: Awaited<ReturnType<ReportModel['json']>>;
    try {
      answer = await this.model.json(timeLinesPrompt(project, groups), 500);
    } catch (err) {
      // A model error ends the wait; the draft keeps the task and dates as its wording.
      s.set({ status: 'none', reason: `${aiFailureReason(err)} The lines keep the task and dates.` });
      await s.save();
      return;
    }
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
