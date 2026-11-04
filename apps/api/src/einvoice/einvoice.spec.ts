/**
 * Unit tests — the e-invoice payload, the pre-check, and e-way bill rules.
 *
 *  ✓ The payload adds up line by line to the invoice, in the schema's rupees and dates
 *  ✓ The IRN is the SHA-256 the IRP computes, so the same invoice gets the same IRN
 *  ✓ The pre-check names what the IRP would refuse, with where to fix it
 *  ✓ E-way bills: a day per 200 km ending at midnight IST; vehicle numbers; the extension window
 *  ✓ The PDF carries the IRN, the acknowledgement and the QR
 */
import { createHash } from 'crypto';
import { EinvoiceInput, buildEinvoicePayload, financialYear } from './einvoice-payload';
import { precheck } from './precheck';
import { MockGsp, GspRejected, irnFor } from './gsp.provider';
import { canExtend, normaliseVehicleNo, validDays, validUpto } from './eway';
import { renderInvoicePdf } from '../sales/invoice-pdf';

const SELLER = '27AAPFU0939F1ZV';
const BUYER = '29AAACR5055K1Z3';

function input(over: Partial<EinvoiceInput> = {}): EinvoiceInput {
  return {
    docType: 'INV',
    number: 'INV/2026-27/0007',
    date: '2026-10-08',
    seller: { gstin: SELLER, legalName: 'Kumar Textiles', address: '12 Mill Road', city: 'Mumbai', pincode: '400001', stateCode: '27' },
    buyer: { gstin: BUYER, legalName: 'Rao Traders', address: '4 MG Road', city: 'Bengaluru', pincode: '560001', stateCode: '29' },
    placeOfSupply: '29',
    isReverseCharge: false,
    amounts: { taxableValue: 100001, cgst: 0, sgst: 0, igst: 18000, cess: 0, total: 118001 },
    lines: [
      { description: 'Cotton fabric', hsnSac: '520812', qty: 3, uqc: 'MTR', ratePaise: 20000, amountPaise: 60000, taxRatePct: 18 },
      { description: 'Stitching', hsnSac: '998821', qty: 1, uqc: null, ratePaise: 40000, amountPaise: 40000, taxRatePct: 18 },
    ],
    ...over,
  };
}

describe('the e-invoice payload', () => {
  it('adds up line by line to the invoice', () => {
    const p = buildEinvoicePayload(input());
    expect(p.DocDtls).toEqual({ Typ: 'INV', No: 'INV/2026-27/0007', Dt: '08/10/2026' });
    expect(p.BuyerDtls).toMatchObject({ Gstin: BUYER, Pos: '29', Pin: 560001, Stcd: '29' });
    const sum = (k: 'AssAmt' | 'IgstAmt') => Math.round(p.ItemList.reduce((s, i) => s + i[k] * 100, 0));
    expect(sum('AssAmt')).toBe(100001);
    expect(sum('IgstAmt')).toBe(18000);
    expect(p.ItemList[0]).toMatchObject({ IsServc: 'N', Unit: 'MTR', HsnCd: '520812', Qty: 3 });
    expect(p.ItemList[1]).toMatchObject({ IsServc: 'Y', Unit: undefined });
    expect(p.ValDtls).toMatchObject({ AssVal: 1000.01, IgstVal: 180, TotInvVal: 1180.01, RndOffAmt: 0 });
  });

  it('dates the financial year by April', () => {
    expect(financialYear('2026-10-08')).toBe('2026-27');
    expect(financialYear('2027-03-31')).toBe('2026-27');
    expect(financialYear('2027-04-01')).toBe('2027-28');
  });

  it('is given the IRN the IRP computes, once', async () => {
    const p = buildEinvoicePayload(input());
    expect(irnFor(p)).toBe(createHash('sha256').update(`${SELLER}2026-27INVINV/2026-27/0007`).digest('hex'));
    const gsp = new MockGsp();
    const first = await gsp.generateIrn(p);
    expect(first.irn).toHaveLength(64);
    expect(first.ackNo).toMatch(/^\d{15}$/);
    await expect(gsp.generateIrn(p)).rejects.toBeInstanceOf(GspRejected);
  });
});

