/**
 * The Companies Act, 2013, Schedule III, Division I (companies that follow
 * the Accounting Standards, not Ind AS): which head of the balance sheet
 * and the statement of profit and loss each ledger account belongs to, and
 * the statements laid out in that order. Pure: the figures come in summed.
 *
 * An account is placed by its system role first (the receivable, the bank,
 * GST input), then by the group it sits under, then by its name, so a
 * business's own accounts (a term loan, a security deposit, salaries) land
 * where an accountant would put them.
 */
import { AccountType } from '@ai-accounting/shared';
import { isMoneyAccount } from '../../gl/money-accounts';
import { ReportRow } from '../report-table';
import type { ChartAccount } from './report-data.service';

export type BsHead =
  | 'share_capital' | 'reserves'
  | 'lt_borrowings' | 'deferred_tax_liability' | 'other_lt_liabilities' | 'lt_provisions'
  | 'st_borrowings' | 'trade_payables' | 'other_current_liabilities' | 'st_provisions'
  | 'ppe' | 'intangibles' | 'cwip' | 'nc_investments' | 'deferred_tax_asset' | 'lt_loans_advances' | 'other_nc_assets'
  | 'current_investments' | 'inventories' | 'trade_receivables' | 'cash' | 'st_loans_advances' | 'other_current_assets';

export type PlHead = 'revenue' | 'other_income' | 'materials' | 'purchases' | 'inventory_change' | 'employee' | 'finance' | 'depreciation' | 'other_expenses' | 'tax';

export const CURRENT_ASSETS: BsHead[] = ['current_investments', 'inventories', 'trade_receivables', 'cash', 'st_loans_advances', 'other_current_assets'];
export const CURRENT_LIABILITIES: BsHead[] = ['st_borrowings', 'trade_payables', 'other_current_liabilities', 'st_provisions'];
export const FIXED_ASSETS: BsHead[] = ['ppe', 'intangibles', 'cwip', 'nc_investments'];
export const EQUITY: BsHead[] = ['share_capital', 'reserves'];
export const BORROWINGS: BsHead[] = ['lt_borrowings', 'st_borrowings'];
const LIABILITY_HEADS: BsHead[] = ['share_capital', 'reserves', 'lt_borrowings', 'deferred_tax_liability', 'other_lt_liabilities', 'lt_provisions', 'st_borrowings', 'trade_payables', 'other_current_liabilities', 'st_provisions'];
export const isLiabilitySide = (h: BsHead) => LIABILITY_HEADS.includes(h);

const has = (re: RegExp, ...s: Array<string | null | undefined>) => s.some((x) => !!x && re.test(x));

/**
 * The balance-sheet head of an asset, liability or capital account. `net`
 * is its balance, debit positive: a bank account in credit is an overdraft,
 * a short-term borrowing, not negative cash.
 */
