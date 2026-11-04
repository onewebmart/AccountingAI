import { Gstr1, Gstr3b, HsnRow, TaxHeads, ZERO_HEADS, addHeads, sumHeads } from './gst-returns';

/**
 * GSTR-9, the annual return, built from the year's monthly GSTR-1 and
 * GSTR-3B as this system computes them. Pure.
 *
 * Covered: table 4 (outward supplies on which tax is payable), 5 (nil and
 * exempt), 6 and 7 (credit availed and reversed), 9 (tax payable and paid)
 * and 17 (HSN summary of outward supplies). Not covered: table 8 (credit as
 * per GSTR-2B against 3B), 10–14 (amendments made in the next year), 15–16,
 * 18 (inward HSN) and 19. Those need the portal's own figures or a person.
 */

export interface Gstr9 {
  financialYear: string;
  months: number;
  table4: { b2b: TaxHeads; b2c: TaxHeads; creditNotes: TaxHeads; reverseCharge: TaxHeads; net: TaxHeads };
  /** 5A: exports under LUT, without payment of tax, net of their credit notes. 5D–F: nil rated and exempt. */
  table5: { exportsWithoutTax: number; nilExempt: number };
  table6: { reverseCharge: TaxHeads; other: TaxHeads; total: TaxHeads };
  table7: { reversed: TaxHeads };
  table6Net: TaxHeads;
  table9: Array<{ head: 'igst' | 'cgst' | 'sgst' | 'cess'; payable: number; paidByCredit: number; paidInCash: number }>;
  table17: HsnRow[];
  notCovered: string[];
}

const docHeads = (docs: Array<{ items: TaxHeads[] }>) => sumHeads(docs.flatMap((d) => d.items));

export function buildGstr9(financialYear: string, months: Array<{ gstr1: Gstr1; gstr3b: Gstr3b }>): Gstr9 {
  let b2b = { ...ZERO_HEADS };
  let b2c = { ...ZERO_HEADS };
  let creditNotes = { ...ZERO_HEADS };
  let reverseCharge = { ...ZERO_HEADS };
  let nilExempt = 0;
  let exportsWithoutTax = 0;
  let itcRc = { ...ZERO_HEADS };
  let itcOther = { ...ZERO_HEADS };
  let reversed = { ...ZERO_HEADS };
  const paid = new Map<'igst' | 'cgst' | 'sgst' | 'cess', { payable: number; paidByCredit: number; paidInCash: number }>();
  const hsn = new Map<string, HsnRow>();

  for (const { gstr1, gstr3b } of months) {
    b2b = addHeads(b2b, docHeads(gstr1.b2b.flatMap((p) => p.invoices)));
    b2c = addHeads(b2c, addHeads(docHeads(gstr1.b2cl.flatMap((g) => g.invoices)), sumHeads(gstr1.b2cs)));
    creditNotes = addHeads(creditNotes, addHeads(docHeads(gstr1.cdnr.flatMap((p) => p.notes)), docHeads(gstr1.cdnur)));
    reverseCharge = addHeads(reverseCharge, gstr3b.inwardReverseCharge);
    nilExempt += gstr1.nil.reduce((s, n) => s + n.nilPaise, 0);
    exportsWithoutTax += gstr3b.outwardZeroRated?.txval ?? 0;
    itcRc = addHeads(itcRc, gstr3b.itcReverseCharge);
    itcOther = addHeads(itcOther, gstr3b.itcOther);
    reversed = addHeads(reversed, gstr3b.itcReversed ?? ZERO_HEADS);
    for (const row of gstr3b.setOff.rows) {
      const p = paid.get(row.head) ?? { payable: 0, paidByCredit: 0, paidInCash: 0 };
      p.payable += row.liabilityPaise + row.reverseChargePaise;
      p.paidByCredit += Object.values(row.fromCredit).reduce((s, x) => s + x, 0);
      p.paidInCash += row.cashPaise;
      paid.set(row.head, p);
    }
    for (const r of [...gstr1.hsn.b2b, ...gstr1.hsn.b2c]) {
      const key = `${r.hsn}|${r.uqc}|${r.rate}`;
      const row = hsn.get(key) ?? { ...r, ...ZERO_HEADS, qty: 0 };
      Object.assign(row, addHeads(row, r));
      row.qty += r.qty;
      hsn.set(key, row);
    }
  }

  const net = addHeads(addHeads(addHeads(b2b, b2c), creditNotes, -1), reverseCharge);
  const total = addHeads(itcRc, itcOther);
  return {
    financialYear,
    months: months.length,
    table4: { b2b, b2c, creditNotes, reverseCharge, net },
    table5: { exportsWithoutTax, nilExempt },
    table6: { reverseCharge: { ...itcRc, txval: 0 }, other: { ...itcOther, txval: 0 }, total: { ...total, txval: 0 } },
    table7: { reversed: { ...reversed, txval: 0 } },
    table6Net: { ...addHeads(total, reversed, -1), txval: 0 },
    table9: (['igst', 'cgst', 'sgst', 'cess'] as const).map((head) => ({ head, ...(paid.get(head) ?? { payable: 0, paidByCredit: 0, paidInCash: 0 }) })),
    table17: [...hsn.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate),
    notCovered: [
      'Table 8: credit as per GSTR-2B against what was claimed in GSTR-3B. Take it from the portal, which fills it.',
      'Tables 10 to 14: amendments of this year made in the next year, up to the due date.',
      'Tables 15, 16, 18 and 19: demands and refunds, supplies from composition dealers, inward HSN, late fees.',
    ],
  };
}

/** The months of a financial year, April to March: 2026-27 → 2026-04 … 2027-03. */
export function monthsOf(financialYear: string): string[] {
  const start = Number(financialYear.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1;
    const y = m >= 4 ? start : start + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  });
}
