import { AccountType, VoucherType } from '@ai-accounting/shared';

/**
 * Transaction locking by module, as Zoho Books has it: Sales, Purchases,
 * Banking and Accountant lock separately. Locked through a date, nothing in
 * that module dated on or before it can be posted (created), and nothing
 * posted in it can be reversed (changed or deleted). The org-wide lock and
 * year-end close apply on top: an entry is refused when either covers it.
 */
export const LOCK_MODULES = ['sales', 'purchases', 'banking', 'accountant'] as const;
export type LockModule = (typeof LOCK_MODULES)[number];

export const MODULE_LABEL: Record<LockModule, string> = {
  sales: 'Sales',
  purchases: 'Purchases',
  banking: 'Banking',
  accountant: 'Accountant',
};

export function isLockModule(v: unknown): v is LockModule {
  return typeof v === 'string' && (LOCK_MODULES as readonly string[]).includes(v);
}

/** What a line's account is, as far as locking needs to know. */
export interface LockAccountFacts {
  systemKey?: string | null;
  type?: string | null;
}

/** Kept customer by customer: invoices, receipts, credit notes and advances. */
const CUSTOMER_SIDE = new Set(['ACCOUNTS_RECEIVABLE', 'CUSTOMER_ADVANCES']);
/** Kept vendor by vendor (and claim by claim): bills, payments, debit notes, advances, expense claims. */
const VENDOR_SIDE = new Set(['ACCOUNTS_PAYABLE', 'VENDOR_ADVANCES', 'EMPLOYEE_PAYABLE']);

/**
 * The module an entry belongs to, from its voucher type and the accounts it
 * touches, so every posting path is covered without each one saying so:
 *
 *   SALES, CREDIT_NOTE ............................................. sales
 *   PURCHASE, DEBIT_NOTE ........................................... purchases
 *   CONTRA (transfers between bank, cash and the gateway) .......... banking
 *   RECEIPT / PAYMENT touching receivables or customer advances .... sales      (customer payments, refunds to customers)
 *   RECEIPT / PAYMENT touching payables, vendor advances or claims . purchases  (vendor payments, vendor refunds, reimbursements)
 *   PAYMENT with an expense line ................................... purchases  (expenses, a bank line filed as an expense)
 *   any other RECEIPT / PAYMENT .................................... banking    (deposits, drawings, TDS deposited, loan repaid)
 *   JOURNAL applying an advance (advance and its control account) .. sales or purchases
 *   JOURNAL crediting the employee claims account (a claim approved)  purchases
 *   any other JOURNAL .............................................. accountant (manual journals, adjustments,
 *                                                                               depreciation, revaluation, GST set-off)
 *
 * Usually one module; an entry that settles a customer against a vendor is in both.
 */
export function modulesOfEntry(
  voucherType: VoucherType | string,
  lines: Array<{ accountId: unknown; debitPaise: number; creditPaise: number }>,
  accounts: Map<string, LockAccountFacts>,
): LockModule[] {
  switch (voucherType) {
    case VoucherType.SALES:
    case VoucherType.CREDIT_NOTE:
      return ['sales'];
    case VoucherType.PURCHASE:
    case VoucherType.DEBIT_NOTE:
      return ['purchases'];
    case VoucherType.CONTRA:
      return ['banking'];
  }

  const keys = new Set<string>();
  let expenseDebit = false;
  for (const l of lines) {
    const facts = accounts.get(String(l.accountId));
    if (facts?.systemKey) keys.add(facts.systemKey);
    if (facts?.type === AccountType.EXPENSE && l.debitPaise > 0) expenseDebit = true;
  }
  const customer = [...keys].some((k) => CUSTOMER_SIDE.has(k));
  const vendor = [...keys].some((k) => VENDOR_SIDE.has(k));

  if (voucherType === VoucherType.RECEIPT || voucherType === VoucherType.PAYMENT) {
    const out: LockModule[] = [];
    if (customer) out.push('sales');
    if (vendor) out.push('purchases');
    if (!out.length && voucherType === VoucherType.PAYMENT && expenseDebit) out.push('purchases');
    return out.length ? out : ['banking'];
  }

  // JOURNAL (and anything else): the accountant's, unless it is one of the
  // documents' own journals.
  const out: LockModule[] = [];
  if (keys.has('CUSTOMER_ADVANCES') && keys.has('ACCOUNTS_RECEIVABLE')) out.push('sales');
  if ((keys.has('VENDOR_ADVANCES') && keys.has('ACCOUNTS_PAYABLE')) || keys.has('EMPLOYEE_PAYABLE')) out.push('purchases');
  return out.length ? out : ['accountant'];
}

/** A module's lock as stored: the date it is locked through, or null. */
export interface ModuleLockState {
  lockedThrough: string | null;
  reason?: string | null;
  changedBy?: string | null;
  changedAt?: Date | null;
}

/** The locks among `modules` that cover `date`. */
export function locksCovering(
  modules: LockModule[],
  date: string,
  state: Partial<Record<LockModule, ModuleLockState | null>> | null | undefined,
): Array<{ module: LockModule; lockedThrough: string }> {
  const out: Array<{ module: LockModule; lockedThrough: string }> = [];
  for (const m of modules) {
    const through = state?.[m]?.lockedThrough;
    if (through && date <= through) out.push({ module: m, lockedThrough: through });
  }
  return out;
}
