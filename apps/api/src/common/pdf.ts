/**
 * PDF drawing without a rendering engine or font files: the two standard
 * Helvetica faces every reader has, text measured from their widths. They
 * carry no ₹ glyph, so amounts print as "Rs.". Shared by invoices and reports.
 */

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

export function toWinAnsi(text: string): number[] {
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

export function widthOf(text: string, size: number, bold = false): number {
  const table = bold ? W_BOLD : W_REGULAR;
  return toWinAnsi(text).reduce((s, b) => s + (b >= 32 && b <= 126 ? table[b - 32] : 556), 0) * (size / 1000);
}

/** Words onto lines no wider than `max` points. */
export function wrap(text: string, size: number, max: number, bold = false): string[] {
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


export const money = (paise: number) =>
  `${paise < 0 ? '-' : ''}${(Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const displayDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};


// ── Drawing ─────────────────────────────────────────────────────────────────

/** A4 portrait, in points. */
export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const MARGIN = 40;

export class Page {
  readonly ops: string[] = [];
  constructor(readonly width = PAGE_W, readonly height = PAGE_H) {}
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

export function assemble(pages: Page[]): Buffer {
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
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Contents ${stream} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> >>`,
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
