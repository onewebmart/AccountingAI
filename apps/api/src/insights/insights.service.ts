import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BillStatus, JournalStatus } from '@ai-accounting/shared';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { ReportsService } from '../reports/reports.service';

// ── Types ──────────────────────────────────────────────────────────────────────

export const InsightType = {
  EXPENSE_SPIKE: 'expense_spike',
  CASHFLOW_WARNING: 'cashflow_warning',
  OVERDUE_AP: 'overdue_ap',
  GST_DUE_SOON: 'gst_due_soon',
  MONTHLY_SUMMARY: 'monthly_summary',
  HEALTH_SCORE: 'health_score',
} as const;

export type InsightType = (typeof InsightType)[keyof typeof InsightType];

export interface Insight {
  id: string;
  type: InsightType;
  /** high = red/urgent, medium = amber, low = informational */
  priority: 'high' | 'medium' | 'low';
  headline: string;
  explanation: string;
  actionLabel?: string;
  actionHref?: string;
  /** Primary amount relevant to this insight (paise). */
  amountPaise?: number;
  /** Month-over-month change as a percentage (positive = increase). */
  changePercent?: number;
}

// ── Date helpers ───────────────────────────────────────────────────────────────

function getPreviousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

function getGstDueDate(period: string): string {
  // GSTR-3B due on 20th of the following month for monthly filers
  const [y, m] = period.split('-').map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return `${nextY}-${String(nextM).padStart(2, '0')}-20`;
}

function daysBetween(from: string, to: string): number {
  return Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);
}

