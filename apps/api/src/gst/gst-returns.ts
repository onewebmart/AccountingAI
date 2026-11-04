/**
 * GSTR-1 and GSTR-3B arithmetic, in integer paise throughout (Invariant 1).
 *
 * Pure functions only. GstReturnsService loads the month's documents; these
 * decide which table each one belongs in, split it by rate and HSN, and work
 * out the 3B set-off. Keeping them free of the database is what lets the
 * filing rules be tested one by one.
 *
 * Figures are what each document actually charged, which is what the ledger
 * holds, so the return agrees with the books. Where the charge disagrees with
 * the place of supply that is reported as an issue, not silently "corrected".
 */

export interface Amounts {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
}

export interface LineLike {
  description?: string | null;
  hsnSac: string | null;
  qty?: number | null;
  amountPaise: number;
  taxRatePct?: number | null;
  /** GST unit, when the line's item says; guessed from the HSN otherwise. */
  uqc?: string | null;
}

/** Taxable value and tax, the five columns every GST table carries. */
export interface TaxHeads {
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}

export const ZERO_HEADS: TaxHeads = { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };

export function addHeads(a: TaxHeads, b: TaxHeads, sign: 1 | -1 = 1): TaxHeads {
  return {
    txval: a.txval + sign * b.txval,
    iamt: a.iamt + sign * b.iamt,
    camt: a.camt + sign * b.camt,
    samt: a.samt + sign * b.samt,
    csamt: a.csamt + sign * b.csamt,
  };
}

export function sumHeads(rows: TaxHeads[]): TaxHeads {
  return rows.reduce((acc, r) => addHeads(acc, r), { ...ZERO_HEADS });
}

/** The part of a document taxed at one rate under one HSN/SAC code. */
export interface RateBucket extends TaxHeads {
  rate: number;
  hsn: string | null;
  uqc: string | null;
  description: string | null;
  qty: number;
}

/** Rates GST has used: today's slabs, and the ones older invoices still carry. */
export const GST_RATES_PCT = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];

/**
 * The slab a document was taxed at, read off its tax and taxable value — for
 * documents whose lines do not say. `exact` is false when no slab explains the
 * tax to within rounding, which usually means two rates on one document.
 */
export function inferRate(taxablePaise: number, taxPaise: number): { rate: number; exact: boolean } {
  if (taxablePaise <= 0 || taxPaise <= 0) return { rate: 0, exact: taxPaise <= 0 };
  const pct = (taxPaise * 100) / taxablePaise;
  let rate = GST_RATES_PCT[0];
  for (const r of GST_RATES_PCT) if (Math.abs(r - pct) < Math.abs(rate - pct)) rate = r;
  const expected = Math.round((taxablePaise * rate) / 100);
  return { rate, exact: Math.abs(expected - taxPaise) <= Math.max(2, expected * 0.005) };
}

/**
 * Splits a whole number of paise across weights, largest remainder first, so
 * the parts always add back to the total exactly.
 */
export function allocate(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (Math.max(0, w) * abs) / sum);
  const parts = raw.map(Math.floor);
  let left = abs - parts.reduce((s, p) => s + p, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts.map((p) => sign * p);
}

/**
 * Splits a document into rate-and-HSN buckets.
 *
 * Line items say the rate and HSN when they were typed in; the taxable value
 * and each tax head are then shared across them in proportion (tax by
 * amount × rate), so the buckets add back to the document exactly. Documents
 * with no usable lines — everything read off a scan today — are one bucket
 * at the rate their tax implies.
 */
