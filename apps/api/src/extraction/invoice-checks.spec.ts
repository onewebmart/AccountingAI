import { dueDateFromTerms, gstinProblem, invoiceProblems } from './invoice-checks';

const balanced = { taxableValue: 2270000, cgst: 204300, sgst: 204300, igst: 0, cess: 0, total: 2678600 };

describe('gstinProblem', () => {
  it('accepts a valid GSTIN, in any case', () => {
    expect(gstinProblem('27AAPFU0939F1ZV')).toBeNull();
    expect(gstinProblem('27aapfu0939f1zv')).toBeNull();
  });

  it('rejects a GSTIN whose check digit does not match', () => {
    // From the project's own worked example; its 15th character should be W.
    expect(gstinProblem('27AAFCS3456M1Z9')).toMatch(/check digit/);
  });

  it('rejects anything not in the 15-character format', () => {
    expect(gstinProblem('27AAPFU0939F1Z')).toMatch(/format/);
    expect(gstinProblem('ABCDE1234F')).toMatch(/format/);
  });
});

describe('invoiceProblems', () => {
  it('finds nothing wrong with a consistent invoice', () => {
    expect(invoiceProblems(balanced, '27AAPFU0939F1ZV')).toEqual([]);
  });

  it('flags a total that does not equal taxable value plus tax', () => {
    // Found end to end: printed ₹47,700, parts add to ₹47,200, booked silently.
    const problems = invoiceProblems(
      { taxableValue: 4000000, cgst: 360000, sgst: 360000, igst: 0, cess: 0, total: 4770000 },
      null,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/₹47,200\.00 .* ₹47,700\.00 .* ₹500\.00/);
  });

  it('allows up to ₹1 of rounding on the total', () => {
    expect(invoiceProblems({ ...balanced, total: balanced.total + 100 }, null)).toEqual([]);
    expect(invoiceProblems({ ...balanced, total: balanced.total + 101 }, null)).toHaveLength(1);
  });

  it('flags unequal CGST and SGST, and IGST charged alongside them', () => {
    expect(invoiceProblems({ ...balanced, sgst: 204000, total: 2678300 }, null)[0]).toMatch(/should be equal/);
    expect(
      invoiceProblems({ ...balanced, igst: 408600, total: balanced.total + 408600 }, null)[0],
    ).toMatch(/inter-state or intra-state/);
  });

  it('flags an invalid counterparty GSTIN', () => {
    expect(invoiceProblems(balanced, '27AAFCS3456M1Z9')).toEqual([
      expect.stringMatching(/^GSTIN 27AAFCS3456M1Z9 fails its check digit/),
    ]);
  });
});

describe('dueDateFromTerms', () => {
  it.each([
    ['Net 30', '2026-11-04'],
    ['Net 30 days', '2026-11-04'],
    ['Payment within 45 days of invoice', '2026-11-19'],
    ['Due on receipt', '2026-10-05'],
  ])('"%s" from 2026-10-05 is due %s', (terms, due) => {
    expect(dueDateFromTerms('2026-10-05', terms)).toBe(due);
  });

  it('crosses month and year ends', () => {
    expect(dueDateFromTerms('2026-12-15', 'Net 30')).toBe('2027-01-14');
  });

  it('returns null when there is no day count or no usable invoice date', () => {
    expect(dueDateFromTerms('2026-10-05', 'As agreed')).toBeNull();
    expect(dueDateFromTerms(null, 'Net 30')).toBeNull();
    expect(dueDateFromTerms('05/10/2026', 'Net 30')).toBeNull();
  });
});
