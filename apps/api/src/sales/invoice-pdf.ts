/**
 * A tax invoice as a PDF, written directly: no rendering engine or font
 * files, just the two standard Helvetica faces every PDF reader has. They
 * carry no ₹ glyph, so amounts print as "Rs.".
 *
 * Carries what Rule 46 of the CGST Rules asks of a tax invoice: supplier and
 * recipient with GSTINs, a serial number and date, HSN/SAC, quantity,
 * taxable value, rate and amount of each tax, place of supply with its
 * state, whether tax is payable on reverse charge, and a signatory.
 */

import { MARGIN, PAGE_H, PAGE_W, Page, assemble, displayDate, money, wrap } from '../common/pdf';

export interface InvoicePdfData {
  seller: { name: string; address: string | null; gstin: string | null; pan: string | null; stateCode: string | null; phone: string | null; email: string | null };
  buyer: { name: string; address: string | null; gstin: string | null; stateCode: string | null };
  number: string | null;
  date: string;
  dueDate: string | null;
  lines: Array<{ description: string; hsnSac: string | null; qty: number; ratePaise: number; amountPaise: number; taxRatePct: number }>;
  amounts: { taxableValue: number; cgst: number; sgst: number; igst: number; cess: number; total: number };
  notes: string | null;
  /** Printed under the totals on every invoice: bank details, terms. */
  footer: string | null;
  /** Shown across the top while the invoice is not yet posted. */
  draft: boolean;
  /** QUOTATION, SALES ORDER, DELIVERY CHALLAN: other documents on the same layout. */
  title?: string;
  numberLabel?: string;
  /** Under the number: valid until, expected by, the reason goods move. */
  extraRows?: Array<[string, string]>;
  /** BILL TO by default; TO on a purchase order. */
  partyLabel?: string;
  /** Registered with the IRP: its IRN, acknowledgement and the signed QR, as a grid of dark modules. */
  einvoice?: { irn: string; ackNo: string; ackDate: string; qr: boolean[][]; test: boolean } | null;
}

const STATES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep',
  '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana',
  '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};
export const stateName = (code: string | null) => (code ? `${STATES[code] ?? 'State'} (${code})` : 'Not stated');

