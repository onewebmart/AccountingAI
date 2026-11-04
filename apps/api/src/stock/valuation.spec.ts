/**
 * Tests — stock valuation, reorders and line-to-item suggestions (pure).
 *
 *  ✓ Weighted average: moves out at the running average; the last unit out takes what is left
 *  ✓ The same day, stock in comes before stock out
 *  ✓ Sold before it was billed: the next purchase makes those units good at its own cost
 *  ✓ Summary on a date: 90 days of sales, the last two purchase rates, negative stock
 *  ✓ Reorder at the level, or under two weeks' cover; what is on order counts
 *  ✓ A line's item: this vendor's history, anyone's, shared words checked against HSN, else a new item
 */
import { Move, itemLedger, reorder, summary } from './valuation';
import { isServiceLine, itemNameFrom, suggestItem } from './line-mapping';

let n = 0;
const bill = (date: string, qty: number, amountPaise: number, itemId = 'rice'): Move => ({ itemId, date, qty, ratePaise: Math.round(amountPaise / qty), valuePaise: amountPaise, source: { kind: 'bill', id: `b${++n}`, number: null } });
const sale = (date: string, qty: number, itemId = 'rice'): Move => ({ itemId, date, qty: -qty, ratePaise: null, source: { kind: 'invoice', id: `i${++n}`, number: null } });

describe('item ledger', () => {
  it('moves out at the running average, and the last unit out takes what is left', () => {
    const rows = itemLedger([bill('2026-10-01', 10, 50000), bill('2026-10-05', 10, 60000), sale('2026-10-08', 5), sale('2026-10-20', 15)]);
    expect(rows.map((r) => [r.balanceQty, r.balanceValuePaise, r.avgPaise])).toEqual([[10, 50000, 5000], [20, 110000, 5500], [15, 82500, 5500], [0, 0, 0]]);
    expect(rows[3].valuePaise).toBe(-82500);

    // ₹10 for three: 333 + 333 + 334, nothing left over.
    const thirds = itemLedger([bill('2026-10-01', 3, 1000), sale('2026-10-02', 1), sale('2026-10-03', 1), sale('2026-10-04', 1)]);
    expect(thirds.map((r) => r.valuePaise)).toEqual([1000, -333, -333, -334]);
  });

  it('costs a sale at what came in the same day', () => {
    const rows = itemLedger([sale('2026-10-01', 2), bill('2026-10-01', 4, 40000)]);
    expect(rows.map((r) => r.source.kind)).toEqual(['bill', 'invoice']);
    expect(rows[1]).toMatchObject({ balanceQty: 2, balanceValuePaise: 20000 });
  });

  it('makes good stock sold before its bill, at the bill’s cost', () => {
    const rows = itemLedger([sale('2026-10-01', 2), bill('2026-10-03', 5, 50000)]);
    expect(rows[0]).toMatchObject({ balanceQty: -2, balanceValuePaise: 0 });
    expect(rows[1]).toMatchObject({ balanceQty: 3, balanceValuePaise: 30000, avgPaise: 10000 });
  });

  it('takes a return in at the running average when no rate is given', () => {
    const back: Move = { itemId: 'rice', date: '2026-10-06', qty: 1, ratePaise: null, source: { kind: 'adjustment', id: 'a1', number: null } };
    const rows = itemLedger([bill('2026-10-01', 4, 40000), sale('2026-10-05', 2), back]);
    expect(rows[2]).toMatchObject({ valuePaise: 10000, balanceQty: 3, balanceValuePaise: 30000 });
  });
});

describe('summary', () => {
  it('reads each item on a date, with 90 days of sales and the last two purchase rates', () => {
    const rows = summary(
      [
        bill('2026-05-01', 100, 400000), sale('2026-06-01', 30), bill('2026-08-10', 50, 225000), sale('2026-09-15', 40), sale('2026-11-02', 10),
        sale('2026-10-01', 3, 'oil'),
      ],
      '2026-10-31',
    );
    const rice = rows.find((r) => r.itemId === 'rice')!;
    // 2026-08-03 onward: the September sale only; November's is after the date.
    expect(rice).toMatchObject({ qty: 80, out90: 40, lastInRatePaise: 4500, prevInRatePaise: 4000, negative: false });
    expect(rows.find((r) => r.itemId === 'oil')).toMatchObject({ qty: -3, valuePaise: 0, negative: true });
  });
});

