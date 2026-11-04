/**
 * Tests — management report layouts, schedules and the report PDF (pure).
 *
 *  ✓ Months: shifting, ranges, the financial year a month is in
 *  ✓ P&L by month: income and expenses in the reader's signs, group subtotals, the profit
 *  ✓ Compared: change and percentage against the last period and last year
 *  ✓ Budget against actual; sales by party less notes, with shares; by item, unlinked lines apart
 *  ✓ Ageing by how overdue, from the due date or the document's; days to pay weighted by amount
 *  ✓ GST: output and reverse charge less input credit
 *  ✓ A schedule's next day, monthly and weekly; a relative period resolved on the day it runs
 *  ✓ CSV for a spreadsheet; PDF pages, landscape when wide
 */
import { AccountType } from '@ai-accounting/shared';
import { AccountMeta, ageingByParty, averageDays, bucketOf, budgetVsActual, byItem, byParty, comparison, fyMonths, gstSummary, monthsBetween, plMonthly, shiftMonth } from './management';
import { nextRun } from './report-schedules.service';
import { resolvePeriod } from './report-catalog.service';
import { toCsv } from './report-table';
import { renderReportPdf } from './report-pdf';

const acct = (id: string, name: string, type: AccountType, group: string | null = null, code = id): [string, AccountMeta] => [id, { id, name, code, type, group }];
const accounts = new Map([
  acct('sales', 'Sales Revenue', AccountType.INCOME, 'Revenue', '4100'),
  acct('purch', 'Purchases', AccountType.EXPENSE, 'Direct Expenses', '5100'),
  acct('rent', 'Rent', AccountType.EXPENSE, 'Indirect Expenses', '6100'),
  acct('bank', 'Bank Accounts', AccountType.ASSETS, 'Current Assets', '1100'),
]);

describe('months', () => {
  it('shifts, ranges and finds the financial year', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', 14)).toBe('2028-01');
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(fyMonths('2026-11')).toEqual({ fy: '2026-27', from: '2026-04', to: '2027-03' });
    expect(fyMonths('2027-02')).toEqual({ fy: '2026-27', from: '2026-04', to: '2027-03' });
  });
});

describe('profit and loss layouts', () => {
  it('lays out months with group subtotals and the profit', () => {
    const t = plMonthly(
      [
        { accountId: 'sales', month: '2026-10', net: -500000 }, { accountId: 'sales', month: '2026-11', net: -700000 },
        { accountId: 'purch', month: '2026-10', net: 300000 }, { accountId: 'rent', month: '2026-11', net: 50000 },
        { accountId: 'bank', month: '2026-10', net: 200000 },
      ],
      accounts,
      ['2026-10', '2026-11'],
    );
    expect(t.columns.map((c) => c.label)).toEqual(['Account', 'Oct 2026', 'Nov 2026', 'Total']);
    expect(t.rows.map((r) => r.cells)).toEqual([
      ['Income', null, null, null],
      ['Sales Revenue', 500000, 700000, 1200000],
      ['Total income', 500000, 700000, 1200000],
      ['Expenses', null, null, null],
      ['Purchases', 300000, 0, 300000],
      ['Total Direct Expenses', 300000, 0, 300000],
      ['Rent', 0, 50000, 50000],
      ['Total Indirect Expenses', 0, 50000, 50000],
      ['Total expenses', 300000, 50000, 350000],
      ['Net profit', 200000, 650000, 850000],
    ]);
    expect(t.rows[t.rows.length - 1].style).toBe('grand');
  });

  it('compares with the period before and the year before', () => {
    const t = comparison(
      { current: new Map([['sales', 120000], ['rent', 30000]]), previous: new Map([['sales', 100000], ['rent', 30000]]), lastYear: new Map([['sales', 0]]) },
      accounts,
      { current: 'Nov 2026', previous: 'Oct 2026', lastYear: 'Nov 2025' },
    );
    expect(t.rows.find((r) => r.cells[0] === 'Sales Revenue')!.cells).toEqual(['Sales Revenue', 120000, 100000, 20000, 20, 0, 120000, null]);
    expect(t.rows[t.rows.length - 1].cells).toEqual(['Net profit', 90000, 70000, 20000, 28.6, 0, 90000, null]);
  });

  it('sets the budget against the actual', () => {
    const t = budgetVsActual(new Map([['sales', 1000000], ['rent', 60000]]), new Map([['sales', 925000], ['rent', 75000], ['purch', 10000]]), accounts, '2026-27, Apr 2026 to Nov 2026');
    expect(t.rows.find((r) => r.cells[0] === 'Sales Revenue')!.cells).toEqual(['Sales Revenue', 1000000, 925000, -75000, 92.5]);
    expect(t.rows.find((r) => r.cells[0] === 'Purchases')!.cells).toEqual(['Purchases', 0, 10000, 10000, null]);
    expect(t.rows[t.rows.length - 1].cells).toEqual(['Net profit', 940000, 840000, -100000, 89.4]);
  });
});

