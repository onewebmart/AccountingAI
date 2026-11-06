/**
 * Every built-in report the Reports Center lists: the first sixteen, which
 * live in report-catalog.service.ts, given a category here, and the rest,
 * defined category by category in this folder.
 */
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BUSINESS_REPORTS } from './business';
import { RECEIVABLE_REPORTS, SALES_REPORTS } from './sales';
import { PAYMENT_REPORTS, PAYMENTS_MADE_REPORTS } from './payments';
import { PAYABLE_REPORTS } from './payables';
import { PURCHASE_REPORTS } from './purchases';
import { TAX_REPORTS } from './taxes';
import { BANKING_REPORTS, INVENTORY_REPORTS, PROJECT_REPORTS } from './operations';
import { ACCOUNTANT_REPORTS, ACTIVITY_REPORTS, AUTOMATION_REPORTS, CURRENCY_REPORTS, RECURRING_REPORTS } from './books';
import { CATEGORIES, CategoryKey, FILTER_KEYS, FilterDef, ParamKind, ReportDef, ReportShape, RunParams } from './types';

export const EXTRA_REPORTS: ReportDef[] = [
  ...BUSINESS_REPORTS,
  ...SALES_REPORTS,
  ...RECEIVABLE_REPORTS,
  ...PAYMENT_REPORTS,
  ...RECURRING_REPORTS,
  ...PAYABLE_REPORTS,
  ...PAYMENTS_MADE_REPORTS,
  ...PURCHASE_REPORTS,
  ...TAX_REPORTS,
  ...BANKING_REPORTS,
  ...PROJECT_REPORTS,
  ...INVENTORY_REPORTS,
  ...ACCOUNTANT_REPORTS,
  ...CURRENCY_REPORTS,
  ...ACTIVITY_REPORTS,
  ...AUTOMATION_REPORTS,
];
export const EXTRA_BY_KEY = new Map(EXTRA_REPORTS.map((r) => [r.key, r]));

/** The first sixteen reports, placed in the Center's categories. */
export const LEGACY_META: Record<string, { category: CategoryKey; description: string; shape: ReportShape }> = {
  pl_monthly: { category: 'business', shape: 'statement', description: 'Each income and expense account month by month, and the profit.' },
  comparison: { category: 'business', shape: 'statement', description: 'This period against the one before and the same months a year earlier.' },
  balance_sheet: { category: 'business', shape: 'statement', description: 'Assets, liabilities and capital as the books stand today.' },
  sales_by_customer: { category: 'sales', shape: 'list', description: 'Each customer’s invoices less credit notes, with their share of sales.' },
  sales_by_item: { category: 'sales', shape: 'list', description: 'Quantity and value sold of each item, and its average rate.' },
  sales_by_month: { category: 'sales', shape: 'list', description: 'Invoices, credit notes and net sales month by month.' },
  receivables: { category: 'receivables', shape: 'list', description: 'AR ageing summary: what each customer owes by how overdue, and how long they take to pay.' },
  payables: { category: 'payables', shape: 'list', description: 'AP ageing summary: what you owe each vendor by how overdue, and how long you take to pay.' },
  purchases_by_vendor: { category: 'purchases', shape: 'list', description: 'Each vendor’s bills less debit notes, with their share of purchases.' },
  purchases_by_item: { category: 'purchases', shape: 'list', description: 'Quantity and value bought of each item, and its average rate.' },
  purchases_by_month: { category: 'purchases', shape: 'list', description: 'Bills, debit notes and net purchases month by month.' },
  expenses: { category: 'purchases', shape: 'statement', description: 'Expenses by category: each expense account month by month.' },
  gst_summary: { category: 'taxes', shape: 'list', description: 'Output tax, reverse charge and input credit month by month, from the GST accounts.' },
  trial_balance: { category: 'accountant', shape: 'list', description: 'Every account’s debit or credit balance for a financial year.' },
  budget_vs_actual: { category: 'budgets', shape: 'statement', description: 'Each account’s budget against what the books show, and the variance.' },
  project_pnl: { category: 'projects', shape: 'list', description: 'Project profit: income, costs, margin, hours and unbilled time by project.' },
};

export interface CenterEntry {
  key: string;
  title: string;
  category: CategoryKey;
  categoryLabel: string;
  description: string;
  params: ParamKind;
  filters: FilterDef[];
  shape: ReportShape;
}

const label = (c: CategoryKey) => CATEGORIES.find((x) => x.key === c)!.label;

export function builtInEntries(legacy: Array<{ key: string; title: string; params: 'range' | 'today' | 'year' }>): CenterEntry[] {
  return [
    ...legacy.map((l) => {
      const m = LEGACY_META[l.key] ?? { category: 'business' as CategoryKey, shape: 'statement' as ReportShape, description: '' };
      return { key: l.key, title: l.title, category: m.category, categoryLabel: label(m.category), description: m.description, params: l.params, filters: [], shape: m.shape };
    }),
    ...EXTRA_REPORTS.map((r) => ({ key: r.key, title: r.title, category: r.category, categoryLabel: label(r.category), description: r.description, params: r.params, filters: r.filters ?? [], shape: r.shape })),
  ];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const FY = /^\d{4}-\d{2}$/;

/**
 * The parameters a report may be run with, and nothing else: the period
 * fields in their formats, and only the filters the report declares, each
 * an id or one of its listed values. A required filter must be there.
 */
export function cleanParams(def: { filters?: FilterDef[] }, p: RunParams): RunParams {
  const out: RunParams = {};
  if (p.from) { if (!MONTH.test(p.from)) throw new BadRequestException('from is a month like 2026-04.'); out.from = p.from; }
  if (p.to) { if (!MONTH.test(p.to)) throw new BadRequestException('to is a month like 2026-11.'); out.to = p.to; }
  if (p.through) { if (!MONTH.test(p.through)) throw new BadRequestException('through is a month like 2026-11.'); out.through = p.through; }
  if (p.financialYear) { if (!FY.test(p.financialYear)) throw new BadRequestException('financialYear looks like 2026-27.'); out.financialYear = p.financialYear; }
  if (p.asOf) { if (!DATE.test(p.asOf)) throw new BadRequestException('asOf is a date like 2026-11-30.'); out.asOf = p.asOf; }
  if (p.quarter) { if (!['Q1', 'Q2', 'Q3', 'Q4'].includes(p.quarter)) throw new BadRequestException('quarter is Q1 to Q4.'); out.quarter = p.quarter; }
  for (const f of def.filters ?? []) {
    const v = p[f.key];
    if (v === undefined || v === null || v === '') {
      if (f.required) throw new BadRequestException(`Pick the ${f.label.toLowerCase()}.`);
      continue;
    }
    if (typeof v !== 'string') throw new BadRequestException(`${f.label} is not valid.`);
    if (f.kind === 'select') {
      if (!f.options?.some(([value]) => value === v)) throw new BadRequestException(`${f.label}: pick one of the choices.`);
    } else if (f.kind === 'user') {
      if (!/^[A-Za-z0-9:_-]{1,64}$/.test(v)) throw new BadRequestException(`${f.label} is not valid.`);
    } else if (!Types.ObjectId.isValid(v) || v.length !== 24) {
      throw new BadRequestException(`${f.label} is not valid.`);
    }
    out[f.key] = v;
  }
  return out;
}

export { FILTER_KEYS };
