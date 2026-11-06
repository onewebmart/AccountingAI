import type { TxnStatus } from './shared';

/**
 * Figures for the landing page's mock dashboard. Illustrative only, and
 * labelled "Sample data" wherever they appear. Amounts are integer paise,
 * like everywhere else in the product; they become rupees only in labels.
 *
 * The figures agree with each other: October's revenue and expenses are the
 * last bars, net profit is their difference, the overdue total is the overdue
 * invoice in the table, and the cash line closes on September plus October's
 * cash in less cash out.
 */

export interface MonthFigures {
  month: string;
  revenue: number;
  expenses: number;
  /** Bank and cash at the end of the month. */
  cash: number;
}

export const MONTHS: MonthFigures[] = [
  { month: 'May', revenue: 3_12_400_00, expenses: 1_98_600_00, cash: 6_24_000_00 },
  { month: 'Jun', revenue: 3_48_900_00, expenses: 2_05_300_00, cash: 6_82_500_00 },
  { month: 'Jul', revenue: 3_36_200_00, expenses: 2_12_800_00, cash: 6_51_300_00 },
  { month: 'Aug', revenue: 3_89_500_00, expenses: 2_24_100_00, cash: 7_38_900_00 },
  { month: 'Sep', revenue: 4_21_800_00, expenses: 2_31_700_00, cash: 8_12_400_00 },
  { month: 'Oct', revenue: 4_52_300_00, expenses: 2_38_950_00, cash: 9_04_700_00 },
];

const last = MONTHS[MONTHS.length - 1];
const prev = MONTHS[MONTHS.length - 2];

/** Percentage change, one decimal. */
const change = (now: number, before: number) => Math.round(((now - before) / before) * 1000) / 10;

export const KPI = {
  revenue: last.revenue,
  revenueChange: change(last.revenue, prev.revenue),
  expenses: last.expenses,
  expensesChange: change(last.expenses, prev.expenses),
  profit: last.revenue - last.expenses,
  profitChange: change(last.revenue - last.expenses, prev.revenue - prev.expenses),
  overdue: 42_800_00,
  pending: 1_43_600_00,
  cashIn: 4_26_900_00,
  cashOut: 3_34_600_00,
};

export interface Txn {
  date: string;
  number: string;
  kind: 'Invoice' | 'Bill' | 'Payment received' | 'Payment made';
  party: string;
  amount: number;
  status: TxnStatus;
}

export const TRANSACTIONS: Txn[] = [
  { date: '31 Oct', number: 'INV-0142', kind: 'Invoice', party: 'Mehta Textiles Pvt Ltd', amount: 1_18_000_00, status: 'Paid' },
  { date: '30 Oct', number: 'BILL-0087', kind: 'Bill', party: 'Sharma Office Supplies', amount: 18_880_00, status: 'Pending' },
  { date: '29 Oct', number: 'PAY-0219', kind: 'Payment received', party: 'Kapoor & Sons', amount: 64_900_00, status: 'Paid' },
  { date: '27 Oct', number: 'INV-0139', kind: 'Invoice', party: 'Gupta Electricals', amount: 42_800_00, status: 'Overdue' },
  { date: '25 Oct', number: 'PAY-0214', kind: 'Payment made', party: 'Verma Logistics', amount: 27_140_00, status: 'Paid' },
  { date: '24 Oct', number: 'INV-0141', kind: 'Invoice', party: 'Nair Hospitality', amount: 56_640_00, status: 'Pending' },
];
