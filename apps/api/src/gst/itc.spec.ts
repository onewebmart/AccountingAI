/**
 * Unit tests — the ITC rules and the 2B explainer.
 *
 *  ✓ Invoice numbers compared without case, punctuation or leading zeros
 *  ✓ Credit only for what a 2B carries, at the lower amount, once, even when reported late
 *  ✓ A month with no 2B claims its bills by date, and they are never claimed again
 *  ✓ Rule 37: reversed the month after the 180 days, in proportion to what is unpaid; back when paid
 *  ✓ The watchlist: bills to pay before their credit is reversed
 *  ✓ Each kind of 2B mismatch explained, with a message for the vendor where the vendor must act
 */
import { TaxHeads } from './gst-returns';
import { BillForItc, Line2bForItc, claims, match2b, normaliseInvoiceNumber, rule37, rule37Watchlist, sumRows } from './itc';
import { explain2b } from './explain-2b';

const GSTIN = '27AAACR5055K1Z7';
const heads = (txval: number, rate = 18, inter = false): TaxHeads => {
  const t = Math.round((txval * rate) / 100);
  return inter ? { txval, iamt: t, camt: 0, samt: 0, csamt: 0 } : { txval, iamt: 0, camt: t / 2, samt: t / 2, csamt: 0 };
};
const gst = (h: TaxHeads) => h.iamt + h.camt + h.samt + h.csamt;

function bill(id: string, over: Partial<BillForItc> = {}): BillForItc {
  const h = over.heads ?? heads(100000);
  return {
    id, number: `RT/${id}`, vendorName: 'Rao Traders', vendorGstin: GSTIN, billDate: '2026-04-10', isReverseCharge: false,
    heads: h, totalPaise: h.txval + gst(h), tdsPaise: 0, settlements: [], ...over,
  };
}
function line(id: string, period: string, over: Partial<Line2bForItc> = {}): Line2bForItc {
  return { id, period, gstin: GSTIN, supplierName: 'Rao Traders', number: `RT/${id}`, date: '2026-04-10', isReverseCharge: false, heads: heads(100000), ...over };
}

describe('matching 2B to bills', () => {
  it('reads one invoice number however it was typed', () => {
    expect(normaliseInvoiceNumber('INV/0045')).toBe(normaliseInvoiceNumber('inv-45'));
    expect(normaliseInvoiceNumber('INV 45')).toBe('INV45');
    expect(normaliseInvoiceNumber('2026-27/045')).toBe('20262745');
    expect(normaliseInvoiceNumber('A100')).toBe('A100');
  });

  it('matches each bill once, across months, never a bill dated after the 2B', () => {
    const bills = [bill('1', { number: 'RT/001' }), bill('2', { billDate: '2026-05-20' }), bill('3', { isReverseCharge: true })];
    const lines = [line('a', '2026-05', { number: 'rt-1' }), line('b', '2026-04', { number: 'RT/2' }), line('c', '2026-05', { number: 'RT/2' }), line('d', '2026-04', { number: 'RT/3' })];
    const m = match2b(lines, bills, new Set(['2026-04', '2026-05']));
    expect(m.map((x) => [x.lineId, x.billId, x.period])).toEqual([['a', '1', '2026-05'], ['c', '2', '2026-05']]);
  });
});

describe('claiming credit', () => {
  it('claims only what a 2B carries, at the lower amount, in the month it appears', () => {
    const bills = [bill('1'), bill('2'), bill('3', { heads: heads(100000, 18) })];
    const lines = [line('1', '2026-04'), line('2', '2026-06'), line('3', '2026-04', { heads: heads(100000, 12) })];
    const c = claims(lines, bills, new Set(['2026-04', '2026-05', '2026-06']));
    expect(c.get('1')).toMatchObject({ period: '2026-04', basis: 'twoB' });
    // Reported two months late: claimed then.
    expect(c.get('2')).toMatchObject({ period: '2026-06' });
    // The vendor reported 12% where the bill says 18%: the lower.
    expect(gst(c.get('3')!.heads)).toBe(12000);
  });

  it('claims by date in a month with no 2B, and not again when the 2B shows it later', () => {
    const bills = [bill('1', { billDate: '2026-04-10' }), bill('2', { billDate: '2026-05-02' })];
    const lines = [line('1', '2026-05')];
    const c = claims(lines, bills, new Set(['2026-05']));
    expect(c.get('1')).toMatchObject({ period: '2026-04', basis: 'date' });
    // Its month had a 2B and it was not in it: not claimed.
    expect(c.has('2')).toBe(false);
    expect(match2b(lines, bills, new Set(['2026-05']))[0]).toMatchObject({ billId: '1', claimedByDate: true });
  });
});

