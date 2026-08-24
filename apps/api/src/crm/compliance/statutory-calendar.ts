import {
  ClientType,
  ComplianceAuthority,
  ComplianceStatus,
  ComplianceType,
  FirmService,
} from '@ai-accounting/shared';

/**
 * The Indian statutory calendar, as data.
 *
 * Kept declarative and free of I/O so the date arithmetic is unit-testable and
 * so a rule change (the government revises due dates by notification more often
 * than anyone would like) is an edit here rather than a hunt through services.
 *
 * Dates are ISO YYYY-MM-DD strings, matching the convention used across the
 * codebase for business dates.
 */

export type Cadence = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

export interface ComplianceRule {
  complianceType: ComplianceType;
  label: string;
  authority: ComplianceAuthority;
  cadence: Cadence;
  /** The client must subscribe to at least one of these services. */
  requiredServices: FirmService[];
  /**
   * When set, only these constitutions are liable. ROC filings apply to
   * companies; an individual or partnership never files MGT-7.
   */
  applicableClientTypes?: ClientType[];
}

/** Companies (and LLPs) file with the MCA; sole proprietors and individuals do not. */
const INCORPORATED: ClientType[] = [
  ClientType.PRIVATE_LIMITED,
  ClientType.PUBLIC_LIMITED,
  ClientType.LLP,
];

export const COMPLIANCE_RULES: ComplianceRule[] = [
  {
    complianceType: ComplianceType.GSTR_1,
    label: 'GSTR-1 — Outward supplies',
    authority: ComplianceAuthority.GST,
    cadence: 'MONTHLY',
    requiredServices: [FirmService.GST_FILING],
  },
  {
    complianceType: ComplianceType.GSTR_3B,
    label: 'GSTR-3B — Summary return',
    authority: ComplianceAuthority.GST,
    cadence: 'MONTHLY',
    requiredServices: [FirmService.GST_FILING],
  },
  {
    complianceType: ComplianceType.TDS_RETURN,
    label: 'TDS return',
    authority: ComplianceAuthority.INCOME_TAX,
    cadence: 'QUARTERLY',
    requiredServices: [FirmService.TDS],
  },
  {
    complianceType: ComplianceType.ITR,
    label: 'Income-tax return',
    authority: ComplianceAuthority.INCOME_TAX,
    cadence: 'ANNUAL',
    requiredServices: [FirmService.ITR],
  },
  {
    complianceType: ComplianceType.ROC_MGT_7,
    label: 'ROC annual return (MGT-7)',
    authority: ComplianceAuthority.MCA,
    cadence: 'ANNUAL',
    requiredServices: [FirmService.ROC_MCA],
    applicableClientTypes: INCORPORATED,
  },
  {
    complianceType: ComplianceType.ROC_AOC_4,
    label: 'ROC financial statements (AOC-4)',
    authority: ComplianceAuthority.MCA,
    cadence: 'ANNUAL',
    requiredServices: [FirmService.ROC_MCA],
    applicableClientTypes: INCORPORATED,
  },
];

