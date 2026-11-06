/**
 * A report built from scratch on one module's fields: invoices, bills,
 * expenses, payments, journal lines, items, customers, vendors or time.
 *
 * The query layer only reads, always scopes to the org, and only ever uses
 * the field paths and operators listed here. What a person picks arrives
 * as a field key and an operator name; both are looked up in these tables
 * and anything else is refused, so no input becomes a Mongo operator or a
 * field path. Values are typed and checked: text is matched as escaped
 * text, money is whole paise, a date is YYYY-MM-DD.
 */
import { BadRequestException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { JournalStatus, VoucherType } from '@ai-accounting/shared';
import { outstandingPaise } from '../../gl/schemas/settlement.schema';
import { ReportColumn, ReportRow, ReportTable } from '../report-table';
import type { ReportCondition } from '../schemas/custom-report.schema';
import type { ReportDataService } from './report-data.service';
import { DONE_BILL, DONE_INVOICE, gstOf } from './documents';

export type FieldKind = 'text' | 'money' | 'number' | 'date' | 'bool';
type Lookup = 'customers' | 'vendors' | 'items' | 'projects' | 'accounts';
type Doc = Record<string, unknown>;

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  /** The document path it reads; absent for a worked-out field. */
  path?: string;
  /** An id shown as the name of what it points at. */
  lookup?: Lookup;
  /** A worked-out field, from the paths in `needs`. */
  get?: (d: Doc) => string | number | boolean | null;
  needs?: string[];
  /** Values a text field takes, as [value, label]. */
  options?: Array<[string, string]>;
  /** Adds up in a total. */
  sum?: boolean;
}

export interface ModuleDef {
  key: string;
  label: string;
  /** The path the report's period applies to. */
  dateField?: string;
  /** Lines of journals: one row per line. */
  unwind?: 'lines';
  fields: FieldDef[];
}

const pick = (d: Doc, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Doc)[k] : undefined), d);
const amounts = (d: Doc) => (d.amountsPaise ?? { cgst: 0, sgst: 0, igst: 0, cess: 0 }) as { cgst: number; sgst: number; igst: number; cess: number };
const month = (path: string): FieldDef => ({ key: 'month', label: 'Month', kind: 'text', needs: [path], get: (d) => String(pick(d, path) ?? '').slice(0, 7) || null });
const money = (key: string, label: string, path: string): FieldDef => ({ key, label, kind: 'money', path, sum: true });
const text = (key: string, label: string, path: string, options?: Array<[string, string]>): FieldDef => ({ key, label, kind: 'text', path, options });
const date = (key: string, label: string, path: string): FieldDef => ({ key, label, kind: 'date', path });

const DOC_TAX: FieldDef[] = [
  money('taxable', 'Taxable value', 'amountsPaise.taxableValue'),
  money('cgst', 'CGST', 'amountsPaise.cgst'),
  money('sgst', 'SGST', 'amountsPaise.sgst'),
  money('igst', 'IGST', 'amountsPaise.igst'),
  money('cess', 'Cess', 'amountsPaise.cess'),
  { key: 'gst', label: 'GST', kind: 'money', sum: true, needs: ['amountsPaise'], get: (d) => gstOf(amounts(d)) },
  money('total', 'Total', 'amountsPaise.total'),
];
const SETTLED_NEEDS = ['status', 'amountsPaise', 'amountPaidPaise', 'adjustedPaise', 'isReverseCharge', 'tds'];
const balance: FieldDef = { key: 'balance', label: 'Balance due', kind: 'money', sum: true, needs: SETTLED_NEEDS, get: (d) => outstandingPaise(d as unknown as Parameters<typeof outstandingPaise>[0]) };

