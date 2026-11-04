/**
 * Unit tests — the GSTR-1 / GSTR-3B rules, without a database.
 *
 *  ✓ Paise are shared out exactly, never lost or invented
 *  ✓ The rate is read off the tax when the lines do not say
 *  ✓ A two-rate invoice splits into a bucket per rate and HSN
 *  ✓ Sales land in B2B, B2CL or B2CS by registration, state and value
 *  ✓ Credit notes follow their invoice into CDNR, CDNUR or the B2CS net
 *  ✓ A sale charging IGST to a customer with no state blocks the return
 *  ✓ Set-off spends IGST credit where CGST/SGST credit falls short
 *  ✓ Reverse-charge tax is always cash
 *  ✓ Portal JSON is rupees, dd-mm-yyyy and MMYYYY
 */
import {
  allocate,
  Amounts,
  buildGstr1,
  buildGstr3b,
  gstr1PortalJson,
  inferRate,
  rateBuckets,
  SaleIn,
  setOff,
} from './gst-returns';

const amounts = (taxableValue: number, tax: { cgst?: number; sgst?: number; igst?: number; cess?: number } = {}): Amounts => {
  const cgst = tax.cgst ?? 0;
  const sgst = tax.sgst ?? 0;
  const igst = tax.igst ?? 0;
  const cess = tax.cess ?? 0;
  return { taxableValue, cgst, sgst, igst, cess, total: taxableValue + cgst + sgst + igst + cess };
};

let seq = 0;
const sale = (over: Partial<SaleIn> & { amounts: Amounts }): SaleIn => ({
  id: `inv${++seq}`,
  number: `INV-${seq}`,
  date: '2026-09-10',
  customerName: 'Customer',
  customerGstin: null,
  customerState: null,
  lines: [],
  ...over,
});

const ORG = { period: '2026-09', orgGstin: '27AAPFU0939F1ZV', orgState: '27' };

describe('allocate', () => {
  it('shares paise out exactly', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
    expect(allocate(5, [0, 0])).toEqual([5, 0]);
    expect(allocate(-100, [1, 3])).toEqual([-25, -75]);
  });
});

describe('inferRate', () => {
  it('finds the slab, and says when none fits', () => {
    expect(inferRate(100000, 18000)).toEqual({ rate: 18, exact: true });
    expect(inferRate(100000, 0)).toEqual({ rate: 0, exact: true });
    expect(inferRate(100000, 13000)).toEqual({ rate: 12, exact: false });
  });
});

describe('rateBuckets', () => {
  it('keeps one code sold in two units apart, as the HSN summary lists them', () => {
    const { buckets } = rateBuckets(amounts(30000, { cgst: 750, sgst: 750 }), [
      { description: 'Turmeric, loose', hsnSac: '0910', qty: 5, uqc: 'KGS', amountPaise: 20000, taxRatePct: 5 },
      { description: 'Turmeric, packs', hsnSac: '0910', qty: 4, uqc: 'PAC', amountPaise: 10000, taxRatePct: 5 },
      { description: 'More loose', hsnSac: '0910', qty: 1, uqc: 'KGS', amountPaise: 0, taxRatePct: 5 },
    ]);
    expect(buckets.map((b) => [b.hsn, b.uqc, b.qty, b.txval])).toEqual([
      ['0910', 'KGS', 5, 20000],
      ['0910', 'PAC', 4, 10000],
    ]);
  });

  it('splits a two-rate invoice by its lines', () => {
    const result = rateBuckets(amounts(30000, { cgst: 2050, sgst: 2050 }), [
      { description: 'Rice', hsnSac: '1006', qty: 10, amountPaise: 10000, taxRatePct: 5 },
      { description: 'Repairs', hsnSac: '998719', qty: 1, amountPaise: 20000, taxRatePct: 18 },
    ]);
    expect(result.rateInferred).toBe(false);
    expect(result.buckets.map((b) => [b.rate, b.hsn, b.qty, b.txval, b.camt, b.samt])).toEqual([
      [5, '1006', 10, 10000, 250, 250],
      [18, '998719', 1, 20000, 1800, 1800],
    ]);
  });

  it('reads the rate off the tax when there are no lines', () => {
    const result = rateBuckets(amounts(100000, { igst: 18000 }), []);
    expect(result).toMatchObject({ rateInferred: true, rateUnclear: false });
    expect(result.buckets).toEqual([
      { rate: 18, hsn: null, uqc: null, description: null, qty: 0, txval: 100000, iamt: 18000, camt: 0, samt: 0, csamt: 0 },
    ]);
  });
});