export function rateBuckets(
  amounts: Amounts,
  lines: LineLike[],
): { buckets: RateBucket[]; rateInferred: boolean; rateUnclear: boolean } {
  const tax = amounts.cgst + amounts.sgst + amounts.igst;
  const usable = lines.filter((l) => l.amountPaise > 0);
  const linesCarryTax = usable.some((l) => (l.taxRatePct ?? 0) > 0);
  // Lines that contradict the document (tax charged, every line at 0%) are
  // treated as saying nothing about the rate.
  const inferred = usable.length === 0 || (tax > 0) !== linesCarryTax;
  const implied = inferRate(amounts.taxableValue, tax);

  type Group = { rate: number; hsn: string | null; uqc: string | null; description: string | null; weight: number; qty: number };
  const groups: Group[] = [];
  if (usable.length === 0) {
    groups.push({ rate: implied.rate, hsn: null, uqc: null, description: null, weight: amounts.taxableValue, qty: 0 });
  } else {
    for (const l of usable) {
      const rate = inferred ? implied.rate : l.taxRatePct ?? 0;
      const hsn = l.hsnSac?.trim() || null;
      const uqc = l.uqc?.trim() || null;
      const found = groups.find((g) => g.rate === rate && g.hsn === hsn && g.uqc === uqc);
      if (found) {
        found.weight += l.amountPaise;
        found.qty += l.qty ?? 0;
      } else {
        groups.push({ rate, hsn, uqc, description: l.description?.trim() || null, weight: l.amountPaise, qty: l.qty ?? 0 });
      }
    }
  }

  const txval = allocate(amounts.taxableValue, groups.map((g) => g.weight));
  const taxWeights = groups.map((g, i) => txval[i] * g.rate);
  const byTax = taxWeights.some((w) => w > 0) ? taxWeights : txval;
  const iamt = allocate(amounts.igst, byTax);
  const camt = allocate(amounts.cgst, byTax);
  const samt = allocate(amounts.sgst, byTax);
  // Cess rates vary item by item and lines do not carry them: share by value.
  const csamt = allocate(amounts.cess, txval);

  return {
    buckets: groups.map((g, i) => ({
      rate: g.rate,
      hsn: g.hsn,
      uqc: g.uqc,
      description: g.description,
      qty: g.qty,
      txval: txval[i],
      iamt: iamt[i],
      camt: camt[i],
      samt: samt[i],
      csamt: csamt[i],
    })),
    rateInferred: inferred,
    rateUnclear: inferred && !implied.exact,
  };
}

/** Buckets of one document merged by rate — how B2B, B2CL and note tables list items. */
export function itemsByRate(buckets: RateBucket[]): Array<TaxHeads & { rate: number }> {
  const out: Array<TaxHeads & { rate: number }> = [];
  for (const b of buckets) {
    const found = out.find((o) => o.rate === b.rate);
    if (found) Object.assign(found, addHeads(found, b));
    else out.push({ rate: b.rate, txval: b.txval, iamt: b.iamt, camt: b.camt, samt: b.samt, csamt: b.csamt });
  }
  return out.sort((a, b) => a.rate - b.rate);
}

// ── GSTR-1 ──────────────────────────────────────────────────────────────────

/** B2C invoices above this, sent to another state, are reported one by one (B2CL). */
export const B2CL_THRESHOLD_PAISE = 1_00_000_00;

export interface SaleIn {
  id: string;
  number: string | null;
  date: string;
  customerName: string;
  customerGstin: string | null;
  /** The customer's state code, from their GSTIN or as recorded. */
  customerState: string | null;
  amounts: Amounts;
  lines: LineLike[];
}

export interface CreditNoteIn {
  id: string;
  number: string;
  date: string;
  amounts: Amounts;
  /** The invoice it was raised against, which may be from an earlier month. */
  invoice: SaleIn;
}

export interface Issue {
  /** block: the portal will refuse the return as it stands. note: worth a look. */
  level: 'block' | 'note';
  message: string;
  documentId?: string;
}

export interface DocLine extends TaxHeads {
  rate: number;
}

export interface ReturnDoc {
  id: string;
  number: string;
  date: string;
  pos: string;
  valuePaise: number;
  items: DocLine[];
}

export type B2csSupply = 'INTRA' | 'INTER';
export type NilSupply = 'INTRB2B' | 'INTRAB2B' | 'INTRB2C' | 'INTRAB2C';

export interface HsnRow extends TaxHeads {
  hsn: string;
  description: string;
  uqc: string;
  qty: number;
  rate: number;
}

export interface Gstr1 {
  period: string;
  gstin: string | null;
  b2b: Array<{ ctin: string; customerName: string; invoices: ReturnDoc[] }>;
  b2cl: Array<{ pos: string; invoices: ReturnDoc[] }>;
  b2cs: Array<TaxHeads & { supplyType: B2csSupply; pos: string; rate: number }>;
  nil: Array<{ supplyType: NilSupply; nilPaise: number }>;
  cdnr: Array<{ ctin: string; customerName: string; notes: ReturnDoc[] }>;
  cdnur: ReturnDoc[];
  hsn: { b2b: HsnRow[]; b2c: HsnRow[] };
  docs: Array<{ kind: 'invoices' | 'credit_notes'; from: string; to: string; count: number }>;
  summary: Array<TaxHeads & { section: string; label: string; count: number }>;
  issues: Issue[];
}

