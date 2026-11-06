import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditService } from '../../gl/audit.service';
import { isMoneyAccount } from '../../gl/money-accounts';
import { todayIst } from '../../automation/schedule';
import { ReportTable } from '../report-table';
import { CustomReport, CustomReportDocument, ReportCondition } from '../schemas/custom-report.schema';
import { ReportPreference, ReportPreferenceDocument } from '../schemas/report-preference.schema';
import { ReportSchedule, ReportScheduleDocument } from '../schemas/report-schedule.schema';
import { ReportDataService } from './report-data.service';
import { CenterEntry, EXTRA_BY_KEY, builtInEntries, cleanParams } from './index';
import { CATEGORIES, CategoryKey, FilterKind, RunParams, categoryLabel } from './types';
import { checkCustomization, customize } from './customize';
import { MODULE_BY_KEY, checkModuleSpec, moduleCatalog, runModule } from './modules';
import { monthEnd, rangeLabel } from '../management';

/** What the catalog lends the Center: its own reports, how to run any of them, and what a relative period means today. */
export interface BaseCatalog {
  list: Array<{ key: string; title: string; params: 'range' | 'today' | 'year' }>;
  run: (key: string, p: RunParams) => Promise<ReportTable>;
  resolve: (period: string, today: string) => { from: string; to: string; financialYear: string; through: string };
}

export interface CustomInput {
  name: string;
  description?: string | null;
  kind: 'derived' | 'module';
  baseKey?: string | null;
  module?: string | null;
  params?: Record<string, string>;
  period?: string | null;
  columns?: string[];
  conditions?: ReportCondition[];
  groupBy?: string | null;
  groupTotalsOnly?: boolean;
  sortBy?: string | null;
  sortDir?: 'asc' | 'desc';
  shared?: boolean;
}

const CUSTOM_KEY = /^custom\.([a-f0-9]{24})$/;
const PERIODS = ['last_month', 'this_month', 'last_quarter', 'this_fy', 'last_fy'];
const PARAM_KEYS = ['from', 'to', 'financialYear', 'through', 'asOf', 'quarter', 'customerId', 'vendorId', 'accountId', 'projectId', 'itemId', 'userId', 'status', 'detail'] as const;
const MODULE_CATEGORY: Record<string, CategoryKey> = { invoices: 'sales', bills: 'payables', expenses: 'purchases', payments: 'payments_received', journal_lines: 'accountant', items: 'inventory', customers: 'receivables', vendors: 'payables', time_entries: 'projects' };

export const customKey = (id: string) => `custom.${id}`;

/**
 * The Reports Center: every report with its category, each person's
 * favourites and last visits, and the reports people make their own.
 * Runs reports; never writes to the books. What it saves (favourites,
 * custom report definitions) is audited; a visit is only a timestamp.
 */
@Injectable()
export class ReportCenterService {
  constructor(
    private data: ReportDataService,
    private audit: AuditService,
    @InjectModel(CustomReport.name) private customModel: Model<CustomReportDocument>,
    @InjectModel(ReportPreference.name) private prefModel: Model<ReportPreferenceDocument>,
    @Optional() @InjectModel(ReportSchedule.name) private scheduleModel?: Model<ReportScheduleDocument>,
  ) {}

  /** A key the Center runs: one of its built-in reports, or a custom report's. */
  has(key: string): boolean {
    return EXTRA_BY_KEY.has(key) || CUSTOM_KEY.test(key);
  }

  entries(base: BaseCatalog): CenterEntry[] {
    return builtInEntries(base.list);
  }

  private entry(base: BaseCatalog, key: string): CenterEntry {
    const e = this.entries(base).find((x) => x.key === key);
    if (!e) throw new BadRequestException(`No report called ${key}.`);
    return e;
  }