export interface GeneratedObligation {
  complianceType: ComplianceType;
  label: string;
  authority: ComplianceAuthority;
  periodKey: string;
  periodLabel: string;
  dueDate: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function iso(year: number, month1: number, day: number): string {
  return `${year}-${String(month1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Month after (year, month1), rolling the year over. month1 is 1-based. */
function nextMonth(year: number, month1: number): { year: number; month1: number } {
  return month1 === 12 ? { year: year + 1, month1: 1 } : { year, month1: month1 + 1 };
}

/**
 * Indian financial year containing a given month: 1 Apr – 31 Mar.
 * August 2026 → FY2026-27; February 2026 → FY2025-26.
 */
export function financialYearOf(year: number, month1: number): {
  startYear: number;
  key: string;
  label: string;
} {
  const startYear = month1 >= 4 ? year : year - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, '0');
  return {
    startYear,
    key: `FY${startYear}-${endShort}`,
    label: `FY ${startYear}-${endShort}`,
  };
}

/** TDS quarters follow the financial year: Q1 = Apr–Jun. */
function tdsQuarter(month1: number): 1 | 2 | 3 | 4 {
  if (month1 >= 4 && month1 <= 6) return 1;
  if (month1 >= 7 && month1 <= 9) return 2;
  if (month1 >= 10 && month1 <= 12) return 3;
  return 4;
}

const TDS_QUARTER_MONTHS: Record<number, string> = {
  1: 'Apr–Jun',
  2: 'Jul–Sep',
  3: 'Oct–Dec',
  4: 'Jan–Mar',
};

/**
 * TDS return due dates (non-government deductors): 31 Jul, 31 Oct, 31 Jan and
 * 31 May for Q1–Q4. Q4's falls in the following financial year.
 */
function tdsDueDate(fyStartYear: number, quarter: 1 | 2 | 3 | 4): string {
  switch (quarter) {
    case 1: return iso(fyStartYear, 7, 31);
    case 2: return iso(fyStartYear, 10, 31);
    case 3: return iso(fyStartYear + 1, 1, 31);
    case 4: return iso(fyStartYear + 1, 5, 31);
  }
}

/**
 * Every obligation of one rule whose due date falls within [fromDate, toDate].
 *
 * The window is over DUE DATES, not periods: a firm cares about what it must
 * file in the next 90 days, whatever period that filing covers.
 */
export function obligationsInWindow(
  rule: ComplianceRule,
  fromDate: string,
  toDate: string,
): GeneratedObligation[] {
  const out: GeneratedObligation[] = [];
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return out;

  const base = {
    complianceType: rule.complianceType,
    label: rule.label,
    authority: rule.authority,
  };

  const within = (due: string): boolean => due >= fromDate && due <= toDate;

  // Walk a generous span of periods around the window and keep the ones whose
  // due date lands inside it. Cheap, and avoids inverting each cadence's rule.
  const startYear = from.getUTCFullYear() - 1;
  const endYear = to.getUTCFullYear() + 1;

  if (rule.cadence === 'MONTHLY') {
    // GSTR-1 is due the 11th of the following month, GSTR-3B the 20th.
    const dayOfNextMonth = rule.complianceType === ComplianceType.GSTR_1 ? 11 : 20;

    for (let y = startYear; y <= endYear; y++) {
      for (let m = 1; m <= 12; m++) {
        const filing = nextMonth(y, m);
        const due = iso(filing.year, filing.month1, dayOfNextMonth);
        if (!within(due)) continue;
        out.push({
          ...base,
          periodKey: `${y}-${String(m).padStart(2, '0')}`,
          periodLabel: `${MONTH_NAMES[m - 1]} ${y}`,
          dueDate: due,
        });
      }
    }
    return out;
  }

  if (rule.cadence === 'QUARTERLY') {
    for (let fyStart = startYear - 1; fyStart <= endYear; fyStart++) {
      for (const q of [1, 2, 3, 4] as const) {
        const due = tdsDueDate(fyStart, q);
        if (!within(due)) continue;
        const fy = financialYearOf(fyStart, 4);
        out.push({
          ...base,
          periodKey: `${fy.key}-Q${q}`,
          periodLabel: `Q${q} (${TDS_QUARTER_MONTHS[q]} ${fyStart}${q === 4 ? ` – ${fyStart + 1}` : ''})`,
          dueDate: due,
        });
      }
    }
    return out;
  }

  // ANNUAL — all reckoned against a financial year ending 31 March.
  for (let fyStart = startYear - 1; fyStart <= endYear; fyStart++) {
    const fy = financialYearOf(fyStart, 4);
    let due: string;

    switch (rule.complianceType) {
      case ComplianceType.ITR:
        // Non-audit assessees: 31 July following the FY end.
        due = iso(fyStart + 1, 7, 31);
        break;
      case ComplianceType.ROC_MGT_7:
        // Within 60 days of the AGM, and the AGM must be held by 30 September.
        due = iso(fyStart + 1, 11, 29);
        break;
      case ComplianceType.ROC_AOC_4:
        // Within 30 days of the AGM.
        due = iso(fyStart + 1, 10, 30);
        break;
      default:
        continue;
    }

    if (!within(due)) continue;
    out.push({ ...base, periodKey: fy.key, periodLabel: fy.label, dueDate: due });
  }

  return out;
}

/** Whether a client is liable for a rule, by subscribed services and constitution. */
export function ruleAppliesToClient(
  rule: ComplianceRule,
  services: FirmService[] | undefined,
  clientType: ClientType | undefined,
): boolean {
  const subscribed = (services ?? []).some((s) => rule.requiredServices.includes(s));
  if (!subscribed) return false;

  if (rule.applicableClientTypes) {
    // No constitution recorded — don't invent an ROC liability for a client
    // that might be an individual. It appears once the type is filled in.
    if (!clientType) return false;
    if (!rule.applicableClientTypes.includes(clientType)) return false;
  }

  return true;
}

/** Whole days from `today` to `dueDate`; negative once overdue. */
export function daysUntil(dueDate: string, today: string): number {
  const due = new Date(`${dueDate}T00:00:00Z`).getTime();
  const now = new Date(`${today}T00:00:00Z`).getTime();
  return Math.round((due - now) / 86_400_000);
}

/** Offsets at which a client is reminded before a deadline. */
export const REMINDER_OFFSETS = [7, 3, 1] as const;

export const PENDING_STATUSES: ComplianceStatus[] = [ComplianceStatus.PENDING];