interface Placed {
  registered: boolean;
  pos: string | null;
  interState: boolean;
}

/**
 * Where a supply goes. The place of supply is the customer's state; whether it
 * is inter-state is read off the tax actually charged (IGST or CGST+SGST),
 * because that is what was collected and what the ledger holds.
 */
function place(sale: SaleIn, orgState: string, issues: Issue[]): Placed {
  const registered = !!sale.customerGstin;
  const charged = sale.amounts.igst > 0 ? 'inter' : sale.amounts.cgst + sale.amounts.sgst > 0 ? 'intra' : null;
  let pos = sale.customerGstin?.slice(0, 2) ?? sale.customerState ?? null;
  if (!pos && charged !== 'inter') pos = orgState; // CGST+SGST, or no tax: within the state
  const interState = charged ? charged === 'inter' : pos !== orgState;
  const label = sale.number ?? sale.id;

  if (!pos) {
    issues.push({
      level: 'block',
      message: `Invoice ${label} charges IGST to ${sale.customerName}, who has no GSTIN or state on record. Set their state.`,
      documentId: sale.id,
    });
  } else if (charged && (pos !== orgState) !== interState) {
    issues.push({
      level: 'note',
      message:
        `Invoice ${label} charges ${interState ? 'IGST' : 'CGST + SGST'}, but ${sale.customerName} is ` +
        `${pos === orgState ? 'in your state' : `in state ${pos}`}. Check the place of supply.`,
      documentId: sale.id,
    });
  }
  return { registered, pos, interState };
}

function uqcFor(hsn: string | null): string {
  // Services (SAC, chapter 99) have no unit of measure.
  return hsn?.startsWith('99') ? 'NA' : 'OTH';
}

function nilSupply(placed: Placed): NilSupply {
  return `${placed.interState ? 'INTR' : 'INTRA'}${placed.registered ? 'B2B' : 'B2C'}` as NilSupply;
}

function isB2cl(placed: Placed, sale: SaleIn): boolean {
  return !placed.registered && placed.interState && sale.amounts.total > B2CL_THRESHOLD_PAISE;
}

