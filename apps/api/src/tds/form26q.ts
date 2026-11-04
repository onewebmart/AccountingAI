import type { TdsPayableRow } from './tds.service';

/**
 * The quarterly TDS statement for payments to residents (Form 26Q), checked,
 * and the per-vendor summary Form 16A will carry. Pure.
 *
 * This is the content and its checks, as a table to key into Protean's
 * Return Preparation Utility; it is not the FVU input file, whose fixed
 * layout is Protean's to define. Form 16A itself must be downloaded from
 * TRACES once the statement is processed: a certificate made anywhere else
 * is not valid.
 */

export type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

export interface DepositRow {
  id: string;
  month: string;
  section: string;
  amountPaise: number;
  paidOn: string;
  challanNumber: string;
}

export interface Issue26q {
  level: 'block' | 'warn';
  message: string;
}

export const TAN = /^[A-Z]{4}\d{5}[A-Z]$/;
export const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
/** Without a PAN, TDS is at least 20% (section 206AA). */
const NO_PAN_RATE_BPS = 2000;

export function quarterMonths(financialYear: string, q: Quarter): string[] {
  const start = Number(financialYear.slice(0, 4));
  const first = { Q1: 4, Q2: 7, Q3: 10, Q4: 1 }[q];
  const year = q === 'Q4' ? start + 1 : start;
  return [0, 1, 2].map((i) => `${year}-${String(first + i).padStart(2, '0')}`);
}

/** 31 July, 31 October, 31 January, 31 May. */
export function filingDueDate(financialYear: string, q: Quarter): string {
  const start = Number(financialYear.slice(0, 4));
  return { Q1: `${start}-07-31`, Q2: `${start}-10-31`, Q3: `${start + 1}-01-31`, Q4: `${start + 1}-05-31` }[q];
}

/** Deposit by the 7th of the next month; TDS deducted in March, by 30 April. */
export function depositDueDate(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (m === 3) return `${y}-04-30`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return `${next}-07`;
}

/**
 * Interest for depositing late (section 201(1A)): 1.5% a month or part of
 * one, from the date of deduction to the date of deposit.
 */
export function lateDepositInterest(tdsPaise: number, deductedOn: string, depositedOn: string): number {
  const [y1, m1, d1] = deductedOn.split('-').map(Number);
  const [y2, m2, d2] = depositedOn.split('-').map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1);
  if (d2 >= d1) months += 1; // a part of a month counts as a month
  return Math.round((tdsPaise * 15 * Math.max(1, months)) / 1000);
}

