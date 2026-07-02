/**
 * Paise is the canonical money unit throughout the entire platform.
 * All money stored, transmitted, and computed as integer paise.
 * Display layer divides by 100 — never store the result.
 */
export type Paise = number;

export function assertPaise(value: number, field = 'amount'): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${field} must be an integer (paise). Got: ${value}`);
  }
  if (value < 0) {
    throw new Error(`${field} must be non-negative paise. Got: ${value}`);
  }
}

export function paiseToRupees(paise: Paise): number {
  return paise / 100;
}

export function rupeesToPaise(rupees: number): Paise {
  const paise = Math.round(rupees * 100);
  assertPaise(paise);
  return paise;
}

export function formatRupees(paise: Paise): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(paiseToRupees(paise));
}
