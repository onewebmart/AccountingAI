/**
 * Unit tests — TDS receivable against Form 26AS.
 *
 *  ✓ Reads Part I as CSV, whatever the column order and date style; reports what it cannot read
 *  ✓ Pairs each receipt's TDS with the deductor's entry by amount, date and name
 *  ✓ Leftovers say what to chase: not in 26AS, not in the books, amounts that differ
 */
import { BookTds, dateText, nameLikeness, parse26asCsv, reconcile26as, rupeesText } from './reconcile-26as';

const CSV = [
  'Form 26AS, Part I,,,,,',
  'Sr No,Name of Deductor,TAN of Deductor,Section,Transaction Date,Status of Booking,Amount Paid / Credited,Tax Deducted,TDS Deposited',
  '1,RAO TRADERS PRIVATE LIMITED,MUMR12345A,194J,15-Oct-2026,F,"1,00,000.00","10,000.00","10,000.00"',
  '2,MEHTA RETAIL LLP,PNEM54321B,194C,02/11/2026,F,50000,1000.00,1000.00',
  '3,ACME CORP,BLRA11111C,194J,20-Nov-2026,F,30000,3000,3000',
  '4,BROKEN ROW,,194J,someday,F,1,1,1',
].join('\n');

const book = (over: Partial<BookTds>): BookTds => ({ invoiceId: 'i', invoiceNumber: 'INV/1', customerName: 'Rao Traders', paidOn: '2026-10-20', tdsPaise: 1000000, ...over });

describe('reading 26AS', () => {
  it('reads Part I and says which lines it could not', () => {
    const { rows, skipped } = parse26asCsv(CSV);
    expect(rows.map((r) => [r.deductorName, r.tan, r.date, r.tdsPaise, r.amountPaise])).toEqual([
      ['RAO TRADERS PRIVATE LIMITED', 'MUMR12345A', '2026-10-15', 1000000, 10000000],
      ['MEHTA RETAIL LLP', 'PNEM54321B', '2026-11-02', 100000, 5000000],
      ['ACME CORP', 'BLRA11111C', '2026-11-20', 300000, 3000000],
    ]);
    expect(skipped).toEqual([{ line: 6, reason: 'no date it could read' }]);
    expect(() => parse26asCsv('just,some,columns\n1,2,3')).toThrow(/No header row/);
  });

  it('reads amounts and dates exactly', () => {
    expect(rupeesText('1,23,456.7')).toBe(12345670);
    expect(rupeesText('12.345')).toBeNull();
    expect(dateText('5-Jan-2027')).toBe('2027-01-05');
    expect(dateText('05.01.2027')).toBe('2027-01-05');
  });

  it('knows one business by its name, however written', () => {
    expect(nameLikeness('Rao Traders', 'RAO TRADERS PRIVATE LIMITED')).toBe(1);
    expect(nameLikeness('Mehta Retail', 'Rao Traders')).toBe(0);
  });
});

describe('reconciling', () => {
  it('matches, and names what is left on each side', () => {
    const { rows } = parse26asCsv(CSV);
    const r = reconcile26as(
      [
        book({}),
        book({ invoiceId: 'm', customerName: 'Mehta Retail', paidOn: '2026-11-05', tdsPaise: 150000 }),
        book({ invoiceId: 'z', customerName: 'Zenith Foods', paidOn: '2026-11-10', tdsPaise: 50000 }),
      ],
      rows,
    );
    expect(r.matched.map((m) => [m.book.invoiceId, m.row.line])).toEqual([['i', 3]]);
    expect(r.differs.map((d) => [d.book.invoiceId, d.differencePaise])).toEqual([['m', -50000]]);
    expect(r.notIn26as.map((b) => b.invoiceId)).toEqual(['z']);
    expect(r.notInBooks.map((x) => x.deductorName)).toEqual(['ACME CORP']);
    expect(r.totals).toMatchObject({ booksPaise: 1200000, in26asPaise: 1400000, matchedPaise: 1000000, atRiskPaise: 100000 });
  });
});