export function bsHead(a: ChartAccount, net = 0): BsHead | null {
  const k = a.systemKey;
  const g = a.group;
  if (a.type === AccountType.CAPITAL) {
    if (k === 'RETAINED_EARNINGS' || has(/reserve|surplus|premium|retained/i, a.name)) return 'reserves';
    return 'share_capital';
  }
  if (a.type === AccountType.LIABILITIES) {
    if (k === 'ACCOUNTS_PAYABLE' || has(/sundry creditors|trade payables/i, g, a.name)) return 'trade_payables';
    if (k) return 'other_current_liabilities'; // GST output, TDS payable, advances from customers, accruals
    if (has(/deferred tax/i, a.name)) return 'deferred_tax_liability';
    if (has(/overdraft|cash credit|\bo\.?d\.?\b|\bc\.?c\.?\b|short[- ]term (loan|borrowing)|working capital loan/i, a.name, g)) return 'st_borrowings';
    if (has(/loan|borrowing|debenture|bonds?\b|secured|unsecured/i, a.name, g)) return 'lt_borrowings';
    if (has(/provision/i, a.name, g)) return has(/gratuity|leave encashment|long[- ]term/i, a.name, g) ? 'lt_provisions' : 'st_provisions';
    if (has(/non[- ]current|long[- ]term/i, g)) return 'other_lt_liabilities';
    return 'other_current_liabilities';
  }
  if (a.type !== AccountType.ASSETS) return null;
  if (k === 'BANK' || k === 'CASH' || k === 'PAYMENT_GATEWAY' || isMoneyAccount(a)) return net < 0 ? 'st_borrowings' : 'cash';
  if (k === 'ACCOUNTS_RECEIVABLE' || has(/sundry debtors|trade receivables/i, g, a.name)) return 'trade_receivables';
  if (k === 'INVENTORY' || has(/\bstock\b|inventor/i, a.name)) return 'inventories';
  if (k === 'ACCUMULATED_DEPRECIATION') return 'ppe';
  if (k?.startsWith('GST_INPUT') || k === 'TDS_RECEIVABLE' || k === 'VENDOR_ADVANCES') return 'st_loans_advances';
  if (k) return 'other_current_assets'; // prepaid expenses and the like
  if (has(/deferred tax/i, a.name)) return 'deferred_tax_asset';
  if (has(/work[- ]in[- ]progress|\bcwip\b/i, a.name)) return 'cwip';
  if (has(/goodwill|software|trademark|patent|copyright|licen[cs]e|intangible/i, a.name, g)) return 'intangibles';
  if (has(/investment|mutual fund|shares in|fixed deposit|\bfd\b/i, a.name, g)) return has(/short|current|liquid|mutual fund/i, a.name) ? 'current_investments' : 'nc_investments';
  if (has(/security deposit|deposits?\b|long[- ]term (loan|advance)/i, a.name, g)) return 'lt_loans_advances';
  if (has(/fixed assets|\bproperty\b|\bplant\b|machinery|equipment|furniture|fixtures|vehicles?\b|buildings?\b|\bland\b|computers?\b/i, g, a.name)) return 'ppe';
  if (has(/non[- ]current/i, g)) return 'other_nc_assets';
  if (has(/advance|loans? (to|and)|loan given|staff loan|imprest/i, a.name)) return 'st_loans_advances';
  return 'other_current_assets';
}

/** The P&L head of an income or expense account. */
export function plHead(a: ChartAccount): PlHead | null {
  const k = a.systemKey;
  if (a.type === AccountType.INCOME) {
    if (k === 'FX_GAIN' || k === 'ASSET_DISPOSAL_GAIN') return 'other_income';
    if (has(/indirect income|other income|non[- ]operating/i, a.group)) return 'other_income';
    if (has(/interest|dividend|other income|rent received|commission received|discount received|\bgain\b|misc/i, a.name)) return 'other_income';
    return 'revenue';
  }
  if (a.type !== AccountType.EXPENSE) return null;
  if (k === 'PURCHASE_EXPENSE') return 'purchases';
  if (k === 'CHANGE_IN_INVENTORY') return 'inventory_change';
  if (k === 'DEPRECIATION') return 'depreciation';
  if (has(/depreciation|amorti[sz]ation/i, a.name)) return 'depreciation';
  if (has(/raw material|materials? consumed|consumables|packing material/i, a.name)) return 'materials';
  if (has(/change in inventor|opening stock|closing stock/i, a.name)) return 'inventory_change';
  if (has(/^purchases?\b|purchase of|stock[- ]in[- ]trade/i, a.name)) return 'purchases';
  if (has(/salar|wage|staff|employee|bonus|gratuity|provident|\bp\.?f\.?\b|\besic?\b|remuneration|stipend|welfare/i, a.name)) return 'employee';
  if (has(/income[- ]tax|current tax|deferred tax|tax expense|provision for tax/i, a.name)) return 'tax';
  if (has(/interest|finance cost|finance charges|loan processing|borrowing cost/i, a.name)) return 'finance';
  return 'other_expenses';
}