describe('buildGstr1', () => {
  const b2b = sale({ customerGstin: '27AAACR5055K1Z5', amounts: amounts(100000, { cgst: 9000, sgst: 9000 }),
    lines: [{ description: 'Laptop', hsnSac: '8471', qty: 2, amountPaise: 100000, taxRatePct: 18 }] });
  const b2cl = sale({ customerState: '29', amounts: amounts(10_000_000, { igst: 1_800_000 }) });
  const b2csInter = sale({ customerState: '29', amounts: amounts(50000, { igst: 9000 }) });
  const b2csIntra = sale({ amounts: amounts(100000, { cgst: 2500, sgst: 2500 }) });
  const nil = sale({ customerGstin: '27AAACR5055K1Z5', amounts: amounts(40000) });
  const notes = [
    { id: 'cn1', number: 'CRN-1', date: '2026-09-20', amounts: amounts(10000, { cgst: 900, sgst: 900 }), invoice: b2b },
    { id: 'cn2', number: 'CRN-2', date: '2026-09-21', amounts: amounts(10000, { igst: 1800 }), invoice: b2csInter },
    { id: 'cn3', number: 'CRN-3', date: '2026-09-22', amounts: amounts(1_000_000, { igst: 180_000 }), invoice: b2cl },
  ];
  const r = buildGstr1({ ...ORG, invoices: [b2b, b2cl, b2csInter, b2csIntra, nil], creditNotes: notes });

  it('puts each sale in its table', () => {
    expect(r.b2b).toHaveLength(1);
    expect(r.b2b[0].invoices.map((i) => [i.number, i.pos, i.items])).toEqual([
      [b2b.number, '27', [{ rate: 18, txval: 100000, iamt: 0, camt: 9000, samt: 9000, csamt: 0 }]],
    ]);
    expect(r.b2cl.map((g) => [g.pos, g.invoices.map((i) => i.number)])).toEqual([['29', [b2cl.number]]]);
    // B2CS is net of the credit note against it.
    expect(r.b2cs.map((row) => [row.supplyType, row.pos, row.rate, row.txval, row.iamt, row.camt])).toEqual([
      ['INTRA', '27', 5, 100000, 0, 2500],
      ['INTER', '29', 18, 40000, 7200, 0],
    ]);
    expect(r.nil).toEqual([{ supplyType: 'INTRAB2B', nilPaise: 40000 }]);
  });

  it('sends credit notes after their invoice', () => {
    expect(r.cdnr.map((p) => [p.ctin, p.notes.map((n) => n.number)])).toEqual([['27AAACR5055K1Z5', ['CRN-1']]]);
    expect(r.cdnur.map((n) => [n.number, n.pos, n.items[0].iamt])).toEqual([['CRN-3', '29', 180_000]]);
  });

  it('nets notes out of the HSN summary, leaving quantity alone', () => {
    expect(r.hsn.b2b.find((h) => h.hsn === '8471')).toMatchObject({ uqc: 'OTH', qty: 2, rate: 18, txval: 90000, camt: 8100 });
  });

  it('lists the document series', () => {
    expect(r.docs).toEqual([
      { kind: 'invoices', from: b2b.number, to: nil.number, count: 5 },
      { kind: 'credit_notes', from: 'CRN-1', to: 'CRN-3', count: 3 },
    ]);
  });

  it('reports exactly ₹1 lakh as B2CS; only above it is B2CL', () => {
    const atLimit = sale({ customerState: '29', amounts: { ...amounts(8_474_577, { igst: 1_525_423 }) } });
    expect(atLimit.amounts.total).toBe(10_000_000);
    const out = buildGstr1({ ...ORG, invoices: [atLimit], creditNotes: [] });
    expect(out.b2cl).toHaveLength(0);
    expect(out.b2cs).toHaveLength(1);
  });

  it('blocks a sale charging IGST to a customer with no state, and notes a wrong tax type', () => {
    const noState = sale({ customerName: 'Walk-in', amounts: amounts(50000, { igst: 9000 }) });
    const wrongType = sale({ customerName: 'Karnataka Co', customerGstin: '29AAACR5055K1Z5', amounts: amounts(50000, { cgst: 4500, sgst: 4500 }) });
    const out = buildGstr1({ ...ORG, invoices: [noState, wrongType], creditNotes: [] });
    expect(out.issues.filter((i) => i.level === 'block').map((i) => i.documentId)).toEqual([noState.id]);
    expect(out.issues.find((i) => i.documentId === wrongType.id)?.message).toMatch(/charges CGST \+ SGST, but Karnataka Co is in state 29/);
  });
});

