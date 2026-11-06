import { AccountType } from '@ai-accounting/shared';
import type { Account } from './common';

/** The five base account types as the API stores them, in the order of a balance sheet then P&L. */
export const ACCOUNT_TYPES: Array<{ type: string; label: string }> = [
  { type: AccountType.ASSETS, label: 'Assets' },
  { type: AccountType.LIABILITIES, label: 'Liabilities' },
  { type: AccountType.CAPITAL, label: 'Capital' },
  { type: AccountType.INCOME, label: 'Income' },
  { type: AccountType.EXPENSE, label: 'Expenses' },
];

export const typeLabel = (type: string) => ACCOUNT_TYPES.find((t) => t.type === type)?.label ?? type;

/** Ids of an account and everything under it: a group cannot move under these. */
export function selfAndBelow(id: string, all: Account[]): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of all) {
      if (a.parentId && out.has(a.parentId) && !out.has(a._id)) {
        out.add(a._id);
        grew = true;
      }
    }
  }
  return out;
}
