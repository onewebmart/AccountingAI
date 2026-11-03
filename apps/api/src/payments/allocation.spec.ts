/**
 * Unit tests — suggesting how a lump sum pays open invoices.
 *
 *  ✓ Invoices the remittance names come first
 *  ✓ Otherwise the fewest, oldest invoices that add up exactly
 *  ✓ Otherwise oldest first, the last one in part, any excess as an advance
 */
import { OpenDocument, suggestAllocation } from './allocation';

const open: OpenDocument[] = [
  { id: 'a', number: 'INV-101', date: '2026-08-01', owedPaise: 50000 },
  { id: 'b', number: 'INV-102', date: '2026-08-15', owedPaise: 30000 },
  { id: 'c', number: 'INV-103', date: '2026-09-01', owedPaise: 20000 },
  { id: 'd', number: 'INV-104', date: '2026-09-20', owedPaise: 80000 },
];
const picked = (s: ReturnType<typeof suggestAllocation>) => s.allocations.map((a) => [a.documentId, a.amountPaise]);

describe('suggestAllocation', () => {
  it('puts the invoices the payment names first', () => {
    const s = suggestAllocation(100000, open, 'NEFT CR RAO TRADERS INV104 INV-103');
    expect(s.method).toBe('named');
    expect(picked(s)).toEqual([['c', 20000], ['d', 80000]]);
    expect(s.advancePaise).toBe(0);
  });

  it('finds the fewest, oldest invoices that add up exactly', () => {
    expect(picked(suggestAllocation(80000, open))).toEqual([['d', 80000]]);
    const two = suggestAllocation(70000, open);
    expect(two.method).toBe('exact');
    expect(picked(two)).toEqual([['a', 50000], ['c', 20000]]);
    expect(two.reason).toBe('INV-101 + INV-103 add up to exactly ₹700.');
  });

  it('settles oldest first when nothing adds up, holding any excess as an advance', () => {
    const part = suggestAllocation(65000, open);
    expect(part.method).toBe('oldest_first');
    expect(picked(part)).toEqual([['a', 50000], ['b', 15000]]);
    const over = suggestAllocation(200000, open);
    expect(over.advancePaise).toBe(20000);
    expect(over.reason).toMatch(/held as an advance/);
    expect(suggestAllocation(5000, [])).toMatchObject({ method: 'none', advancePaise: 5000 });
  });
});
