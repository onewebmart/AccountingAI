/**
 * Unit tests — the rules the AI pipeline leans on for Indian bills.
 *
 *  ✓ Toner, ink and cheap peripherals are expenses; a laptop is an asset
 *  ✓ Each line of a mixed bill reads to its own account
 *  ✓ Blocked GST moves into the cost only on strong evidence (17(5))
 *  ✓ "Paid by UPI" on a bill is read as paid at the counter; terms are not
 *  ✓ The CGST rate read as the line's GST rate is doubled back
 *  ✓ TDS section suggested only past the section's threshold
 *  ✓ A customer's greeting does not hide what they asked for in a quote
 */
import { CAPITALISE_FROM_PAISE, ruleFor, ruleForLine } from '../categorisation/category-rules';
import { blockedItc, paidAtCounter, paidCheck } from './bill-checks';
import { fullGstRates } from '../../extraction/invoice-checks';
import { suggestTdsSection } from '../../gl/tds';
import { parseOrderMessage } from '../../orders/quote-parser';

describe('Fixed asset or expense', () => {
  it('books a printer toner cartridge as stationery, though its HSN is the printer heading', () => {
    const hit = ruleForLine({ description: 'Printer toner cartridge HP 88A', hsnSac: '8443', qty: 2, ratePaise: 145000, amountPaise: 290000 });
    expect(hit?.name).toBe('Office & Stationery');
    expect(hit?.reason).toMatch(/toner/);
  });

  it('keeps a laptop as Office Equipment, even described "with charger"', () => {
    expect(ruleForLine({ description: 'Dell Latitude laptop with charger', hsnSac: '8471', qty: 1, ratePaise: 5500000, amountPaise: 5500000 })?.name).toBe('Office Equipment');
  });

  it('expenses a mouse, and anything under ₹5,000 a unit', () => {
    expect(ruleForLine({ description: 'Wireless mouse', hsnSac: '8471', qty: 3, ratePaise: 60000, amountPaise: 180000 })?.name).toBe('Office & Stationery');
    const chair = ruleForLine({ description: 'Plastic visitor chair', hsnSac: '9401', qty: 4, ratePaise: 120000, amountPaise: 480000 });
    expect(chair?.name).toBe('Office & Stationery');
    expect(chair?.reason).toMatch(/₹5,000/);
    expect(ruleForLine({ description: 'Office chair, ergonomic', hsnSac: '9401', qty: 1, ratePaise: CAPITALISE_FROM_PAISE + 1, amountPaise: CAPITALISE_FROM_PAISE + 1 })?.name).toBe('Furniture & Fixtures');
  });

  it('lets the largest line speak for a mixed bill, and reads each line on its own', () => {
    const lines = [
      { description: 'A4 copier paper', hsnSac: '4802', qty: 10, ratePaise: 30000, amountPaise: 300000 },
      { description: 'HP laptop', hsnSac: '8471', qty: 1, ratePaise: 5500000, amountPaise: 5500000 },
    ];
    expect(ruleFor({ kind: 'bill', lines })?.name).toBe('Office Equipment');
    expect(lines.map((l) => ruleForLine(l)?.name)).toEqual(['Office & Stationery', 'Office Equipment']);
  });
});

describe('Blocked GST (17(5))', () => {
  it('moves restaurant GST into the cost when the vendor is a restaurant, on a bill of several lines', () => {
    const [c] = blockedItc({ vendorName: 'HOTEL ANNAPURNA VEG', lines: [{ description: 'Veg Thali x2' }, { description: 'Masala Chaas x2' }], gstPaise: 2200 });
    expect(c.code).toBe('blocked_itc');
    expect(c.moveToCost).toBe(true);
    expect(c.message).toMatch(/booked into the cost/);
  });

  it('moves it on the restaurant SAC code alone', () => {
    expect(blockedItc({ vendorName: 'Some Place', lines: [{ description: 'Service', hsnSac: '996331' }], gstPaise: 500 })[0].moveToCost).toBe(true);
  });

  it('only flags food words from a trader: a grocer may resell the tea', () => {
    const [c] = blockedItc({ vendorName: 'Assam Tea Traders', lines: [{ description: 'Tea CTC 25 kg', hsnSac: '0902' }], gstPaise: 2500 });
    expect(c.code).toBe('blocked_itc');
    expect(c.moveToCost).toBeUndefined();
  });

  it('flags but does not move a car, whose credit a dealer may claim', () => {
    const [c] = blockedItc({ vendorName: 'City Motors', lines: [{ description: 'New car purchase', hsnSac: '8703' }], gstPaise: 100000 });
    expect(c.moveToCost).toBeUndefined();
  });

  it('moves a salon bill on any evidence', () => {
    expect(blockedItc({ vendorName: 'Glow Salon', lines: [{ description: 'Hair cut' }], gstPaise: 900 })[0].moveToCost).toBe(true);
  });
});

