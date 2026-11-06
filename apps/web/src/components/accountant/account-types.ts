/**
 * The detailed account types, as the API keeps them (apps/api/src/gl/account-subtypes.ts),
 * each with the base type its reports use and a line on what belongs in it.
 */
export interface AccountTypeInfo {
  key: string;
  label: string;
  /** ASSETS, LIABILITIES, CAPITAL, INCOME or EXPENSE. */
  base: string;
  about: string;
}

export const ACCOUNT_TYPE_LIST: AccountTypeInfo[] = [
  { key: 'other_asset', label: 'Other Asset', base: 'ASSETS', about: 'Assets you hold for more than a year that are not fixed assets: long-term deposits, investments, goodwill.' },
  { key: 'other_current_asset', label: 'Other Current Asset', base: 'ASSETS', about: 'Assets used up or turned into cash within a year: prepaid expenses, advances paid, deposits, loans given, TDS receivable.' },
  { key: 'cash', label: 'Cash', base: 'ASSETS', about: 'Cash in hand and petty cash: money kept on the premises. Expenses can be paid through it.' },
  { key: 'bank', label: 'Bank', base: 'ASSETS', about: 'A current, savings or overdraft account with a bank. Payments and receipts can go through it.' },
  { key: 'fixed_asset', label: 'Fixed Asset', base: 'ASSETS', about: 'What the business owns and uses for years: furniture, computers, vehicles, machinery, and their depreciation.' },
  { key: 'stock', label: 'Stock', base: 'ASSETS', about: 'Goods held for sale or to make goods: raw material, work in progress, finished goods.' },
  { key: 'payment_clearing', label: 'Payment Clearing', base: 'ASSETS', about: 'Money collected by a payment gateway or wallet, held until it is paid into your bank.' },
  { key: 'input_tax', label: 'Input Tax', base: 'ASSETS', about: 'GST paid on purchases that you set off against the GST you collect.' },
  { key: 'other_current_liability', label: 'Other Current Liability', base: 'LIABILITIES', about: 'What you owe within a year: statutory dues such as TDS, advances from customers, accrued expenses, short-term loans.' },
  { key: 'credit_card', label: 'Credit Card', base: 'LIABILITIES', about: 'A business credit card: what is spent on it is owed to the card issuer until the bill is paid.' },
  { key: 'long_term_liability', label: 'Long Term Liability', base: 'LIABILITIES', about: 'Loans and obligations due after more than a year: a term loan, a vehicle loan, a loan from a director.' },
  { key: 'other_liability', label: 'Other Liability', base: 'LIABILITIES', about: 'Obligations that are neither current nor loans, such as deposits received and held for a long time.' },
  { key: 'output_tax', label: 'Output Tax', base: 'LIABILITIES', about: 'GST collected on sales, and GST payable under reverse charge, owed to the government.' },
  { key: 'equity', label: 'Equity', base: 'CAPITAL', about: "The owners' stake: capital put in, drawings and retained earnings." },
  { key: 'income', label: 'Income', base: 'INCOME', about: 'Revenue from your main business: sales of goods and services.' },
  { key: 'other_income', label: 'Other Income', base: 'INCOME', about: 'Income outside your main business: interest, discounts received, gains on selling assets or on exchange.' },
  { key: 'expense', label: 'Expense', base: 'EXPENSE', about: 'The everyday cost of running the business: rent, salaries, utilities, travel, fees.' },
  { key: 'cost_of_goods_sold', label: 'Cost of Goods Sold', base: 'EXPENSE', about: 'The direct cost of what you sold: purchases, freight inward, direct labour, the change in stock.' },
  { key: 'other_expense', label: 'Other Expense', base: 'EXPENSE', about: 'Costs outside normal operations: losses on selling assets or on exchange, round-off, penalties.' },
];

export const BASE_LABEL: Record<string, string> = {
  ASSETS: 'Asset',
  LIABILITIES: 'Liability',
  CAPITAL: 'Equity',
  INCOME: 'Income',
  EXPENSE: 'Expense',
};

export const accountTypeInfo = (key: string | undefined | null) => ACCOUNT_TYPE_LIST.find((t) => t.key === key);
export const accountTypeLabel = (key: string | undefined | null) => accountTypeInfo(key)?.label ?? '—';
