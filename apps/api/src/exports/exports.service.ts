import { Injectable } from '@nestjs/common';
import { ReportsService, TbEntry } from '../reports/reports.service';

/** Escape a CSV field — wrap in quotes if it contains commas, quotes, or newlines. */
function csvField(value: string | number): string {
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function csvRow(fields: (string | number)[]): string {
  return fields.map(csvField).join(',');
}

function paise(n: number): string {
  return (n / 100).toFixed(2);
}

@Injectable()
export class ExportsService {
  constructor(private readonly reportsService: ReportsService) {}

  // ── Trial Balance CSV ───────────────────────────────────────────────────────

  async trialBalanceCsv(orgId: string, financialYear: string): Promise<string> {
    const report = await this.reportsService.getTrialBalance(orgId, financialYear);
    const lines: string[] = [
      csvRow(['Account', 'Type', 'Debit (₹)', 'Credit (₹)', 'Net (₹)', 'Dr/Cr']),
    ];

    for (const e of report.entries) {
      const net = Math.abs(e.netPaise) / 100;
      const side = e.netPaise >= 0 ? 'Dr' : 'Cr';
      lines.push(csvRow([e.accountDescription, e.accountType, paise(e.totalDebitPaise), paise(e.totalCreditPaise), net.toFixed(2), side]));
    }

    lines.push('');
    lines.push(csvRow(['TOTAL', '', paise(report.grandTotalDebitPaise), paise(report.grandTotalCreditPaise), '', '']));
    lines.push(csvRow(['Balanced', '', '', '', report.isBalanced ? 'YES' : 'NO', '']));

    return lines.join('\r\n');
  }

  // ── P&L CSV ─────────────────────────────────────────────────────────────────

  async profitAndLossCsv(orgId: string, financialYear: string, period?: string): Promise<string> {
    const report = await this.reportsService.getProfitAndLoss(orgId, financialYear, period);
    const lines: string[] = [];

    lines.push(csvRow([`Profit & Loss — FY ${financialYear}${period ? ` — ${period}` : ''}`]));
    lines.push('');
    lines.push(csvRow(['REVENUE', '']));
    lines.push(csvRow(['Account', 'Amount (₹)']));
    for (const e of report.revenueLines) {
      lines.push(csvRow([e.accountDescription, paise(e.totalCreditPaise - e.totalDebitPaise)]));
    }
    lines.push(csvRow(['Total Revenue', paise(report.totalRevenuePaise)]));
    lines.push('');
    lines.push(csvRow(['EXPENSES', '']));
    lines.push(csvRow(['Account', 'Amount (₹)']));
    for (const e of report.expenseLines) {
      lines.push(csvRow([e.accountDescription, paise(e.totalDebitPaise - e.totalCreditPaise)]));
    }
    lines.push(csvRow(['Total Expenses', paise(report.totalExpensesPaise)]));
    lines.push('');
    lines.push(csvRow([report.netIncomePaise >= 0 ? 'NET PROFIT' : 'NET LOSS', paise(Math.abs(report.netIncomePaise))]));

    return lines.join('\r\n');
  }

  // ── Balance Sheet CSV ────────────────────────────────────────────────────────

  async balanceSheetCsv(orgId: string, financialYear: string, asOf?: string): Promise<string> {
    const report = await this.reportsService.getBalanceSheet(orgId, financialYear, asOf);
    const lines: string[] = [];

    lines.push(csvRow([`Balance Sheet — FY ${financialYear} — As of ${report.asOf}`]));
    lines.push(csvRow(['Balanced', report.isTiedOut ? 'YES' : 'NO']));
    lines.push('');

    const section = (title: string, entries: TbEntry[], total: number, creditNormal: boolean) => {
      lines.push(csvRow([title, '']));
      lines.push(csvRow(['Account', 'Amount (₹)']));
      for (const e of entries) {
        const val = creditNormal ? e.totalCreditPaise - e.totalDebitPaise : e.totalDebitPaise - e.totalCreditPaise;
        lines.push(csvRow([e.accountDescription, paise(val)]));
      }
      lines.push(csvRow([`Total ${title}`, paise(total)]));
      lines.push('');
    };

    section('ASSETS', report.assetLines, report.totalAssetsPaise, false);
    section('LIABILITIES', report.liabilityLines, report.totalLiabilitiesPaise, true);
    lines.push(csvRow(['EQUITY', '']));
    section('Capital', report.capitalLines, report.totalEquityPaise - report.retainedEarningsPaise, true);
    lines.push(csvRow(['Retained Earnings (Net Income)', paise(report.retainedEarningsPaise)]));
    lines.push(csvRow(['Total Equity', paise(report.totalEquityPaise)]));
    lines.push('');
    lines.push(csvRow(['TOTAL LIABILITIES & EQUITY', paise(report.totalLiabilitiesPaise + report.totalEquityPaise)]));

    return lines.join('\r\n');
  }

  // ── Day Book CSV ─────────────────────────────────────────────────────────────

  async dayBookCsv(orgId: string, financialYear: string, startDate: string, endDate: string): Promise<string> {
    const entries = await this.reportsService.getDayBook(orgId, startDate, endDate, financialYear);
    const lines: string[] = [
      csvRow(['Date', 'Voucher Type', 'Voucher No.', 'Narration', 'Account', 'Debit (₹)', 'Credit (₹)']),
    ];

    for (const entry of entries) {
      for (const line of entry.lines) {
        lines.push(
          csvRow([
            entry.date,
            entry.voucherType,
            entry.voucherNumber,
            entry.narration,
            line.description,
            paise(line.debitPaise),
            paise(line.creditPaise),
          ]),
        );
      }
    }

    return lines.join('\r\n');
  }

  // ── Ledger CSV ───────────────────────────────────────────────────────────────

  async ledgerCsv(orgId: string, financialYear: string, account: string): Promise<string> {
    const report = await this.reportsService.getLedger(orgId, financialYear, account);
    const lines: string[] = [
      csvRow([`Ledger — ${account} — FY ${financialYear}`]),
      '',
      csvRow(['Date', 'Voucher Type', 'Voucher No.', 'Narration', 'Debit (₹)', 'Credit (₹)', 'Balance (₹)']),
    ];

    for (const e of report.entries) {
      lines.push(
        csvRow([
          e.date,
          e.voucherType,
          e.voucherNumber,
          e.narration,
          paise(e.debitPaise),
          paise(e.creditPaise),
          (Math.abs(e.runningBalancePaise) / 100).toFixed(2) + (e.runningBalancePaise >= 0 ? ' Dr' : ' Cr'),
        ]),
      );
    }

    lines.push('');
    lines.push(csvRow(['Closing Balance', '', '', '', '', '', (Math.abs(report.closingBalancePaise) / 100).toFixed(2) + (report.closingBalancePaise >= 0 ? ' Dr' : ' Cr')]));

    return lines.join('\r\n');
  }
}
