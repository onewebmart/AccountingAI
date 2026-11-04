/**
 * Unit tests — order messages read into lines, and document amounts.
 *
 *  ✓ Quantities and items read however a customer writes them
 *  ✓ Items matched by their words, singular or plural; a poor match is no match
 *  ✓ Tax worked out per line: IGST across states, CGST and SGST within
 */
import { parseOrderText, matchItem, unitCode } from './quote-parser';
import { docAmounts, isInterState, lineProblem } from './doc-lines';
import { quotePrompt, readQuoteAnswer } from './quote-model';

describe('reading an order message', () => {
  it('reads quantities first or last, with or without units', () => {
    const lines = parseOrderText('Hi, please send 200 cartons of A4 paper and 10 boxes of staples by Friday.\nBlue pens x 50\n- Whiteboard markers: 12');
    expect(lines.map((l) => [l.qty, l.unit, l.itemText])).toEqual([
      [200, 'cartons', 'A4 paper'],
      [10, 'boxes', 'staples'],
      [50, null, 'Blue pens'],
      [12, null, 'Whiteboard markers'],
    ]);
    expect(unitCode('cartons')).toBe('CTN');
    expect(parseOrderText('Can you call me tomorrow?')).toEqual([]);
  });

  it('matches items by their words', () => {
    const items = [{ name: 'A4 Copier Paper (500 sheets)' }, { name: 'Stapler pins No. 10' }, { name: 'Ball pen blue' }];
    expect(matchItem('A4 paper', items)?.item.name).toBe('A4 Copier Paper (500 sheets)');
    expect(matchItem('Blue pens', items)?.item.name).toBe('Ball pen blue');
    expect(matchItem('printer toner', items)).toBeNull();
  });

  it("keeps only the model's lines that name a real item", () => {
    expect(readQuoteAnswer({ lines: [{ item: 'ball pen blue', qty: 50 }, { item: 'Unicorn', qty: 1 }, { item: 'Ball pen blue', qty: -2 }] }, ['Ball pen blue'])).toEqual([{ item: 'Ball pen blue', qty: 50 }]);
    expect(readQuoteAnswer('nope', ['x'])).toEqual([]);
    expect(quotePrompt('need pens', ['Ball pen blue'])).toContain('Ball pen blue');
  });
});

describe('document amounts', () => {
  const lines = [
    { qty: 2.5, ratePaise: 10000, taxRatePct: 18 },
    { qty: 1, ratePaise: 33333, taxRatePct: 5 },
  ];
  it('splits within a state, integrates across', () => {
    expect(docAmounts(lines, false)).toEqual({ taxableValue: 58333, cgst: 3084, sgst: 3083, igst: 0, cess: 0, total: 64500 });
    expect(docAmounts(lines, true)).toMatchObject({ igst: 6167, cgst: 0, total: 64500 });
    expect(isInterState('27', '29')).toBe(true);
    expect(isInterState('27', null)).toBe(false);
  });

  it('checks each line', () => {
    expect(lineProblem({ description: '', qty: 1, ratePaise: 1, taxRatePct: 18 }, 0)).toMatch(/description/);
    expect(lineProblem({ description: 'x', qty: 0, ratePaise: 1, taxRatePct: 18 }, 0)).toMatch(/quantity/);
    expect(lineProblem({ description: 'x', qty: 1.2345, ratePaise: 1, taxRatePct: 18 }, 0)).toMatch(/three decimals/);
    expect(lineProblem({ description: 'x', qty: 1, ratePaise: 1.5, taxRatePct: 18 }, 0)).toMatch(/paise/);
    expect(lineProblem({ description: 'x', qty: 1, ratePaise: 1, taxRatePct: 17 }, 0)).toMatch(/slab/);
  });
});