describe('sales and purchases', () => {
  const doc = (partyId: string, partyName: string, taxablePaise: number, date = '2026-10-05') => ({ partyId, partyName, date, taxablePaise, gstPaise: Math.round(taxablePaise * 0.18) });
  it('nets each party’s notes and shows its share', () => {
    const t = byParty('sales', [doc('a', 'Asha Traders', 300000), doc('b', 'Bharat Stores', 100000), doc('a', 'Asha Traders', 100000)], [doc('a', 'Asha Traders', 100000)], 'Oct 2026');
    expect(t.rows.map((r) => r.cells)).toEqual([
      ['Asha Traders', 2, 400000, 100000, 300000, 54000, 75],
      ['Bharat Stores', 1, 100000, 0, 100000, 18000, 25],
      ['Total', 3, 500000, 100000, 400000, 72000, 100],
    ]);
  });

  it('groups lines by item, unlinked lines apart', () => {
    const t = byItem('sales', [
      { itemId: 'rice', name: 'Basmati Rice', uqc: 'BAG', qty: 10, amountPaise: 60000 },
      { itemId: 'rice', name: 'Basmati Rice', uqc: 'BAG', qty: 5, amountPaise: 30000 },
      { itemId: null, name: 'Delivery', uqc: null, qty: 1, amountPaise: 10000 },
    ], 'Oct 2026');
    expect(t.rows.map((r) => r.cells)).toEqual([
      ['Basmati Rice', 15, 'BAG', 90000, 6000, 90],
      ['Lines not linked to an item', null, null, 10000, null, 10],
      ['Total', null, null, 100000, null, 100],
    ]);
  });
});

describe('receivables', () => {
  it('buckets by days overdue and weighs days to pay by amount', () => {
    expect(bucketOf('2026-11-04', '2026-10-05', '2026-11-04')).toBe(0);
    expect(bucketOf(null, '2026-10-05', '2026-11-04')).toBe(1);
    expect(bucketOf('2026-07-01', '2026-06-01', '2026-11-04')).toBe(4);
    expect(averageDays([{ partyId: 'a', paidOn: '2026-10-01', days: 10, amountPaise: 30000 }, { partyId: 'a', paidOn: '2026-10-02', days: 40, amountPaise: 10000 }])).toBe(18);

    const t = ageingByParty('receivables', [
      { partyId: 'a', partyName: 'Asha Traders', date: '2026-10-01', dueDate: '2026-10-15', owedPaise: 50000 },
      { partyId: 'a', partyName: 'Asha Traders', date: '2026-11-01', dueDate: '2026-11-30', owedPaise: 20000 },
      { partyId: 'b', partyName: 'Bharat Stores', date: '2026-06-01', dueDate: '2026-07-01', owedPaise: 10000 },
    ], [{ partyId: 'a', paidOn: '2026-09-20', days: 30, amountPaise: 40000 }], '2026-11-04');
    expect(t.rows.map((r) => r.cells)).toEqual([
      ['Asha Traders', 20000, 50000, 0, 0, 0, 70000, 30],
      ['Bharat Stores', 0, 0, 0, 0, 10000, 10000, null],
      ['Total', 20000, 50000, 0, 0, 10000, 80000, 30],
    ]);
  });
});