export const MODULES: ModuleDef[] = [
  {
    key: 'invoices', label: 'Invoices', dateField: 'invoiceDate',
    fields: [
      date('date', 'Invoice date', 'invoiceDate'), month('invoiceDate'), text('number', 'Invoice number', 'invoiceNumber'),
      { key: 'customer', label: 'Customer', kind: 'text', path: 'customerId', lookup: 'customers' },
      text('status', 'Status', 'status', [['posted', 'Posted'], ['paid', 'Paid']]), date('due', 'Due date', 'dueDate'),
      text('salesperson', 'Salesperson', 'salespersonName'), text('reference', 'Reference', 'referenceNumber'), text('subject', 'Subject', 'subject'),
      ...DOC_TAX, money('paid', 'Paid', 'amountPaidPaise'), money('credited', 'Credit notes', 'adjustedPaise'), balance, text('fy', 'Financial year', 'financialYear'),
    ],
  },
  {
    key: 'bills', label: 'Bills', dateField: 'billDate',
    fields: [
      date('date', 'Bill date', 'billDate'), month('billDate'), text('number', 'Bill number', 'billNumber'),
      { key: 'vendor', label: 'Vendor', kind: 'text', path: 'vendorId', lookup: 'vendors' },
      text('status', 'Status', 'status', [['posted', 'Posted'], ['paid', 'Paid']]), date('due', 'Due date', 'dueDate'), text('order', 'Order number', 'orderNumber'),
      { key: 'rcm', label: 'Reverse charge', kind: 'bool', path: 'isReverseCharge' },
      ...DOC_TAX, money('tds', 'TDS', 'tds.amountPaise'), text('tdsSection', 'TDS section', 'tds.section'), money('paid', 'Paid', 'amountPaidPaise'), money('credited', 'Vendor credits', 'adjustedPaise'), balance, text('fy', 'Financial year', 'financialYear'),
    ],
  },
  {
    key: 'expenses', label: 'Expenses', dateField: 'date',
    fields: [
      date('date', 'Date', 'date'), month('date'), text('number', 'Expense number', 'number'), text('kind', 'Kind', 'kind', [['expense', 'Expense'], ['mileage', 'Mileage']]),
      { key: 'vendor', label: 'Vendor', kind: 'text', path: 'vendorId', lookup: 'vendors' },
      { key: 'account', label: 'Expense account', kind: 'text', path: 'expenseAccountId', lookup: 'accounts' },
      { key: 'paidThrough', label: 'Paid through', kind: 'text', path: 'paidThroughAccountId', lookup: 'accounts' },
      { key: 'project', label: 'Project', kind: 'text', path: 'projectId', lookup: 'projects' },
      { key: 'customer', label: 'Customer', kind: 'text', path: 'customerId', lookup: 'customers' },
      { key: 'billable', label: 'Billable', kind: 'bool', path: 'billable' },
      money('taxable', 'Amount before GST', 'taxablePaise'),
      { key: 'gst', label: 'GST', kind: 'money', sum: true, needs: ['cgstPaise', 'sgstPaise', 'igstPaise'], get: (d) => Number(d.cgstPaise ?? 0) + Number(d.sgstPaise ?? 0) + Number(d.igstPaise ?? 0) },
      money('total', 'Total', 'totalPaise'), text('reference', 'Reference', 'reference'), text('notes', 'Notes', 'notes'),
    ],
  },
  {
    key: 'payments', label: 'Payments received and made', dateField: 'date',
    fields: [
      date('date', 'Date', 'date'), month('date'), text('number', 'Number', 'number'), text('kind', 'Kind', 'kind', [['receipt', 'Received from a customer'], ['payment', 'Paid to a vendor']]),
      text('party', 'Customer or vendor', 'partyName'), text('mode', 'Mode', 'mode', [['cash', 'Cash'], ['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['upi', 'UPI'], ['card', 'Card'], ['other', 'Other']]),
      text('account', 'Bank or cash account', 'depositAccountName'), money('amount', 'Amount', 'amountPaise'), money('tds', 'TDS', 'tdsPaise'), money('charges', 'Bank charges', 'bankChargesPaise'), money('unapplied', 'Advance not yet applied', 'unappliedPaise'), text('reference', 'Reference', 'reference'),
    ],
  },
  {
    key: 'journal_lines', label: 'Journal lines', dateField: 'date', unwind: 'lines',
    fields: [
      date('date', 'Date', 'date'), month('date'), text('voucherType', 'Voucher type', 'voucherType', Object.values(VoucherType).map((v) => [v, v] as [string, string])),
      { key: 'voucherNumber', label: 'Voucher number', kind: 'number', path: 'voucherNumber' }, text('fy', 'Financial year', 'financialYear'), text('narration', 'Narration', 'narration'),
      { key: 'account', label: 'Account', kind: 'text', path: 'lines.accountId', lookup: 'accounts' },
      text('lineText', 'Line description', 'lines.description'),
      money('debit', 'Debit', 'lines.debitPaise'), money('credit', 'Credit', 'lines.creditPaise'),
      { key: 'net', label: 'Net (Dr +)', kind: 'money', sum: true, needs: ['lines.debitPaise', 'lines.creditPaise'], get: (d) => Number(pick(d, 'lines.debitPaise') ?? 0) - Number(pick(d, 'lines.creditPaise') ?? 0) },
      { key: 'project', label: 'Project', kind: 'text', path: 'lines.projectId', lookup: 'projects' },
    ],
  },
  {
    key: 'items', label: 'Items',
    fields: [
      text('name', 'Name', 'name'), text('code', 'Code', 'code'), text('kind', 'Kind', 'kind', [['goods', 'Goods'], ['service', 'Service']]), text('hsn', 'HSN / SAC', 'hsnSac'), text('uqc', 'Unit', 'uqc'),
      { key: 'gstRate', label: 'GST rate %', kind: 'number', path: 'gstRatePct' },
      { key: 'salePrice', label: 'Sale price', kind: 'money', path: 'salePricePaise' }, { key: 'purchasePrice', label: 'Purchase price', kind: 'money', path: 'purchasePricePaise' },
      { key: 'forSale', label: 'Sold', kind: 'bool', path: 'forSale' }, { key: 'forPurchase', label: 'Bought', kind: 'bool', path: 'forPurchase' }, { key: 'trackStock', label: 'Counted in stock', kind: 'bool', path: 'trackStock' }, { key: 'active', label: 'Active', kind: 'bool', path: 'isActive' },
    ],
  },
  {
    key: 'customers', label: 'Customers',
    fields: [
      text('name', 'Name', 'name'), text('company', 'Company', 'companyName'), text('gstin', 'GSTIN', 'gstin'), text('pan', 'PAN', 'pan'), text('email', 'Email', 'email'), text('phone', 'Phone', 'phone'),
      text('city', 'City', 'city'), text('state', 'State code', 'stateCode'), text('currency', 'Currency', 'currency'), text('terms', 'Payment terms', 'paymentTerms'),
    ],
  },
  {
    key: 'vendors', label: 'Vendors',
    fields: [
      text('name', 'Name', 'name'), text('company', 'Company', 'companyName'), text('gstin', 'GSTIN', 'gstin'), text('pan', 'PAN', 'pan'), text('email', 'Email', 'email'), text('phone', 'Phone', 'phone'),
      text('city', 'City', 'city'), text('tdsSection', 'TDS section', 'tdsSection'), text('currency', 'Currency', 'currency'), text('terms', 'Payment terms', 'paymentTerms'),
      { key: 'msme', label: 'MSME category', kind: 'text', needs: ['msme'], get: (d) => ((d.msme as { category?: string } | null)?.category ?? null) },
    ],
  },
  {
    key: 'time_entries', label: 'Time entries', dateField: 'date',
    fields: [
      date('date', 'Date', 'date'), month('date'), { key: 'project', label: 'Project', kind: 'text', path: 'projectId', lookup: 'projects' }, text('person', 'Person', 'userName'), text('task', 'Task', 'task'),
      { key: 'hours', label: 'Hours', kind: 'number', path: 'hours', sum: true }, { key: 'billable', label: 'Billable', kind: 'bool', path: 'billable' },
      text('status', 'Status', 'status', [['unbilled', 'Unbilled'], ['billing', 'Being billed'], ['billed', 'Billed']]), { key: 'rate', label: 'Rate an hour', kind: 'money', path: 'ratePaise' }, text('notes', 'Notes', 'notes'),
    ],
  },
];
export const MODULE_BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

/** What each module reads before any condition: posted documents only, so figures agree with the books. */
function baseFilter(module: string): Record<string, unknown> {
  switch (module) {
    case 'invoices': return { status: { $in: DONE_INVOICE }, isOpeningBalance: { $ne: true } };
    case 'bills': return { status: { $in: DONE_BILL }, isOpeningBalance: { $ne: true } };
    case 'expenses': return { status: 'posted' };
    case 'payments': return { status: 'posted' };
    case 'journal_lines': return { status: JournalStatus.POSTED };
    default: return {};
  }
}

function modelFor(data: ReportDataService, module: string): Model<Doc> {
  const m = {
    invoices: () => data.invoices, bills: () => data.bills, expenses: () => data.expenses, payments: () => data.payments,
    journal_lines: () => data.journals, items: () => data.items, customers: () => data.customers, vendors: () => data.vendors, time_entries: () => data.time,
  }[module];
  if (!m) throw new BadRequestException('Pick a module.');
  return m() as unknown as Model<Doc>;
}

export const OPS: Record<FieldKind, readonly string[]> = {
  text: ['contains', 'equals', 'not_equals'],
  date: ['equals', 'gt', 'gte', 'lt', 'lte'],
  money: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte'],
  number: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte'],
  bool: ['is_true', 'is_false'],
};
/** Operator names to the only Mongo operators the layer ever writes. */
const MONGO_OP: Record<string, string> = { equals: '$eq', not_equals: '$ne', gt: '$gt', gte: '$gte', lt: '$lt', lte: '$lte' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface ModuleSpec {
  module: string;
  columns: string[];
  conditions: ReportCondition[];
  groupBy: string | null;
  groupTotalsOnly: boolean;
  sortBy: string | null;
  sortDir: 'asc' | 'desc';
}

/** Every key and value checked against the module's lists; returns the module. */
export function checkModuleSpec(spec: ModuleSpec): ModuleDef {
  const mod = MODULE_BY_KEY.get(spec.module);
  if (!mod) throw new BadRequestException('Pick a module.');
  const fields = new Map(mod.fields.map((f) => [f.key, f]));
  if (!Array.isArray(spec.columns) || spec.columns.length < 1 || spec.columns.length > 20) throw new BadRequestException('Pick one to twenty fields.');
  if (new Set(spec.columns).size !== spec.columns.length) throw new BadRequestException('Each field once.');
  for (const c of spec.columns) if (!fields.has(c)) throw new BadRequestException(`${mod.label} have no field ${c}.`);
  if (spec.conditions.length > 10) throw new BadRequestException('Ten conditions at most.');
  for (const c of spec.conditions) {
    const f = fields.get(c.field);
    if (!f) throw new BadRequestException(`${mod.label} have no field ${c.field}.`);
    if (!OPS[f.kind].includes(c.op)) throw new BadRequestException(`${c.op} does not apply to ${f.label}.`);
    if (f.kind === 'bool') continue;
    if (f.kind === 'text' && (typeof c.value !== 'string' || c.value.length > 100)) throw new BadRequestException(`${f.label}: text up to 100 letters.`);
    if (f.kind === 'date' && (typeof c.value !== 'string' || !DATE.test(c.value))) throw new BadRequestException(`${f.label}: a date like 2026-11-30.`);
    if ((f.kind === 'money' || f.kind === 'number') && (typeof c.value !== 'number' || !Number.isFinite(c.value))) throw new BadRequestException(`${f.label}: a number.`);
    if (f.kind === 'money' && !Number.isInteger(c.value)) throw new BadRequestException(`${f.label}: whole paise.`);
  }
  if (spec.groupBy) {
    const g = fields.get(spec.groupBy);
    if (!g || !['text', 'date', 'bool'].includes(g.kind)) throw new BadRequestException('Group by a text, date or yes-no field.');
  }
  if (spec.sortBy && !fields.has(spec.sortBy)) throw new BadRequestException(`${mod.label} have no field ${spec.sortBy}.`);
  if (!['asc', 'desc'].includes(spec.sortDir)) throw new BadRequestException('Sort up or down.');
  return mod;
}

/** A condition the database can apply: on a stored path, not a name looked up or a worked-out figure. */
function pushdown(f: FieldDef, c: ReportCondition): Record<string, unknown> | null {
  if (!f.path || f.lookup || f.get) return null;
  if (f.kind === 'bool') return { [f.path]: c.op === 'is_true' ? true : { $ne: true } };
  if (f.kind === 'text' && c.op === 'contains') return { [f.path]: { $regex: escapeRegex(String(c.value)), $options: 'i' } };
  const op = MONGO_OP[c.op];
  if (!op) return null;
  const value = f.kind === 'text' || f.kind === 'date' ? String(c.value) : Number(c.value);
  return { [f.path]: { [op]: value } };
}

function inMemory(v: string | number | boolean | null, f: FieldDef, c: ReportCondition): boolean {
  if (f.kind === 'bool') return c.op === 'is_true' ? v === true : v !== true;
  if (f.kind === 'text' || f.kind === 'date') {
    const a = String(v ?? '').toLowerCase();
    const b = String(c.value ?? '').toLowerCase();
    if (c.op === 'contains') return a.includes(b);
    if (c.op === 'equals') return a === b;
    if (c.op === 'not_equals') return a !== b;
    return c.op === 'gt' ? a > b : c.op === 'gte' ? a >= b : c.op === 'lt' ? a < b : a <= b;
  }
  const n = typeof v === 'number' ? v : null;
  const b = Number(c.value);
  if (n === null) return c.op === 'not_equals';
  return c.op === 'equals' ? n === b : c.op === 'not_equals' ? n !== b : c.op === 'gt' ? n > b : c.op === 'gte' ? n >= b : c.op === 'lt' ? n < b : n <= b;
}

const MAX_ROWS = 10_000;

export async function runModule(data: ReportDataService, orgId: string, spec: ModuleSpec, span: { fromDate: string; toDate: string; label: string } | null, meta: { key: string; title: string }): Promise<ReportTable> {
  const mod = checkModuleSpec(spec);
  const fields = new Map(mod.fields.map((f) => [f.key, f]));
  // orgId first and always; the tenant plugin would add it too, but an aggregate has no plugin.
  const match: Record<string, unknown> = { orgId, ...baseFilter(mod.key) };
  if (mod.dateField && span) match[mod.dateField] = { $gte: span.fromDate, $lte: span.toDate };
  const lineMatch: Array<Record<string, unknown>> = [];
  const later: ReportCondition[] = [];
  for (const c of spec.conditions) {
    const f = fields.get(c.field)!;
    const q = pushdown(f, c);
    if (!q) later.push(c);
    else if (mod.unwind && f.path!.startsWith(`${mod.unwind}.`)) lineMatch.push(q);
    else (match.$and = [...((match.$and as unknown[]) ?? []), q]);
  }
  const used = new Set([...spec.columns, ...spec.conditions.map((c) => c.field), ...(spec.groupBy ? [spec.groupBy] : []), ...(spec.sortBy ? [spec.sortBy] : [])]);
  const paths = new Set<string>();
  for (const k of used) {
    const f = fields.get(k)!;
    if (f.path) paths.add(f.path);
    for (const n of f.needs ?? []) paths.add(n);
  }
  // A path under one already asked for would collide (amountsPaise and amountsPaise.cgst).
  const projection = Object.fromEntries([...paths].filter((p) => ![...paths].some((q) => q !== p && p.startsWith(`${q}.`))).map((p) => [p, 1]));
  const model = modelFor(data, mod.key);
  const docs: Doc[] = mod.unwind
    ? await model.aggregate<Doc>([{ $match: match }, { $unwind: `$${mod.unwind}` }, ...(lineMatch.length ? [{ $match: { $and: lineMatch } }] : []), { $project: projection }, { $limit: MAX_ROWS + 1 }]).exec()
    : await model.find(match, projection).limit(MAX_ROWS + 1).lean<Doc[]>().exec();
  const truncated = docs.length > MAX_ROWS;
  const list = docs.slice(0, MAX_ROWS);

  // Names for every id a chosen field points at.
  const names = new Map<Lookup, Map<string, string>>();
  for (const f of mod.fields.filter((x) => x.lookup && used.has(x.key))) {
    if (names.has(f.lookup!)) continue;
    const ids = list.map((d) => pick(d, f.path!)).filter(Boolean);
    if (f.lookup === 'accounts') {
      const chart = await data.chart(orgId);
      names.set('accounts', new Map([...chart.values()].map((a) => [a.id, a.name])));
    } else {
      names.set(f.lookup!, await data.names(f.lookup!, orgId, ids));
    }
  }
  const valueOf = (d: Doc, f: FieldDef): string | number | boolean | null => {
    if (f.get) return f.get(d);
    const v = pick(d, f.path!);
    if (v === undefined || v === null) return null;
    if (f.lookup) return names.get(f.lookup)?.get(String(v)) ?? (v instanceof Types.ObjectId ? 'Unknown' : String(v));
    if (f.kind === 'bool') return v === true;
    if (f.kind === 'money' || f.kind === 'number') return typeof v === 'number' ? v : Number(v);
    const label = f.options?.find(([value]) => value === v)?.[1];
    return label ?? String(v);
  };
  let rows = list.map((d) => new Map(mod.fields.filter((f) => used.has(f.key)).map((f) => [f.key, valueOf(d, f)])));
  rows = rows.filter((r) => later.every((c) => {
    const f = fields.get(c.field)!;
    // Options compare by what is stored, so a condition on a listed value still matches its label.
    const v = r.get(c.field) ?? null;
    const stored = f.options?.find(([, l]) => l === v)?.[0];
    return inMemory(stored ?? v, f, c);
  }));
  if (spec.sortBy) {
    const k = spec.sortBy;
    const dir = spec.sortDir === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      const x = a.get(k);
      const y = b.get(k);
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return dir * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en-IN', { numeric: true }));
    });
  }

  const cols = spec.columns.map((k) => fields.get(k)!);
  const columns: ReportColumn[] = cols.map((f) => ({ key: f.key, label: f.label, kind: f.kind === 'money' ? 'money' : f.kind === 'number' ? 'number' : 'text' }));
  const cell = (v: string | number | boolean | null | undefined) => (v === true ? 'Yes' : v === false ? 'No' : v ?? null);
  const sums = (group: Array<Map<string, unknown>>) => cols.map((f) => (f.sum || f.kind === 'money' ? group.reduce((s, r) => s + (typeof r.get(f.key) === 'number' ? (r.get(f.key) as number) : 0), 0) : null));
  const round = (v: number | null, f: FieldDef) => (v === null ? null : f.kind === 'money' ? Math.round(v) : Math.round(v * 100) / 100);
  const totalRow = (group: Array<Map<string, unknown>>, label: string): Array<string | number | null> => {
    const s: Array<string | number | null> = sums(group).map((v, i) => round(v, cols[i]));
    if (cols[0].kind === 'text' || cols[0].kind === 'date' || cols[0].kind === 'bool') s[0] = label;
    return s;
  };
  const out: ReportRow[] = [];
  if (spec.groupBy) {
    const g = fields.get(spec.groupBy)!;
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = String(cell(r.get(spec.groupBy) as string | number | boolean | null) ?? '(blank)');
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
    }
    const keys = [...groups.keys()].sort((a, b) => (spec.sortBy === spec.groupBy && spec.sortDir === 'desc' ? -1 : 1) * a.localeCompare(b, 'en-IN', { numeric: true }));
    for (const k of keys) {
      const list2 = groups.get(k)!;
      if (spec.groupTotalsOnly) {
        const t = totalRow(list2, `${k} (${list2.length})`);
        const gi = cols.findIndex((c) => c.key === g.key);
        if (gi > 0) t[gi] = k;
        out.push({ cells: t });
        continue;
      }
      out.push({ cells: cols.map((_, i) => (i === 0 ? `${g.label}: ${k}` : null)), style: 'group' });
      for (const r of list2) out.push({ cells: cols.map((f) => cell(r.get(f.key) as string | number | boolean | null)), indent: 1 });
      out.push({ cells: totalRow(list2, `Total ${k}`), style: 'total' });
    }
  } else {
    for (const r of rows) out.push({ cells: cols.map((f) => cell(r.get(f.key) as string | number | boolean | null)) });
  }
  if (rows.length && cols.some((f) => f.sum || f.kind === 'money')) out.push({ cells: totalRow(rows, `Total (${rows.length})`), style: 'grand' });
  return {
    key: meta.key, title: meta.title, subtitle: span && mod.dateField ? span.label : 'As it stands today', columns, rows: out,
    notes: [
      `From ${mod.label.toLowerCase()}${['invoices', 'bills', 'expenses', 'payments', 'journal_lines'].includes(mod.key) ? ', posted only' : ''}.`,
      ...(truncated ? [`Only the first ${MAX_ROWS} records are read: narrow the period or add a condition.`] : []),
    ],
  };
}

/** The modules and their fields, for the report builder. */
export const moduleCatalog = () =>
  MODULES.map((m) => ({ key: m.key, label: m.label, hasPeriod: !!m.dateField, fields: m.fields.map((f) => ({ key: f.key, label: f.label, kind: f.kind, options: f.options ?? null, ops: OPS[f.kind], groupable: ['text', 'date', 'bool'].includes(f.kind), summable: !!(f.sum || f.kind === 'money') })) }));
