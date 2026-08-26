/**
 * The Indian financial year — April to March.
 *
 * Shared rather than redeclared per page. This was pinned to '2025-26' on the
 * dashboard, so from April 2026 it queried a year with nothing posted in it and
 * every figure read ₹0.00 however much had been entered. The exports page had
 * the same string baked into six filenames.
 *
 * The API's reports and exports take this exact format — `2026-27`, not
 * `FY2026-27`, which returns an empty report rather than an error.
 */
export function currentFinancialYear(at: Date = new Date()): string {
  // Months are zero-based, so >= 3 is April onwards.
  const startYear = at.getMonth() >= 3 ? at.getFullYear() : at.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** The last `count` financial years, most recent first — for year pickers. */
export function recentFinancialYears(count = 3, at: Date = new Date()): string[] {
  const current = currentFinancialYear(at);
  const startYear = Number(current.slice(0, 4));
  return Array.from({ length: count }, (_, i) => {
    const y = startYear - i;
    return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  });
}
