import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccountType, JournalStatus } from '@ai-accounting/shared';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { LedgerAccount, LedgerAccountDocument } from '../gl/schemas/ledger-account.schema';
import { isMoneyAccount } from '../gl/money-accounts';
import { ImportBatch, ImportBatchDocument } from '../migration/schemas/import-batch.schema';

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

/** Calendar span of an Indian financial year label such as "2025-26". */
export function financialYearRange(financialYear: string): { start: string; end: string } {
  const startYear = Number(financialYear.split('-')[0]);
  if (!Number.isFinite(startYear)) {
    // Unparseable label — use a range wide enough not to hide anything.
    return { start: '1900-01-01', end: '2999-12-31' };
  }
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
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
  /** The customer or vendor a manual journal line names, if any. */
  contact?: string | null;
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

export interface DashboardSummary {
  financialYear: string;
  /** YYYY-MM the month-to-date figures cover. */
  period: string;
  incomeMTD: number;
  expensesMTD: number;
  cashOnHand: number;
  gstDue: number;
  gstInputCredit: number;
  gstOutputLiability: number;
}

export interface CashFlowReport {
  financialYear: string;
  period: string | null;
  /** Bank and cash at the start: brought forward, and the opening balances entered. */
  openingCashPaise: number;
  cashInflowsPaise: number;
  cashOutflowsPaise: number;
  netCashFlowPaise: number;
  /** Bank and cash at the end: opening plus what came in, less what went out. */
  closingCashPaise: number;
}

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
    @InjectModel(LedgerAccount.name)
    private accountModel: Model<LedgerAccountDocument>,
    // Read only: which vouchers were opening balances. Absent where reports are built without it.
    @Optional() @InjectModel(ImportBatch.name) private batchModel?: Model<ImportBatchDocument>,
  ) {}

  // ── Internal: load posted journals for a financial year (optionally filtered by period) ──

  private async loadJournals(
    orgId: string,
    financialYear: string,
    period?: string | null,
    { includeClosing = false }: { includeClosing?: boolean } = {},
  ): Promise<JournalDocument[]> {
    const filter: Record<string, unknown> = { orgId, financialYear, status: JournalStatus.POSTED };
    // The year-end closing entry would zero that year's P&L and trial balance;
    // ledgers keep it, since it is a real movement on retained earnings.
    if (!includeClosing) filter.isClosingEntry = { $ne: true };
    if (period) {
      // period is YYYY-MM — filter journals whose date starts with it
      filter.date = { $regex: `^${period}` };
    }
    return this.journalModel.find(filter).sort({ date: 1, voucherNumber: 1 }).lean().exec() as unknown as JournalDocument[];
  }

  // ── Build account map from journal lines ────────────────────────────────

  /**
   * Group journal lines by account.
   *
   * Lines that reference a real ledger account are grouped by that account and take
   * its declared type; the name-based classifier is only a fallback for lines whose
   * account no longer resolves, so a renamed account can never silently change which
   * side of the balance sheet it lands on.
   */
  private buildAccountMap(
    journals: JournalDocument[],
    accounts: Map<string, { name: string; type: AccountType }>,
  ): Map<string, TbEntry> {
    const map = new Map<string, TbEntry>();

    for (const j of journals) {
      for (const line of j.lines) {
        const accountId = line.accountId?.toString();
        const account = accountId ? accounts.get(accountId) : undefined;
        const desc = account?.name ?? line.description ?? 'Unknown Account';
        const key = accountId && account ? accountId : desc;

        if (!map.has(key)) {
          map.set(key, {
            accountDescription: desc,
            accountType: account?.type ?? classifyAccount(desc),
            totalDebitPaise: 0,
            totalCreditPaise: 0,
            netPaise: 0,
          });
        }
        const entry = map.get(key)!;
        entry.totalDebitPaise += line.debitPaise;
        entry.totalCreditPaise += line.creditPaise;
        entry.netPaise = entry.totalDebitPaise - entry.totalCreditPaise;
      }
    }
    return map;
  }

  /** Ledger accounts for the org, keyed by id, for report grouping. */
  private async loadAccounts(
    orgId: string,
  ): Promise<Map<string, { name: string; type: AccountType }>> {
    const accounts = await this.accountModel.find({ orgId }).select('name type').lean().exec();
    return new Map(
      accounts.map((a) => [
        a._id.toString(),
        { name: a.name, type: a.type as AccountType },
      ]),
    );
  }

  /**
   * Headline numbers for the dashboard: this month's income and spend, the money
   * actually in hand, and the net GST position.
   */
  async getDashboardSummary(
    orgId: string,
    financialYear: string,
    month?: string,
  ): Promise<DashboardSummary> {
    const period = month ?? new Date().toISOString().slice(0, 7);

    const [yearJournals, monthJournals, accounts] = await Promise.all([
      this.loadJournals(orgId, financialYear),
      this.loadJournals(orgId, financialYear, period),
      this.loadAccounts(orgId),
    ]);

    const monthEntries = [...this.buildAccountMap(monthJournals, accounts).values()];
    const incomeMTD = monthEntries
      .filter((e) => e.accountType === AccountType.INCOME)
      .reduce((s, e) => s + (e.totalCreditPaise - e.totalDebitPaise), 0);
    const expensesMTD = monthEntries
      .filter((e) => e.accountType === AccountType.EXPENSE)
      .reduce((s, e) => s + (e.totalDebitPaise - e.totalCreditPaise), 0);

    // Cash and GST are running positions, so they come off the whole year, not the month.
    const systemAccounts = await this.accountModel
      .find({ orgId })
      .select('_id systemKey')
      .lean()
      .exec();
    const keyById = new Map(
      systemAccounts.map((a) => [a._id.toString(), a.systemKey as string | undefined]),
    );

    let cashOnHand = 0;
    let gstInput = 0;
    let gstOutput = 0;

    for (const j of yearJournals) {
      for (const line of j.lines) {
        const key = keyById.get(line.accountId?.toString() ?? '');
        if (!key) continue;
        const net = line.debitPaise - line.creditPaise;

        if (key === 'BANK' || key === 'CASH') cashOnHand += net;
        else if (key.startsWith('GST_INPUT')) gstInput += net;
        else if (key.startsWith('GST_OUTPUT')) gstOutput += -net;
      }
    }

    return {
      financialYear,
      period,
      incomeMTD,
      expensesMTD,
      cashOnHand,
      // Output tax collected less input credit available; never shown as negative
      // because a credit balance is a refund position, not an amount owed.
      gstDue: Math.max(0, gstOutput - gstInput),
      gstInputCredit: gstInput,
      gstOutputLiability: gstOutput,
    };
  }

  // ── Trial Balance ────────────────────────────────────────────────────────

  async getTrialBalance(orgId: string, financialYear: string): Promise<TrialBalanceReport> {
    const journals = await this.loadJournals(orgId, financialYear);
    const accountMap = this.buildAccountMap(journals, await this.loadAccounts(orgId));
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
    const accountMap = this.buildAccountMap(journals, await this.loadAccounts(orgId));
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
    // A balance sheet is a position at a date, so it sums everything posted up
    // to that date — every earlier year included. It used to load only the
    // selected year's journals and ignore `asOf`, so a business's second year
    // opened with no assets, no bank balance and no profit brought forward.
    const { end } = financialYearRange(financialYear);
    const today = new Date().toISOString().slice(0, 10);
    const asOfDate = asOf ?? (today < end ? today : end);
    const journals = (await this.journalModel
      .find({ orgId, status: JournalStatus.POSTED, date: { $lte: asOfDate } })
      .sort({ date: 1, voucherNumber: 1 })
      .lean()
      .exec()) as unknown as JournalDocument[];
    const accountMap = this.buildAccountMap(journals, await this.loadAccounts(orgId));
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

    // Retained earnings = all profit to date (earlier years plus this one), since
    // no year-end entry closes income and expense into a capital account.
    const retainedEarningsPaise = entries
      .filter((e) => e.accountType === AccountType.INCOME || e.accountType === AccountType.EXPENSE)
      .reduce((s, e) => s + (e.totalCreditPaise - e.totalDebitPaise), 0);
    const totalEquityPaise = explicitCapitalPaise + retainedEarningsPaise;

    const isTiedOut = totalAssetsPaise === totalLiabilitiesPaise + totalEquityPaise;

    return {
      financialYear,
      asOf: asOfDate,
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

  /**
   * One account's postings for a year, with a running balance.
   *
   * `account` is a ledger account id, or — for exports and older callers — the
   * account's description as written on the journal lines. Balance-sheet
   * accounts open with everything posted to them in earlier years; income and
   * expense accounts start every year at zero.
   */
  async getLedger(
    orgId: string,
    financialYear: string,
    account: string,
  ): Promise<LedgerReport> {
    const accounts = await this.loadAccounts(orgId);
    const byId = accounts.get(account);
    const accountDescription = byId?.name ?? account;
    const accountType = byId?.type ?? classifyAccount(account);
    const matches = (line: { accountId?: unknown; description?: string }) =>
      byId ? String(line.accountId) === account : (line.description || '') === account;

    let opening = 0;
    if ([AccountType.ASSETS, AccountType.LIABILITIES, AccountType.CAPITAL].includes(accountType)) {
      const prior = await this.journalModel
        .find({ orgId, status: JournalStatus.POSTED, financialYear: { $lt: financialYear } })
        .lean()
        .exec();
      for (const j of prior) {
        for (const line of j.lines) {
          if (matches(line)) opening += line.debitPaise - line.creditPaise;
        }
      }
    }

    const journals = await this.loadJournals(orgId, financialYear, null, { includeClosing: true });
    let running = opening;
    const entries: LedgerEntry[] = [];

    for (const j of journals) {
      for (const line of j.lines) {
        if (!matches(line)) continue;
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
          contact: line.contact?.name || null,
        });
      }
    }

    return {
      accountDescription,
      financialYear,
      openingBalancePaise: opening,
      entries,
      closingBalancePaise: running,
    };
  }

  // ── Day Book ─────────────────────────────────────────────────────────────

  async getDayBook(
    orgId: string,
    startDate: string | undefined,
    endDate: string | undefined,
    financialYear: string,
  ): Promise<DayBookEntry[]> {
    // Without an explicit range, show the whole financial year. Passing undefined
    // bounds straight into $gte/$lte would match nothing and look like "no data".
    const { start, end } = financialYearRange(financialYear);

    const journals = await this.journalModel
      .find({
        orgId,
        financialYear,
        status: JournalStatus.POSTED,
        date: { $gte: startDate || start, $lte: endDate || end },
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
    const [journals, accounts, openingIds] = await Promise.all([
      this.loadJournals(orgId, financialYear, period),
      this.accountModel.find({ orgId }).select('name type isGroup systemKey').lean().exec(),
      this.openingJournalIds(orgId),
    ]);
    const byId = new Map(accounts.map((a) => [a._id.toString(), a]));
    // A line moves money when its account is a bank or cash account, whatever
    // the voucher type or wording. A line whose account no longer resolves falls
    // back to its description, as the other reports fall back to names.
    const isMoney = (line: { accountId?: unknown; description?: string | null }) => {
      const account = line.accountId ? byId.get(String(line.accountId)) : undefined;
      if (account) return isMoneyAccount(account);
      const desc = (line.description || '').toLowerCase();
      return desc.includes('bank') || desc.includes('cash');
    };
    const net = (lines: Array<{ debitPaise: number; creditPaise: number }>) => lines.reduce((s, l) => s + l.debitPaise - l.creditPaise, 0);

    // Money held before the range: earlier years, and for a month, the months before it.
    const before = await this.journalModel
      .find({
        orgId,
        status: JournalStatus.POSTED,
        $or: period ? [{ financialYear: { $lt: financialYear } }, { financialYear, date: { $lt: `${period}-01` } }] : [{ financialYear: { $lt: financialYear } }],
      })
      .select('lines')
      .lean()
      .exec();
    let openingCashPaise = before.reduce((s, j) => s + net(j.lines.filter(isMoney)), 0);
    let cashInflowsPaise = 0;
    let cashOutflowsPaise = 0;

    for (const j of journals) {
      const money = j.lines.filter(isMoney);
      if (money.length === 0) continue;
      // Opening balances are where the books start, not money that came in.
      if (openingIds.has(j._id.toString())) {
        openingCashPaise += net(money);
        continue;
      }
      // Bank to cash, or one bank to another: nothing came in or went out.
      if (money.length === j.lines.length) continue;
      for (const line of money) {
        cashInflowsPaise += line.debitPaise;
        cashOutflowsPaise += line.creditPaise;
      }
    }

    return {
      financialYear,
      period: period ?? null,
      openingCashPaise,
      cashInflowsPaise,
      cashOutflowsPaise,
      netCashFlowPaise: cashInflowsPaise - cashOutflowsPaise,
      closingCashPaise: openingCashPaise + cashInflowsPaise - cashOutflowsPaise,
    };
  }

  /** The vouchers that brought in opening balances, from the imports that posted them. */
  private async openingJournalIds(orgId: string): Promise<Set<string>> {
    if (!this.batchModel) return new Set();
    const batches = await this.batchModel.find({ orgId, status: 'committed', journalId: { $ne: null } }).select('journalId').lean().exec();
    return new Set(batches.map((b) => String(b.journalId)));
  }
}
