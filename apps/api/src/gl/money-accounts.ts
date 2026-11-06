import { AccountType } from '@ai-accounting/shared';
import { SystemAccountKey } from './schemas/ledger-account.schema';

/** Names that mark an asset ledger as money: a bank account, cash, a wallet. */
export const MONEY_NAME = /\b(bank|cash|petty|wallet|imprest|current a\/?c|savings a\/?c)\b/i;

/**
 * A bank or cash account: the system Bank and Cash accounts, and any other
 * asset ledger named as money. What expenses may be paid through, and what
 * the cash flow counts.
 */
export function isMoneyAccount(a: { systemKey?: string | null; type?: string | null; isGroup?: boolean | null; name: string; accountType?: string | null }): boolean {
  if (a.systemKey === SystemAccountKey.BANK || a.systemKey === SystemAccountKey.CASH) return true;
  if (a.systemKey || a.type !== AccountType.ASSETS || a.isGroup) return false;
  // Typed as Bank or Cash in the chart of accounts, or named as money.
  return a.accountType === 'bank' || a.accountType === 'cash' || MONEY_NAME.test(a.name);
}
