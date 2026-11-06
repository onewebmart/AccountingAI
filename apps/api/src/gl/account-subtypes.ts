import { AccountType } from '@ai-accounting/shared';
// Type-only: the schema imports this file for its enum, so a value import would be a cycle.
import type { SystemAccountKey } from './schemas/ledger-account.schema';

/**
 * The detailed account type a person picks (Bank, Input Tax, Cost of Goods
 * Sold…). Each belongs to one of the five base types, and the base type is
 * what every report, the closing entry and the balance checks keep using:
 * the detail only says more about the account, it never moves it between
 * statements.
 */
export const ACCOUNT_SUBTYPES = {
  other_asset: { label: 'Other Asset', base: AccountType.ASSETS },
  other_current_asset: { label: 'Other Current Asset', base: AccountType.ASSETS },
  cash: { label: 'Cash', base: AccountType.ASSETS },
  bank: { label: 'Bank', base: AccountType.ASSETS },
  fixed_asset: { label: 'Fixed Asset', base: AccountType.ASSETS },
  stock: { label: 'Stock', base: AccountType.ASSETS },
  payment_clearing: { label: 'Payment Clearing', base: AccountType.ASSETS },
  input_tax: { label: 'Input Tax', base: AccountType.ASSETS },
  other_current_liability: { label: 'Other Current Liability', base: AccountType.LIABILITIES },
  credit_card: { label: 'Credit Card', base: AccountType.LIABILITIES },
  long_term_liability: { label: 'Long Term Liability', base: AccountType.LIABILITIES },
  other_liability: { label: 'Other Liability', base: AccountType.LIABILITIES },
  output_tax: { label: 'Output Tax', base: AccountType.LIABILITIES },
  equity: { label: 'Equity', base: AccountType.CAPITAL },
  income: { label: 'Income', base: AccountType.INCOME },
  other_income: { label: 'Other Income', base: AccountType.INCOME },
  expense: { label: 'Expense', base: AccountType.EXPENSE },
  cost_of_goods_sold: { label: 'Cost of Goods Sold', base: AccountType.EXPENSE },
  other_expense: { label: 'Other Expense', base: AccountType.EXPENSE },
} as const satisfies Record<string, { label: string; base: AccountType }>;

export type AccountSubtype = keyof typeof ACCOUNT_SUBTYPES;
export const ACCOUNT_SUBTYPE_KEYS = Object.keys(ACCOUNT_SUBTYPES) as AccountSubtype[];

export function isAccountSubtype(v: unknown): v is AccountSubtype {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ACCOUNT_SUBTYPES, v);
}

export function baseTypeOf(subtype: AccountSubtype): AccountType {
  return ACCOUNT_SUBTYPES[subtype].base;
}

/** What each system account is. Fixed: the books rely on these accounts being what they are. */
export const SYSTEM_SUBTYPE: Record<`${SystemAccountKey}`, AccountSubtype> = {
  BANK: 'bank',
  CASH: 'cash',
  PAYMENT_GATEWAY: 'payment_clearing',
  ACCOUNTS_RECEIVABLE: 'other_current_asset',
  GST_INPUT_CGST: 'input_tax',
  GST_INPUT_SGST: 'input_tax',
  GST_INPUT_IGST: 'input_tax',
  GST_INPUT_CESS: 'input_tax',
  TDS_RECEIVABLE: 'other_current_asset',
  VENDOR_ADVANCES: 'other_current_asset',
  PREPAID_EXPENSES: 'other_current_asset',
  INVENTORY: 'stock',
  ACCUMULATED_DEPRECIATION: 'fixed_asset',
  ACCOUNTS_PAYABLE: 'other_current_liability',
  GST_OUTPUT_CGST: 'output_tax',
  GST_OUTPUT_SGST: 'output_tax',
  GST_OUTPUT_IGST: 'output_tax',
  GST_OUTPUT_CESS: 'output_tax',
  RCM_GST_PAYABLE: 'output_tax',
  TDS_PAYABLE: 'other_current_liability',
  CUSTOMER_ADVANCES: 'other_current_liability',
  ACCRUED_EXPENSES: 'other_current_liability',
  EMPLOYEE_PAYABLE: 'other_current_liability',
  RETAINED_EARNINGS: 'equity',
  SALES_REVENUE: 'income',
  ASSET_DISPOSAL_GAIN: 'other_income',
  FX_GAIN: 'other_income',
  PURCHASE_EXPENSE: 'cost_of_goods_sold',
  CHANGE_IN_INVENTORY: 'cost_of_goods_sold',
  DEPRECIATION: 'expense',
  ASSET_DISPOSAL_LOSS: 'other_expense',
  FX_LOSS: 'other_expense',
  ROUND_OFF: 'other_expense',
  SUSPENSE: 'other_expense',
};

