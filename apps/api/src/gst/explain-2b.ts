import { TaxHeads } from './gst-returns';
import { BillForItc, Line2bForItc, Match, normaliseGstin, normaliseInvoiceNumber, periodOf } from './itc';

/**
 * What went wrong between GSTR-2B and the books, in plain words, with the
 * message to send the vendor. Rules, not a model: every figure is computed
 * here, and each kind of difference has a known cause to name.
 */

export type ExplanationKind =
  | 'number_typed_differently'
  | 'tax_differs_rate'
  | 'igst_vs_cgst_sgst'
  | 'taxable_differs_tax_same'
  | 'amount_differs'
  | 'already_claimed_by_date'
  | 'other_registration'
  | 'number_differs'
  | 'not_in_books'
  | 'not_in_2b'
  | 'no_gstin';

export interface Explanation {
  kind: ExplanationKind;
  lineId: string | null;
  billId: string | null;
  supplier: string;
  invoiceNumber: string | null;
  /** What happened, in a sentence or two. */
  explanation: string;
  /** What to do about it. */
  action: string;
  /** Ready to send to the vendor, when the vendor is the one to fix it. */
  vendorMessage: string | null;
  /** Credit at stake, in paise. */
  itcPaise: number;
}

/** Amounts within this are the same invoice rounded differently (₹5). */
export const TOLERANCE_PAISE = 500;

const tax = (h: TaxHeads) => h.iamt + h.camt + h.samt + h.csamt;
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
/** Rounded to a slab-like number; a share of 0 taxable is no rate. */
const rateOf = (h: TaxHeads) => (h.txval > 0 ? Math.round((tax(h) * 1000) / h.txval) / 10 : 0);
/** The PAN inside a GSTIN: one business, one PAN, a registration per state. */
const panOf = (gstin: string | null) => (gstin && gstin.length === 15 ? gstin.slice(2, 12).toUpperCase() : null);

function letter(to: string, ourGstin: string | null, body: string): string {
  return [
    `Dear ${to},`,
    '',
    body,
    '',
    `Our GSTIN is ${ourGstin ?? '(our GSTIN)'}. Could you check and correct it in your GSTR-1, so the credit reaches our GSTR-2B? Please let us know once it is done.`,
    '',
    'Thank you.',
  ].join('\n');
}