  private async customDoc(orgId: string, key: string, viewer?: string): Promise<CustomReportDocument> {
    const id = CUSTOM_KEY.exec(key)?.[1] ?? (Types.ObjectId.isValid(key) ? key : null);
    const doc = id ? await this.customModel.findOne({ _id: id, orgId }).exec() : null;
    // Someone else's private report is as good as not there.
    if (!doc || (viewer && !doc.shared && doc.createdBy !== viewer)) throw new NotFoundException('No such report.');
    return doc;
  }

  async title(orgId: string, key: string): Promise<string> {
    if (EXTRA_BY_KEY.has(key)) return EXTRA_BY_KEY.get(key)!.title;
    if (CUSTOM_KEY.test(key)) return (await this.customDoc(orgId, key).catch(() => null))?.name ?? 'A removed report';
    return key;
  }

  async exists(orgId: string, key: string, viewer?: string): Promise<boolean> {
    if (EXTRA_BY_KEY.has(key)) return true;
    if (!CUSTOM_KEY.test(key)) return false;
    return !!(await this.customDoc(orgId, key, viewer).catch(() => null));
  }

  /** Run a built-in report of the Center's, or a custom report, with only the parameters it accepts. */
  async run(orgId: string, key: string, p: RunParams, viewer: string | undefined, base: BaseCatalog): Promise<ReportTable> {
    const def = EXTRA_BY_KEY.get(key);
    if (def) return def.run({ orgId, p: cleanParams(def, p), data: this.data, today: todayIst() });
    const doc = await this.customDoc(orgId, key, viewer);
    return this.runSpec(orgId, this.specOf(doc), p, base, { key, title: doc.name });
  }

  private specOf(doc: CustomReportDocument | CustomReport): Required<CustomInput> {
    return {
      name: doc.name, description: doc.description ?? null, kind: doc.kind, baseKey: doc.baseKey ?? null, module: doc.module ?? null, params: { ...(doc.params ?? {}) }, period: doc.period ?? null,
      columns: [...(doc.columns ?? [])], conditions: (doc.conditions ?? []).map((c) => ({ field: c.field, op: c.op, value: c.value })), groupBy: doc.groupBy ?? null,
      groupTotalsOnly: !!doc.groupTotalsOnly, sortBy: doc.sortBy ?? null, sortDir: doc.sortDir ?? 'asc', shared: !!doc.shared,
    };
  }

  /** The saved parameters, the relative period as of today, then whatever the run asks for. */
  private paramsFor(spec: Required<CustomInput>, p: RunParams, base: BaseCatalog): RunParams {
    const out: RunParams = {};
    for (const k of PARAM_KEYS) if (spec.params[k]) out[k] = spec.params[k];
    if (spec.period) Object.assign(out, base.resolve(spec.period, todayIst()));
    for (const k of PARAM_KEYS) if (p[k]) out[k] = p[k];
    return out;
  }

  private async runSpec(orgId: string, spec: Required<CustomInput>, p: RunParams, base: BaseCatalog, meta: { key: string; title: string }): Promise<ReportTable> {
    const params = this.paramsFor(spec, p, base);
    if (spec.kind === 'derived') {
      const e = this.entry(base, spec.baseKey ?? '');
      const table = await base.run(e.key, params);
      return customize(table, e.shape, spec, meta);
    }
    const mod = MODULE_BY_KEY.get(spec.module ?? '');
    if (!mod) throw new BadRequestException('Pick a module.');
    let span: { fromDate: string; toDate: string; label: string } | null = null;
    if (mod.dateField) {
      const r = this.data.management.range(params.from, params.to);
      span = { fromDate: `${r.from}-01`, toDate: monthEnd(r.to), label: rangeLabel(r.from, r.to) };
    }
    return runModule(this.data, orgId, { ...spec, module: mod.key }, span, meta);
  }

