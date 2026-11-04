/**
 * Unit tests — depreciation, the assistant's rules, and schedule shares.
 *
 *  ✓ SLM by the day; WDV by the year at the rate that reaches residual over the life
 *  ✓ Never below residual; opening depreciation carried in; nothing before put to use
 *  ✓ Income Tax blocks: half rate for additions under 180 days, proceeds off the block
 *  ✓ Assistant: a missing regular bill, a year's cost in one month, an asset in expenses
 *  ✓ A prepaid's months add back to the whole, to the paise
 */
import { AssetForDep, depreciationTo, taxBlocks, wdvRate } from './depreciation';
import { BillFact, annualCosts, capitalCandidates, missingRecurringBills } from './assistant';
import { prepaidShares, schedulePeriods } from './schedules.service';
import { lastClosedPeriod } from './month-end-sweep.service';

const laptop = (over: Partial<AssetForDep> = {}): AssetForDep => ({
  costPaise: 12000000, residualPaise: 600000, putToUse: '2026-04-01', method: 'SLM', lifeYears: 3, openingAccumulatedPaise: 0, openingAsOf: null, ...over,
});

describe('depreciation', () => {
  it('runs straight line by the day', () => {
    // (₹1,20,000 − ₹6,000) ÷ 3 = ₹38,000 a year; 30 days of April.
    expect(depreciationTo(laptop(), '2026-04-30')).toBe(Math.round((11400000 / 3) * (30 / 365)));
    // 2027-28 has 29 February: still one year's charge.
    expect(depreciationTo(laptop(), '2028-03-31')).toBe(7600000);
    expect(depreciationTo(laptop(), '2027-03-31')).toBe(3800000);
    expect(depreciationTo(laptop(), '2026-03-31')).toBe(0);
  });

  it('stops at residual value', () => {
    expect(depreciationTo(laptop(), '2035-01-01')).toBe(11400000);
  });

  it('writes down value by the year at the rate that reaches residual', () => {
    const rate = wdvRate(12000000, 600000, 3);
    expect(rate).toBeCloseTo(0.6316, 4);
    const a = laptop({ method: 'WDV' });
    const year1 = Math.round(12000000 * rate);
    expect(depreciationTo(a, '2027-03-31')).toBe(year1);
    // Year two on what was left.
    expect(depreciationTo(a, '2028-03-31')).toBe(Math.round(12000000 * rate + (12000000 - 12000000 * rate) * rate));
    // Over the full life it comes to cost less residual.
    expect(depreciationTo(a, '2029-03-31')).toBe(11400000);
  });

  it('carries opening depreciation in, and goes on from its date', () => {
    const a = laptop({ openingAccumulatedPaise: 3800000, openingAsOf: '2027-03-31', putToUse: '2026-04-01' });
    expect(depreciationTo(a, '2027-03-31')).toBe(3800000);
    expect(depreciationTo(a, '2028-03-31')).toBe(7600000);
  });

  it('works out tax depreciation by block', () => {
    const blocks = taxBlocks(
      [
        { id: '1', name: 'Laptop', category: 'computers', costPaise: 10000000, putToUse: '2026-05-01', disposedOn: null, proceedsPaise: 0 },
        { id: '2', name: 'Server', category: 'servers', costPaise: 10000000, putToUse: '2027-01-15', disposedOn: null, proceedsPaise: 0 },
        { id: '3', name: 'Chair', category: 'furniture', costPaise: 5000000, putToUse: '2026-06-01', disposedOn: '2026-12-01', proceedsPaise: 2000000 },
      ],
      '2026-27',
    );
    const computers = blocks.find((b) => b.block.startsWith('Computers'))!;
    // Laptop a full year at 40%; server under 180 days at 20%.
    expect(computers).toMatchObject({ additionsPaise: 20000000, depreciationPaise: 4000000 + 2000000, closingPaise: 14000000 });
    const furniture = blocks.find((b) => b.block.startsWith('Furniture'))!;
    expect(furniture).toMatchObject({ disposalsPaise: 2000000, depreciationPaise: 300000 });
  });
});

describe('the assistant', () => {
  const bill = (over: Partial<BillFact>): BillFact => ({
    billId: 'b', vendorId: 'v1', vendorName: 'Mehta Estates', number: 'R', date: '2026-08-01', taxablePaise: 5000000,
    accountId: 'rent', accountName: 'Rent', accountType: 'EXPENSE', lines: [], isReverseCharge: false, ...over,
  });

  it('accrues a regular bill that has not come this month', () => {
    const bills = [bill({ date: '2026-08-01' }), bill({ date: '2026-09-01', taxablePaise: 5100000 }), bill({ date: '2026-10-01', taxablePaise: 4900000 })];
    const [c] = missingRecurringBills('2026-11', bills);
    expect(c).toMatchObject({ vendorName: 'Mehta Estates', amountPaise: 5000000, accountId: 'rent' });
    expect(c.reason).toMatch(/billed in each of 2026-08, 2026-09, 2026-10/);
    // Billed this month already, or irregular: nothing.
    expect(missingRecurringBills('2026-11', [...bills, bill({ date: '2026-11-02' })])).toEqual([]);
    expect(missingRecurringBills('2026-11', [bill({ date: '2026-08-01' }), bill({ date: '2026-09-01', taxablePaise: 9000000 }), bill({ date: '2026-10-01' })])).toEqual([]);
  });

  it('finds a year paid in one month, and an asset sitting in expenses', () => {
    const insurance = bill({ billId: 'ins', date: '2026-11-05', vendorName: 'ICICI Lombard', taxablePaise: 3600000, lines: [{ description: 'Office insurance, annual premium', hsnSac: '997133', amountPaise: 3600000 }] });
    expect(annualCosts('2026-11', [insurance])[0]).toMatchObject({ billId: 'ins', amountPaise: 3600000 });
    expect(annualCosts('2026-11', [{ ...insurance, taxablePaise: 500000 }])).toEqual([]);

    const laptopBill = bill({ billId: 'lap', date: '2026-11-08', vendorName: 'Infotech', accountName: 'Office & Stationery', lines: [{ description: 'Dell laptop', hsnSac: '84713010', amountPaise: 7500000 }, { description: 'Mouse', hsnSac: '847160', amountPaise: 50000 }] });
    expect(capitalCandidates('2026-11', [laptopBill]).map((c) => [c.description, c.category])).toEqual([['Dell laptop', 'computers']]);
    expect(capitalCandidates('2026-11', [{ ...laptopBill, accountType: 'ASSETS' }])).toEqual([]);
  });
});

describe('schedules', () => {
  it('spreads to the paise, month by month', () => {
    expect(prepaidShares(1000001, 3)).toEqual([333334, 333334, 333333]);
    expect(schedulePeriods({ startPeriod: '2026-11', months: 3 })).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('knows which month has ended', () => {
    expect(lastClosedPeriod('2026-11-30')).toBe('2026-11');
    expect(lastClosedPeriod('2026-11-29')).toBe('2026-10');
    expect(lastClosedPeriod('2027-01-05')).toBe('2026-12');
  });
});