describe('reorder', () => {
  it('reorders at the level, with the quantity the item asks for', () => {
    expect(reorder({ qty: 8, out90: 0, reorderLevel: 10, reorderQty: 50 })).toMatchObject({ reorder: true, suggestQty: 50, reason: '8 in stock, at or under the reorder level of 10.' });
    expect(reorder({ qty: 8, onOrder: 5, out90: 0, reorderLevel: 10, reorderQty: 50 }).reorder).toBe(false);
  });

  it('without a level, reorders under two weeks of cover, up to six weeks', () => {
    // 90 a quarter: one a day. 10 left is 10 days.
    expect(reorder({ qty: 10, out90: 90, reorderLevel: null, reorderQty: null })).toMatchObject({ reorder: true, suggestQty: 32, daysLeft: 10 });
    expect(reorder({ qty: 20, out90: 90, reorderLevel: null, reorderQty: null }).reorder).toBe(false);
    expect(reorder({ qty: 10, onOrder: 10, out90: 90, reorderLevel: null, reorderQty: null }).reorder).toBe(false);
    // Nothing sold lately: nothing to reorder.
    expect(reorder({ qty: 0, out90: 0, reorderLevel: null, reorderQty: null }).reorder).toBe(false);
  });
});

describe('line to item', () => {
  const items = [
    { id: 'basmati', name: 'Basmati Rice 25kg', kind: 'goods' as const, hsnSac: '1006' },
    { id: 'sona', name: 'Sona Masoori Rice 25kg', kind: 'goods' as const, hsnSac: '1006' },
    { id: 'oil', name: 'Sunflower Oil 15L', kind: 'goods' as const, hsnSac: '1512' },
    { id: 'audit', name: 'Rice audit', kind: 'service' as const, hsnSac: '998221' },
  ];
  const line = (description: string, hsnSac: string | null = null, partyId = 'v1') => ({ partyId, description, hsnSac, taxRatePct: 5 });

  it("takes this vendor's own history first, then anyone's", () => {
    const linked = [
      { partyId: 'v2', description: 'RICE BSMT 25 KG', itemId: 'sona', docNumber: 'B-1' },
      { partyId: 'v1', description: 'Rice bsmt 25 kg', itemId: 'basmati', docNumber: 'B-7' },
    ];
    expect(suggestItem(line('RICE BSMT 25 KG'), items, linked)).toMatchObject({ by: 'vendor_history', itemId: 'basmati', confidence: 0.95 });
    expect(suggestItem(line('RICE BSMT 25 KG', null, 'v3'), items, linked)).toMatchObject({ by: 'history', itemId: 'basmati' });
  });

  it('matches shared words among goods, and trusts it more when the HSN agrees', () => {
    const agree = suggestItem(line('Basmati rice 25kg bag', '10063020'), items, []);
    expect(agree).toMatchObject({ by: 'name', itemId: 'basmati' });
    const differ = suggestItem(line('Basmati rice 25kg bag', '1904'), items, []);
    expect(differ).toMatchObject({ by: 'name', itemId: 'basmati' });
    expect(differ.confidence).toBeLessThan(agree.confidence);
    expect(differ.reason).toMatch(/HSN 1904 is not the item's 1006/);
  });

  it('proposes a new item when nothing is close', () => {
    expect(suggestItem(line('1. Jaggery blocks 1kg', '1701'), items, [])).toMatchObject({
      by: 'new', itemId: null, newItem: { name: 'Jaggery blocks 1kg', kind: 'goods', hsnSac: '1701', gstRatePct: 5 },
    });
    expect(isServiceLine('9965')).toBe(true);
    expect(isServiceLine('1006')).toBe(false);
    expect(itemNameFrom('  - Ghee   500ml ')).toBe('Ghee 500ml');
  });
});