describe('setOff', () => {
  it('spends IGST credit where the other credit falls short', () => {
    // Paying CGST first with IGST credit would leave SGST to cash; this pays nothing in cash.
    const out = setOff({ igst: 0, cgst: 500, sgst: 500, cess: 0 }, { igst: 0, cgst: 0, sgst: 0, cess: 0 }, { igst: 500, cgst: 500, sgst: 0, cess: 0 });
    expect(out.cashTotalPaise).toBe(0);
    expect(out.rows.find((r) => r.head === 'sgst')?.fromCredit.igst).toBe(500);
    expect(out.creditLeft).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
  });

  it('never pays SGST from CGST credit, and puts reverse charge in cash', () => {
    const out = setOff({ igst: 1000, cgst: 500, sgst: 500, cess: 0 }, { igst: 0, cgst: 100, sgst: 100, cess: 0 }, { igst: 1400, cgst: 50, sgst: 300, cess: 0 });
    const row = (h: string) => out.rows.find((r) => r.head === h)!;
    expect(row('igst')).toMatchObject({ cashPaise: 0, fromCredit: { igst: 1000, cgst: 0, sgst: 0, cess: 0 } });
    expect(row('cgst')).toMatchObject({ cashPaise: 150, fromCredit: { igst: 400, cgst: 50, sgst: 0, cess: 0 } });
    expect(row('sgst')).toMatchObject({ cashPaise: 300, fromCredit: { igst: 0, cgst: 0, sgst: 300, cess: 0 } });
    expect(out.cashTotalPaise).toBe(450);
  });
});

describe('buildGstr3b', () => {
  it('nets debit notes out of credit and keeps reverse charge apart', () => {
    const gstr1 = buildGstr1({ ...ORG, invoices: [sale({ customerGstin: '27AAACR5055K1Z5', amounts: amounts(100000, { cgst: 9000, sgst: 9000 }) })], creditNotes: [] });
    const bill = (id: string, vendorGstin: string | null, isReverseCharge: boolean, a: Amounts) => ({ id, number: id, vendorName: id, vendorGstin, isReverseCharge, amounts: a });
    const normal = bill('B1', '27AAACR5055K1Z5', false, amounts(50000, { cgst: 4500, sgst: 4500 }));
    const out = buildGstr3b({
      gstr1,
      orgState: '27',
      bills: [normal, bill('B2', null, true, amounts(20000, { cgst: 1800, sgst: 1800 })), bill('B3', '29AAACR5055K1Z5', false, amounts(30000))],
      debitNotes: [{ id: 'DN1', amounts: amounts(10000, { cgst: 900, sgst: 900 }), bill: normal }],
    });
    expect(out.outwardTaxable).toEqual({ txval: 100000, iamt: 0, camt: 9000, samt: 9000, csamt: 0 });
    expect(out.inwardReverseCharge).toEqual({ txval: 20000, iamt: 0, camt: 1800, samt: 1800, csamt: 0 });
    expect(out.itcOther.camt).toBe(3600);
    expect(out.itcNet).toEqual({ txval: 0, iamt: 0, camt: 5400, samt: 5400, csamt: 0 });
    expect(out.inwardExempt).toEqual({ inter: 30000, intra: 0 });
    // 9,000 due less 5,400 credit, plus 1,800 reverse charge, per head.
    expect(out.setOff.rows.find((r) => r.head === 'cgst')?.cashPaise).toBe(5400);
    expect(out.setOff.cashTotalPaise).toBe(10800);
  });
});

describe('gstr1PortalJson', () => {
  it('writes rupees, portal dates and the filing period', () => {
    const r = buildGstr1({ ...ORG, invoices: [sale({ number: 'INV-9', date: '2026-09-05', customerGstin: '27AAACR5055K1Z5', amounts: amounts(100050, { cgst: 9005, sgst: 9004 }) })], creditNotes: [] });
    const json = gstr1PortalJson(r) as { fp: string; b2b: Array<{ inv: Array<Record<string, unknown>> }> };
    expect(json.fp).toBe('092026');
    expect(json.b2b[0].inv[0]).toMatchObject({ inum: 'INV-9', idt: '05-09-2026', val: 1180.59, pos: '27', rchrg: 'N' });
    expect((json.b2b[0].inv[0].itms as Array<{ itm_det: unknown }>)[0].itm_det).toEqual({
      txval: 1000.5, rt: 18, iamt: 0, camt: 90.05, samt: 90.04, csamt: 0,
    });
  });
});
