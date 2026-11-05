/**
 * Unit tests — pricing a sales document: discount before tax, adjustment after.
 *
 *  ✓ A percent discount is spread over the lines in proportion, the last line taking what is left
 *  ✓ GST is worked out on the discounted values
 *  ✓ The shares always add up to the discount and never run outside a line
 *  ✓ A discount is a percent or an amount, never more than the lines
 *  ✓ An adjustment is added after tax, whole paise, at most ₹99.99 either way
 */
import { adjustmentOf, discountOf, docAmounts, priceDoc, spreadDiscount } from './doc-lines';

describe('pricing a document', () => {
  it('takes 10% off ₹1,000 + ₹500 before 18% GST: taxable ₹1,350, GST ₹243', () => {
    const r = priceDoc([{ qty: 1, ratePaise: 100000, taxRatePct: 18 }, { qty: 1, ratePaise: 50000, taxRatePct: 18 }], false, { discount: { percent: 10 } });
    expect(r.subTotalPaise).toBe(150000);
    expect(r.discount).toEqual({ percent: 10, amountPaise: 15000 });
    expect(r.lines.map((l) => l.discountPaise)).toEqual([10000, 5000]);
    expect(r.amounts).toEqual({ taxableValue: 135000, cgst: 12150, sgst: 12150, igst: 0, cess: 0, total: 159300 });
    // Across states, one head.
    expect(priceDoc([{ qty: 1, ratePaise: 100000, taxRatePct: 18 }, { qty: 1, ratePaise: 50000, taxRatePct: 18 }], true, { discount: { percent: 10 } }).amounts).toMatchObject({ igst: 24300, cgst: 0 });
  });

  it('spreads to the paisa, the last line taking the remainder, and stays within each line', () => {
    expect(spreadDiscount([10000, 10000, 10000], 100)).toEqual([33, 33, 34]);
    expect(spreadDiscount([100000, 50000], 0)).toEqual([0, 0]);
    // Rounding would leave the last line a negative share: the largest-remainder split instead.
    const shares = spreadDiscount([1, 1, 1, 1], 2);
    expect(shares.reduce((s, x) => s + x, 0)).toBe(2);
    expect(shares.every((s) => s >= 0 && s <= 1)).toBe(true);
    // A last line of a few paise cannot take more than itself.
    const tiny = spreadDiscount([3, 3, 1], 6);
    expect(tiny.reduce((s, x) => s + x, 0)).toBe(6);
    expect(tiny.every((s, i) => s >= 0 && s <= [3, 3, 1][i])).toBe(true);
    for (let n = 0; n < 200; n++) {
      const amounts = Array.from({ length: 1 + (n % 7) }, (_, i) => ((n * 7919 + i * 104729) % 50000) + 1);
      const sum = amounts.reduce((s, a) => s + a, 0);
      const d = (n * 31337) % (sum + 1);
      const s = spreadDiscount(amounts, d);
      expect(s.reduce((t, x) => t + x, 0)).toBe(d);
      expect(s.every((x, i) => x >= 0 && x <= amounts[i])).toBe(true);
    }
  });

  it('reads a discount as a percent or an amount, never more than the lines', () => {
    expect(discountOf(150000, { percent: 12.5 })).toEqual({ percent: 12.5, amountPaise: 18750 });
    expect(discountOf(150000, { amountPaise: 20000 })).toEqual({ percent: null, amountPaise: 20000 });
    expect(discountOf(150000, { percent: 0 })).toBeNull();
    expect(discountOf(150000, null)).toBeNull();
    expect(() => discountOf(150000, { percent: 10, amountPaise: 500 })).toThrow(/not both/);
    expect(() => discountOf(150000, { amountPaise: 150001 })).toThrow(/more than/);
    expect(() => discountOf(150000, { percent: 101 })).toThrow(/at most 100/);
    expect(() => discountOf(150000, { amountPaise: 10.5 })).toThrow(/whole paise/);
  });

  it('adds an adjustment after tax, within ₹99.99 either way', () => {
    const r = priceDoc([{ qty: 1, ratePaise: 100051, taxRatePct: 18 }], false, { adjustment: { label: 'Round off', paise: -60 } });
    expect(r.amounts).toEqual({ taxableValue: 100051, cgst: 9005, sgst: 9004, igst: 0, cess: 0, total: 118000 });
    expect(r.adjustment).toEqual({ label: 'Round off', paise: -60 });
    expect(adjustmentOf({ paise: 9999 }, 100)).toEqual({ label: 'Adjustment', paise: 9999 });
    expect(() => adjustmentOf({ paise: 10000 }, 1_000_000)).toThrow(/at most ₹99.99/);
    expect(() => adjustmentOf({ paise: -10000 }, 1_000_000)).toThrow(/at most ₹99.99/);
    expect(() => adjustmentOf({ paise: 0.5 }, 1000)).toThrow(/whole paise/);
    expect(() => adjustmentOf({ paise: -500 }, 500)).toThrow(/nothing or below/);
    expect(adjustmentOf({ paise: 0 }, 500)).toBeNull();
  });

  it('taxes each line on its value after its discount', () => {
    expect(docAmounts([{ qty: 2, ratePaise: 5000, taxRatePct: 12, discountPaise: 1000 }], false)).toEqual({ taxableValue: 9000, cgst: 540, sgst: 540, igst: 0, cess: 0, total: 10080 });
  });
});
