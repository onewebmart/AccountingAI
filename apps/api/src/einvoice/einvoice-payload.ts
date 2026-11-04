import { allocate } from '../gst/gst-returns';

/**
 * A posted invoice, as the e-invoice schema (NIC INV-01, version 1.1) wants
 * it. Pure. Amounts stay integer paise until this, the last step, where the
 * schema's rupees are written out.
 */

export interface EinvoiceParty {
  gstin: string | null;
  legalName: string;
  address: string | null;
  city: string | null;
  pincode: string | null;
  stateCode: string | null;
}

export interface EinvoiceLine {
  description: string;
  hsnSac: string | null;
  qty: number;
  uqc: string | null;
  ratePaise: number;
  amountPaise: number;
  taxRatePct: number;
}

export interface EinvoiceInput {
  docType: 'INV' | 'CRN' | 'DBN';
  number: string | null;
  /** YYYY-MM-DD */
  date: string;
  seller: EinvoiceParty;
  buyer: EinvoiceParty;
  /** Where the supply is taxed: the buyer's state for goods delivered there and most services. */
  placeOfSupply: string | null;
  isReverseCharge: boolean;
  amounts: { taxableValue: number; cgst: number; sgst: number; igst: number; cess: number; total: number };
  lines: EinvoiceLine[];
}

const rs = (paise: number) => Math.round(paise) / 100;
const ddmmyyyy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Each line's share of the document's taxable value and tax, adding back to it exactly. */
export function lineShares(input: EinvoiceInput) {
  const lines = input.lines.length ? input.lines : [{ description: 'Supply', hsnSac: null, qty: 1, uqc: null, ratePaise: input.amounts.taxableValue, amountPaise: input.amounts.taxableValue, taxRatePct: 0 }];
  const txval = allocate(input.amounts.taxableValue, lines.map((l) => l.amountPaise));
  const byTax = txval.map((t, i) => t * (lines[i].taxRatePct || 0));
  const weights = byTax.some((w) => w > 0) ? byTax : txval;
  return {
    lines,
    txval,
    igst: allocate(input.amounts.igst, weights),
    cgst: allocate(input.amounts.cgst, weights),
    sgst: allocate(input.amounts.sgst, weights),
    cess: allocate(input.amounts.cess, txval),
  };
}

function party(p: EinvoiceParty) {
  return {
    Gstin: (p.gstin ?? '').toUpperCase(),
    LglNm: p.legalName.slice(0, 100),
    Addr1: (p.address ?? '').replace(/\s+/g, ' ').trim().slice(0, 100),
    Loc: (p.city ?? '').trim().slice(0, 100),
    Pin: Number(p.pincode ?? 0),
    Stcd: p.stateCode ?? '',
  };
}

export function buildEinvoicePayload(input: EinvoiceInput) {
  const s = lineShares(input);
  const items = s.lines.map((l, i) => {
    const qty = l.qty > 0 ? l.qty : 1;
    const ass = s.txval[i];
    const isService = (l.hsnSac ?? '').startsWith('99');
    return {
      SlNo: String(i + 1),
      PrdDesc: l.description.slice(0, 300),
      IsServc: isService ? 'Y' : 'N',
      HsnCd: (l.hsnSac ?? '').replace(/\s/g, ''),
      Qty: qty,
      Unit: isService ? undefined : l.uqc ?? 'OTH',
      // Unit price from the line's share, so price × quantity is its assessable value.
      UnitPrice: Math.round(ass / qty) / 100,
      TotAmt: rs(ass),
      Discount: 0,
      AssAmt: rs(ass),
      GstRt: l.taxRatePct || 0,
      IgstAmt: rs(s.igst[i]),
      CgstAmt: rs(s.cgst[i]),
      SgstAmt: rs(s.sgst[i]),
      CesRt: 0,
      CesAmt: rs(s.cess[i]),
      TotItemVal: rs(ass + s.igst[i] + s.cgst[i] + s.sgst[i] + s.cess[i]),
    };
  });
  const a = input.amounts;
  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: input.isReverseCharge ? 'Y' : 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: input.docType, No: (input.number ?? '').toUpperCase(), Dt: ddmmyyyy(input.date) },
    SellerDtls: party(input.seller),
    BuyerDtls: { ...party(input.buyer), Pos: input.placeOfSupply ?? input.buyer.stateCode ?? '' },
    ItemList: items,
    ValDtls: {
      AssVal: rs(a.taxableValue),
      CgstVal: rs(a.cgst),
      SgstVal: rs(a.sgst),
      IgstVal: rs(a.igst),
      CesVal: rs(a.cess),
      Discount: 0,
      OthChrg: 0,
      // Whatever the total rounds to beyond value plus tax.
      RndOffAmt: rs(a.total - (a.taxableValue + a.cgst + a.sgst + a.igst + a.cess)),
      TotInvVal: rs(a.total),
    },
  };
}

export type EinvoicePayload = ReturnType<typeof buildEinvoicePayload>;

/** 2026-10-08 → 2026-27: the financial year an IRN is unique within. */
export function financialYear(date: string): string {
  const y = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
