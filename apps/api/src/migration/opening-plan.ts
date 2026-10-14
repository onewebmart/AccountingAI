/**
 * The one journal that brings another system's balances into these books.
 * Pure, in integer paise; MigrationService posts what this plans.
 */
import { AccountRole, ImportedAccount, ImportedParty } from './source-parsers';

export type LineTarget = { role: AccountRole } | { accountName: string };

export interface PlannedLine {
  target: LineTarget;
  label: string;
  debitPaise: number;
  creditPaise: number;
}

export interface OpeningPlan {
  lines: PlannedLine[];
  debitPaise: number;
  creditPaise: number;
  /** Debit − credit. Not zero means the books it came from did not balance as read. */
  differencePaise: number;
  notes: string[];
}

const ROLE_LABEL: Record<AccountRole, string> = {
  bank: 'Bank Accounts',
  cash: 'Cash in Hand',
  receivable: 'Accounts Receivable',
  payable: 'Accounts Payable',
  gst_output_cgst: 'Output CGST',
  gst_output_sgst: 'Output SGST',
  gst_output_igst: 'Output IGST',
  gst_output_cess: 'Output Cess',
  gst_input_cgst: 'Input CGST',
  gst_input_sgst: 'Input SGST',
  gst_input_igst: 'Input IGST',
  gst_input_cess: 'Input Cess',
  tds_payable: 'TDS Payable',
  tds_receivable: 'TDS Receivable',
  retained_earnings: 'Retained Earnings',
  suspense: 'Suspense',
};

const rupees = (p: number) => (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });

/**
 * Accounts with one of our roles (bank, GST, receivables…) are summed onto
 * that ledger; the rest each get their own line.
 *
 * Receivables and payables: when the source gave a control-account total
 * (a trial balance's "Sundry Debtors"), that total is what the ledger opens
 * with. Customer-by-customer balances are what the opening documents are
 * made from, and any difference between the two is called out. With no
 * total, the party balances are the total.
 */
export function planOpening(accounts: ImportedAccount[], parties: ImportedParty[]): OpeningPlan {
  const byRole = new Map<AccountRole, number>();
  const lines: PlannedLine[] = [];
  const notes: string[] = [];
  const push = (target: LineTarget, label: string, net: number) => {
    if (net === 0) return;
    lines.push({ target, label, debitPaise: net > 0 ? net : 0, creditPaise: net < 0 ? -net : 0 });
  };

  for (const a of accounts) {
    if (a.balancePaise === 0) continue;
    const role = a.classification?.role ?? null;
    if (role) byRole.set(role, (byRole.get(role) ?? 0) + a.balancePaise);
    else push({ accountName: a.name }, a.name, a.balancePaise);
  }

  const owedBy = (kind: 'customer' | 'vendor') => parties.filter((p) => p.kind === kind).reduce((s, p) => s + p.balancePaise, 0);
  const customers = owedBy('customer');
  const vendors = owedBy('vendor');
  if (byRole.has('receivable')) {
    const total = byRole.get('receivable')!;
    if (parties.some((p) => p.kind === 'customer') && customers !== total) {
      notes.push(`Customer balances add up to ${rupees(customers)} but the receivables total is ${rupees(total)}; the ledger opens at the total.`);
    }
  } else if (customers !== 0) {
    byRole.set('receivable', customers);
  }
  if (byRole.has('payable')) {
    const total = -byRole.get('payable')!;
    if (parties.some((p) => p.kind === 'vendor') && vendors !== total) {
      notes.push(`Vendor balances add up to ${rupees(vendors)} but the payables total is ${rupees(total)}; the ledger opens at the total.`);
    }
  } else if (vendors !== 0) {
    byRole.set('payable', -vendors);
  }

  for (const [role, net] of byRole) push({ role }, ROLE_LABEL[role], net);

  const debitPaise = lines.reduce((s, l) => s + l.debitPaise, 0);
  const creditPaise = lines.reduce((s, l) => s + l.creditPaise, 0);
  return { lines, debitPaise, creditPaise, differencePaise: debitPaise - creditPaise, notes };
}
