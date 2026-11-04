/**
 * Tests — currencies and exports in the GST returns (pure).
 *
 *  ✓ Minor units to paise at a rate, rounded once, for 0-, 2- and 3-digit currencies
 *  ✓ A rate is rupees for one unit, four decimals at most
 *  ✓ An export under LUT goes to GSTR-1 table 6A with its shipping bill, not to nil or B2C;
 *    its credit note goes to 9B as EXPWOP; GSTR-3B carries both in 3.1(b), and the portal JSON too
 */
import { formatMinor, rateProblem, toPaise } from './currencies';
import { buildGstr1, buildGstr3b, gstr1PortalJson, gstr3bPortalJson } from '../gst/gst-returns';

describe('currencies', () => {
  it('converts minor units to paise, rounding once', () => {
    expect(toPaise(100000, 83.25, 2)).toBe(83_25_000); // $1,000.00 at 83.25 = ₹83,250
    expect(toPaise(1234, 84.1025, 2)).toBe(1_03_782); // $12.34 → ₹1,037.82485 → ₹1,037.82
    expect(toPaise(1, 84.5, 2)).toBe(85); // 84.5 paise exactly: half rounds up
    expect(toPaise(1000, 0.5562, 0)).toBe(55_620); // ¥1,000 at 0.5562
    expect(toPaise(1500, 271.35, 3)).toBe(40_703); // KWD 1.500 at 271.35 = ₹407.025 → ₹407.03
    expect(toPaise(-1234, 84.1025, 2)).toBe(-1_03_782);
    expect(formatMinor(123456, 'USD')).toBe('USD 1,234.56');
    expect(formatMinor(1500, 'JPY')).toBe('JPY 1,500');
  });

  it('takes a rate as rupees for one unit, to four decimals', () => {
    expect(rateProblem(83.2475)).toBeNull();
    expect(rateProblem(0)).toMatch(/more than nothing/);
    expect(rateProblem(83.24751)).toMatch(/four decimals/);
  });
});

describe('exports in the returns', () => {
  const amounts = (taxable: number) => ({ taxableValue: taxable, cgst: 0, sgst: 0, igst: 0, cess: 0, total: taxable });
  const exportSale = {
    id: 'e1', number: 'EXP/1', date: '2026-10-05', customerName: 'Acme Inc', customerGstin: null, customerState: null,
    amounts: amounts(83_25_000), lines: [{ description: 'Design services', hsnSac: '998391', qty: 1, ratePaise: 83_25_000, amountPaise: 83_25_000, taxRatePct: 0 }],
    exportType: 'lut' as const, shippingBill: { number: '1234567', date: '2026-10-06', portCode: 'INNSA1' },
  };
  const r1 = buildGstr1({
    period: '2026-10', orgGstin: '27AAPFU0939F1ZV', orgState: '27', invoices: [exportSale],
    creditNotes: [{ id: 'n1', number: 'CN/1', date: '2026-10-20', amounts: amounts(8_32_500), invoice: exportSale }],
  });

  it('puts an export in table 6A and its note in 9B as EXPWOP, not in nil or B2C', () => {
    expect(r1.exp).toEqual([{ type: 'WOPAY', invoices: [expect.objectContaining({ number: 'EXP/1', pos: '96', valuePaise: 83_25_000, items: [{ rate: 0, txval: 83_25_000, iamt: 0, camt: 0, samt: 0, csamt: 0 }], shippingBill: exportSale.shippingBill })] }]);
    expect(r1.nil).toEqual([]);
    expect(r1.b2cs).toEqual([]);
    expect(r1.cdnur).toEqual([expect.objectContaining({ number: 'CN/1', typ: 'EXPWOP' })]);
    expect(r1.issues.filter((i) => i.level === 'block')).toEqual([]);
    expect(r1.summary.find((s) => s.section === 'exp')).toMatchObject({ count: 1, txval: 83_25_000 });

    const json = gstr1PortalJson(r1) as { exp: unknown; cdnur: Array<{ typ: string }> };
    expect(json.exp).toEqual([{ exp_typ: 'WOPAY', inv: [{ inum: 'EXP/1', idt: '05-10-2026', val: 83250, sbpcode: 'INNSA1', sbnum: '1234567', sbdt: '06-10-2026', itms: [{ txval: 83250, rt: 0, iamt: 0, csamt: 0 }] }] }]);
    expect(json.cdnur[0].typ).toBe('EXPWOP');
  });

  it('reports exports less their notes as zero-rated in GSTR-3B 3.1(b)', () => {
    const r3 = buildGstr3b({ gstr1: r1, orgState: '27', bills: [], debitNotes: [] });
    expect(r3.outwardZeroRated.txval).toBe(83_25_000 - 8_32_500);
    expect(r3.outwardTaxable.txval).toBe(0);
    expect(r3.outwardNil.txval).toBe(0);
    expect((gstr3bPortalJson(r3) as { sup_details: { osup_zero: unknown } }).sup_details.osup_zero).toEqual({ txval: 74925, iamt: 0, csamt: 0 });
  });
});
