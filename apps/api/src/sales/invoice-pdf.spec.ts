/**
 * Unit tests — the invoice PDF.
 *
 *  ✓ Amounts in words, the Indian way (lakh, crore), with paise
 *  ✓ A well-formed PDF: every cross-reference offset lands on its object
 *  ✓ It carries what a tax invoice must: both GSTINs, number, date, place of supply, taxes, total
 *  ✓ Long invoices run onto more pages; drafts say so; brackets in text are escaped
 */
import { amountInWords, InvoicePdfData, renderInvoicePdf } from './invoice-pdf';

const base: InvoicePdfData = {
  seller: { name: 'Kumar Textiles', address: '12 MG Road, Pune 411001', gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F', stateCode: '27', phone: '020 5555 1234', email: 'accounts@kumar.example' },
  buyer: { name: 'Rao Traders (Pvt)', address: 'Bengaluru 560001', gstin: '29AAACR5055K1Z2', stateCode: '29' },
  number: 'INV/2026-27/0042',
  date: '2026-10-14',
  dueDate: '2026-11-13',
  lines: [{ description: 'Cotton fabric, 120 m', hsnSac: '5208', qty: 120, ratePaise: 25000, amountPaise: 3000000, taxRatePct: 5 }],
  amounts: { taxableValue: 3000000, cgst: 0, sgst: 0, igst: 150000, cess: 0, total: 3150000 },
  notes: null,
  footer: 'Pay to HDFC Bank A/c 50100000001234, IFSC HDFC0000001',
  draft: false,
};

const text = (pdf: Buffer) => pdf.toString('latin1');

describe('amountInWords', () => {
  it('says it the Indian way', () => {
    expect(amountInWords(3150000)).toBe('Rupees Thirty One Thousand Five Hundred Only');
    expect(amountInWords(11800050)).toBe('Rupees One Lakh Eighteen Thousand and Fifty Paise Only');
    expect(amountInWords(1234567899)).toBe('Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Ninety Nine Paise Only');
    expect(amountInWords(0)).toBe('Rupees Zero Only');
  });
});

describe('renderInvoicePdf', () => {
  it('writes a well-formed PDF', () => {
    const pdf = renderInvoicePdf(base);
    const s = text(pdf);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(s.match(/startxref\n(\d+)/)![1]);
    expect(s.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...s.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(s.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });

  it('carries what a tax invoice must', () => {
    const s = text(renderInvoicePdf(base));
    for (const shown of [
      'TAX INVOICE', 'Kumar Textiles', 'GSTIN 27AAPFU0939F1ZV', 'GSTIN 29AAACR5055K1Z2', 'INV/2026-27/0042', '14/10/2026',
      'Karnataka \\(29\\)', 'Reverse charge', '5208', 'IGST', 'Rs. 31,500.00', 'Rupees Thirty One Thousand Five Hundred Only',
      'Pay to HDFC Bank', 'For Kumar Textiles', 'Authorised signatory',
    ]) {
      expect(s).toContain(shown);
    }
    expect(s).toContain('Rao Traders \\(Pvt\\)');
    expect(s).not.toContain('DRAFT');
  });

  it('runs onto more pages, and marks a draft', () => {
    const many = { ...base, draft: true, lines: Array.from({ length: 60 }, (_, i) => ({ ...base.lines[0], description: `Item ${i + 1}` })) };
    const s = text(renderInvoicePdf(many));
    expect(s).toMatch(/\/Count [2-9]/);
    expect(s).toContain('Page 1 of');
    expect(s).toContain('DRAFT - not yet posted');
  });

  it('prints an unregistered seller as a plain invoice', () => {
    const s = text(renderInvoicePdf({ ...base, seller: { ...base.seller, gstin: null }, amounts: { ...base.amounts, igst: 0, total: 3000000 } }));
    expect(s).toContain('(INVOICE)');
    expect(s).toContain('Not registered under GST');
  });
});