  /** Check a definition before it is saved: names, keys, values; and that it runs. */
  private async check(orgId: string, input: CustomInput, base: BaseCatalog): Promise<Required<CustomInput>> {
    const name = (input.name ?? '').trim();
    if (name.length < 2 || name.length > 120) throw new BadRequestException('Name the report, two to 120 letters.');
    if (input.period && !PERIODS.includes(input.period)) throw new BadRequestException('Pick a period.');
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.params ?? {})) {
      if (!(PARAM_KEYS as readonly string[]).includes(k)) throw new BadRequestException(`${k} is not a report setting.`);
      if (v === null || v === undefined || v === '') continue;
      if (typeof v !== 'string' || v.length > 40) throw new BadRequestException(`${k} is not valid.`);
      params[k] = v;
    }
    const spec: Required<CustomInput> = {
      name, description: input.description?.trim().slice(0, 500) || null, kind: input.kind, baseKey: input.baseKey ?? null, module: input.module ?? null, params, period: input.period ?? null,
      columns: input.columns ?? [], conditions: input.conditions ?? [], groupBy: input.groupBy ?? null, groupTotalsOnly: !!input.groupTotalsOnly, sortBy: input.sortBy ?? null, sortDir: input.sortDir ?? 'asc', shared: !!input.shared,
    };
    if (!['asc', 'desc'].includes(spec.sortDir)) throw new BadRequestException('Sort up or down.');
    if (spec.kind === 'derived') {
      if (spec.module) throw new BadRequestException('A report from an existing one has no module.');
      if (spec.baseKey && CUSTOM_KEY.test(spec.baseKey)) throw new BadRequestException('Start from a built-in report.');
      const e = this.entry(base, spec.baseKey ?? '');
      // The base report's own filters, checked the way a run checks them.
      cleanParams({ filters: e.filters }, params);
      const table = await base.run(e.key, this.paramsFor(spec, {}, base));
      checkCustomization(table.columns, e.shape, spec);
    } else if (spec.kind === 'module') {
      if (spec.baseKey) throw new BadRequestException('A new report has no base report.');
      checkModuleSpec(spec as Required<CustomInput> & { module: string });
      for (const k of Object.keys(params)) if (!['from', 'to'].includes(k)) throw new BadRequestException('A new report takes a period only.');
    } else {
      throw new BadRequestException('Start from a report or a module.');
    }
    return spec;
  }

  async preview(orgId: string, input: CustomInput, p: RunParams, base: BaseCatalog): Promise<ReportTable> {
    // An unsaved report may have no name yet.
    const spec = await this.check(orgId, { ...input, name: (input.name?.trim().length ?? 0) >= 2 ? input.name : 'Preview' }, base);
    return this.runSpec(orgId, spec, p, base, { key: 'preview', title: spec.name });
  }

  private view(doc: CustomReportDocument, viewer: string) {
    const s = this.specOf(doc);
    return { id: String(doc._id), key: customKey(String(doc._id)), ...s, createdBy: doc.createdBy, createdByName: doc.createdByName ?? null, mine: doc.createdBy === viewer, updatedAt: (doc as unknown as { updatedAt?: Date }).updatedAt ?? null };
  }

  async listCustom(orgId: string, viewer: string) {
    const docs = await this.customModel.find({ orgId, $or: [{ createdBy: viewer }, { shared: true }] }).sort({ name: 1 }).exec();
    return docs.map((d) => this.view(d, viewer));
  }

  async getCustom(orgId: string, viewer: string, id: string) {
    return this.view(await this.customDoc(orgId, id, viewer), viewer);
  }

  async createCustom(orgId: string, actorId: string, input: CustomInput, base: BaseCatalog) {
    const spec = await this.check(orgId, input, base);
    const createdByName = (await this.data.userNames([actorId])).get(actorId) ?? null;
    const doc = await this.customModel.create({ orgId, ...spec, createdBy: actorId, createdByName });
    await this.audit.record({ orgId, entityType: 'CustomReport', entityId: String(doc._id), action: 'CREATE', performedBy: actorId, before: null, after: { ...spec } });
    return this.view(doc, actorId);
  }

  /** Only its creator changes a report; anyone it is shared with can run it. */
  async updateCustom(orgId: string, actorId: string, id: string, input: CustomInput, base: BaseCatalog) {
    const doc = await this.customDoc(orgId, id, actorId);
    if (doc.createdBy !== actorId) throw new BadRequestException('Only the person who made this report can change it. Make your own from it instead.');
    const before = this.specOf(doc);
    const spec = await this.check(orgId, input, base);
    doc.set({ ...spec });
    await doc.save();
    await this.audit.record({ orgId, entityType: 'CustomReport', entityId: id, action: before.shared !== spec.shared ? (spec.shared ? 'SHARE' : 'UNSHARE') : 'UPDATE', performedBy: actorId, before: { ...before }, after: { ...spec } });
    return this.view(doc, actorId);
  }

  async deleteCustom(orgId: string, actorId: string, id: string) {
    const doc = await this.customDoc(orgId, id, actorId);
    if (doc.createdBy !== actorId) throw new BadRequestException('Only the person who made this report can delete it.');
    const before = this.specOf(doc);
    await this.customModel.deleteOne({ _id: doc._id, orgId }).exec();
    await this.prefModel.deleteMany({ orgId, key: customKey(id) }).exec();
    await this.audit.record({ orgId, entityType: 'CustomReport', entityId: id, action: 'DELETE', performedBy: actorId, before: { ...before }, after: null });
    return { deleted: true };
  }

  // ── Favourites and visits, per org and person ───────────────────────────

  private async checkKey(orgId: string, key: string, viewer: string, base: BaseCatalog) {
    const known = this.entries(base).some((e) => e.key === key) || (CUSTOM_KEY.test(key) && (await this.exists(orgId, key, viewer)));
    if (!known) throw new NotFoundException('No such report.');
  }

  async setFavourite(orgId: string, userId: string, key: string, favourite: boolean, base: BaseCatalog) {
    await this.checkKey(orgId, key, userId, base);
    const before = await this.prefModel.findOne({ orgId, userId, key }).lean().exec();
    if (!!before?.favourite === favourite) return { key, favourite };
    await this.prefModel.updateOne({ orgId, userId, key }, { $set: { favourite } }, { upsert: true }).exec();
    await this.audit.record({ orgId, entityType: 'ReportFavourite', entityId: `${userId}:${key}`, action: favourite ? 'STAR' : 'UNSTAR', performedBy: userId, before: { favourite: !!before?.favourite }, after: { favourite } });
    return { key, favourite };
  }

  /** When the person last opened the report: what Last visited shows. Not audited: it records a look, not a change. */
  async visit(orgId: string, userId: string, key: string, base: BaseCatalog) {
    await this.checkKey(orgId, key, userId, base);
    const at = new Date();
    await this.prefModel.updateOne({ orgId, userId, key }, { $set: { lastVisitedAt: at } }, { upsert: true }).exec();
    return { key, lastVisitedAt: at.toISOString() };
  }

  /** Everything the Reports Center page lists for one person. */
  async center(orgId: string, userId: string, base: BaseCatalog) {
    const [prefs, custom, schedules] = await Promise.all([
      this.prefModel.find({ orgId, userId }).lean().exec(),
      this.customModel.find({ orgId, $or: [{ createdBy: userId }, { shared: true }] }).sort({ name: 1 }).exec(),
      this.scheduleModel ? this.scheduleModel.countDocuments({ orgId, active: true }).exec() : Promise.resolve(0),
    ]);
    const pref = new Map(prefs.map((p) => [p.key, p]));
    const entries = this.entries(base);
    const byKey = new Map(entries.map((e) => [e.key, e]));
    const reports = [
      ...entries.map((e) => ({ ...e, createdBy: 'System Generated', custom: false, shared: false, mine: false, kind: 'built_in' as const, baseKey: null as string | null })),
      ...custom.map((d) => {
        const baseEntry = d.baseKey ? byKey.get(d.baseKey) : undefined;
        const category = baseEntry?.category ?? MODULE_CATEGORY[d.module ?? ''] ?? 'business';
        return {
          key: customKey(String(d._id)), title: d.name, category, categoryLabel: categoryLabel(category), description: d.description ?? (baseEntry ? `From ${baseEntry.title}` : `From ${MODULE_BY_KEY.get(d.module ?? '')?.label ?? 'a module'}`),
          params: baseEntry?.params ?? (MODULE_BY_KEY.get(d.module ?? '')?.dateField ? 'range' : 'today'), filters: baseEntry?.filters ?? [], shape: baseEntry?.shape ?? 'list',
          createdBy: d.createdBy === userId ? 'You' : d.createdByName ?? 'Someone in your organisation', custom: true, shared: d.shared, mine: d.createdBy === userId, kind: d.kind, baseKey: d.baseKey ?? null,
        };
      }),
    ].map((r) => ({ ...r, favourite: !!pref.get(r.key)?.favourite, lastVisitedAt: pref.get(r.key)?.lastVisitedAt?.toISOString() ?? null }));
    return {
      categories: CATEGORIES.map((c) => ({ ...c, count: reports.filter((r) => r.category === c.key).length })),
      reports,
      counts: { all: reports.length, favourites: reports.filter((r) => r.favourite).length, shared: reports.filter((r) => r.custom && r.shared).length, mine: reports.filter((r) => r.custom && r.mine).length, scheduled: schedules },
    };
  }

  /** One report's period, filters and (for a custom one) its definition, for the report page. */
  async definition(orgId: string, userId: string, key: string, base: BaseCatalog) {
    const pref = await this.prefModel.findOne({ orgId, userId, key }).lean().exec();
    if (CUSTOM_KEY.test(key)) {
      const doc = await this.customDoc(orgId, key, userId);
      const c = this.view(doc, userId);
      const baseEntry = doc.baseKey ? this.entries(base).find((e) => e.key === doc.baseKey) : undefined;
      const mod = MODULE_BY_KEY.get(doc.module ?? '');
      const category = baseEntry?.category ?? MODULE_CATEGORY[doc.module ?? ''] ?? 'business';
      return {
        key, title: doc.name, category, categoryLabel: categoryLabel(category), description: doc.description ?? '', params: baseEntry?.params ?? (mod?.dateField ? 'range' : 'today'),
        filters: baseEntry?.filters ?? [], shape: baseEntry?.shape ?? 'list', createdBy: c.mine ? 'You' : c.createdByName ?? 'Someone in your organisation', custom: c, favourite: !!pref?.favourite,
      };
    }
    const e = this.entry(base, key);
    return { ...e, createdBy: 'System Generated', custom: null, favourite: !!pref?.favourite };
  }

  modules() {
    return moduleCatalog();
  }

  /** The choices for a filter: customers, vendors, accounts, projects, items, people. */
  async options(orgId: string, kind: FilterKind): Promise<Array<{ value: string; label: string }>> {
    const named = async (m: Model<{ name: string }>, extra: Record<string, unknown> = {}) =>
      (await m.find({ orgId, ...extra }, { name: 1 }).sort({ name: 1 }).limit(2000).lean().exec()).map((x) => ({ value: String(x._id), label: x.name }));
    switch (kind) {
      case 'customer': return named(this.data.customers as unknown as Model<{ name: string }>);
      case 'vendor': return named(this.data.vendors as unknown as Model<{ name: string }>);
      case 'item': return named(this.data.items as unknown as Model<{ name: string }>);
      case 'project': return this.data.has('projects') ? named(this.data.projects as unknown as Model<{ name: string }>) : [];
      case 'account':
      case 'money_account': {
        const chart = [...(await this.data.chart(orgId)).values()].filter((a) => !a.isGroup && (kind === 'account' || isMoneyAccount(a))).sort((a, b) => a.code.localeCompare(b.code));
        return chart.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }));
      }
      case 'user': {
        const members = await this.data.memberships.find({ orgId }, { userId: 1 }).lean().exec();
        const names = await this.data.userNames(members.map((m) => m.userId));
        return members.map((m) => ({ value: String(m.userId), label: names.get(String(m.userId)) ?? 'Former user' })).sort((a, b) => a.label.localeCompare(b.label));
      }
      default: throw new BadRequestException('No such list.');
    }
  }
}