describe('rule 37', () => {
  const periods = new Set(['2026-04']);
  const onTime = bill('1', { billDate: '2026-04-10' });

  it('reverses credit the month after 180 days, in proportion to what is unpaid', () => {
    // Paid ₹59,000 of ₹1,18,000 by the 180th day (7 October): half the credit goes back.
    const b = { ...onTime, settlements: [{ date: '2026-06-01', amountPaise: 59000 }] };
    const c = claims([line('1', '2026-04')], [b], periods);
    expect(rule37('2026-10', [b], c).reversed).toEqual([]);
    const { reversed } = rule37('2026-11', [b], c);
    expect(reversed).toHaveLength(1);
    expect(reversed[0]).toMatchObject({ payBy: '2026-10-07', unpaidPaise: 59000 });
    expect(gst(reversed[0].heads)).toBe(9000);
  });

  it('counts TDS as paid, and leaves bills paid in time alone', () => {
    const tds = { ...onTime, tdsPaise: 2000, settlements: [{ date: '2026-07-01', amountPaise: 116000 }] };
    const paid = { ...bill('2'), settlements: [{ date: '2026-10-07', amountPaise: 118000 }] };
    const c = claims([line('1', '2026-04'), line('2', '2026-04')], [tds, paid], periods);
    expect(rule37('2026-11', [tds, paid], c).reversed).toEqual([]);
  });

  it('claims it back in the month of a late payment, never more than was reversed', () => {
    const b = { ...onTime, settlements: [{ date: '2026-10-20', amountPaise: 59000 }, { date: '2027-01-15', amountPaise: 80000 }] };
    const c = claims([line('1', '2026-04')], [b], periods);
    // Paid half on 20 October, after the 180 days: reversed in November in full, half back in November.
    const nov = rule37('2026-11', [b], c);
    expect(gst(sumRows(nov.reversed))).toBe(18000);
    expect(gst(sumRows(nov.reclaimed))).toBe(9000);
    // The rest in January, capped at what is still reversed.
    expect(gst(sumRows(rule37('2027-01', [b], c).reclaimed))).toBe(9000);
    expect(rule37('2026-12', [b], c).reclaimed).toEqual([]);
  });

  it('never reverses credit not yet taken', () => {
    const b = bill('1');
    expect(rule37('2026-11', [b], claims([], [b], periods)).reversed).toEqual([]);
  });

  it('lists bills to pay before their credit goes', () => {
    const due = bill('1', { billDate: '2026-05-20' });
    const later = bill('2', { billDate: '2026-09-01' });
    const watch = rule37Watchlist('2026-11-04', [due, later], claims([], [due, later], new Set()));
    expect(watch.map((w) => [w.billId, w.payBy, w.daysLeft])).toEqual([['1', '2026-11-16', 12]]);
    expect(gst(watch[0].heads)).toBe(18000);
  });
});

describe('explaining 2B mismatches', () => {
  const period = '2026-04';
  const explain = (lines: Line2bForItc[], bills: BillForItc[], periods = new Set([period])) =>
    explain2b({ period, ourGstin: '29ABCDE1234F1Z5', lines, bills, matches: match2b(lines, bills, periods) });

  it('says nothing about a clean match, and notes a number typed differently', () => {
    expect(explain([line('1', period)], [bill('1')])).toEqual([]);
    const [e] = explain([line('1', period, { number: 'rt-0001' })], [bill('1', { number: 'RT/1' })]);
    expect(e).toMatchObject({ kind: 'number_typed_differently', vendorMessage: null, itcPaise: 0 });
  });

  it('names a wrong rate, a place-of-supply swap, and a taxable-only difference', () => {
    const [rate] = explain([line('1', period, { heads: heads(100000, 12) })], [bill('1')]);
    expect(rate.kind).toBe('tax_differs_rate');
    expect(rate.explanation).toMatch(/12% in the 2B against 18%/);
    expect(rate.vendorMessage).toMatch(/29ABCDE1234F1Z5/);

    const [swap] = explain([line('1', period, { heads: heads(100000, 18, true) })], [bill('1')]);
    expect(swap.kind).toBe('igst_vs_cgst_sgst');

    const [txval] = explain([line('1', period, { heads: { ...heads(100000), txval: 103000 } })], [bill('1')]);
    expect(txval).toMatchObject({ kind: 'taxable_differs_tax_same', vendorMessage: null });
  });

  it('finds the bill a stray 2B line probably is', () => {
    const otherState = `29${GSTIN.slice(2)}`;
    const [reg] = explain([line('1', period, { gstin: otherState })], [bill('1')]);
    expect(reg).toMatchObject({ kind: 'other_registration', billId: '1' });

    const [num] = explain([line('x', period, { number: 'RT/999' })], [bill('1')]);
    expect(num).toMatchObject({ kind: 'number_differs', billId: '1' });

    const [none] = explain([line('x', period, { number: 'ZZ/1', heads: heads(5000) })], []);
    expect(none.kind).toBe('not_in_books');
  });

  it('flags bills the vendor has not reported, and vendors with no GSTIN', () => {
    const items = explain([], [bill('1'), bill('2', { vendorGstin: null, vendorName: 'Local Hardware' })]);
    expect(items.map((e) => e.kind)).toEqual(['not_in_2b', 'no_gstin']);
    expect(items[0].vendorMessage).toMatch(/does not show your invoice RT\/1/);
  });
});