export function buildGstr1(input: {
  period: string;
  orgGstin: string | null;
  orgState: string;
  invoices: SaleIn[];
  creditNotes: CreditNoteIn[];
  /** Invoices dated in the period but not posted, so not in the return. */
  unpostedCount?: number;
}): Gstr1 {
  const { orgState } = input;
  const issues: Issue[] = [];
  if (!input.orgGstin) {
    issues.push({ level: 'block', message: 'Add your GSTIN in Settings — the return is filed against it.' });
  }
  if (input.unpostedCount) {
    issues.push({
      level: 'note',
      message: `${input.unpostedCount} invoice${input.unpostedCount === 1 ? ' is' : 's are'} dated this month but not posted, so left out.`,
    });
  }

  const b2b = new Map<string, { ctin: string; customerName: string; invoices: ReturnDoc[] }>();
  const b2cl = new Map<string, ReturnDoc[]>();
  const b2cs = new Map<string, TaxHeads & { supplyType: B2csSupply; pos: string; rate: number }>();
  const nil = new Map<NilSupply, number>();
  const cdnr = new Map<string, { ctin: string; customerName: string; notes: ReturnDoc[] }>();
  const cdnur: ReturnDoc[] = [];
  const hsn = { b2b: new Map<string, HsnRow>(), b2c: new Map<string, HsnRow>() };
  let missingHsn = 0;
  let unclearRate = 0;

  const addHsn = (registered: boolean, b: RateBucket, sign: 1 | -1) => {
    const code = b.hsn ?? '';
    const table = registered ? hsn.b2b : hsn.b2c;
    // The portal lists one row per code, unit and rate.
    const uqc = b.uqc ?? uqcFor(b.hsn);
    const key = `${code}|${uqc}|${b.rate}`;
    const row = table.get(key) ?? {
      hsn: code,
      description: b.description ?? '',
      uqc,
      qty: 0,
      rate: b.rate,
      ...ZERO_HEADS,
    };
    Object.assign(row, addHeads(row, b, sign));
    // A credit note carries no count of goods returned, so it leaves quantity alone.
    if (row.uqc !== 'NA' && sign > 0) row.qty += b.qty;
    table.set(key, row);
  };

  const addB2cs = (placed: Placed, b: RateBucket, sign: 1 | -1) => {
    const supplyType: B2csSupply = placed.interState ? 'INTER' : 'INTRA';
    const pos = placed.pos ?? '';
    const key = `${supplyType}|${pos}|${b.rate}`;
    const row = b2cs.get(key) ?? { supplyType, pos, rate: b.rate, ...ZERO_HEADS };
    Object.assign(row, addHeads(row, b, sign));
    b2cs.set(key, row);
  };

  const split = (amounts: Amounts, lines: LineLike[]) => {
    const result = rateBuckets(amounts, lines);
    if (result.rateUnclear) unclearRate += 1;
    if (result.buckets.some((b) => b.rate > 0 && !b.hsn)) missingHsn += 1;
    return result.buckets;
  };

  const docOf = (id: string, number: string | null, date: string, pos: string, value: number, buckets: RateBucket[]): ReturnDoc => ({
    id,
    number: number ?? '',
    date,
    pos,
    valuePaise: value,
    items: itemsByRate(buckets.filter((b) => b.rate > 0)),
  });

  for (const sale of input.invoices) {
    const placed = place(sale, orgState, issues);
    if (!sale.number) {
      issues.push({ level: 'block', message: `An invoice to ${sale.customerName} dated ${sale.date} has no number.`, documentId: sale.id });
    }
    const buckets = split(sale.amounts, sale.lines);
    for (const b of buckets) {
      if (b.rate === 0) nil.set(nilSupply(placed), (nil.get(nilSupply(placed)) ?? 0) + b.txval);
      addHsn(placed.registered, b, 1);
    }
    const taxed = buckets.filter((b) => b.rate > 0);
    if (taxed.length === 0) continue;
    const doc = docOf(sale.id, sale.number, sale.date, placed.pos ?? '', sale.amounts.total, taxed);
    if (placed.registered) {
      const ctin = sale.customerGstin!;
      const party = b2b.get(ctin) ?? { ctin, customerName: sale.customerName, invoices: [] };
      party.invoices.push(doc);
      b2b.set(ctin, party);
    } else if (isB2cl(placed, sale)) {
      b2cl.set(doc.pos, [...(b2cl.get(doc.pos) ?? []), doc]);
    } else {
      for (const b of taxed) addB2cs(placed, b, 1);
    }
  }

  for (const note of input.creditNotes) {
    // A note follows its invoice: same customer, same place, same table.
    const placed = place(note.invoice, orgState, []);
    const buckets = split(note.amounts, note.invoice.lines);
    for (const b of buckets) {
      if (b.rate === 0) nil.set(nilSupply(placed), (nil.get(nilSupply(placed)) ?? 0) - b.txval);
      addHsn(placed.registered, b, -1);
    }
    const taxed = buckets.filter((b) => b.rate > 0);
    if (taxed.length === 0) continue;
    const doc = docOf(note.id, note.number, note.date, placed.pos ?? '', note.amounts.total, taxed);
    if (placed.registered) {
      const ctin = note.invoice.customerGstin!;
      const party = cdnr.get(ctin) ?? { ctin, customerName: note.invoice.customerName, notes: [] };
      party.notes.push(doc);
      cdnr.set(ctin, party);
    } else if (isB2cl(placed, note.invoice)) {
      cdnur.push(doc);
    } else {
      // B2C small: the portal takes these netted into the B2CS rows.
      for (const b of taxed) addB2cs(placed, b, -1);
    }
  }

  if (missingHsn > 0) {
    issues.push({
      level: 'note',
      message:
        `${missingHsn} document${missingHsn === 1 ? ' has' : 's have'} no HSN/SAC code. ` +
        'Table 12 needs one for every taxable line; those rows show without a code.',
    });
  }
  if (unclearRate > 0) {
    issues.push({
      level: 'note',
      message:
        `${unclearRate} document${unclearRate === 1 ? "'s" : "s'"} tax matches no single GST rate — ` +
        'probably items at two rates on one invoice. They are filed at the nearest rate; check them.',
    });
  }
  for (const row of b2cs.values()) {
    if (row.txval < 0) {
      issues.push({
        level: 'note',
        message: `B2CS for state ${row.pos} at ${row.rate}% is negative this month: credit notes exceed sales.`,
      });
    }
  }

  const numbered = (numbers: string[]) => [...numbers].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const invoiceNumbers = numbered(input.invoices.map((i) => i.number).filter((n): n is string => !!n));
  const noteNumbers = numbered(input.creditNotes.map((n) => n.number));
  const docs: Gstr1['docs'] = [];
  if (invoiceNumbers.length) {
    docs.push({ kind: 'invoices', from: invoiceNumbers[0], to: invoiceNumbers[invoiceNumbers.length - 1], count: invoiceNumbers.length });
  }
  if (noteNumbers.length) {
    docs.push({ kind: 'credit_notes', from: noteNumbers[0], to: noteNumbers[noteNumbers.length - 1], count: noteNumbers.length });
  }

  const b2bList = [...b2b.values()].sort((a, b) => a.ctin.localeCompare(b.ctin));
  const b2clList = [...b2cl.entries()].map(([pos, invoices]) => ({ pos, invoices })).sort((a, b) => a.pos.localeCompare(b.pos));
  const b2csList = [...b2cs.values()].sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate);
  const cdnrList = [...cdnr.values()].sort((a, b) => a.ctin.localeCompare(b.ctin));
  const nilList = [...nil.entries()].filter(([, v]) => v !== 0).map(([supplyType, nilPaise]) => ({ supplyType, nilPaise }));

  const docsHeads = (docs: ReturnDoc[]) => sumHeads(docs.flatMap((d) => d.items));
  const b2bDocs = b2bList.flatMap((p) => p.invoices);
  const b2clDocs = b2clList.flatMap((g) => g.invoices);
  const cdnrDocs = cdnrList.flatMap((p) => p.notes);
  const summary: Gstr1['summary'] = [
    { section: 'b2b', label: '4A — B2B invoices', count: b2bDocs.length, ...docsHeads(b2bDocs) },
    { section: 'b2cl', label: '5 — B2C large (inter-state)', count: b2clDocs.length, ...docsHeads(b2clDocs) },
    { section: 'b2cs', label: '7 — B2C others', count: b2csList.length, ...sumHeads(b2csList) },
    { section: 'cdnr', label: '9B — Credit notes, registered', count: cdnrDocs.length, ...docsHeads(cdnrDocs) },
    { section: 'cdnur', label: '9B — Credit notes, unregistered', count: cdnur.length, ...docsHeads(cdnur) },
    { section: 'nil', label: '8 — Nil rated', count: nilList.length, ...ZERO_HEADS, txval: nilList.reduce((s, n) => s + n.nilPaise, 0) },
  ];

  return {
    period: input.period,
    gstin: input.orgGstin,
    b2b: b2bList,
    b2cl: b2clList,
    b2cs: b2csList,
    nil: nilList,
    cdnr: cdnrList,
    cdnur,
    hsn: { b2b: [...hsn.b2b.values()], b2c: [...hsn.b2c.values()] },
    docs,
    summary,
    issues,
  };
}

