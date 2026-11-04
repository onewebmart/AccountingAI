/**
 * Depreciation, as a function of time. Pure.
 *
 * Books: Schedule II of the Companies Act, straight line (SLM) or written
 * down value (WDV), pro rata by day from the date an asset is put to use,
 * never below its residual value. Because the depreciation to any date is
 * computed afresh, a run books the difference between what is due and what
 * is already booked: runs can be monthly, yearly or skipped, and add up.
 *
 * Tax: the Income Tax Act's block-of-assets rates, a separate report; the
 * books are not touched by it.
 */

export type AssetCategory = 'computers' | 'servers' | 'office_equipment' | 'furniture' | 'plant' | 'vehicles' | 'buildings' | 'software' | 'other';

/** Useful lives (Schedule II, Part C) and Income Tax block rates, by category. */
export const CATEGORIES: Record<AssetCategory, { label: string; lifeYears: number; itRatePct: number; itBlock: string }> = {
  computers: { label: 'Computers and laptops', lifeYears: 3, itRatePct: 40, itBlock: 'Computers and software (40%)' },
  servers: { label: 'Servers and networks', lifeYears: 6, itRatePct: 40, itBlock: 'Computers and software (40%)' },
  office_equipment: { label: 'Office equipment', lifeYears: 5, itRatePct: 15, itBlock: 'Plant and machinery (15%)' },
  furniture: { label: 'Furniture and fittings', lifeYears: 10, itRatePct: 10, itBlock: 'Furniture and fittings (10%)' },
  plant: { label: 'Plant and machinery', lifeYears: 15, itRatePct: 15, itBlock: 'Plant and machinery (15%)' },
  vehicles: { label: 'Motor vehicles', lifeYears: 8, itRatePct: 15, itBlock: 'Motor vehicles (15%)' },
  buildings: { label: 'Buildings', lifeYears: 30, itRatePct: 10, itBlock: 'Buildings (10%)' },
  software: { label: 'Software', lifeYears: 3, itRatePct: 40, itBlock: 'Computers and software (40%)' },
  other: { label: 'Other', lifeYears: 5, itRatePct: 15, itBlock: 'Plant and machinery (15%)' },
};

/** HSN chapters of things usually bought to keep, not to use up, with their category. */
export const ASSET_HSN: Array<{ prefix: string; category: AssetCategory }> = [
  { prefix: '8471', category: 'computers' },
  { prefix: '8443', category: 'office_equipment' },
  { prefix: '8517', category: 'office_equipment' },
  { prefix: '8528', category: 'office_equipment' },
  { prefix: '8415', category: 'office_equipment' },
  { prefix: '8418', category: 'office_equipment' },
  { prefix: '9401', category: 'furniture' },
  { prefix: '9403', category: 'furniture' },
  { prefix: '8703', category: 'vehicles' },
  { prefix: '8711', category: 'vehicles' },
  { prefix: '8704', category: 'vehicles' },
];

export interface AssetForDep {
  costPaise: number;
  residualPaise: number;
  /** YYYY-MM-DD */
  putToUse: string;
  method: 'SLM' | 'WDV';
  lifeYears: number;
  /** For assets brought in already part-depreciated: what was booked by openingAsOf. */
  openingAccumulatedPaise: number;
  openingAsOf: string | null;
}

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
/** Days from a to b, both counted. */
const span = (a: string, b: string) => (b < a ? 0 : Math.round((t(b) - t(a)) / DAY) + 1);
export const addDays = (d: string, n: number) => new Date(t(d) + n * DAY).toISOString().slice(0, 10);
const fyStart = (d: string) => (Number(d.slice(5, 7)) >= 4 ? `${d.slice(0, 4)}-04-01` : `${Number(d.slice(0, 4)) - 1}-04-01`);
const fyEnd = (start: string) => `${Number(start.slice(0, 4)) + 1}-03-31`;

/** The WDV rate that brings cost to residual over the life: 1 − (residual ÷ cost)^(1 ÷ life). */
export function wdvRate(costPaise: number, residualPaise: number, lifeYears: number): number {
  if (costPaise <= 0 || lifeYears <= 0) return 0;
  const floor = Math.max(residualPaise, 1) / costPaise;
  return 1 - Math.pow(floor, 1 / lifeYears);
}