interface Describable {
  name: string;
  type: AccountType | string;
  systemKey?: string | null;
}

/**
 * The detailed type of an account saved before there was one: from its
 * system key, else from its own name and its group's, else the plain kind
 * of its base type. Always one whose base type is the account's own.
 */
export function deriveAccountSubtype(account: Describable, parent?: Describable | null): AccountSubtype {
  const fromKey = account.systemKey ? SYSTEM_SUBTYPE[account.systemKey as `${SystemAccountKey}`] : undefined;
  if (fromKey && ACCOUNT_SUBTYPES[fromKey].base === account.type) return fromKey;

  const own = account.name.toLowerCase();
  const group = (parent?.name ?? '').toLowerCase();
  const either = (re: RegExp) => re.test(own) || re.test(group);
  const gst = /\b(gst|cgst|sgst|igst|utgst|cess)\b/;

  switch (account.type) {
    case AccountType.ASSETS:
      if (gst.test(own) && /\binput\b|\bitc\b|credit/.test(own)) return 'input_tax';
      if (/gateway|clearing|wallet/.test(own)) return 'payment_clearing';
      if (/\bcash\b|\bpetty\b|\bimprest\b/.test(own)) return 'cash';
      if (/\bbank\b|current a\/?c|savings a\/?c|\bo\/?d\b|overdraft/.test(own)) return 'bank';
      if (/\bstock\b|inventor|raw material|work in progress|finished goods/.test(own)) return 'stock';
      if (either(/fixed|furniture|fixture|equipment|machinery|plant|vehicle|computer|building|\bland\b|depreciation/)) return 'fixed_asset';
      if (either(/current/) || /receivable|advance|prepaid|deposit|tds|loan/.test(own)) return 'other_current_asset';
      return 'other_asset';
    case AccountType.LIABILITIES:
      if (/credit card/.test(own)) return 'credit_card';
      if (gst.test(own) && /output|payable|reverse charge|rcm/.test(own)) return 'output_tax';
      if (/short.?term/.test(own)) return 'other_current_liability';
      if (either(/long.?term|term loan|secured loan|unsecured loan|borrowing|debenture/) || /\bloan\b/.test(own)) return 'long_term_liability';
      if (either(/current/) || /payable|provision|duties|accrued|advance|outstanding|\btds\b|creditor/.test(own)) return 'other_current_liability';
      return 'other_liability';
    case AccountType.CAPITAL:
      return 'equity';
    case AccountType.INCOME:
      if (either(/other income|indirect income|non.?operating/) || /interest|discount|gain|dividend|commission received|rent received|miscellaneous/.test(own)) return 'other_income';
      return 'income';
    case AccountType.EXPENSE:
      // \b keeps "Indirect Expenses" out of "direct expense".
      if (either(/cost of goods|cost of sales|\bdirect expense|manufactur/) || /purchase|raw material|freight inward|carriage inward|inventor/.test(own)) return 'cost_of_goods_sold';
      if (/\bloss\b|round.?off|penalt|suspense|exchange/.test(own)) return 'other_expense';
      return 'expense';
    default:
      return 'other_asset';
  }
}