// ── GSTR-3B ─────────────────────────────────────────────────────────────────

export type Head = 'igst' | 'cgst' | 'sgst' | 'cess';
export type Heads = Record<Head, number>;
export const HEADS: Head[] = ['igst', 'cgst', 'sgst', 'cess'];
const ZERO: Heads = { igst: 0, cgst: 0, sgst: 0, cess: 0 };

function headsOf(t: TaxHeads): Heads {
  return { igst: t.iamt, cgst: t.camt, sgst: t.samt, cess: t.csamt };
}

export interface SetOffRow {
  head: Head;
  /** Forward-charge tax on outward supplies. */
  liabilityPaise: number;
  /** Reverse-charge tax: always paid in cash, never from credit. */
  reverseChargePaise: number;
  /** How much of each credit went to this head. */
  fromCredit: Heads;
  cashPaise: number;
}

export interface SetOff {
  rows: SetOffRow[];
  /** Credit left over, carried to next month's ledger. */
  creditLeft: Heads;
  cashTotalPaise: number;
}

/**
 * Pays the month's tax from input credit in the order the law sets
 * (section 49 and rule 88A):
 *  - IGST credit goes first, to IGST, then to CGST and SGST — and must be used
 *    up before any CGST or SGST credit is touched. It covers whatever their own
 *    credit cannot first, so as little as possible ends up in cash.
 *  - CGST credit pays CGST, then IGST. Never SGST.
 *  - SGST credit pays SGST, then IGST. Never CGST.
 *  - Cess credit pays only cess.
 * Reverse-charge tax cannot be paid from credit at all; it is cash.
 */
