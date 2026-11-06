/**
 * Taxes: the GSTR-1 and GSTR-3B summaries, the HSN summary, the 2B match,
 * TDS deducted, payable, the 26Q statement and TDS receivable. The GST and
 * TDS figures are the very ones the GST and TDS pages compute, read
 * through their own services; nothing here files or posts.
 */
import { BadRequestException } from '@nestjs/common';
import { fyMonths, monthLabel, monthsBetween, shiftMonth } from '../management';
import { Cell, ReportDef, RunCtx, listTable, money, num, rangeDates, text } from './types';
import { DONE_BILL } from './documents';
import type { TaxHeads } from '../../gst/gst-returns';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const heads = (t: TaxHeads): Cell[] => [t.txval, t.iamt, t.camt, t.samt, t.csamt];
const TAX_COLUMNS = [money('taxable', 'Taxable value'), money('igst', 'IGST'), money('cgst', 'CGST'), money('sgst', 'SGST'), money('cess', 'Cess')];

/** The one month a return covers: `to` (or `from`); by default last month. */
export function monthOf(ctx: RunCtx): string {
  const m = ctx.p.to || ctx.p.from || shiftMonth(ctx.today.slice(0, 7), -1);
  if (!MONTH.test(m)) throw new BadRequestException('The month looks like 2026-10.');
  return m;
}

/** A financial year and quarter; by default the quarter last month fell in. */
export function quarterOf(ctx: RunCtx): { fy: string; quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4' } {
  const month = ctx.p.through || shiftMonth(ctx.today.slice(0, 7), -1);
  const fy = ctx.p.financialYear || fyMonths(month).fy;
  if (ctx.p.quarter) {
    if (!['Q1', 'Q2', 'Q3', 'Q4'].includes(ctx.p.quarter)) throw new BadRequestException('The quarter is Q1, Q2, Q3 or Q4.');
    return { fy, quarter: ctx.p.quarter as 'Q1' };
  }
  const m = Number(month.slice(5, 7));
  return { fy, quarter: m >= 4 && m <= 6 ? 'Q1' : m >= 7 && m <= 9 ? 'Q2' : m >= 10 ? 'Q3' : 'Q4' };
}

const gstReturns = (ctx: RunCtx) => ctx.data.service(async () => (await import('../../gst/gst-returns.service')).GstReturnsService, 'GST returns');
const tds = (ctx: RunCtx) => ctx.data.service(async () => (await import('../../tds/tds.service')).TdsService, 'TDS');

const gstr1Summary: ReportDef = {
  key: 'gstr1_summary', title: 'GSTR-1 summary', category: 'taxes', params: 'month', shape: 'list',
  description: 'Outward supplies for a month by GSTR-1 table: B2B, B2C large and small, exports, credit notes, nil-rated.',
  async run(ctx) {
    const period = monthOf(ctx);
    const r = await (await gstReturns(ctx)).gstr1(ctx.orgId, period);
    const rows: Cell[][] = r.summary.map((s) => [s.section, s.label, s.count, ...heads(s)]);
    return listTable({
      key: 'gstr1_summary', title: 'GSTR-1 summary', subtitle: `${monthLabel(period)}${r.gstin ? `, GSTIN ${r.gstin}` : ''}`,
      columns: [text('section', 'Table'), text('label', 'Supplies'), num('count', 'Documents'), ...TAX_COLUMNS], rows, sum: ['count', 'taxable', 'igst', 'cgst', 'sgst', 'cess'],
      notes: ['The same figures as the GSTR-1 page, from posted invoices and credit notes.', ...r.issues.map((i) => `${i.level === 'block' ? 'Fix before filing' : 'Note'}: ${i.message}`)],
    });
  },
};

