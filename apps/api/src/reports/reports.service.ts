import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccountType, JournalStatus } from '@ai-accounting/shared';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';

// ── Account classification ─────────────────────────────────────────────────

/**
 * Classify an account by its human-readable description (stored in journal line.description).
 * This is intentionally simple: a proper CoA module (Phase 3/Masters) would store this
 * as a first-class field. Here we infer from naming convention so reports work now.
 */
export function classifyAccount(description: string): AccountType {
  const d = description.toLowerCase();
  if (d.includes('sales') || d.includes('revenue') || d.includes('income')) return AccountType.INCOME;
  if (d.includes('purchase') || d.includes('expense') || d.includes('cost')) return AccountType.EXPENSE;
  if (d.includes('payable') || d.includes('gst output') || d.includes('tax payable')) return AccountType.LIABILITIES;
  if (d.includes('capital') || d.includes('equity') || d.includes('retained')) return AccountType.CAPITAL;
  // ASSETS: receivable, bank, cash, gst input, prepaid, stock, etc.
  return AccountType.ASSETS;
}

// ── DTOs ───────────────────────────────────────────────────────────────────

export interface TbEntry {
  accountDescription: string;
  accountType: AccountType;
  totalDebitPaise: number;
  totalCreditPaise: number;
  /** Positive = net debit balance; negative = net credit balance. */
  netPaise: number;
}

export interface TrialBalanceReport {
  financialYear: string;
  entries: TbEntry[];
  grandTotalDebitPaise: number;
  grandTotalCreditPaise: number;
  /** true when ΣDebit === ΣCredit (must always hold per Invariant 2). */
  isBalanced: boolean;
}

export interface PlReport {
  financialYear: string;
  period: string | null;
  revenueLines: TbEntry[];
  expenseLines: TbEntry[];
  totalRevenuePaise: number;
  totalExpensesPaise: number;
  netIncomePaise: number;
}

export interface BsReport {
  financialYear: string;
  asOf: string;
  assetLines: TbEntry[];
  liabilityLines: TbEntry[];
  capitalLines: TbEntry[];
  /** Net income from P&L for the period — becomes retained earnings on the BS. */
  retainedEarningsPaise: number;
  totalAssetsPaise: number;
  totalLiabilitiesPaise: number;
  /** Capital accounts + retained earnings. */
  totalEquityPaise: number;
  /** Assets === Liabilities + Equity — must be true if accounting is correct. */
  isTiedOut: boolean;
}

export interface LedgerEntry {
  date: string;
  journalId: string;
  voucherType: string;
  voucherNumber: number;
  narration: string;
  debitPaise: number;
  creditPaise: number;
  runningBalancePaise: number;
}

export interface LedgerReport {
  accountDescription: string;
  financialYear: string;
  openingBalancePaise: number;
  entries: LedgerEntry[];
  closingBalancePaise: number;
}

export interface DayBookEntry {
  date: string;
  journalId: string;
  voucherType: string;
  voucherNumber: number;
  narration: string;
  totalAmountPaise: number;
  lines: Array<{ description: string; debitPaise: number; creditPaise: number }>;
}