/** Cost of goods sold, for the gross margin: the cost heads and the direct-expense group. */
export const isCostOfSales = (a: ChartAccount) => {
  const h = plHead(a);
  return h === 'materials' || h === 'purchases' || h === 'inventory_change' || (a.type === AccountType.EXPENSE && has(/\bdirect expense|cost of (goods|sales)|manufacturing/i, a.group));
};

export const BS_LABEL: Record<BsHead, string> = {
  share_capital: '(a) Share capital',
  reserves: '(b) Reserves and surplus',
  lt_borrowings: '(a) Long-term borrowings',
  deferred_tax_liability: '(b) Deferred tax liabilities (net)',
  other_lt_liabilities: '(c) Other long-term liabilities',
  lt_provisions: '(d) Long-term provisions',
  st_borrowings: '(a) Short-term borrowings',
  trade_payables: '(b) Trade payables',
  other_current_liabilities: '(c) Other current liabilities',
  st_provisions: '(d) Short-term provisions',
  ppe: '(i) Property, plant and equipment',
  intangibles: '(ii) Intangible assets',
  cwip: '(iii) Capital work-in-progress',
  nc_investments: '(b) Non-current investments',
  deferred_tax_asset: '(c) Deferred tax assets (net)',
  lt_loans_advances: '(d) Long-term loans and advances',
  other_nc_assets: '(e) Other non-current assets',
  current_investments: '(a) Current investments',
  inventories: '(b) Inventories',
  trade_receivables: '(c) Trade receivables',
  cash: '(d) Cash and cash equivalents',
  st_loans_advances: '(e) Short-term loans and advances',
  other_current_assets: '(f) Other current assets',
};

export const PL_LABEL: Record<PlHead, string> = {
  revenue: 'I. Revenue from operations',
  other_income: 'II. Other income',
  materials: 'Cost of materials consumed',
  purchases: 'Purchases of stock-in-trade',
  inventory_change: 'Changes in inventories of finished goods, work-in-progress and stock-in-trade',
  employee: 'Employee benefits expense',
  finance: 'Finance costs',
  depreciation: 'Depreciation and amortisation expense',
  other_expenses: 'Other expenses',
  tax: 'Tax expense',
};

/** Balances by head, as a person reads them: assets debit-positive, the rest credit-positive. */
export interface HeadFigures {
  heads: Map<BsHead, number>;
  /** The accounts behind each head, with their amounts as shown. */
  accounts: Map<BsHead, Array<{ name: string; amount: number }>>;
  /** The P&L not yet closed into reserves: income less expenses to date. */
  profitToDate: number;
}

export function bsFigures(nets: Map<string, number>, chart: Map<string, ChartAccount>): HeadFigures {
  const heads = new Map<BsHead, number>();
  const accounts = new Map<BsHead, Array<{ name: string; amount: number }>>();
  let profitToDate = 0;
  for (const [id, net] of nets) {
    const a = chart.get(id);
    if (!a || net === 0) continue;
    if (a.type === AccountType.INCOME || a.type === AccountType.EXPENSE) {
      profitToDate -= net;
      continue;
    }
    const h = bsHead(a, net);
    if (!h) continue;
    const amount = isLiabilitySide(h) ? -net : net;
    heads.set(h, (heads.get(h) ?? 0) + amount);
    (accounts.get(h) ?? accounts.set(h, []).get(h)!).push({ name: a.name, amount });
  }
  if (profitToDate) {
    heads.set('reserves', (heads.get('reserves') ?? 0) + profitToDate);
    (accounts.get('reserves') ?? accounts.set('reserves', []).get('reserves')!).push({ name: 'Surplus in the statement of profit and loss', amount: profitToDate });
  }
  for (const list of accounts.values()) list.sort((x, y) => x.name.localeCompare(y.name));
  return { heads, accounts, profitToDate };
}