const gstr3bSummary: ReportDef = {
  key: 'gstr3b_summary', title: 'GSTR-3B summary', category: 'taxes', params: 'month', shape: 'statement',
  description: 'Tax on outward supplies, reverse charge, input tax credit, and what is paid from credit and in cash, for a month.',
  async run(ctx) {
    const period = monthOf(ctx);
    const r = await (await gstReturns(ctx)).gstr3b(ctx.orgId, period);
    const line = (section: string, label: string, t: TaxHeads, style?: 'total') => ({ cells: [section, label, ...heads(t)], style });
    const byHead = (k: 'cashPaise' | 'liabilityPaise' | 'reverseChargePaise') => {
      const v = (h: string) => r.setOff.rows.find((x) => x.head === h)?.[k] ?? 0;
      return { txval: 0, iamt: v('igst'), camt: v('cgst'), samt: v('sgst'), csamt: v('cess') };
    };
    const credit = (() => {
      const v = (h: string) => { const row = r.setOff.rows.find((x) => x.head === h); return row ? Object.values(row.fromCredit).reduce((s, n) => s + n, 0) : 0; };
      return { txval: 0, iamt: v('igst'), camt: v('cgst'), samt: v('sgst'), csamt: v('cess') };
    })();
    const left = { txval: 0, iamt: r.setOff.creditLeft.igst, camt: r.setOff.creditLeft.cgst, samt: r.setOff.creditLeft.sgst, csamt: r.setOff.creditLeft.cess };
    return {
      key: 'gstr3b_summary', title: 'GSTR-3B summary', subtitle: `${monthLabel(period)}${r.gstin ? `, GSTIN ${r.gstin}` : ''}`,
      columns: [text('section', 'Table'), text('label', 'Particulars'), ...TAX_COLUMNS],
      rows: [
        { cells: ['3.1', 'Outward supplies and inward supplies liable to reverse charge', null, null, null, null, null], style: 'group' as const },
        line('3.1(a)', 'Outward taxable supplies', r.outwardTaxable),
        line('3.1(b)', 'Zero-rated supplies (exports)', r.outwardZeroRated),
        line('3.1(c)', 'Nil-rated and exempted supplies', r.outwardNil),
        line('3.1(d)', 'Inward supplies liable to reverse charge', r.inwardReverseCharge),
        { cells: ['4', 'Eligible input tax credit', null, null, null, null, null], style: 'group' as const },
        line('4(A)(3)', 'On inward supplies liable to reverse charge', r.itcReverseCharge),
        line('4(A)(5)', 'All other ITC', r.itcOther),
        line('4(B)(2)', 'ITC reversed (rule 37)', r.itcReversed),
        line('4(C)', 'Net ITC available', r.itcNet, 'total'),
        { cells: ['6.1', 'Payment of tax', null, null, null, null, null], style: 'group' as const },
        line('', 'Tax on outward supplies', byHead('liabilityPaise')),
        line('', 'Reverse-charge tax (cash only)', byHead('reverseChargePaise')),
        line('', 'Paid from input tax credit', credit),
        line('', 'Paid in cash', byHead('cashPaise'), 'total'),
        line('', 'Credit carried forward', left),
      ],
      notes: [
        r.itcBasis === 'twoB' ? 'Input tax credit is what this month’s GSTR-2B carries.' : 'No GSTR-2B imported for the month: credit is taken from every posted bill by its date.',
        `Cash to pay: ${(r.setOff.cashTotalPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })} rupees.`,
        ...r.issues.map((i) => `${i.level === 'block' ? 'Fix before filing' : 'Note'}: ${i.message}`),
      ],
    };
  },
};

const hsnSummary: ReportDef = {
  key: 'hsn_summary', title: 'HSN summary', category: 'taxes', params: 'range', shape: 'list',
  description: 'Outward supplies by HSN or SAC code, unit and rate, as GSTR-1 table 12 reports them (B2B and B2C apart).',
  async run(ctx) {
    const r = rangeDates(ctx);
    const months = monthsBetween(r.from, r.to);
    if (months.length > 12) throw new BadRequestException('The HSN summary covers twelve months at most.');
    const svc = await gstReturns(ctx);
    const by = new Map<string, Cell[]>();
    for (const m of months) {
      const g = await svc.gstr1(ctx.orgId, m);
      for (const [table, list] of [['B2B', g.hsn.b2b], ['B2C', g.hsn.b2c]] as const) {
        for (const h of list) {
          const k = `${table}|${h.hsn}|${h.uqc}|${h.rate}`;
          const x = by.get(k) ?? by.set(k, [table, h.hsn, h.description, h.uqc, h.rate, 0, 0, 0, 0, 0, 0, 0]).get(k)!;
          (x[5] as number) += h.qty;
          x[5] = Math.round((x[5] as number) * 1000) / 1000;
          x[6] = (x[6] as number) + h.txval; x[7] = (x[7] as number) + h.iamt; x[8] = (x[8] as number) + h.camt; x[9] = (x[9] as number) + h.samt; x[10] = (x[10] as number) + h.csamt;
          x[11] = (x[11] as number) + h.iamt + h.camt + h.samt + h.csamt;
        }
      }
    }
    const rows = [...by.values()].sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));
    const columns = [text('table', 'Table 12'), text('hsn', 'HSN / SAC'), text('description', 'Description'), text('uqc', 'Unit'), num('rate', 'Rate %'), num('qty', 'Quantity'), ...TAX_COLUMNS, money('tax', 'Total tax')];
    return listTable({ key: 'hsn_summary', title: 'HSN summary', subtitle: r.label, columns, rows, sum: ['qty', 'taxable', 'igst', 'cgst', 'sgst', 'cess', 'tax'], notes: ['Month by month as GSTR-1 builds it, added up over the period.'] });
  },
};

