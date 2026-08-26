/**
 * Client-side CSV, for data the browser already holds.
 *
 * The GST registers arrive as JSON to render the tables; serialising the rows
 * already on screen is both instant and guaranteed to match what the user is
 * looking at, which a second server-side rendering of the same report would
 * not be.
 */

/** RFC 4180: quote anything containing a comma, quote or newline; double the quotes. */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n');
}

/** Paise → a plain decimal string for a spreadsheet cell (no ₹, no grouping). */
export function paiseToCsvAmount(paise: number): string {
  return (paise / 100).toFixed(2);
}

/**
 * Hands the browser a file to save.
 *
 * The BOM is what makes Excel open a UTF-8 CSV in the right encoding; without
 * it, rupee signs and Indian names in the data come out mangled.
 */
export function downloadCsvFile(csv: string, filename: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