describe('Paid at the counter', () => {
  it('reads how a bill was paid', () => {
    expect(paidAtCounter('TOTAL 462.00\nPaid by UPI\nThank you')).toEqual({ mode: 'upi', evidence: 'Paid by UPI' });
    expect(paidAtCounter('Payment Mode: Cash')?.mode).toBe('cash');
    expect(paidAtCounter('Paid via Google Pay')?.mode).toBe('upi');
    expect(paidAtCounter('Received with thanks')?.mode).toBe('unknown');
  });

  it('does not read terms, a due date or "unpaid" as paid', () => {
    expect(paidAtCounter('Payment terms: 15 days. Due Date: 18-11-2026')).toBeNull();
    expect(paidAtCounter('Payment mode: Credit')).toBeNull();
    expect(paidAtCounter('Status: unpaid')).toBeNull();
    expect(paidAtCounter(null)).toBeNull();
  });

  it('turns it into a check that points to the expense form', () => {
    expect(paidCheck({ mode: 'cash', evidence: 'Payment mode: Cash' })[0].message).toMatch(/paid in cash.*expense paid from cash/);
    expect(paidCheck(null)).toEqual([]);
  });
});

describe('GST rate per line', () => {
  const a = { cgst: 51750, sgst: 51750, igst: 0 };
  it('doubles a CGST rate read as the GST rate', () => {
    const lines = [{ amountPaise: 290000, taxRatePct: 9 }, { amountPaise: 285000, taxRatePct: 9 }];
    expect(fullGstRates(lines, a).map((l) => l.taxRatePct)).toEqual([18, 18]);
  });
  it('leaves a full rate, and an inter-state bill, alone', () => {
    const lines = [{ amountPaise: 290000, taxRatePct: 18 }, { amountPaise: 285000, taxRatePct: 18 }];
    expect(fullGstRates(lines, a)).toBe(lines);
    const igst = [{ amountPaise: 100000, taxRatePct: 9 }];
    expect(fullGstRates(igst, { cgst: 0, sgst: 0, igst: 9000 })).toBe(igst);
  });
});

describe('TDS section suggestion', () => {
  const fees = [{ description: 'Professional fees for statutory audit', hsnSac: '998221' }];
  it('suggests 194J for professional fees past ₹50,000 in the year', () => {
    const s = suggestTdsSection({ lines: fees, taxablePaise: 3000000, yearPaise: 6000000 });
    expect(s?.section).toBe('194J-b');
    expect(s?.crossed).toMatch(/₹60,000/);
  });
  it('says nothing below the threshold', () => {
    expect(suggestTdsSection({ lines: fees, taxablePaise: 3000000, yearPaise: 4000000 })).toBeNull();
  });
  it('suggests 194C for a contractor bill over ₹30,000, and 194I for a month\'s rent over ₹50,000', () => {
    expect(suggestTdsSection({ lines: [{ description: 'Labour charges for fabrication', hsnSac: null }], taxablePaise: 3500000, yearPaise: 3500000 })?.section).toBe('194C');
    expect(suggestTdsSection({ lines: [{ description: 'Office rent for November', hsnSac: '997212' }], taxablePaise: 5500000, yearPaise: 5500000 })?.section).toBe('194I-b');
    expect(suggestTdsSection({ lines: [{ description: 'Office rent for November', hsnSac: '997212' }], taxablePaise: 4500000, yearPaise: 9000000 })).toBeNull();
  });
  it('says nothing for goods', () => {
    expect(suggestTdsSection({ lines: [{ description: 'A4 paper', hsnSac: '4802' }], taxablePaise: 9000000, yearPaise: 9000000 })).toBeNull();
  });
});

describe('Quote from a customer message', () => {
  it('reads every item after a greeting, and reports what it could not read', () => {
    const { lines, skipped } = parseOrderMessage('Namaste, please send quotation for 20 box files and 3 HP 88A toner. Also 10 packets A4 paper. Delivery by Friday. - Kulkarni');
    expect(lines.map((l) => [l.qty, l.itemText])).toEqual([[20, 'files'], [3, 'HP 88A toner'], [10, 'A4 paper']]);
    expect(skipped).toEqual([]);
    expect(parseOrderMessage('Need the 2nd lot as before').skipped).toEqual(['the 2nd lot as before']);
  });
});