describe('the pre-check', () => {
  const codes = (i: EinvoiceInput, today = '2026-10-10') => precheck(i, today).map((x) => `${x.level}:${x.code}`);

  it('passes a complete invoice', () => {
    expect(codes(input())).toEqual([]);
  });

  it('says a B2C sale needs no IRN', () => {
    expect(codes(input({ buyer: { ...input().buyer, gstin: null } }))).toEqual(['block:b2c']);
  });

  it('finds what is missing, and where to fix it', () => {
    const issues = precheck(input({ seller: { ...input().seller, pincode: null, city: '' }, buyer: { ...input().buyer, address: null } }), '2026-10-10');
    expect(issues.map((i) => [i.code, i.where])).toEqual([
      ['settings_city', 'settings'],
      ['settings_pincode', 'settings'],
      ['customer_address', 'customer'],
    ]);
  });

  it('catches tax charged against the place of supply', () => {
    expect(codes(input({ amounts: { taxableValue: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0, total: 118000 } }))).toContain('block:pos_tax');
    expect(codes(input({ placeOfSupply: '27', buyer: { ...input().buyer, stateCode: '27', gstin: '27AAACR5055K1Z7', pincode: '411001' } }))).toContain('block:pos_tax');
  });

  it('checks the number, the date, the codes and the pincode', () => {
    expect(codes(input({ number: '0INV/1' }))).toContain('block:doc_no');
    expect(codes(input({ number: 'INV/2026-27/000007' }))).toContain('block:doc_no');
    expect(codes(input({ date: '2026-10-11' }))).toContain('block:doc_date');
    expect(codes(input({ date: '2026-08-01' }))).toContain('warn:doc_age');
    expect(codes(input({ lines: [{ ...input().lines[0], hsnSac: null }, input().lines[1]] }))).toContain('block:hsn_missing');
    expect(codes(input({ lines: [{ ...input().lines[0], hsnSac: '5208' }, input().lines[1]] }))).toContain('warn:hsn_short');
    expect(codes(input({ buyer: { ...input().buyer, pincode: '400001' } }))).toContain('warn:customer_pincode_state');
  });
});

describe('e-way bills', () => {
  it('lasts a day per 200 km, each day ending at midnight IST of the next', () => {
    expect(validDays(1, 'regular')).toBe(1);
    expect(validDays(200, 'regular')).toBe(1);
    expect(validDays(201, 'regular')).toBe(2);
    expect(validDays(45, 'odc')).toBe(3);
    // Made at 10:00 IST on 5 October, 350 km: valid to the end of 7 October, IST.
    const at = new Date('2026-10-05T04:30:00Z');
    expect(validUpto(at, validDays(350, 'regular')).toISOString()).toBe('2026-10-07T18:29:59.000Z');
  });

  it('reads vehicle numbers however they are typed', () => {
    expect(normaliseVehicleNo('mh 12 ab 1234')).toBe('MH12AB1234');
    expect(normaliseVehicleNo('KA-01-F-0001')).toBe('KA01F0001');
    expect(normaliseVehicleNo('22 BH 1234 AA')).toBe('22BH1234AA');
    expect(normaliseVehicleNo('1234')).toBeNull();
  });

  it('extends only near expiry', () => {
    const until = new Date('2026-10-07T18:29:59Z');
    expect(canExtend(until, new Date('2026-10-07T08:00:00Z'))).toBe(false);
    expect(canExtend(until, new Date('2026-10-07T12:00:00Z'))).toBe(true);
    expect(canExtend(until, new Date('2026-10-08T03:00:00Z'))).toBe(false);
  });
});

describe('the invoice PDF', () => {
  it('prints the IRN, the acknowledgement and the QR', () => {
    const pdf = renderInvoicePdf({
      seller: { name: 'Kumar Textiles', address: '12 Mill Road', gstin: SELLER, pan: null, stateCode: '27', phone: null, email: null },
      buyer: { name: 'Rao Traders', address: null, gstin: BUYER, stateCode: '29' },
      number: 'INV/2026-27/0007', date: '2026-10-08', dueDate: null,
      lines: [{ description: 'Cotton', hsnSac: '520812', qty: 1, ratePaise: 100000, amountPaise: 100000, taxRatePct: 18 }],
      amounts: { taxableValue: 100000, cgst: 0, sgst: 0, igst: 18000, cess: 0, total: 118000 },
      notes: null, footer: null, draft: false,
      einvoice: { irn: 'a'.repeat(64), ackNo: '112010012345678', ackDate: '2026-10-08 10:15:00', qr: [[true, false], [false, true]], test: true },
    }).toString('latin1');
    expect(pdf).toContain(`IRN ${'a'.repeat(32)}`);
    expect(pdf).toContain('Ack no. 112010012345678');
    expect(pdf).toContain('TEST - NOT REGISTERED WITH THE IRP');
  });
});