export function setOff(liability: Heads, reverseCharge: Heads, credit: Heads): SetOff {
  const due = { ...liability };
  const left = { ...credit };
  const used: Record<Head, Heads> = { igst: { ...ZERO }, cgst: { ...ZERO }, sgst: { ...ZERO }, cess: { ...ZERO } };
  const apply = (from: Head, to: Head, cap = Number.POSITIVE_INFINITY) => {
    const n = Math.max(0, Math.min(left[from], due[to], cap));
    left[from] -= n;
    due[to] -= n;
    used[from][to] += n;
  };

  apply('igst', 'igst');
  apply('igst', 'cgst', due.cgst - left.cgst);
  apply('igst', 'sgst', due.sgst - left.sgst);
  apply('igst', 'cgst');
  apply('igst', 'sgst');
  apply('cgst', 'cgst');
  apply('cgst', 'igst');
  apply('sgst', 'sgst');
  apply('sgst', 'igst');
  apply('cess', 'cess');

  const rows = HEADS.map((head) => ({
    head,
    liabilityPaise: liability[head],
    reverseChargePaise: reverseCharge[head],
    fromCredit: { igst: used.igst[head], cgst: used.cgst[head], sgst: used.sgst[head], cess: used.cess[head] },
    cashPaise: due[head] + reverseCharge[head],
  }));
  return { rows, creditLeft: left, cashTotalPaise: rows.reduce((s, r) => s + r.cashPaise, 0) };
}

export interface PurchaseIn {
  id: string;
  number: string | null;
  vendorName: string;
  vendorGstin: string | null;
  isReverseCharge: boolean;
  amounts: Amounts;
}

export interface Gstr3b {
  period: string;
  gstin: string | null;
  /** 3.1(a) Outward taxable supplies, net of credit notes. */
  outwardTaxable: TaxHeads;
  /** 3.1(c) Nil rated and exempted outward supplies. */
  outwardNil: TaxHeads;
  /** 3.1(d) Inward supplies on which you pay tax (reverse charge). */
  inwardReverseCharge: TaxHeads;
  /** 3.2 Inter-state supplies to unregistered persons, by place of supply. */
  interStateUnregistered: Array<{ pos: string; txval: number; iamt: number }>;
  /** 4(A)(3) and 4(A)(5): credit on reverse-charge and on all other purchases. */
  itcReverseCharge: TaxHeads;
  itcOther: TaxHeads;
  /** 4(C) Net ITC available. */
  itcNet: TaxHeads;
  /** 5 Exempt, nil and non-GST inward supplies. */
  inwardExempt: { inter: number; intra: number };
  setOff: SetOff;
  issues: Issue[];
}