export interface PlFigures {
  heads: Map<PlHead, number>;
  accounts: Map<PlHead, Array<{ name: string; amount: number }>>;
}

/** P&L by head; income credit-positive, expenses debit-positive. */
export function plFigures(nets: Map<string, number>, chart: Map<string, ChartAccount>): PlFigures {
  const heads = new Map<PlHead, number>();
  const accounts = new Map<PlHead, Array<{ name: string; amount: number }>>();
  for (const [id, net] of nets) {
    const a = chart.get(id);
    if (!a || net === 0) continue;
    const h = plHead(a);
    if (!h) continue;
    const amount = a.type === AccountType.INCOME ? -net : net;
    heads.set(h, (heads.get(h) ?? 0) + amount);
    (accounts.get(h) ?? accounts.set(h, []).get(h)!).push({ name: a.name, amount });
  }
  for (const list of accounts.values()) list.sort((x, y) => x.name.localeCompare(y.name));
  return { heads, accounts };
}

export function plTotals(f: PlFigures) {
  const v = (h: PlHead) => f.heads.get(h) ?? 0;
  const income = v('revenue') + v('other_income');
  const expenses = (['materials', 'purchases', 'inventory_change', 'employee', 'finance', 'depreciation', 'other_expenses'] as PlHead[]).reduce((s, h) => s + v(h), 0);
  const beforeTax = income - expenses;
  return { income, expenses, beforeTax, tax: v('tax'), profit: beforeTax - v('tax') };
}

/** The statement of profit and loss, current and previous period side by side. */
export function schedulePl(cur: PlFigures, prev: PlFigures | null, opts: { details: boolean }): ReportRow[] {
  const rows: ReportRow[] = [];
  const c = plTotals(cur);
  const p = prev ? plTotals(prev) : null;
  const v = (f: PlFigures | null, h: PlHead) => (f ? f.heads.get(h) ?? 0 : null);
  const line = (label: string, a: number | null, b: number | null, style?: ReportRow['style'], indent?: number) => rows.push({ cells: prev ? [label, a, b] : [label, a], style, indent });
  const head = (h: PlHead, indent: number, label = PL_LABEL[h]) => {
    line(label, v(cur, h), v(prev, h), opts.details ? 'total' : undefined, indent);
    if (opts.details) for (const acc of cur.accounts.get(h) ?? []) {
      const before = prev?.accounts.get(h)?.find((x) => x.name === acc.name)?.amount ?? 0;
      line(acc.name, acc.amount, prev ? before : null, undefined, indent + 1);
    }
  };
  head('revenue', 0);
  head('other_income', 0);
  line('III. Total income (I + II)', c.income, p?.income ?? null, 'total');
  rows.push({ cells: prev ? ['IV. Expenses', null, null] : ['IV. Expenses', null], style: 'group' });
  for (const h of ['materials', 'purchases', 'inventory_change', 'employee', 'finance', 'depreciation', 'other_expenses'] as PlHead[]) head(h, 1);
  line('Total expenses (IV)', c.expenses, p?.expenses ?? null, 'total');
  line('V. Profit before tax (III − IV)', c.beforeTax, p?.beforeTax ?? null, 'total');
  head('tax', 0, 'VI. Tax expense');
  line('VII. Profit (loss) for the period (V − VI)', c.profit, p?.profit ?? null, 'grand');
  return rows;
}

