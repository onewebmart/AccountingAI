/**
 * Deterministic checks on an extracted invoice.
 *
 * The model is asked to report data-quality concerns itself, but it does not
 * reliably notice arithmetic it got wrong — an invoice printed as ₹47,700 whose
 * tax lines add up to ₹47,200 came back at confidence 0.9 with no warning. These
 * checks run on every extraction regardless of what the model says.
 */

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The GSTIN's 15th character is a mod-36 checksum over the first fourteen. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

/** Why a GSTIN is invalid, or null if it is valid. */
export function gstinProblem(raw: string): string | null {
  const gstin = raw.trim().toUpperCase();
  if (!GSTIN_PATTERN.test(gstin)) return 'is not in the 15-character GSTIN format';
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) {
    return 'fails its check digit — a character was probably misread';
  }
  return null;
}

/** Rupees for a message, e.g. 4770000 → "₹47,700.00". */
function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface CheckedAmounts {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
}

/** A difference of up to ₹1 is treated as rounding on the printed total. */
export const ROUNDING_TOLERANCE_PAISE = 100;

/**
 * Problems a reviewer must resolve before this invoice can be trusted. Each is
 * a sentence ready to show on the review screen.
 */
export function invoiceProblems(amounts: CheckedAmounts, counterpartyGstin: string | null): string[] {
  const problems: string[] = [];
  const { taxableValue, cgst, sgst, igst, cess, total } = amounts;

  const computed = taxableValue + cgst + sgst + igst + cess;
  if (total > 0 && Math.abs(computed - total) > ROUNDING_TOLERANCE_PAISE) {
    problems.push(
      `taxable value plus tax comes to ${rupees(computed)} but the invoice total reads ${rupees(total)} ` +
        `— a difference of ${rupees(Math.abs(total - computed))}`,
    );
  }
  if (cgst > 0 && sgst > 0 && Math.abs(cgst - sgst) > 1) {
    problems.push(`CGST (${rupees(cgst)}) and SGST (${rupees(sgst)}) should be equal`);
  }
  if (igst > 0 && (cgst > 0 || sgst > 0)) {
    problems.push('both IGST and CGST/SGST are charged — an invoice is either inter-state or intra-state');
  }
  if (counterpartyGstin) {
    const problem = gstinProblem(counterpartyGstin);
    if (problem) problems.push(`GSTIN ${counterpartyGstin} ${problem}`);
  }
  return problems;
}

/**
 * A due date from printed payment terms such as "Net 30", "30 days" or
 * "due within 45 days of invoice". Null when the terms carry no day count
 * ("Due on receipt" is treated as due on the invoice date).
 */
export function dueDateFromTerms(invoiceDate: string | null, terms: string | null): string | null {
  if (!invoiceDate || !terms || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) return null;
  if (/on receipt|immediate/i.test(terms)) return invoiceDate;
  const days = terms.match(/(\d{1,3})\s*(?:days?|d\b)/i) ?? terms.match(/net\s*(\d{1,3})/i);
  if (!days) return null;
  const due = new Date(`${invoiceDate}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + Number(days[1]));
  return due.toISOString().slice(0, 10);
}
