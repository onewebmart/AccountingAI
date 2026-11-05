import { AccountType } from '@ai-accounting/shared';
import { SystemAccountKey } from './schemas/ledger-account.schema';

/** Names that mark an asset ledger as money: a bank account, cash, a wallet. */
export const MONEY_NAME = /\b(bank|cash|petty|wallet|imprest|current a\/?c|savings a\/?c)\b/i;

/**
 * A bank or cash account: the system Bank and Cash accounts, and any other
 * asset ledger named as money. What expenses may be paid through, and what
 * the cash flow counts.
 */
export function isMoneyAccount(a: { systemKey?: string | null; type?: string | null; isGroup?: boolean | null; name: string }): boolean {
  if (a.systemKey === SystemAccountKey.BANK || a.systemKey === SystemAccountKey.CASH) return true;
  return !a.systemKey && a.type === AccountType.ASSETS && !a.isGroup && MONEY_NAME.test(a.name);
}
