/**
 * Small, pure readings of documents shared by the reports: what was owed on
 * a date, the party's name as the document carries it.
 */
import { outstandingPaise } from '../../gl/schemas/settlement.schema';
import { InvoiceStatus, BillStatus } from '@ai-accounting/shared';

export const DONE_INVOICE = [InvoiceStatus.POSTED, InvoiceStatus.PAID];
export const DONE_BILL = [BillStatus.POSTED, BillStatus.PAID];

interface Settled {
  status: string;
  amountsPaise: { total: number; cgst: number; sgst: number; igst: number; cess: number; taxableValue: number };
  isReverseCharge?: boolean | null;
  amountPaidPaise?: number | null;
  adjustedPaise?: number | null;
  tds?: { amountPaise: number } | null;
  payments?: Array<{ paidOn: string; amountPaise: number; tdsPaise?: number | null }> | null;
  adjustments?: Array<{ noteDate: string; amountPaise: number }> | null;
}

/**
 * What was still owed on a document at the end of a day: what is owed now,
 * with the payments and notes dated after that day added back. Exact for
 * today, since nothing is dated after it.
 */
export function owedAsOf(doc: Settled, asOf: string): number {
  const now = outstandingPaise(doc as Parameters<typeof outstandingPaise>[0]);
  const later =
    (doc.payments ?? []).filter((p) => p.paidOn > asOf).reduce((s, p) => s + p.amountPaise + (p.tdsPaise ?? 0), 0) +
    (doc.adjustments ?? []).filter((a) => a.noteDate > asOf).reduce((s, a) => s + a.amountPaise, 0);
  return now + later;
}

export const gstOf = (a: { cgst: number; sgst: number; igst: number; cess: number }) => a.cgst + a.sgst + a.igst + a.cess;

/** The name the document was issued to, or the party's name now. */
export const issuedTo = (doc: { partyAtIssue?: { name?: string | null } | null }, names: Map<string, string>, id: unknown, unknown = 'Unknown') =>
  doc.partyAtIssue?.name || names.get(String(id)) || unknown;
