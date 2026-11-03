/**
 * Paying micro and small enterprises on time: section 43B(h) of the
 * Income-tax Act, read with section 15 of the MSMED Act.
 *
 * A micro or small enterprise must be paid by the agreed day, which a
 * written agreement may set at most 45 days from acceptance; without one,
 * within 15 days. Pay later and the expense is deductible only in the year
 * it is actually paid. Medium enterprises, and traders (whose Udyam
 * registration is for priority-sector lending only), are outside it.
 *
 * Acceptance is the day the goods or services were accepted. The bill date
 * stands in for it here; where they differ, the person can see why.
 */

export type MsmeCategory = 'micro' | 'small' | 'medium';
export type MsmeActivity = 'manufacturing' | 'services' | 'trading';

export interface VendorMsme {
  /** Udyam registration number, e.g. UDYAM-MH-26-0012345. */
  udyamNumber: string;
  category: MsmeCategory;
  activity: MsmeActivity;
  /** A written agreement on payment terms lets the due day run to 45 days. */
  writtenAgreement: boolean;
}

export const UDYAM_PATTERN = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whether 43B(h) applies to bills from this vendor at all. */
export function msmeProtected(msme: VendorMsme | null | undefined): msme is VendorMsme {
  return !!msme && msme.category !== 'medium' && msme.activity !== 'trading';
}

/**
 * The last day to pay a bill under 43B(h), or null when it does not apply.
 * With a written agreement, the bill's own due date if it is sooner than 45
 * days; without one, 15 days, whatever the bill says.
 */
export function msmePayBy(billDate: string, dueDate: string | null, msme: VendorMsme | null | undefined): string | null {
  if (!msmeProtected(msme)) return null;
  if (!msme.writtenAgreement) return addDays(billDate, 15);
  const cap = addDays(billDate, 45);
  return dueDate && dueDate < cap ? dueDate : cap;
}