/** The balance sheet in Schedule III order, with trade payables split by MSME dues. */
export function scheduleBs(cur: HeadFigures, prev: HeadFigures | null, msme: { cur: number; prev: number | null }, opts: { details: boolean }): ReportRow[] {
  const rows: ReportRow[] = [];
  const two = !!prev;
  const v = (f: HeadFigures | null, h: BsHead) => (f ? f.heads.get(h) ?? 0 : null);
  const sum = (f: HeadFigures | null, hs: BsHead[]) => (f ? hs.reduce((s, h) => s + (f.heads.get(h) ?? 0), 0) : null);
  const line = (label: string, a: number | null, b: number | null, style?: ReportRow['style'], indent?: number) => rows.push({ cells: two ? [label, a, b] : [label, a], style, indent });
  const group = (label: string) => rows.push({ cells: two ? [label, null, null] : [label, null], style: 'group' });
  const head = (h: BsHead, indent = 1) => {
    line(BS_LABEL[h], v(cur, h), v(prev, h), undefined, indent);
    if (h === 'trade_payables') {
      const tp = v(cur, h) ?? 0;
      const tpPrev = v(prev, h);
      line('(A) Total outstanding dues of micro and small enterprises', msme.cur, two ? msme.prev ?? 0 : null, undefined, indent + 1);
      line('(B) Total outstanding dues of creditors other than micro and small enterprises', tp - msme.cur, two ? (tpPrev ?? 0) - (msme.prev ?? 0) : null, undefined, indent + 1);
    }
    if (opts.details) for (const acc of cur.accounts.get(h) ?? []) {
      const before = prev?.accounts.get(h)?.find((x) => x.name === acc.name)?.amount ?? 0;
      line(acc.name, acc.amount, two ? before : null, undefined, indent + 1);
    }
  };
  const liab: BsHead[] = LIABILITY_HEADS;
  const assets: BsHead[] = ['ppe', 'intangibles', 'cwip', 'nc_investments', 'deferred_tax_asset', 'lt_loans_advances', 'other_nc_assets', ...CURRENT_ASSETS];

  group('I. EQUITY AND LIABILITIES');
  line("(1) Shareholders' funds", sum(cur, EQUITY), sum(prev, EQUITY), 'total');
  head('share_capital'); head('reserves');
  const ncl: BsHead[] = ['lt_borrowings', 'deferred_tax_liability', 'other_lt_liabilities', 'lt_provisions'];
  line('(2) Non-current liabilities', sum(cur, ncl), sum(prev, ncl), 'total');
  ncl.forEach((h) => head(h));
  line('(3) Current liabilities', sum(cur, CURRENT_LIABILITIES), sum(prev, CURRENT_LIABILITIES), 'total');
  CURRENT_LIABILITIES.forEach((h) => head(h));
  line('TOTAL', sum(cur, liab), sum(prev, liab), 'grand');

  group('II. ASSETS');
  const nca: BsHead[] = ['ppe', 'intangibles', 'cwip', 'nc_investments', 'deferred_tax_asset', 'lt_loans_advances', 'other_nc_assets'];
  line('(1) Non-current assets', sum(cur, nca), sum(prev, nca), 'total');
  line('(a) Property, plant and equipment and intangible assets', sum(cur, ['ppe', 'intangibles', 'cwip']), sum(prev, ['ppe', 'intangibles', 'cwip']), undefined, 1);
  head('ppe', 2); head('intangibles', 2); head('cwip', 2);
  (['nc_investments', 'deferred_tax_asset', 'lt_loans_advances', 'other_nc_assets'] as BsHead[]).forEach((h) => head(h));
  line('(2) Current assets', sum(cur, CURRENT_ASSETS), sum(prev, CURRENT_ASSETS), 'total');
  CURRENT_ASSETS.forEach((h) => head(h));
  line('TOTAL', sum(cur, assets), sum(prev, assets), 'grand');
  return rows;
}

export const totalOf = (f: HeadFigures, hs: BsHead[]) => hs.reduce((s, h) => s + (f.heads.get(h) ?? 0), 0);
export const ASSET_HEADS: BsHead[] = ['ppe', 'intangibles', 'cwip', 'nc_investments', 'deferred_tax_asset', 'lt_loans_advances', 'other_nc_assets', ...CURRENT_ASSETS];
export { LIABILITY_HEADS };