describe('GST summary', () => {
  it('adds reverse charge to output and takes off input credit', () => {
    const t = gstSummary([{ month: '2026-10', outputPaise: 90000, rcmPaise: 5000, inputPaise: 40000 }], ['2026-10', '2026-11']);
    expect(t.rows.map((r) => r.cells)).toEqual([['Oct 2026', 90000, 5000, 40000, 55000], ['Nov 2026', 0, 0, 0, 0], ['Total', 90000, 5000, 40000, 55000]]);
  });
});

describe('schedules', () => {
  it('finds the next day, monthly and weekly', () => {
    expect(nextRun('monthly', 2, '2026-11-01')).toBe('2026-11-02');
    expect(nextRun('monthly', 2, '2026-11-02')).toBe('2026-12-02');
    expect(nextRun('monthly', 2, '2026-12-15')).toBe('2027-01-02');
    // 2026-11-04 is a Wednesday: the next Monday is the 9th, the next Wednesday the 11th.
    expect(nextRun('weekly', 1, '2026-11-04')).toBe('2026-11-09');
    expect(nextRun('weekly', 3, '2026-11-04')).toBe('2026-11-11');
    expect(nextRun('weekly', 7, '2026-11-04')).toBe('2026-11-08');
  });

  it('resolves a period on the day it runs', () => {
    expect(resolvePeriod('last_month', '2026-11-02')).toMatchObject({ from: '2026-10', to: '2026-10', financialYear: '2026-27' });
    expect(resolvePeriod('last_month', '2026-04-02')).toMatchObject({ from: '2026-03', to: '2026-03', financialYear: '2025-26' });
    expect(resolvePeriod('last_quarter', '2026-11-02')).toMatchObject({ from: '2026-07', to: '2026-09' });
    expect(resolvePeriod('last_quarter', '2026-02-10')).toMatchObject({ from: '2025-10', to: '2025-12' });
    expect(resolvePeriod('this_fy', '2026-11-02')).toMatchObject({ from: '2026-04', to: '2026-11', financialYear: '2026-27' });
    expect(resolvePeriod('last_fy', '2026-11-02')).toMatchObject({ from: '2025-04', to: '2026-03', financialYear: '2025-26' });
  });
});

describe('rendering', () => {
  const wide = plMonthly([{ accountId: 'sales', month: '2026-10', net: -12345678 }], accounts, monthsBetween('2026-04', '2026-11'));

  it('writes CSV a spreadsheet reads as numbers', () => {
    const csv = toCsv(byParty('sales', [{ partyId: 'a', partyName: 'Rao, Sons & Co', date: '2026-10-01', taxablePaise: 123450, gstPaise: 0 }], [], 'Oct 2026'));
    expect(csv.split('\n')[3]).toBe('Customer,Invoices,Taxable value,Credit notes,Net sales,GST,Share %');
    expect(csv.split('\n')[4]).toBe('"Rao, Sons & Co",1,1234.50,0.00,1234.50,0.00,100');
  });

  it('draws a PDF, landscape when the table is wide', () => {
    const pdf = renderReportPdf(wide, { name: 'Saffron Foods', gstin: '27AAPFU0939F1ZV' }, '2026-11-04').toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/MediaBox [0 0 841.89 595.28]');
    expect(pdf).toContain('(Profit and loss by month) Tj');
    expect(pdf).toContain('(1,23,456.78) Tj');
    const narrow = renderReportPdf(gstSummary([], ['2026-10']), { name: 'Saffron Foods' }, '2026-11-04').toString('latin1');
    expect(narrow).toContain('/MediaBox [0 0 595.28 841.89]');
  });
});