function fmtPaise(paise: number): string {
  const abs = Math.abs(paise);
  if (abs >= 10_000_00) {
    return `₹${(abs / 10_000_00).toFixed(2)} L`;
  }
  return `₹${new Intl.NumberFormat('en-IN').format(Math.round(abs / 100))}`;
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class InsightsService {
  constructor(
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
    @InjectModel(PurchaseBill.name) private purchaseBillModel: Model<PurchaseBillDocument>,
    private reportsService: ReportsService,
  ) {}

  async getInsights(
    orgId: string,
    financialYear: string,
    today?: string,
  ): Promise<Insight[]> {
    const todayStr = today ?? new Date().toISOString().slice(0, 10);
    const currentPeriod = todayStr.slice(0, 7); // YYYY-MM
    const prevPeriod = getPreviousPeriod(currentPeriod);

    // Check if there is any posted data at all
    const journalCount = await this.journalModel
      .countDocuments({ orgId, financialYear, status: JournalStatus.POSTED })
      .exec();

    if (journalCount === 0) {
      return [];
    }

    // Fetch all data needed for insight computation in parallel
    const [currentPl, prevPl, cashFlow] = await Promise.all([
      this.reportsService.getProfitAndLoss(orgId, financialYear, currentPeriod),
      this.reportsService.getProfitAndLoss(orgId, financialYear, prevPeriod),
      this.reportsService.getCashFlow(orgId, financialYear, currentPeriod),
    ]);

    // Overdue AP: purchase bills that are POSTED and past their due date
    type AggResult = { count: number; totalPaise: number };
    const overdueResult = await (this.purchaseBillModel as Model<PurchaseBillDocument>)
      .aggregate<AggResult>([
        {
          $match: {
            orgId,
            status: BillStatus.POSTED,
            dueDate: { $ne: null, $lt: todayStr },
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalPaise: { $sum: '$amountsPaise.total' },
          },
        },
      ])
      .exec();

    const overdueCount: number = overdueResult[0]?.count ?? 0;
    const overdueTotalPaise: number = overdueResult[0]?.totalPaise ?? 0;

    // GST due date proximity — GSTR-3B for the PREVIOUS month is due on 20th of current month
    const gstDueDate = getGstDueDate(prevPeriod);
    const daysUntilGst = daysBetween(todayStr, gstDueDate);

    // Build health score (max 100, computed before generating insight cards)
    let healthScore = 15;
    if (currentPl.netIncomePaise > 0) healthScore += 30;
    if (cashFlow.netCashFlowPaise > 0) healthScore += 20;
    if (overdueCount === 0) healthScore += 20;
    if (currentPl.totalRevenuePaise > prevPl.totalRevenuePaise) healthScore += 15;

    const insights: Insight[] = [];

    // ── 1. Overdue AP (highest priority — cash impact) ──────────────────────
    if (overdueCount > 0) {
      insights.push({
        id: 'overdue-ap',
        type: InsightType.OVERDUE_AP,
        priority: 'high',
        headline: `${overdueCount} vendor${overdueCount !== 1 ? 's' : ''} usually paid by now`,
        explanation: `${fmtPaise(overdueTotalPaise)} in bills are past their usual payment date.`,
        amountPaise: overdueTotalPaise,
        actionLabel: 'View bills',
        actionHref: '/purchase',
      });
    }

    // ── 2. Cash flow warning ────────────────────────────────────────────────
    if (cashFlow.netCashFlowPaise < 0) {
      insights.push({
        id: 'cashflow-warning',
        type: InsightType.CASHFLOW_WARNING,
        priority: 'high',
        headline: `Cash outflows exceeded inflows this month`,
        explanation: `Net cash flow: −${fmtPaise(cashFlow.netCashFlowPaise)} — more going out than coming in.`,
        amountPaise: cashFlow.netCashFlowPaise,
        actionLabel: 'View Cash Flow',
        actionHref: '/reports?type=cash-flow',
      });
    }

    // ── 3. Expense spike ────────────────────────────────────────────────────
    if (prevPl.totalExpensesPaise > 0) {
      const changePercent = Math.round(
        ((currentPl.totalExpensesPaise - prevPl.totalExpensesPaise) / prevPl.totalExpensesPaise) * 100,
      );
      if (changePercent >= 15) {
        // Find the top growing expense line for contextual hint
        const topLine = findTopGrowingExpense(currentPl.expenseLines, prevPl.expenseLines);
        const hint = topLine ? ` Mostly ${topLine}.` : '';

        insights.push({
          id: 'expense-spike',
          type: InsightType.EXPENSE_SPIKE,
          priority: changePercent >= 30 ? 'high' : 'medium',
          headline: `Expenses up ${changePercent}% this month`,
          explanation: `${fmtPaise(currentPl.totalExpensesPaise)} vs ${fmtPaise(prevPl.totalExpensesPaise)} last month.${hint} Want to see the breakdown?`,
          amountPaise: currentPl.totalExpensesPaise,
          changePercent,
          actionLabel: 'View P&L',
          actionHref: '/reports?type=profit-loss',
        });
      }
    }

    // ── 4. GST due soon ─────────────────────────────────────────────────────
    if (daysUntilGst >= 0 && daysUntilGst <= 7) {
      insights.push({
        id: 'gst-due-soon',
        type: InsightType.GST_DUE_SOON,
        priority: 'medium',
        headline: `GST due in ${daysUntilGst} day${daysUntilGst !== 1 ? 's' : ''}`,
        explanation: `Reconcile 2B first to claim full input credit.`,
        actionLabel: 'Reconcile 2B',
        actionHref: '/gst',
      });
    }

    // ── 5. Monthly summary (always shown) ───────────────────────────────────
    const profitLabel =
      currentPl.netIncomePaise >= 0
        ? `Net income ${fmtPaise(currentPl.netIncomePaise)} — profitable month.`
        : `Net loss ${fmtPaise(currentPl.netIncomePaise)} — expenses exceeded revenue.`;

    insights.push({
      id: 'monthly-summary',
      type: InsightType.MONTHLY_SUMMARY,
      priority: 'low',
      headline: `Revenue ${fmtPaise(currentPl.totalRevenuePaise)} · Expenses ${fmtPaise(currentPl.totalExpensesPaise)} this month`,
      explanation: profitLabel,
      amountPaise: currentPl.netIncomePaise,
      actionLabel: 'View P&L',
      actionHref: '/reports?type=profit-loss',
    });

    // ── 6. Business health score ─────────────────────────────────────────────
    const healthLabel =
      healthScore >= 70
        ? 'Strong fundamentals — stay consistent.'
        : healthScore >= 40
          ? 'Some areas need attention — review overdue bills and expenses.'
          : 'Review collections and expenses closely.';

    insights.push({
      id: 'health-score',
      type: InsightType.HEALTH_SCORE,
      priority: 'low',
      headline: `Business health: ${healthScore}/100`,
      explanation: healthLabel,
    });

    return insights;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

import type { TbEntry } from '../reports/reports.service';

function findTopGrowingExpense(
  currentLines: TbEntry[],
  prevLines: TbEntry[],
): string | null {
  const prevMap = new Map(prevLines.map((e) => [e.accountDescription, e.totalDebitPaise - e.totalCreditPaise]));
  let topName: string | null = null;
  let topDelta = 0;

  for (const e of currentLines) {
    const curr = e.totalDebitPaise - e.totalCreditPaise;
    const prev = prevMap.get(e.accountDescription) ?? 0;
    const delta = curr - prev;
    if (delta > topDelta) {
      topDelta = delta;
      topName = e.accountDescription;
    }
  }

  return topName;
}