const itcRecon: ReportDef = {
  key: 'itc_reconciliation', title: 'ITC reconciliation (GSTR-2B)', category: 'taxes', params: 'month', shape: 'list',
  description: 'For a month: credit in the books against what GSTR-2B shows, matched, missing and mismatched.',
  async run(ctx) {
    const period = monthOf(ctx);
    const lines = await ctx.data.gstr2b.find({ orgId: ctx.orgId, period }, { reconStatus: 1, taxableValuePaise: 1, itcEligiblePaise: 1 }).lean().exec();
    const LABEL: Record<string, string> = { matched: 'Matched with a bill', missing_in_books: 'In 2B, not in the books', mismatched: 'Amounts or GSTIN differ', pending: 'Not yet matched', missing_in_2b: 'In the books, not in 2B' };
    const by = new Map<string, number[]>();
    for (const l of lines) { const x = by.get(l.reconStatus) ?? by.set(l.reconStatus, [0, 0, 0]).get(l.reconStatus)!; x[0]++; x[1] += l.taxableValuePaise; x[2] += l.itcEligiblePaise; }
    const rows: Cell[][] = ['matched', 'mismatched', 'missing_in_books', 'pending'].filter((k) => by.has(k)).map((k) => [LABEL[k], ...by.get(k)!]);
    // Bills of the month whose credit no 2B line confirms.
    const bills = await ctx.data.bills.find({ orgId: ctx.orgId, status: { $in: DONE_BILL }, isOpeningBalance: { $ne: true }, billDate: { $gte: `${period}-01`, $lte: `${period}-31` } }, { amountsPaise: 1, isReverseCharge: 1 }).lean().exec();
    const matchedBills = new Set((await ctx.data.gstr2b.find({ orgId: ctx.orgId, matchedBillId: { $ne: null } }, { matchedBillId: 1 }).lean().exec()).map((l) => String(l.matchedBillId)));
    const missing = bills.filter((b) => !matchedBills.has(String(b._id)) && b.amountsPaise.cgst + b.amountsPaise.sgst + b.amountsPaise.igst + b.amountsPaise.cess > 0);
    if (missing.length) rows.push([LABEL.missing_in_2b, missing.length, missing.reduce((s, b) => s + b.amountsPaise.taxableValue, 0), missing.reduce((s, b) => s + b.amountsPaise.cgst + b.amountsPaise.sgst + b.amountsPaise.igst + b.amountsPaise.cess, 0)]);
    const columns = [text('status', 'Status'), num('count', 'Documents'), money('taxable', 'Taxable value'), money('itc', 'Input tax credit')];
    return {
      key: 'itc_reconciliation', title: 'ITC reconciliation (GSTR-2B)', subtitle: monthLabel(period), columns,
      rows: rows.map((cells) => ({ cells })),
      notes: [lines.length ? 'GSTR-2B lines as last matched on the GST page; run the match there again after importing a new 2B.' : 'No GSTR-2B imported for this month yet: import it on the GST page.', 'Credit is claimable only on what 2B carries.'],
    };
  },
};

const tdsDeducted: ReportDef = {
  key: 'tds_deducted', title: 'TDS deducted', category: 'taxes', params: 'range', shape: 'list', filters: [{ key: 'vendorId', label: 'Vendor', kind: 'vendor' }],
  description: 'TDS deducted on vendor bills in the period, by section and rate, and the challan it went out on.',
  async run(ctx) {
    const r = rangeDates(ctx);
    const bills = await ctx.data.bills.find({ orgId: ctx.orgId, status: { $in: DONE_BILL }, 'tds.amountPaise': { $gt: 0 }, billDate: { $gte: r.fromDate, $lte: r.toDate }, ...(ctx.p.vendorId ? { vendorId: ctx.p.vendorId } : {}) }).sort({ billDate: 1 }).lean().exec();
    const vendors = await ctx.data.vendors.find({ orgId: ctx.orgId, _id: { $in: bills.map((b) => b.vendorId) } }, { name: 1, pan: 1 }).lean().exec();
    const deposits = await ctx.data.tdsDeposits.find({ orgId: ctx.orgId, _id: { $in: bills.map((b) => b.tds?.depositId).filter(Boolean) } }, { challanNumber: 1, paidOn: 1 }).lean().exec();
    const v = new Map(vendors.map((x) => [String(x._id), x]));
    const d = new Map(deposits.map((x) => [String(x._id), x]));
    const rows: Cell[][] = bills.map((b) => {
      const dep = b.tds?.depositId ? d.get(String(b.tds.depositId)) : undefined;
      return [b.billDate, b.billNumber ?? '', v.get(String(b.vendorId))?.name ?? 'Unknown vendor', v.get(String(b.vendorId))?.pan ?? '', b.tds!.section, b.tds!.rateBps / 100, b.amountsPaise.taxableValue, b.tds!.amountPaise, dep ? `${dep.challanNumber} (${dep.paidOn})` : 'Not yet deposited'];
    });
    const columns = [text('date', 'Bill date'), text('bill', 'Bill'), text('vendor', 'Vendor'), text('pan', 'PAN'), text('section', 'Section'), num('rate', 'Rate %'), money('taxable', 'Amount paid or credited'), money('tds', 'TDS'), text('challan', 'Challan')];
    return listTable({ key: 'tds_deducted', title: 'TDS deducted', subtitle: r.label, columns, rows, sum: ['taxable', 'tds'], notes: ['TDS on posted bills by the bill date, the day it was credited.'] });
  },
};