export interface CashFlowReport {
  financialYear: string;
  period: string | null;
  cashInflowsPaise: number;
  cashOutflowsPaise: number;
  netCashFlowPaise: number;
}

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
  ) {}

  // ── Internal: load posted journals for a financial year (optionally filtered by period) ──

  private async loadJournals(
    orgId: string,
    financialYear: string,
    period?: string | null,
  ): Promise<JournalDocument[]> {
    const filter: Record<string, unknown> = { orgId, financialYear, status: JournalStatus.POSTED };
    if (period) {
      // period is YYYY-MM — filter journals whose date starts with it
      filter.date = { $regex: `^${period}` };
    }
    return this.journalModel.find(filter).sort({ date: 1, voucherNumber: 1 }).lean().exec() as unknown as JournalDocument[];
  }

  // ── Build account map from journal lines ────────────────────────────────

  private buildAccountMap(journals: JournalDocument[]): Map<string, TbEntry> {
    const map = new Map<string, TbEntry>();
    for (const j of journals) {
      for (const line of j.lines) {
        const desc = line.description || 'Unknown Account';
        if (!map.has(desc)) {
          map.set(desc, {
            accountDescription: desc,
            accountType: classifyAccount(desc),
            totalDebitPaise: 0,
            totalCreditPaise: 0,
            netPaise: 0,
          });
        }
        const entry = map.get(desc)!;
        entry.totalDebitPaise += line.debitPaise;
        entry.totalCreditPaise += line.creditPaise;
        entry.netPaise = entry.totalDebitPaise - entry.totalCreditPaise;
      }
    }
    return map;
  }

  // ── Trial Balance ────────────────────────────────────────────────────────

  async getTrialBalance(orgId: string, financialYear: string): Promise<TrialBalanceReport> {
    const journals = await this.loadJournals(orgId, financialYear);
    const accountMap = this.buildAccountMap(journals);
    const entries = [...accountMap.values()].sort((a, b) =>
      a.accountDescription.localeCompare(b.accountDescription),
    );
    const grandTotalDebitPaise = entries.reduce((s, e) => s + e.totalDebitPaise, 0);
    const grandTotalCreditPaise = entries.reduce((s, e) => s + e.totalCreditPaise, 0);
    return {
      financialYear,
      entries,
      grandTotalDebitPaise,
      grandTotalCreditPaise,
      isBalanced: grandTotalDebitPaise === grandTotalCreditPaise,
    };
  }

  // ── Profit & Loss ────────────────────────────────────────────────────────

  async getProfitAndLoss(
    orgId: string,
    financialYear: string,
    period?: string | null,
  ): Promise<PlReport> {
    const journals = await this.loadJournals(orgId, financialYear, period);
    const accountMap = this.buildAccountMap(journals);
    const entries = [...accountMap.values()];

    const revenueLines = entries.filter((e) => e.accountType === AccountType.INCOME);
    const expenseLines = entries.filter((e) => e.accountType === AccountType.EXPENSE);

    // Income accounts are credit-normal: revenue = net credits
    const totalRevenuePaise = revenueLines.reduce(
      (s, e) => s + (e.totalCreditPaise - e.totalDebitPaise),
      0,
    );
    // Expense accounts are debit-normal: expenses = net debits
    const totalExpensesPaise = expenseLines.reduce(
      (s, e) => s + (e.totalDebitPaise - e.totalCreditPaise),
      0,
    );

    return {
      financialYear,
      period: period ?? null,
      revenueLines,
      expenseLines,
      totalRevenuePaise,
      totalExpensesPaise,
      netIncomePaise: totalRevenuePaise - totalExpensesPaise,
    };
  }

  // ── Balance Sheet ────────────────────────────────────────────────────────

  async getBalanceSheet(
    orgId: string,
    financialYear: string,
    asOf?: string | null,
  ): Promise<BsReport> {
    const today = asOf ?? new Date().toISOString().slice(0, 10);
    const journals = await this.loadJournals(orgId, financialYear);
    const accountMap = this.buildAccountMap(journals);
    const entries = [...accountMap.values()];

    const assetLines = entries.filter((e) => e.accountType === AccountType.ASSETS);
    const liabilityLines = entries.filter((e) => e.accountType === AccountType.LIABILITIES);
    const capitalLines = entries.filter((e) => e.accountType === AccountType.CAPITAL);

    // Assets are debit-normal: balance = net debit
    const totalAssetsPaise = assetLines.reduce(
      (s, e) => s + (e.totalDebitPaise - e.totalCreditPaise),
      0,
    );
    // Liabilities are credit-normal: balance = net credit
    const totalLiabilitiesPaise = liabilityLines.reduce(
      (s, e) => s + (e.totalCreditPaise - e.totalDebitPaise),
      0,
    );
    // Capital accounts are credit-normal: balance = net credit
    const explicitCapitalPaise = capitalLines.reduce(
      (s, e) => s + (e.totalCreditPaise - e.totalDebitPaise),
      0,
    );

    // Retained earnings = current year net income (P&L)
    const pl = await this.getProfitAndLoss(orgId, financialYear);
    const retainedEarningsPaise = pl.netIncomePaise;
    const totalEquityPaise = explicitCapitalPaise + retainedEarningsPaise;

    const isTiedOut = totalAssetsPaise === totalLiabilitiesPaise + totalEquityPaise;

    return {
      financialYear,
      asOf: today,
      assetLines,
      liabilityLines,
      capitalLines,
      retainedEarningsPaise,
      totalAssetsPaise,
      totalLiabilitiesPaise,
      totalEquityPaise,
      isTiedOut,
    };
  }

  // ── Ledger ───────────────────────────────────────────────────────────────

  async getLedger(
    orgId: string,
    financialYear: string,
    accountDescription: string,
  ): Promise<LedgerReport> {
    const journals = await this.loadJournals(orgId, financialYear);
    let running = 0;
    const entries: LedgerEntry[] = [];

    for (const j of journals) {
      for (const line of j.lines) {
        if ((line.description || '') !== accountDescription) continue;
        running += line.debitPaise - line.creditPaise;
        entries.push({
          date: j.date,
          journalId: (j as unknown as { _id: { toString(): string } })._id.toString(),
          voucherType: j.voucherType,
          voucherNumber: j.voucherNumber,
          narration: j.narration ?? '',
          debitPaise: line.debitPaise,
          creditPaise: line.creditPaise,
          runningBalancePaise: running,
        });
      }
    }

    return {
      accountDescription,
      financialYear,
      openingBalancePaise: 0,
      entries,
      closingBalancePaise: running,
    };
  }

  // ── Day Book ─────────────────────────────────────────────────────────────

  async getDayBook(
    orgId: string,
    startDate: string,
    endDate: string,
    financialYear: string,
  ): Promise<DayBookEntry[]> {
    const journals = await this.journalModel
      .find({
        orgId,
        financialYear,
        status: JournalStatus.POSTED,
        date: { $gte: startDate, $lte: endDate },
      })
      .sort({ date: 1, voucherNumber: 1 })
      .lean()
      .exec() as unknown as JournalDocument[];

    return journals.map((j) => ({
      date: j.date,
      journalId: (j as unknown as { _id: { toString(): string } })._id.toString(),
      voucherType: j.voucherType,
      voucherNumber: j.voucherNumber,
      narration: j.narration ?? '',
      totalAmountPaise: j.lines.reduce((s, l) => s + l.debitPaise, 0),
      lines: j.lines.map((l) => ({
        description: l.description || '',
        debitPaise: l.debitPaise,
        creditPaise: l.creditPaise,
      })),
    }));
  }

  // ── Cash Flow (direct method) ─────────────────────────────────────────────

  async getCashFlow(
    orgId: string,
    financialYear: string,
    period?: string | null,
  ): Promise<CashFlowReport> {
    const journals = await this.loadJournals(orgId, financialYear, period);

    let cashInflowsPaise = 0;
    let cashOutflowsPaise = 0;

    for (const j of journals) {
      for (const line of j.lines) {
        const desc = (line.description || '').toLowerCase();
        const isBankOrCash = desc.includes('bank') || desc.includes('cash');
        if (!isBankOrCash) continue;
        // Bank/Cash debited → money coming IN (receipts from customers)
        cashInflowsPaise += line.debitPaise;
        // Bank/Cash credited → money going OUT (payments to vendors)
        cashOutflowsPaise += line.creditPaise;
      }
    }

    return {
      financialYear,
      period: period ?? null,
      cashInflowsPaise,
      cashOutflowsPaise,
      netCashFlowPaise: cashInflowsPaise - cashOutflowsPaise,
    };
  }
}
