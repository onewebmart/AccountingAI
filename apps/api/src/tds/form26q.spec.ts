/**
 * Unit tests — Form 26Q and the Form 16A summary.
 *
 *  ✓ Quarters, deposit and filing due dates
 *  ✓ Interest on late deposit: 1.5% a month or part of one
 *  ✓ The checks: TAN, PAN (and the 20% rule), undeposited TDS, challans that do not add up, late fee
 *  ✓ Each vendor's certificate summary, and the CSV for the RPU
 */
import { TdsPayableRow } from './tds.service';
import { DepositRow, build26q, depositDueDate, filingDueDate, form26qCsv, lateDepositInterest, quarterMonths } from './form26q';

const row = (over: Partial<TdsPayableRow> = {}): TdsPayableRow => ({
  billId: 'b1', billNumber: 'RENT-OCT', billDate: '2026-10-01', vendorName: 'Mehta Estates', pan: 'AAAPM1234C',
  section: '194I', rateBps: 1000, taxablePaise: 5000000, tdsPaise: 500000, depositId: 'd1', ...over,
});
const deposit = (over: Partial<DepositRow> = {}): DepositRow => ({ id: 'd1', month: '2026-10', section: '194I', amountPaise: 500000, paidOn: '2026-11-05', challanNumber: '0510308 05112026 00042', ...over });
const base = { financialYear: '2026-27', quarter: 'Q3' as const, deductor: { name: 'Kumar Textiles', tan: 'MUMK12345A', pan: 'AAPFU0939F' }, today: '2027-01-10' };

describe('dates', () => {
  it('knows the quarters and their due dates', () => {
    expect(quarterMonths('2026-27', 'Q1')).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(quarterMonths('2026-27', 'Q4')).toEqual(['2027-01', '2027-02', '2027-03']);
    expect(filingDueDate('2026-27', 'Q3')).toBe('2027-01-31');
    expect(filingDueDate('2026-27', 'Q4')).toBe('2027-05-31');
    expect(depositDueDate('2026-10')).toBe('2026-11-07');
    expect(depositDueDate('2026-12')).toBe('2027-01-07');
    expect(depositDueDate('2027-03')).toBe('2027-04-30');
  });

  it('charges 1.5% for each month or part of one', () => {
    // Deducted 1 October, deposited 10 November: two months or part.
    expect(lateDepositInterest(500000, '2026-10-01', '2026-11-10')).toBe(15000);
    // Deducted 20 October, deposited 10 November: under a month, so one.
    expect(lateDepositInterest(100000, '2026-10-20', '2026-11-10')).toBe(1500);
  });
});

describe('the statement', () => {
  it('is ready when everything is deposited, with each vendor summarised', () => {
    const r = build26q({ ...base, rows: [row(), row({ billId: 'b2', billNumber: 'RENT-NOV', billDate: '2026-11-01', depositId: 'd2' })], deposits: [deposit(), deposit({ id: 'd2', month: '2026-11', paidOn: '2026-12-04' })] });
    expect(r.ready).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.totals).toMatchObject({ amountPaise: 10000000, tdsPaise: 1000000, depositedPaise: 1000000, interestPaise: 0 });
    expect(r.certificates).toEqual([{ name: 'Mehta Estates', pan: 'AAAPM1234C', section: '194I', amountPaise: 10000000, tdsPaise: 1000000, depositedPaise: 1000000 }]);
  });

  it('names what is wrong', () => {
    const r = build26q({
      ...base,
      deductor: { ...base.deductor, tan: null },
      rows: [row({ pan: null, rateBps: 200, taxablePaise: 1000000, tdsPaise: 20000, section: '194C', depositId: null }), row({ depositId: 'd1' })],
      deposits: [deposit({ paidOn: '2026-11-20', amountPaise: 600000 })],
      today: '2027-02-10',
    });
    const text = r.issues.map((i) => `${i.level}: ${i.message}`).join('\n');
    expect(r.ready).toBe(false);
    expect(text).toMatch(/block: Your TAN is missing/);
    expect(text).toMatch(/no valid PAN.*₹1,800.00 more should have been deducted/);
    expect(text).toMatch(/block: TDS of ₹200.00 .* is not deposited/);
    expect(text).toMatch(/Challan .* of ₹6,000.00 pays ₹5,000.00/);
    expect(text).toMatch(/interest of about ₹150.00/);
    expect(text).toMatch(/late fee of ₹200 a day/);
    expect(r.deductees[0]).toMatchObject({ pan: 'PANNOTAVBL', remark: '' });
  });

  it('writes the deductee rows as CSV', () => {
    const csv = form26qCsv(build26q({ ...base, rows: [row({ vendorName: 'Mehta, Estates' })], deposits: [deposit()] }));
    const [header, line] = csv.trim().split('\r\n');
    expect(header).toMatch(/^Deductee PAN,Deductee name,Section/);
    expect(line).toBe('AAAPM1234C,"Mehta, Estates",194I,01/10/2026,50000.00,10.00,5000.00,01/10/2026,0510308 05112026 00042,05/11/2026,');
  });
});
