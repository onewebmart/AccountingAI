import { addSplits, noteAmounts, ZERO_SPLIT } from './note-amounts';

// ₹8,474.58 + 9% CGST + 9% SGST — the ₹10,000 invoice from the worked example.
const invoice = { taxableValue: 847458, cgst: 76271, sgst: 76271, igst: 0, cess: 0, total: 1000000 };

describe('noteAmounts', () => {
  it('splits a part credit in the original proportions', () => {
    const note = noteAmounts(invoice, ZERO_SPLIT, 100000);
    expect(note).toEqual({ taxableValue: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0, total: 118000 });
  });

  it('crediting everything left uses exactly what is left, so the notes add up to the invoice', () => {
    const first = noteAmounts(invoice, ZERO_SPLIT, 333333);
    const second = noteAmounts(invoice, first, 333333);
    const last = noteAmounts(invoice, addSplits([first, second]), invoice.taxableValue - 666666);
    const all = addSplits([first, second, last]);
    expect(all.cgst).toBe(invoice.cgst);
    expect(all.sgst).toBe(invoice.sgst);
    expect(all.total).toBe(invoice.total);
  });

  it('refuses more taxable value than is left, and anything not a positive whole number', () => {
    expect(() => noteAmounts(invoice, ZERO_SPLIT, invoice.taxableValue + 1)).toThrow(/left to adjust/);
    expect(() => noteAmounts(invoice, ZERO_SPLIT, 0)).toThrow(/positive whole number/);
    expect(() => noteAmounts(invoice, ZERO_SPLIT, 10.5)).toThrow(/positive whole number/);
  });

  it('carries IGST and cess for an inter-state document', () => {
    const interState = { taxableValue: 1000000, cgst: 0, sgst: 0, igst: 280000, cess: 120000, total: 1400000 };
    expect(noteAmounts(interState, ZERO_SPLIT, 250000)).toEqual({
      taxableValue: 250000, cgst: 0, sgst: 0, igst: 70000, cess: 30000, total: 350000,
    });
  });
});
