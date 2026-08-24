/**
 * Statutory calendar — the date arithmetic behind Phase 3.
 *
 * These rules decide when a real CA firm chases a real client, so the dates
 * are asserted concretely rather than recomputed by the test.
 */
import 'reflect-metadata';
import { ClientType, ComplianceType, FirmService } from '@ai-accounting/shared';
import {
  COMPLIANCE_RULES,
  daysUntil,
  financialYearOf,
  obligationsInWindow,
  ruleAppliesToClient,
} from './statutory-calendar';

function ruleFor(type: ComplianceType) {
  const rule = COMPLIANCE_RULES.find((r) => r.complianceType === type);
  if (!rule) throw new Error(`no rule for ${type}`);
  return rule;
}

describe('financialYearOf', () => {
  it('runs April to March', () => {
    expect(financialYearOf(2026, 8).key).toBe('FY2026-27'); // August 2026
    expect(financialYearOf(2026, 2).key).toBe('FY2025-26'); // February 2026
    expect(financialYearOf(2026, 4).key).toBe('FY2026-27'); // 1 April flips it
    expect(financialYearOf(2026, 3).key).toBe('FY2025-26'); // 31 March does not
  });
});

describe('monthly GST obligations', () => {
  it('puts GSTR-1 on the 11th of the following month', () => {
    const items = obligationsInWindow(ruleFor(ComplianceType.GSTR_1), '2026-09-01', '2026-09-30');
    expect(items).toHaveLength(1);
    expect(items[0].dueDate).toBe('2026-09-11');
    // The 11 Sep filing covers August.
    expect(items[0].periodKey).toBe('2026-08');
    expect(items[0].periodLabel).toBe('August 2026');
  });

  it('puts GSTR-3B on the 20th of the following month', () => {
    const items = obligationsInWindow(ruleFor(ComplianceType.GSTR_3B), '2026-09-01', '2026-09-30');
    expect(items).toHaveLength(1);
    expect(items[0].dueDate).toBe('2026-09-20');
    expect(items[0].periodKey).toBe('2026-08');
  });

  it('rolls December into the next January', () => {
    const items = obligationsInWindow(ruleFor(ComplianceType.GSTR_3B), '2027-01-01', '2027-01-31');
    expect(items[0].dueDate).toBe('2027-01-20');
    expect(items[0].periodKey).toBe('2026-12');
  });

  it('returns every month in a multi-month window, in order', () => {
    const items = obligationsInWindow(ruleFor(ComplianceType.GSTR_3B), '2026-09-01', '2026-11-30');
    expect(items.map((i) => i.dueDate)).toEqual(['2026-09-20', '2026-10-20', '2026-11-20']);
  });
});

describe('quarterly TDS obligations', () => {
  it('uses 31 Jul / 31 Oct / 31 Jan / 31 May', () => {
    const items = obligationsInWindow(ruleFor(ComplianceType.TDS_RETURN), '2026-04-01', '2027-06-30');
    const dues = items.map((i) => i.dueDate).sort();
    expect(dues).toEqual(
      expect.arrayContaining(['2026-07-31', '2026-10-31', '2027-01-31', '2027-05-31']),
    );
  });

  it('labels Q1 of FY2026-27 correctly', () => {
    const items = obligationsInWindow(ruleFor(ComplianceType.TDS_RETURN), '2026-07-01', '2026-07-31');
    expect(items).toHaveLength(1);
    expect(items[0].periodKey).toBe('FY2026-27-Q1');
  });
});

describe('annual obligations', () => {
  it('puts ITR on 31 July after the financial year ends', () => {
    const items = obligationsInWindow(ruleFor(ComplianceType.ITR), '2026-01-01', '2026-12-31');
    expect(items).toHaveLength(1);
    expect(items[0].dueDate).toBe('2026-07-31');
    // Filed in July 2026 for the year that ended 31 March 2026.
    expect(items[0].periodKey).toBe('FY2025-26');
  });

  it('puts MGT-7 on 29 November and AOC-4 on 30 October', () => {
    const mgt = obligationsInWindow(ruleFor(ComplianceType.ROC_MGT_7), '2026-01-01', '2026-12-31');
    const aoc = obligationsInWindow(ruleFor(ComplianceType.ROC_AOC_4), '2026-01-01', '2026-12-31');
    expect(mgt[0].dueDate).toBe('2026-11-29');
    expect(aoc[0].dueDate).toBe('2026-10-30');
    expect(mgt[0].periodKey).toBe('FY2025-26');
  });
});

describe('window handling', () => {
  it('returns nothing when the window is inverted or invalid', () => {
    expect(obligationsInWindow(ruleFor(ComplianceType.GSTR_1), '2026-09-30', '2026-09-01')).toEqual([]);
    expect(obligationsInWindow(ruleFor(ComplianceType.GSTR_1), 'nonsense', '2026-09-01')).toEqual([]);
  });

  it('includes obligations falling exactly on the window edges', () => {
    const items = obligationsInWindow(ruleFor(ComplianceType.GSTR_1), '2026-09-11', '2026-10-11');
    expect(items.map((i) => i.dueDate)).toEqual(['2026-09-11', '2026-10-11']);
  });
});

describe('ruleAppliesToClient', () => {
  it('requires the client to subscribe to the service', () => {
    const gst = ruleFor(ComplianceType.GSTR_1);
    expect(ruleAppliesToClient(gst, [FirmService.GST_FILING], ClientType.PROPRIETORSHIP)).toBe(true);
    expect(ruleAppliesToClient(gst, [FirmService.ITR], ClientType.PROPRIETORSHIP)).toBe(false);
    expect(ruleAppliesToClient(gst, [], ClientType.PROPRIETORSHIP)).toBe(false);
    expect(ruleAppliesToClient(gst, undefined, ClientType.PROPRIETORSHIP)).toBe(false);
  });

  it('limits ROC filings to incorporated entities', () => {
    const roc = ruleFor(ComplianceType.ROC_MGT_7);
    expect(ruleAppliesToClient(roc, [FirmService.ROC_MCA], ClientType.PRIVATE_LIMITED)).toBe(true);
    expect(ruleAppliesToClient(roc, [FirmService.ROC_MCA], ClientType.LLP)).toBe(true);
    // An individual never files MGT-7, even if the firm ticked the ROC service.
    expect(ruleAppliesToClient(roc, [FirmService.ROC_MCA], ClientType.INDIVIDUAL)).toBe(false);
    expect(ruleAppliesToClient(roc, [FirmService.ROC_MCA], ClientType.PROPRIETORSHIP)).toBe(false);
  });

  it('withholds an ROC liability when the constitution is unknown', () => {
    // Better to surface nothing than to invent a filing the client may not owe;
    // it appears as soon as the client type is recorded.
    const roc = ruleFor(ComplianceType.ROC_MGT_7);
    expect(ruleAppliesToClient(roc, [FirmService.ROC_MCA], undefined)).toBe(false);
  });
});

describe('daysUntil', () => {
  it('counts whole days and goes negative once overdue', () => {
    expect(daysUntil('2026-08-20', '2026-08-13')).toBe(7);
    expect(daysUntil('2026-08-20', '2026-08-20')).toBe(0);
    expect(daysUntil('2026-08-20', '2026-08-25')).toBe(-5);
  });

  it('is unaffected by month and year boundaries', () => {
    expect(daysUntil('2027-01-01', '2026-12-25')).toBe(7);
  });
});