export function buildGstr3b(input: {
  gstr1: Gstr1;
  orgState: string;
  bills: PurchaseIn[];
  /** Debit notes this month, each with the bill it reduces. */
  debitNotes: Array<{ id: string; amounts: Amounts; bill: PurchaseIn }>;
}): Gstr3b {
  const { gstr1, orgState } = input;
  const issues: Issue[] = gstr1.issues.filter((i) => i.level === 'block');

  // 3.1(a): every taxed outward document, less the credit notes against them.
  // B2CS rows are already net of their notes.
  const docHeads = (docs: ReturnDoc[]) => sumHeads(docs.flatMap((d) => d.items));
  const outwardTaxable = addHeads(
    sumHeads([
      docHeads(gstr1.b2b.flatMap((p) => p.invoices)),
      docHeads(gstr1.b2cl.flatMap((g) => g.invoices)),
      sumHeads(gstr1.b2cs),
    ]),
    sumHeads([docHeads(gstr1.cdnr.flatMap((p) => p.notes)), docHeads(gstr1.cdnur)]),
    -1,
  );
  const outwardNil = { ...ZERO_HEADS, txval: gstr1.nil.reduce((s, n) => s + n.nilPaise, 0) };

  // 3.2: inter-state B2C, by state.
  const byPos = new Map<string, { pos: string; txval: number; iamt: number }>();
  const addPos = (pos: string, txval: number, iamt: number) => {
    const row = byPos.get(pos) ?? { pos, txval: 0, iamt: 0 };
    row.txval += txval;
    row.iamt += iamt;
    byPos.set(pos, row);
  };
  for (const g of gstr1.b2cl) for (const inv of g.invoices) for (const it of inv.items) addPos(g.pos, it.txval, it.iamt);
  for (const row of gstr1.b2cs) if (row.supplyType === 'INTER') addPos(row.pos, row.txval, row.iamt);
  for (const note of gstr1.cdnur) for (const it of note.items) addPos(note.pos, -it.txval, -it.iamt);

  const heads = (a: Amounts): TaxHeads => ({ txval: a.taxableValue, iamt: a.igst, camt: a.cgst, samt: a.sgst, csamt: a.cess });
  let inwardReverseCharge = { ...ZERO_HEADS };
  let itcOther = { ...ZERO_HEADS };
  const inwardExempt = { inter: 0, intra: 0 };

  for (const bill of input.bills) {
    const t = heads(bill.amounts);
    const gst = t.iamt + t.camt + t.samt + t.csamt;
    if (bill.isReverseCharge) {
      inwardReverseCharge = addHeads(inwardReverseCharge, t);
      continue;
    }
    if (gst === 0) {
      const inter = !!bill.vendorGstin && bill.vendorGstin.slice(0, 2) !== orgState;
      inwardExempt[inter ? 'inter' : 'intra'] += t.txval;
      continue;
    }
    if (!bill.vendorGstin) {
      issues.push({
        level: 'note',
        message:
          `Bill ${bill.number ?? bill.id} claims GST from ${bill.vendorName}, who has no GSTIN on record. ` +
          'Credit is only available on a registered supplier’s invoice.',
        documentId: bill.id,
      });
    }
    itcOther = addHeads(itcOther, t);
  }
  for (const note of input.debitNotes) {
    const t = heads(note.amounts);
    if (note.bill.isReverseCharge) inwardReverseCharge = addHeads(inwardReverseCharge, t, -1);
    else if (t.iamt + t.camt + t.samt + t.csamt > 0) itcOther = addHeads(itcOther, t, -1);
  }

  // Reverse-charge tax paid this month is credit this month.
  const itcReverseCharge = { ...inwardReverseCharge, txval: 0 };
  const itcNet = { ...addHeads(itcReverseCharge, itcOther), txval: 0 };
  const zeroIfNegative = (h: Heads): Heads => ({
    igst: Math.max(0, h.igst),
    cgst: Math.max(0, h.cgst),
    sgst: Math.max(0, h.sgst),
    cess: Math.max(0, h.cess),
  });

  return {
    period: gstr1.period,
    gstin: gstr1.gstin,
    outwardTaxable,
    outwardNil,
    inwardReverseCharge,
    interStateUnregistered: [...byPos.values()].filter((r) => r.txval !== 0).sort((a, b) => a.pos.localeCompare(b.pos)),
    itcReverseCharge,
    itcOther: { ...itcOther, txval: 0 },
    itcNet,
    inwardExempt,
    setOff: setOff(
      zeroIfNegative(headsOf(outwardTaxable)),
      zeroIfNegative(headsOf(inwardReverseCharge)),
      zeroIfNegative(headsOf(itcNet)),
    ),
    issues,
  };
}

// ── Portal JSON ─────────────────────────────────────────────────────────────

/** Paise to the rupees-and-paise number the portal's JSON carries. Output only. */
const rs = (paise: number) => paise / 100;

/** 2026-09-15 → 15-09-2026, the portal's date format. */
const portalDate = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

/** 2026-09 → 092026, the portal's filing period. */
export const portalPeriod = (period: string) => `${period.slice(5, 7)}${period.slice(0, 4)}`;

function itms(items: DocLine[], inter: boolean) {
  return items.map((it, i) => ({
    num: i + 1,
    itm_det: inter
      ? { txval: rs(it.txval), rt: it.rate, iamt: rs(it.iamt), csamt: rs(it.csamt) }
      : { txval: rs(it.txval), rt: it.rate, iamt: rs(it.iamt), camt: rs(it.camt), samt: rs(it.samt), csamt: rs(it.csamt) },
  }));
}