/** Depreciation from the start through `date`, inclusive, in paise. */
export function depreciationTo(a: AssetForDep, date: string): number {
  const depreciable = Math.max(0, a.costPaise - a.residualPaise);
  const base = a.openingAsOf ? a.openingAccumulatedPaise : 0;
  const start = a.openingAsOf ? addDays(a.openingAsOf, 1) : a.putToUse;
  if (date < a.putToUse) return 0;
  if (date < start) return Math.min(depreciable, base);

  let total = base;
  if (a.method === 'SLM') {
    // By each financial year's own days, so a leap year still carries one year's charge.
    const annual = (a.costPaise - a.residualPaise) / a.lifeYears;
    for (let s = fyStart(start); s <= date; s = addDays(fyEnd(s), 1)) {
      const e = fyEnd(s);
      const from = start > s ? start : s;
      total += annual * (span(from, date < e ? date : e) / span(s, e));
    }
  } else {
    const rate = wdvRate(a.costPaise, a.residualPaise, a.lifeYears);
    let wdv = a.costPaise - base;
    for (let s = fyStart(start); s <= date; s = addDays(fyEnd(s), 1)) {
      const e = fyEnd(s);
      const inUseFrom = start > s ? start : s;
      const yearDays = span(s, e);
      const full = wdv * rate * (span(inUseFrom, e) / yearDays);
      if (date <= e) {
        total += wdv * rate * (span(inUseFrom, date) / yearDays);
        break;
      }
      total += full;
      wdv -= full;
    }
  }
  return Math.min(depreciable, Math.round(total));
}

/** Book value on a date. */
export const bookValue = (a: AssetForDep, date: string) => a.costPaise - depreciationTo(a, date);

export interface TaxAsset {
  id: string;
  name: string;
  category: AssetCategory;
  costPaise: number;
  putToUse: string;
  disposedOn: string | null;
  proceedsPaise: number;
}

/**
 * Income Tax depreciation by block for a financial year, from the register:
 * each year's opening written-down value plus additions less sale proceeds,
 * at the block rate, half the rate on additions in use under 180 days.
 */
export function taxBlocks(assets: TaxAsset[], financialYear: string) {
  const target = `${financialYear.slice(0, 4)}-04-01`;
  const blocks = new Map<string, { block: string; ratePct: number; openingPaise: number; additionsPaise: number; disposalsPaise: number; depreciationPaise: number; closingPaise: number }>();
  const first = assets.reduce((m, a) => (a.putToUse < m ? a.putToUse : m), target);
  for (let s = fyStart(first); s <= target; s = addDays(fyEnd(s), 1)) {
    const e = fyEnd(s);
    const year = new Map<string, { ratePct: number; open: number; full: number; half: number; sold: number }>();
    for (const [name, b] of blocks) year.set(name, { ratePct: b.ratePct, open: b.closingPaise, full: 0, half: 0, sold: 0 });
    for (const a of assets) {
      const c = CATEGORIES[a.category];
      const y = year.get(c.itBlock) ?? { ratePct: c.itRatePct, open: 0, full: 0, half: 0, sold: 0 };
      if (a.putToUse >= s && a.putToUse <= e) {
        if (span(a.putToUse, e) >= 180) y.full += a.costPaise;
        else y.half += a.costPaise;
      }
      if (a.disposedOn && a.disposedOn >= s && a.disposedOn <= e) y.sold += a.proceedsPaise;
      year.set(c.itBlock, y);
    }
    for (const [name, y] of year) {
      const base = Math.max(0, y.open + y.full + y.half - y.sold);
      // Sale proceeds come off the full-rate part first.
      const halfPart = Math.min(y.half, base);
      const fullPart = base - halfPart;
      const dep = Math.round((fullPart * y.ratePct) / 100 + (halfPart * y.ratePct) / 200);
      blocks.set(name, { block: name, ratePct: y.ratePct, openingPaise: y.open, additionsPaise: y.full + y.half, disposalsPaise: y.sold, depreciationPaise: dep, closingPaise: base - dep });
    }
  }
  return [...blocks.values()].filter((b) => b.openingPaise || b.additionsPaise || b.disposalsPaise);
}
