/**
 * "1,25,000.50" → 12500050. Rupees typed into a form become integer paise
 * here, once, by string arithmetic rather than floating point. Accepts Indian
 * digit grouping and a minus sign (an advance); blank is zero; null when it is
 * not an amount. (lib/gst's rupeesToPaise takes neither commas nor minus.)
 */
export function parseRupees(text: string): number | null {
  const s = text.replace(/[,\s₹]/g, '');
  if (s === '') return 0;
  const m = s.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const paise = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -paise : paise;
}