const rs = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function build26q(input: {
  financialYear: string;
  quarter: Quarter;
  deductor: { name: string; tan: string | null; pan: string | null };
  rows: TdsPayableRow[];
  deposits: DepositRow[];
  today: string;
}) {
  const months = new Set(quarterMonths(input.financialYear, input.quarter));
  const rows = input.rows.filter((r) => months.has(r.billDate.slice(0, 7)));
  const deposits = input.deposits.filter((d) => months.has(d.month));
  const depositById = new Map(deposits.map((d) => [d.id, d]));
  const issues: Issue26q[] = [];

  if (!input.deductor.tan || !TAN.test(input.deductor.tan)) issues.push({ level: 'block', message: 'Your TAN is missing or not in the AAAA99999A format. Add it in Settings → Business.' });

  let interestPaise = 0;
  const deductees = rows.map((r) => {
    const deposit = r.depositId ? depositById.get(r.depositId) ?? null : null;
    const pan = r.pan?.trim().toUpperCase() || null;
    const panOk = !!pan && PAN.test(pan);
    // C: deducted at the higher rate because there is no PAN.
    const remark = !panOk && r.rateBps >= NO_PAN_RATE_BPS ? 'C' : '';
    if (!panOk) {
      const shortBy = r.rateBps < NO_PAN_RATE_BPS ? Math.round((r.taxablePaise * (NO_PAN_RATE_BPS - r.rateBps)) / 10_000) : 0;
      issues.push({
        level: 'warn',
        message: `${r.vendorName} (bill ${r.billNumber ?? r.billDate}) has no valid PAN. Without one, TDS is at least 20%${shortBy > 0 ? `: ${rs(shortBy)} more should have been deducted` : ''}. Get the PAN, or the statement shows a default.`,
      });
    }
    if (!deposit) issues.push({ level: 'block', message: `TDS of ${rs(r.tdsPaise)} on ${r.vendorName}'s bill ${r.billNumber ?? r.billDate} is not deposited. Deposit it before filing.` });
    else if (deposit.paidOn > depositDueDate(r.billDate.slice(0, 7))) interestPaise += lateDepositInterest(r.tdsPaise, r.billDate, deposit.paidOn);
    return {
      pan: panOk ? pan! : 'PANNOTAVBL',
      name: r.vendorName,
      section: r.section,
      paidOn: r.billDate,
      amountPaise: r.taxablePaise,
      rateBps: r.rateBps,
      tdsPaise: r.tdsPaise,
      deductedOn: r.billDate,
      challanNumber: deposit?.challanNumber ?? null,
      challanDate: deposit?.paidOn ?? null,
      remark,
    };
  });

  for (const d of deposits) {
    const linked = rows.filter((r) => r.depositId === d.id).reduce((s, r) => s + r.tdsPaise, 0);
    if (linked !== d.amountPaise) issues.push({ level: 'warn', message: `Challan ${d.challanNumber} of ${rs(d.amountPaise)} pays ${rs(linked)} of deductions in this quarter. Each challan's amount should be what it covers.` });
  }
  if (interestPaise > 0) issues.push({ level: 'warn', message: `Some TDS was deposited after its due date: interest of about ${rs(interestPaise)} (1.5% a month) is due, paid by its own challan.` });

  const due = filingDueDate(input.financialYear, input.quarter);
  const totalTds = rows.reduce((s, r) => s + r.tdsPaise, 0);
  if (input.today > due) {
    const days = Math.round((Date.parse(`${input.today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
    issues.push({ level: 'warn', message: `Past the due date of ${due}: a late fee of ₹200 a day (section 234E) runs, capped at the TDS, now about ${rs(Math.min(days * 20_000, totalTds))}.` });
  }

  // What each vendor's Form 16A will show.
  const byVendor = new Map<string, { name: string; pan: string; section: string; amountPaise: number; tdsPaise: number; depositedPaise: number }>();
  for (const d of deductees) {
    const key = `${d.pan}|${d.name}|${d.section}`;
    const c = byVendor.get(key) ?? { name: d.name, pan: d.pan, section: d.section, amountPaise: 0, tdsPaise: 0, depositedPaise: 0 };
    c.amountPaise += d.amountPaise;
    c.tdsPaise += d.tdsPaise;
    if (d.challanNumber) c.depositedPaise += d.tdsPaise;
    byVendor.set(key, c);
  }

  return {
    financialYear: input.financialYear,
    quarter: input.quarter,
    deductor: input.deductor,
    dueDate: due,
    deductees,
    challans: deposits,
    totals: { amountPaise: rows.reduce((s, r) => s + r.taxablePaise, 0), tdsPaise: totalTds, depositedPaise: deposits.reduce((s, d) => s + d.amountPaise, 0), interestPaise },
    certificates: [...byVendor.values()],
    issues,
    ready: !issues.some((i) => i.level === 'block'),
  };
}

export type Form26q = ReturnType<typeof build26q>;

/** The deductee rows as CSV, in the order the RPU's deductee sheet asks for them. Rupees, as it takes them. */
export function form26qCsv(r: Form26q): string {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rupees = (p: number) => (p / 100).toFixed(2);
  const dmy = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
  const header = ['Deductee PAN', 'Deductee name', 'Section', 'Date of payment or credit', 'Amount paid or credited', 'TDS rate (%)', 'TDS deducted', 'Date of deduction', 'Challan number', 'Challan date', 'Remark'];
  const lines = r.deductees.map((d) => [d.pan, d.name, d.section, dmy(d.paidOn), rupees(d.amountPaise), (d.rateBps / 100).toFixed(2), rupees(d.tdsPaise), dmy(d.deductedOn), d.challanNumber, dmy(d.challanDate), d.remark].map(cell).join(','));
  return [header.join(','), ...lines].join('\r\n') + '\r\n';
}