export function explain2b(input: {
  period: string;
  ourGstin: string | null;
  lines: Line2bForItc[];
  bills: BillForItc[];
  matches: Match[];
}): Explanation[] {
  const { period, ourGstin } = input;
  const billById = new Map(input.bills.map((b) => [b.id, b]));
  const matchByLine = new Map(input.matches.map((m) => [m.lineId, m]));
  const matchedBills = new Set(input.matches.map((m) => m.billId));
  const out: Explanation[] = [];

  for (const line of input.lines.filter((l) => l.period === period && !l.isReverseCharge)) {
    const supplier = line.supplierName ?? line.gstin ?? 'The supplier';
    const base = { lineId: line.id, supplier, invoiceNumber: line.number, itcPaise: tax(line.heads) };
    const match = matchByLine.get(line.id);
    if (match) {
      const bill = billById.get(match.billId)!;
      const ref = `invoice ${line.number}${line.date ? ` of ${line.date}` : ''}`;
      if (match.claimedByDate) {
        out.push({
          ...base, billId: bill.id, kind: 'already_claimed_by_date',
          explanation: `Booked in ${monthName(periodOf(bill.billDate))}, a month with no 2B imported, so its credit was claimed then by the bill date. The vendor reported it in ${monthName(period)}.`,
          action: `Nothing to claim again. Import the 2B for ${monthName(periodOf(bill.billDate))} so credit is only claimed once the vendor reports it.`,
          vendorMessage: null,
        });
        continue;
      }
      const dTax = tax(line.heads) - tax(bill.heads);
      const dTxval = line.heads.txval - bill.heads.txval;
      const sameAmounts = Math.abs(dTax) <= TOLERANCE_PAISE && Math.abs(dTxval) <= TOLERANCE_PAISE;
      const swapped = Math.abs(dTax) <= TOLERANCE_PAISE && (line.heads.iamt > 0) !== (bill.heads.iamt > 0);
      if (sameAmounts && !swapped) {
        if (line.number !== bill.number) {
          out.push({
            ...base, billId: bill.id, kind: 'number_typed_differently', itcPaise: 0,
            explanation: `The same invoice: your bill says "${bill.number}", the vendor filed "${line.number}". Matched once punctuation and leading zeros are ignored.`,
            action: 'Nothing to do; it is matched.',
            vendorMessage: null,
          });
        }
        continue;
      }
      if (swapped) {
        const theirs = line.heads.iamt > 0 ? 'IGST' : 'CGST and SGST';
        const ours = bill.heads.iamt > 0 ? 'IGST' : 'CGST and SGST';
        out.push({
          ...base, billId: bill.id, kind: 'igst_vs_cgst_sgst',
          explanation: `The vendor reported ${theirs}; your bill has ${ours}. The total GST matches, so the place of supply differs: one of you has it as ${theirs === 'IGST' ? 'another state' : 'your state'}.`,
          action: `Check the place of supply on the invoice. If your bill is wrong, raise a debit note and re-book it; if the vendor's is, ask them to amend it.`,
          vendorMessage: letter(supplier, ourGstin, `Our GSTR-2B for ${monthName(period)} shows your ${ref} with ${theirs}, but the invoice charges ${ours}. Credit under the wrong head cannot be used against our liability.`),
        });
        continue;
      }
      const bookRate = rateOf(bill.heads);
      const theirRate = rateOf(line.heads);
      if (Math.abs(dTxval) <= TOLERANCE_PAISE && Math.abs(dTax) > TOLERANCE_PAISE && bookRate !== theirRate) {
        out.push({
          ...base, billId: bill.id, kind: 'tax_differs_rate',
          explanation: `Same taxable value, different GST: about ${theirRate}% in the 2B against ${bookRate}% on your bill, a difference of ${rupees(Math.abs(dTax))}. Likely the wrong rate on one side.`,
          action: `Credit is claimed at the lower of the two (${rupees(Math.min(tax(line.heads), tax(bill.heads)))}). Check the rate on the vendor's invoice.`,
          vendorMessage: letter(supplier, ourGstin, `Our GSTR-2B for ${monthName(period)} shows your ${ref} with GST of ${rupees(tax(line.heads))} (about ${theirRate}%), but the invoice charges ${rupees(tax(bill.heads))} (${bookRate}%) on the same value of ${rupees(bill.heads.txval)}.`),
        });
        continue;
      }
      if (Math.abs(dTax) <= TOLERANCE_PAISE) {
        out.push({
          ...base, billId: bill.id, kind: 'taxable_differs_tax_same', itcPaise: 0,
          explanation: `The GST matches but the taxable value differs by ${rupees(Math.abs(dTxval))}: likely freight, a discount or round-off entered differently.`,
          action: 'Credit is not affected. Correct the taxable value on whichever side is wrong when convenient.',
          vendorMessage: null,
        });
        continue;
      }
      out.push({
        ...base, billId: bill.id, kind: 'amount_differs',
        explanation: `The vendor reported ${rupees(tax(line.heads))} of GST on ${rupees(line.heads.txval)}; your bill has ${rupees(tax(bill.heads))} on ${rupees(bill.heads.txval)}. The invoice may have been amended, or booked from a draft.`,
        action: `Credit is claimed at the lower of the two. Check which amount is on the final invoice.`,
        vendorMessage: letter(supplier, ourGstin, `Our GSTR-2B for ${monthName(period)} shows your ${ref} for ${rupees(line.heads.txval)} plus GST ${rupees(tax(line.heads))}, but the invoice we have is for ${rupees(bill.heads.txval)} plus GST ${rupees(tax(bill.heads))}.`),
      });
      continue;
    }

    // Not matched: look for the bill it probably is.
    const open = input.bills.filter((b) => !matchedBills.has(b.id) && !b.isReverseCharge && b.billDate <= `${period}-31`);
    const sameNumber = open.find((b) => normaliseInvoiceNumber(b.number) === normaliseInvoiceNumber(line.number) && panOf(b.vendorGstin) && panOf(b.vendorGstin) === panOf(line.gstin));
    if (sameNumber) {
      out.push({
        ...base, billId: sameNumber.id, kind: 'other_registration',
        explanation: `Your bill ${sameNumber.number} from ${sameNumber.vendorName} has GSTIN ${sameNumber.vendorGstin}; the vendor filed it from ${line.gstin}, another registration of the same business (state ${line.gstin?.slice(0, 2)}).`,
        action: `Check which GSTIN is printed on the invoice and correct the vendor's GSTIN on record, or ask them to amend it.`,
        vendorMessage: letter(supplier, ourGstin, `Our GSTR-2B for ${monthName(period)} shows invoice ${line.number} from your GSTIN ${line.gstin}, but the invoice we have carries ${sameNumber.vendorGstin}.`),
      });
      continue;
    }
    const sameAmount = open.find(
      (b) => normaliseGstin(b.vendorGstin) === normaliseGstin(line.gstin) && Math.abs(tax(b.heads) - tax(line.heads)) <= TOLERANCE_PAISE && Math.abs(b.heads.txval - line.heads.txval) <= TOLERANCE_PAISE,
    );
    if (sameAmount) {
      out.push({
        ...base, billId: sameAmount.id, kind: 'number_differs',
        explanation: `Probably your bill ${sameAmount.number ?? '(no number)'} of ${sameAmount.billDate}: same vendor and the same amounts, but the vendor filed number "${line.number}".`,
        action: 'Check the number on the invoice. If your bill has it wrong, correct it with a debit note and re-book; if the vendor has, ask them to amend.',
        vendorMessage: letter(supplier, ourGstin, `Our GSTR-2B for ${monthName(period)} shows an invoice numbered ${line.number} for ${rupees(line.heads.txval)} plus GST ${rupees(tax(line.heads))}. The invoice we have for the same amount is numbered ${sameAmount.number ?? '(no number)'}.`),
      });
      continue;
    }
    out.push({
      ...base, billId: null, kind: 'not_in_books',
      explanation: `The vendor reported invoice ${line.number ?? '(no number)'}${line.date ? ` of ${line.date}` : ''} for ${rupees(line.heads.txval)} plus GST ${rupees(tax(line.heads))}, and there is no bill for it in your books.`,
      action: 'If you received it, record the bill to claim the credit. If you did not, ask the vendor: it may be billed to you by mistake.',
      vendorMessage: letter(supplier, ourGstin, `Our GSTR-2B for ${monthName(period)} shows your invoice ${line.number ?? ''}${line.date ? ` dated ${line.date}` : ''} for ${rupees(line.heads.txval)} plus GST ${rupees(tax(line.heads))}. We have no record of receiving it. Could you send us a copy, or remove it if it was reported against our GSTIN by mistake?`),
    });
  }

  // Bills of this month the vendor has not reported.
  for (const bill of input.bills.filter((b) => periodOf(b.billDate) === period && !b.isReverseCharge && tax(b.heads) > 0 && !matchedBills.has(b.id))) {
    if (out.some((e) => e.billId === bill.id)) continue;
    const base = { lineId: null, billId: bill.id, supplier: bill.vendorName, invoiceNumber: bill.number, itcPaise: tax(bill.heads) };
    if (!bill.vendorGstin) {
      out.push({
        ...base, kind: 'no_gstin',
        explanation: `${bill.vendorName} has no GSTIN on record. Credit is only available on a registered supplier's tax invoice.`,
        action: 'Add the GSTIN from the invoice to the vendor. If they are not registered, the GST on the bill cannot be claimed.',
        vendorMessage: null,
      });
      continue;
    }
    out.push({
      ...base, kind: 'not_in_2b',
      explanation: `Not in your 2B for ${monthName(period)}: the vendor has not reported invoice ${bill.number ?? '(no number)'} in their GSTR-1 yet, or reported it under another number.`,
      action: `Its credit of ${rupees(tax(bill.heads))} waits until it appears in a 2B. Ask the vendor to file it.`,
      vendorMessage: letter(bill.vendorName, ourGstin, `Our GSTR-2B for ${monthName(period)} does not show your invoice ${bill.number ?? ''} dated ${bill.billDate} for ${rupees(bill.totalPaise)}, which includes GST of ${rupees(tax(bill.heads))}.`),
    });
  }
  return out;
}
