import { Gstr1, Gstr3b, TaxHeads } from './gst-returns';

/**
 * A second look before a return is filed: this month against the months
 * before it, and the things that usually mean something was left out or
 * counted twice. Rules; every figure is computed here. Advice only: it
 * stops nothing.
 */

export interface ReviewFlag {
  level: 'look' | 'note';
  message: string;
}

const gst = (h: TaxHeads) => h.iamt + h.camt + h.samt + h.csamt;
const rs = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** How far a number is from its usual, in words, when it is far enough to look at. */
function swing(label: string, now: number, before: number[], threshold = 0.5): ReviewFlag | null {
  const usual = avg(before.filter((x) => x > 0));
  if (before.length < 2 || usual <= 0) return null;
  if (now === 0) return { level: 'look', message: `${label} is nil this month, against ${rs(usual)} on average over the last ${before.length} months. Check nothing is missing.` };
  const change = (now - usual) / usual;
  if (Math.abs(change) < threshold) return null;
  return {
    level: 'look',
    message: `${label} is ${rs(now)}, ${Math.round(Math.abs(change) * 100)}% ${change > 0 ? 'above' : 'below'} your average of ${rs(usual)} over the last ${before.length} months. Check nothing is ${change > 0 ? 'counted twice' : 'missing'}.`,
  };
}

export function reviewGstr3b(current: Gstr3b, history: Gstr3b[]): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  const out = (r: Gstr3b) => r.outwardTaxable.txval;
  const tax = (r: Gstr3b) => gst(r.outwardTaxable);
  const itc = (r: Gstr3b) => gst(r.itcNet);
  for (const f of [
    swing('Taxable sales', out(current), history.map(out)),
    swing('Input tax credit', itc(current), history.map(itc)),
    swing('Tax paid in cash', current.setOff.cashTotalPaise, history.map((r) => r.setOff.cashTotalPaise), 1),
  ]) if (f) flags.push(f);

  // Credit far above what the business usually takes against its output tax.
  const ratios = history.filter((r) => tax(r) > 0).map((r) => itc(r) / tax(r));
  if (tax(current) > 0 && ratios.length >= 2) {
    const now = itc(current) / tax(current);
    const usual = avg(ratios);
    if (now > 0.8 && now > usual + 0.25) {
      flags.push({ level: 'look', message: `Credit is ${Math.round(now * 100)}% of your output tax this month, against ${Math.round(usual * 100)}% usually. A large purchase explains it; a bill booked twice also would.` });
    }
  }
  if (current.itcBasis === 'date') flags.push({ level: 'look', message: 'Credit is taken on every bill of the month: no GSTR-2B was imported. Import it so only what vendors reported is claimed.' });
  if (gst(current.itcReversed) > 0) flags.push({ level: 'note', message: `${rs(gst(current.itcReversed))} of credit is reversed under rule 37 (unpaid bills). Interest at 18% a year may be due on it.` });
  const left = current.setOff.creditLeft;
  const leftTotal = left.igst + left.cgst + left.sgst + left.cess;
  if (leftTotal > 0) flags.push({ level: 'note', message: `${rs(leftTotal)} of credit is left after the set-off and carries to next month.` });
  return flags;
}

export function reviewGstr1(current: Gstr1, history: Gstr1[]): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  const value = (r: Gstr1) => r.summary.reduce((s, row) => s + row.txval, 0);
  const count = (r: Gstr1) => r.summary.reduce((s, row) => s + row.count, 0);
  const v = swing('Outward supplies', value(current), history.map(value));
  if (v) flags.push(v);
  const c = swing('The number of documents', count(current), history.map(count), 0.6);
  if (c) flags.push({ ...c, message: c.message.replace(/₹/g, '') });
  for (const i of current.issues.filter((x) => x.level !== 'block')) flags.push({ level: 'note', message: i.message });
  return flags;
}