const tdsPayable: ReportDef = {
  key: 'tds_payable', title: 'TDS payable', category: 'taxes', params: 'year', shape: 'list',
  description: 'Each month’s TDS by section: deducted, deposited, still to deposit, and the due date.',
  async run(ctx) {
    const fy = ctx.p.financialYear || fyMonths(ctx.today.slice(0, 7)).fy;
    const { months } = await (await tds(ctx)).payable(ctx.orgId, fy);
    const rows: Cell[][] = months.map((m) => [monthLabel(m.month), m.section, m.sectionLabel, m.dueDate, m.overdue ? 'Overdue' : m.pendingPaise ? 'Due' : 'Deposited', m.deductedPaise, m.depositedPaise, m.pendingPaise]);
    const columns = [text('month', 'Month'), text('section', 'Section'), text('label', 'Nature of payment'), text('due', 'Deposit by'), text('state', 'Status'), money('deducted', 'Deducted'), money('deposited', 'Deposited'), money('pending', 'To deposit')];
    return listTable({ key: 'tds_payable', title: 'TDS payable', subtitle: `Financial year ${fy}`, columns, rows, sum: ['deducted', 'deposited', 'pending'], notes: ['The same figures as the TDS page. Pending past its due date runs interest at 1.5% a month.'] });
  },
};

const form26q: ReportDef = {
  key: 'form_26q_summary', title: 'Form 26Q summary', category: 'taxes', params: 'quarter', shape: 'list',
  description: 'The quarter’s TDS statement by vendor and section: amount paid, TDS, and what is deposited.',
  async run(ctx) {
    const { fy, quarter } = quarterOf(ctx);
    const r = await (await tds(ctx)).form26q(ctx.orgId, fy, quarter, ctx.today);
    const rows: Cell[][] = r.certificates.map((c) => [c.name, c.pan, c.section, c.amountPaise, c.tdsPaise, c.depositedPaise]);
    const columns = [text('vendor', 'Deductee'), text('pan', 'PAN'), text('section', 'Section'), money('amount', 'Amount paid or credited'), money('tds', 'TDS'), money('deposited', 'Deposited')];
    return listTable({
      key: 'form_26q_summary', title: 'Form 26Q summary', subtitle: `${quarter} of ${fy}, due ${r.dueDate}`, columns, rows, sum: ['amount', 'tds', 'deposited'],
      notes: [r.ready ? 'Ready to file.' : 'Not ready to file yet: see below.', ...r.issues.map((i) => `${i.level === 'block' ? 'Fix before filing' : 'Note'}: ${i.message}`)],
    });
  },
};

const tdsReceivable: ReportDef = {
  key: 'tds_receivable', title: 'TDS receivable', category: 'taxes', params: 'year', shape: 'list',
  description: 'TDS customers deducted from their payments this year: what to match against Form 26AS.',
  async run(ctx) {
    const fy = ctx.p.financialYear || fyMonths(ctx.today.slice(0, 7)).fy;
    const list = await (await tds(ctx)).receivable(ctx.orgId, fy);
    const rows: Cell[][] = list.map((x) => [x.paidOn, x.invoiceNumber ?? '', x.customerName, x.receivedPaise, x.tdsPaise]);
    const columns = [text('date', 'Received on'), text('invoice', 'Invoice'), text('customer', 'Customer'), money('received', 'Received'), money('tds', 'TDS deducted')];
    return listTable({ key: 'tds_receivable', title: 'TDS receivable', subtitle: `Financial year ${fy}`, columns, rows, sum: ['received', 'tds'], notes: ['Claim it in the income-tax return once it shows in Form 26AS.'] });
  },
};

export const TAX_REPORTS: ReportDef[] = [gstr1Summary, gstr3bSummary, hsnSummary, itcRecon, tdsDeducted, tdsPayable, form26q, tdsReceivable];
