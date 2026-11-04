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

// ── Text measurement ────────────────────────────────────────────────────────

/** Advance widths (1/1000 em) of Helvetica and Helvetica-Bold, characters 32–126. */
const W_REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const W_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611,
  611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Characters outside ASCII that WinAnsi has, by their byte there; the rest print as "?". */
const WIN_ANSI: Record<string, number> = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85, '©': 0xa9, '°': 0xb0 };

function toWinAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text.replace(/₹\s?/g, 'Rs. ')) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code <= 126) out.push(code);
    else if (WIN_ANSI[ch]) out.push(WIN_ANSI[ch]);
    else if (ch === '\t') out.push(32);
    else out.push(63);
  }
  return out;
}

function widthOf(text: string, size: number, bold = false): number {
  const table = bold ? W_BOLD : W_REGULAR;
  return toWinAnsi(text).reduce((s, b) => s + (b >= 32 && b <= 126 ? table[b - 32] : 556), 0) * (size / 1000);
}

/** Words onto lines no wider than `max` points. */
function wrap(text: string, size: number, max: number, bold = false): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (widthOf(next, size, bold) <= max || !line) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

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

const money = (paise: number) =>
  `${paise < 0 ? '-' : ''}${(Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const displayDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

// ── Drawing ─────────────────────────────────────────────────────────────────

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;

class Page {
  readonly ops: string[] = [];
  text(x: number, y: number, s: string, size = 9, bold = false) {
    const bytes = toWinAnsi(s)
      .map((b) => (b === 40 || b === 41 || b === 92 ? `\\${String.fromCharCode(b)}` : b > 126 ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b)))
      .join('');
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${bytes}) Tj ET`);
  }
  right(xRight: number, y: number, s: string, size = 9, bold = false) {
    this.text(xRight - widthOf(s, size, bold), y, s, size, bold);
  }
  line(x1: number, y1: number, x2: number, y2: number, grey = 0.75) {
    this.ops.push(`${grey} G 0.6 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S 0 G`);
  }
  box(x: number, y: number, w: number, h: number, fill = 0.96) {
    this.ops.push(`${fill} g ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f 0 g`);
  }
}

function assemble(pages: Page[]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) && objects.length;
  const catalog = add('');
  const pagesObj = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  for (const page of pages) {
    const content = page.ops.join('\n');
    const stream = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${stream} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** The invoice as PDF bytes. Pure: the same data always gives the same file. */
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
  page.text(MARGIN + 10, y - 14, 'BILL TO', 7.5, true);
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