/** The return in the shape of the GST offline tool's GSTR-1 JSON. Empty tables are left out. */
export function gstr1PortalJson(r: Gstr1): Record<string, unknown> {
  const out: Record<string, unknown> = { gstin: r.gstin ?? '', fp: portalPeriod(r.period) };
  if (r.b2b.length) {
    out.b2b = r.b2b.map((p) => ({
      ctin: p.ctin,
      inv: p.invoices.map((d) => ({
        inum: d.number, idt: portalDate(d.date), val: rs(d.valuePaise), pos: d.pos, rchrg: 'N', inv_typ: 'R', itms: itms(d.items, false),
      })),
    }));
  }
  if (r.b2cl.length) {
    out.b2cl = r.b2cl.map((g) => ({
      pos: g.pos,
      inv: g.invoices.map((d) => ({ inum: d.number, idt: portalDate(d.date), val: rs(d.valuePaise), itms: itms(d.items, true) })),
    }));
  }
  if (r.b2cs.length) {
    out.b2cs = r.b2cs.map((row) => ({
      sply_ty: row.supplyType, pos: row.pos, typ: 'OE', rt: row.rate,
      txval: rs(row.txval), iamt: rs(row.iamt), camt: rs(row.camt), samt: rs(row.samt), csamt: rs(row.csamt),
    }));
  }
  if (r.cdnr.length) {
    out.cdnr = r.cdnr.map((p) => ({
      ctin: p.ctin,
      nt: p.notes.map((d) => ({
        ntty: 'C', nt_num: d.number, nt_dt: portalDate(d.date), val: rs(d.valuePaise), pos: d.pos, rchrg: 'N', inv_typ: 'R',
        itms: itms(d.items, false),
      })),
    }));
  }
  if (r.cdnur.length) {
    out.cdnur = r.cdnur.map((d) => ({
      typ: 'B2CL', ntty: 'C', nt_num: d.number, nt_dt: portalDate(d.date), val: rs(d.valuePaise), pos: d.pos, itms: itms(d.items, true),
    }));
  }
  if (r.nil.length) {
    out.nil = { inv: r.nil.map((n) => ({ sply_ty: n.supplyType, nil_amt: rs(n.nilPaise), expt_amt: 0, ngsup_amt: 0 })) };
  }
  const hsnRows = (rows: HsnRow[]) =>
    rows.map((h, i) => ({
      num: i + 1, hsn_sc: h.hsn, desc: h.description, uqc: h.uqc, qty: h.qty, rt: h.rate,
      txval: rs(h.txval), iamt: rs(h.iamt), camt: rs(h.camt), samt: rs(h.samt), csamt: rs(h.csamt),
    }));
  if (r.hsn.b2b.length || r.hsn.b2c.length) {
    out.hsn = { hsn_b2b: hsnRows(r.hsn.b2b), hsn_b2c: hsnRows(r.hsn.b2c) };
  }
  if (r.docs.length) {
    out.doc_issue = {
      doc_det: r.docs.map((d) => ({
        // 1: invoices for outward supply; 5: credit notes.
        doc_num: d.kind === 'invoices' ? 1 : 5,
        docs: [{ num: 1, from: d.from, to: d.to, totnum: d.count, cancel: 0, net_issue: d.count }],
      })),
    };
  }
  return out;
}

/** GSTR-3B in the shape of the portal's JSON. */
export function gstr3bPortalJson(r: Gstr3b): Record<string, unknown> {
  const full = (t: TaxHeads) => ({ txval: rs(t.txval), iamt: rs(t.iamt), camt: rs(t.camt), samt: rs(t.samt), csamt: rs(t.csamt) });
  const tax = (t: TaxHeads) => ({ iamt: rs(t.iamt), camt: rs(t.camt), samt: rs(t.samt), csamt: rs(t.csamt) });
  const none = { iamt: 0, camt: 0, samt: 0, csamt: 0 };
  return {
    gstin: r.gstin ?? '',
    ret_period: portalPeriod(r.period),
    sup_details: {
      osup_det: full(r.outwardTaxable),
      osup_zero: { txval: 0, iamt: 0, csamt: 0 },
      osup_nil_exmp: { txval: rs(r.outwardNil.txval) },
      isup_rev: full(r.inwardReverseCharge),
      osup_nongst: { txval: 0 },
    },
    inter_sup: {
      unreg_details: r.interStateUnregistered.map((p) => ({ pos: p.pos, txval: rs(p.txval), iamt: rs(p.iamt) })),
      comp_details: [],
      uin_details: [],
    },
    itc_elg: {
      itc_avl: [
        { ty: 'IMPG', ...none },
        { ty: 'IMPS', ...none },
        { ty: 'ISRC', ...tax(r.itcReverseCharge) },
        { ty: 'ISD', ...none },
        { ty: 'OTH', ...tax(r.itcOther) },
      ],
      itc_rev: [
        { ty: 'RUL', ...none },
        { ty: 'OTH', ...none },
      ],
      itc_net: tax(r.itcNet),
      itc_inelg: [
        { ty: 'RUL', ...none },
        { ty: 'OTH', ...none },
      ],
    },
    inward_sup: {
      isup_details: [
        { ty: 'GST', inter: rs(r.inwardExempt.inter), intra: rs(r.inwardExempt.intra) },
        { ty: 'NONGST', inter: 0, intra: 0 },
      ],
    },
  };
}