// ── Money in words, the Indian way ──────────────────────────────────────────

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ` ${ONES[r % 10]}` : ''}`;
  return [h ? `${ONES[h]} Hundred` : '', rest].filter(Boolean).join(' ');
}

/** 11800050 paise → "Rupees One Lakh Eighteen Thousand and Fifty Paise Only". */
export function amountInWords(paise: number): string {
  let rupees = Math.floor(Math.abs(paise) / 100);
  const p = Math.abs(paise) % 100;
  const parts: string[] = [];
  for (const [size, name] of [[10_000_000, 'Crore'], [100_000, 'Lakh'], [1_000, 'Thousand']] as const) {
    const unit = Math.floor(rupees / size);
    if (unit) parts.push(`${unit >= 1000 ? amountInWords(unit * 100).replace(/^Rupees | Only$/g, '') : below1000(unit)} ${name}`);
    rupees %= size;
  }
  if (rupees) parts.push(below1000(rupees));
  const words = parts.join(' ') || 'Zero';
  return `Rupees ${words}${p ? ` and ${below1000(p)} Paise` : ''} Only`;
}

export function renderInvoicePdf(d: InvoicePdfData): Buffer {
  const pages: Page[] = [];
  let page = new Page();
  pages.push(page);
  let y = PAGE_H - MARGIN;
  const right = PAGE_W - MARGIN;

  if (d.draft) page.right(right, PAGE_H - 24, 'DRAFT - not yet posted', 8, true);

  // Seller, left; document, right.
  page.text(MARGIN, y - 12, d.seller.name, 15, true);
  let sy = y - 28;
  for (const l of [
    ...wrap(d.seller.address ?? '', 8.5, 280),
    [d.seller.phone, d.seller.email].filter(Boolean).join('  ·  '),
    d.seller.gstin ? `GSTIN ${d.seller.gstin}` : 'Not registered under GST',
    d.seller.pan ? `PAN ${d.seller.pan}` : '',
  ].filter(Boolean)) {
    page.text(MARGIN, sy, l, 8.5);
    sy -= 11;
  }
  page.right(right, y - 12, d.title ?? (d.seller.gstin ? 'TAX INVOICE' : 'INVOICE'), 14, true);
  let ry = y - 30;
  for (const [k, v] of [
    [d.numberLabel ?? 'Invoice no.', d.number ?? 'Not numbered yet'],
    ['Date', displayDate(d.date)],
    ...(d.dueDate ? [['Due', displayDate(d.dueDate)]] : []),
    ...(d.extraRows ?? []),
    ['Place of supply', stateName(d.buyer.stateCode)],
    ['Reverse charge', 'No'],
  ] as Array<[string, string]>) {
    page.right(right - 120, ry, k, 8.5);
    page.right(right, ry, v, 8.5, true);
    ry -= 12;
  }
  y = Math.min(sy, ry) - 10;

  // E-invoice: the IRN and acknowledgement, and the signed QR the IRP returned.
  if (d.einvoice) {
    const e = d.einvoice;
    const qrSize = 104;
    const cell = qrSize / Math.max(1, e.qr.length);
    const top = y;
    e.qr.forEach((row, r) => row.forEach((dark, c) => dark && page.box(right - qrSize + c * cell, top - (r + 1) * cell, cell, cell, 0)));
    let ey = top - 12;
    page.text(MARGIN, ey, e.test ? 'E-INVOICE (TEST - NOT REGISTERED WITH THE IRP)' : 'E-INVOICE', 7.5, true);
    ey -= 12;
    page.text(MARGIN, ey, `IRN ${e.irn.slice(0, 32)}`, 8);
    ey -= 10;
    page.text(MARGIN + 18, ey, e.irn.slice(32), 8);
    ey -= 12;
    page.text(MARGIN, ey, `Ack no. ${e.ackNo}   Ack date ${e.ackDate}`, 8);
    y = Math.min(ey, top - qrSize) - 12;
  }

  // Bill to.
  const buyerLines = [...wrap(d.buyer.address ?? '', 8.5, 300), d.buyer.gstin ? `GSTIN ${d.buyer.gstin}` : 'Unregistered', `State: ${stateName(d.buyer.stateCode)}`].filter(Boolean);
  const boxH = 30 + buyerLines.length * 11;
  page.box(MARGIN, y - boxH, right - MARGIN, boxH);
  page.text(MARGIN + 10, y - 14, d.partyLabel ?? 'BILL TO', 7.5, true);
  page.text(MARGIN + 10, y - 27, d.buyer.name, 10, true);
  buyerLines.forEach((l, i) => page.text(MARGIN + 10, y - 40 - i * 11, l, 8.5));
  y -= boxH + 18;

  // Items.
  // Right edges: qty 360, rate 425, GST 462, taxable value at the margin, so a line in crores still fits.
  const cols = { n: MARGIN, desc: MARGIN + 18, hsn: 290, qty: 340, rate: 403, gst: 432, amount: right };
  const header = (p: Page, at: number) => {
    p.box(MARGIN, at - 5, right - MARGIN, 16, 0.9);
    p.text(cols.n + 2, at, '#', 8, true);
    p.text(cols.desc, at, 'Description', 8, true);
    p.text(cols.hsn, at, 'HSN/SAC', 8, true);
    p.right(cols.qty + 20, at, 'Qty', 8, true);
    p.right(cols.rate + 22, at, 'Rate', 8, true);
    p.right(cols.gst + 30, at, 'GST', 8, true);
    p.right(cols.amount - 4, at, 'Taxable value', 8, true);
  };
  header(page, y);
  y -= 18;
  const rows = d.lines.length
    ? d.lines
    : [{ description: 'As agreed', hsnSac: null, qty: 1, ratePaise: d.amounts.taxableValue, amountPaise: d.amounts.taxableValue, taxRatePct: 0 }];
  rows.forEach((l, i) => {
    const desc = wrap(l.description || '-', 8.5, cols.hsn - cols.desc - 8);
    const h = desc.length * 11 + 4;
    if (y - h < MARGIN + 170) {
      page.right(right, MARGIN - 14, 'Continued on the next page', 7.5);
      page = new Page();
      pages.push(page);
      y = PAGE_H - MARGIN - 10;
      header(page, y);
      y -= 18;
    }
    page.text(cols.n + 2, y, String(i + 1), 8.5);
    desc.forEach((t, k) => page.text(cols.desc, y - k * 11, t, 8.5));
    page.text(cols.hsn, y, l.hsnSac ?? '', 8.5);
    page.right(cols.qty + 20, y, String(l.qty), 8.5);
    page.right(cols.rate + 22, y, money(l.ratePaise), 8.5);
    page.right(cols.gst + 30, y, l.taxRatePct ? `${l.taxRatePct}%` : '', 8.5);
    page.right(cols.amount - 4, y, money(l.amountPaise), 8.5);
    y -= h;
    page.line(MARGIN, y + 6, right, y + 6, 0.88);
  });

  // Totals.
  y -= 8;
  const a = d.amounts;
  const totals: Array<[string, number, boolean]> = [['Taxable value', a.taxableValue, false]];
  if (a.cgst) totals.push(['CGST', a.cgst, false]);
  if (a.sgst) totals.push(['SGST / UTGST', a.sgst, false]);
  if (a.igst) totals.push(['IGST', a.igst, false]);
  if (a.cess) totals.push(['Cess', a.cess, false]);
  const roundOff = a.total - (a.taxableValue + a.cgst + a.sgst + a.igst + a.cess);
  if (roundOff) totals.push(['Round off', roundOff, false]);
  totals.push(['Total', a.total, true]);
  for (const [label, value, bold] of totals) {
    if (bold) {
      page.line(right - 200, y + 10, right, y + 10, 0.4);
      y -= 3;
    }
    page.right(right - 110, y, label, bold ? 10 : 8.5, bold);
    page.right(right - 4, y, `Rs. ${money(value)}`, bold ? 10 : 8.5, bold);
    y -= bold ? 16 : 12;
  }
  for (const l of wrap(amountInWords(a.total), 8.5, right - MARGIN, true)) {
    page.text(MARGIN, y, l, 8.5, true);
    y -= 11;
  }
  y -= 6;

  for (const block of [d.notes, d.footer].filter((b): b is string => !!b?.trim())) {
    for (const l of wrap(block, 8.5, right - MARGIN)) {
      page.text(MARGIN, y, l, 8.5);
      y -= 11;
    }
    y -= 6;
  }

  // Signatory.
  const signY = Math.max(MARGIN + 40, y - 30);
  page.right(right, signY, `For ${d.seller.name}`, 9, true);
  page.right(right, signY - 34, 'Authorised signatory', 8.5);

  pages.forEach((p, i) => {
    p.text(MARGIN, MARGIN - 14, 'This is a computer-generated invoice.', 7.5);
    if (pages.length > 1) p.right(PAGE_W / 2 + 20, MARGIN - 14, `Page ${i + 1} of ${pages.length}`, 7.5);
  });
  return assemble(pages);
}
