import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import { todayIst } from '../automation/schedule';
import { ManagementReportsService } from './management.service';
import { ReportsService, TbEntry } from './reports.service';
import { ReportRow, ReportTable } from './report-table';
import { renderReportPdf } from './report-pdf';
import { fyMonths, shiftMonth } from './management';
// The Reports Center's own reports and custom reports (catalog/): this catalog runs them by key too.
import { BaseCatalog, ReportCenterService } from './catalog/center.service';
import type { RunParams } from './catalog/types';

export const REPORT_KEYS = [
  'pl_monthly', 'comparison', 'expenses', 'budget_vs_actual',
  'sales_by_customer', 'sales_by_item', 'sales_by_month',
  'purchases_by_vendor', 'purchases_by_item', 'purchases_by_month',
  'receivables', 'payables', 'gst_summary', 'trial_balance', 'balance_sheet', 'project_pnl',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

/** range: from and to months. today: as it stands now. year: a financial year (and a month to stop at). */
export const CATALOG: Record<ReportKey, { title: string; params: 'range' | 'today' | 'year'; group: string }> = {
  pl_monthly: { title: 'Profit and loss by month', params: 'range', group: 'Profit' },
  comparison: { title: 'Profit and loss compared', params: 'range', group: 'Profit' },
  expenses: { title: 'Expenses by category', params: 'range', group: 'Profit' },
  budget_vs_actual: { title: 'Budget against actual', params: 'year', group: 'Profit' },
  sales_by_customer: { title: 'Sales by customer', params: 'range', group: 'Sales' },
  sales_by_item: { title: 'Sales by item', params: 'range', group: 'Sales' },
  sales_by_month: { title: 'Sales by month', params: 'range', group: 'Sales' },
  purchases_by_vendor: { title: 'Purchases by vendor', params: 'range', group: 'Purchases' },
  purchases_by_item: { title: 'Purchases by item', params: 'range', group: 'Purchases' },
  purchases_by_month: { title: 'Purchases by month', params: 'range', group: 'Purchases' },
  receivables: { title: 'Receivables by customer', params: 'today', group: 'Money owed' },
  payables: { title: 'Payables by vendor', params: 'today', group: 'Money owed' },
  gst_summary: { title: 'GST summary', params: 'range', group: 'Tax' },
  trial_balance: { title: 'Trial balance', params: 'year', group: 'Books' },
  balance_sheet: { title: 'Balance sheet', params: 'today', group: 'Books' },
  project_pnl: { title: 'Profit by project', params: 'range', group: 'Profit' },
};

export interface ReportParams extends RunParams {
  from?: string | null;
  to?: string | null;
  financialYear?: string | null;
  through?: string | null;
  /** Budget against actual: the budget to read; the year's default when left out. */
  budgetId?: string | null;
}

/** A period said relative to the run date, for a schedule: it means a different month each time. */
export type RelativePeriod = 'last_month' | 'this_month' | 'last_quarter' | 'this_fy' | 'last_fy';

export function resolvePeriod(p: RelativePeriod, today: string): { from: string; to: string; financialYear: string; through: string } {
  const now = today.slice(0, 7);
  const last = shiftMonth(now, -1);
  if (p === 'this_month') return { from: now, to: now, financialYear: fyMonths(now).fy, through: now };
  if (p === 'last_month') return { from: last, to: last, financialYear: fyMonths(last).fy, through: last };
  if (p === 'last_quarter') {
    // Indian quarters: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar.
    const m = Number(now.slice(5, 7));
    const qStart = shiftMonth(`${now.slice(0, 4)}-${String(m - ((m - 1) % 3)).padStart(2, '0')}`, -3);
    return { from: qStart, to: shiftMonth(qStart, 2), financialYear: fyMonths(qStart).fy, through: shiftMonth(qStart, 2) };
  }
  const fy = fyMonths(p === 'this_fy' ? now : shiftMonth(fyMonths(now).from, -1));
  return { from: fy.from, to: p === 'this_fy' ? now : fy.to, financialYear: fy.fy, through: p === 'this_fy' ? now : fy.to };
}

/** Every report by its key, as a table, a PDF or a CSV: one way in for the page, the schedule and the questions. */
@Injectable()
export class ReportCatalogService {
  constructor(
    private management: ManagementReportsService,
    private reports: ReportsService,
    @InjectModel(OrgSettings.name) private settingsModel: Model<OrgSettingsDocument>,
    @Optional() private center?: ReportCenterService,
  ) {}

  list() {
    return REPORT_KEYS.map((key) => ({ key, ...CATALOG[key] }));
  }

  /** What the Reports Center needs from this catalog: its reports, and a way to run any report for this person. */
  base(orgId: string, viewer?: string): BaseCatalog {
    return { list: this.list(), run: (key, p) => this.run(orgId, key, p, viewer), resolve: (period, today) => resolvePeriod(period as RelativePeriod, today) };
  }

  /** Any report a schedule may send: these, the Center's, or a custom report the person can see. */
  async exists(orgId: string, key: string, viewer?: string): Promise<boolean> {
    return (REPORT_KEYS as readonly string[]).includes(key) || (!!this.center && (await this.center.exists(orgId, key, viewer)));
  }

  async titleOf(orgId: string, key: string): Promise<string> {
    return CATALOG[key as ReportKey]?.title ?? (this.center ? await this.center.title(orgId, key) : key);
  }

  /** `viewer`: the person asking, so another person's private custom report stays private. */
  async run(orgId: string, key: string, p: ReportParams = {}, viewer?: string): Promise<ReportTable> {
    if (!(REPORT_KEYS as readonly string[]).includes(key)) {
      if (this.center?.has(key)) return this.center.run(orgId, key, p, viewer, this.base(orgId, viewer));
      throw new BadRequestException(`No report called ${key}.`);
    }
    const m = this.management;
    const r = () => m.range(p.from, p.to);
    const fy = () => p.financialYear || fyMonths(todayIst().slice(0, 7)).fy;
    switch (key as ReportKey) {
      case 'pl_monthly': return m.plMonthly(orgId, r());
      case 'comparison': return m.comparison(orgId, r());
      case 'expenses': return m.expenses(orgId, r());
      case 'budget_vs_actual': return m.budgetVsActual(orgId, fy(), p.through, p.budgetId);
      case 'sales_by_customer': return m.byParty(orgId, 'sales', r());
      case 'sales_by_item': return m.byItem(orgId, 'sales', r());
      case 'sales_by_month': return m.byMonth(orgId, 'sales', r());
      case 'purchases_by_vendor': return m.byParty(orgId, 'purchases', r());
      case 'purchases_by_item': return m.byItem(orgId, 'purchases', r());
      case 'purchases_by_month': return m.byMonth(orgId, 'purchases', r());
      case 'receivables': return m.ageing(orgId, 'receivables');
      case 'payables': return m.ageing(orgId, 'payables');
      case 'gst_summary': return m.gst(orgId, r());
      case 'trial_balance': return this.trialBalance(orgId, fy());
      case 'balance_sheet': return this.balanceSheet(orgId, fy());
      case 'project_pnl': return m.projectPnl(orgId, r());
    }
  }

  async org(orgId: string) {
    const s = await this.settingsModel.findOne({ orgId }, { displayName: 1, gstin: 1 }).lean().exec();
    return { name: s?.displayName?.trim() || 'Your business', gstin: s?.gstin ?? null };
  }

  async pdf(orgId: string, key: string, p: ReportParams = {}, viewer?: string) {
    const table = await this.run(orgId, key, p, viewer);
    const today = todayIst();
    return { filename: `${key.replace(/[._]/g, '-')}-${today}.pdf`, buffer: renderReportPdf(table, await this.org(orgId), today), table };
  }

  private async trialBalance(orgId: string, financialYear: string): Promise<ReportTable> {
    const tb = await this.reports.getTrialBalance(orgId, financialYear);
    const rows: ReportRow[] = tb.entries
      .filter((e) => e.netPaise !== 0)
      .sort((a, b) => a.accountType.localeCompare(b.accountType) || a.accountDescription.localeCompare(b.accountDescription))
      .map((e) => ({ cells: [e.accountDescription, e.accountType, e.netPaise > 0 ? e.netPaise : null, e.netPaise < 0 ? -e.netPaise : null] }));
    const dr = tb.entries.reduce((s, e) => s + Math.max(0, e.netPaise), 0);
    const cr = tb.entries.reduce((s, e) => s + Math.max(0, -e.netPaise), 0);
    return {
      key: 'trial_balance', title: 'Trial balance', subtitle: `Financial year ${financialYear}`,
      columns: [{ key: 'account', label: 'Account', kind: 'text' }, { key: 'type', label: 'Type', kind: 'text' }, { key: 'debit', label: 'Debit', kind: 'money' }, { key: 'credit', label: 'Credit', kind: 'money' }],
      rows: [...rows, { cells: ['Total', null, dr, cr], style: 'grand' }],
      notes: [tb.isBalanced ? 'Debits equal credits.' : 'Debits and credits differ: tell support, this should never happen.'],
    };
  }

  private async balanceSheet(orgId: string, financialYear: string): Promise<ReportTable> {
    const bs = await this.reports.getBalanceSheet(orgId, financialYear, todayIst());
    const lines = (title: string, entries: TbEntry[], sign: 1 | -1, extra: Array<[string, number]> = []) => {
      const list = entries.filter((e) => e.netPaise !== 0).map((e) => [e.accountDescription, sign * e.netPaise] as [string, number]);
      const all = [...list, ...extra];
      return [
        { cells: [title, null], style: 'group' as const },
        ...all.map(([name, v]) => ({ cells: [name, v], indent: 1 })),
        { cells: [`Total ${title.toLowerCase()}`, all.reduce((s, [, v]) => s + v, 0)], style: 'total' as const },
      ];
    };
    return {
      key: 'balance_sheet', title: 'Balance sheet', subtitle: `As at ${bs.asOf}`,
      columns: [{ key: 'account', label: 'Account', kind: 'text' }, { key: 'amount', label: 'Amount', kind: 'money' }],
      rows: [
        ...lines('Assets', bs.assetLines, 1),
        ...lines('Liabilities', bs.liabilityLines, -1),
        ...lines('Capital', bs.capitalLines, -1, [['Profit for the year', bs.retainedEarningsPaise]]),
        { cells: ['Liabilities and capital', bs.totalLiabilitiesPaise + bs.totalEquityPaise], style: 'grand' },
      ],
      notes: [bs.isTiedOut ? 'Assets equal liabilities and capital.' : 'Assets and liabilities with capital differ: check the opening balances.'],
    };
  }
}
