import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BillStatus, InvoiceStatus, JournalStatus, VoucherType } from '@ai-accounting/shared';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { AccountsService } from '../gl/accounts.service';
import { financialYearOf } from '../gl/posting.service';
import { outstandingPaise } from '../gl/schemas/settlement.schema';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { RecurringTemplate, RecurringTemplateDocument } from '../automation/schemas/recurring-template.schema';
import { nextOccurrence, todayIst } from '../automation/schedule';
import { ReportsService } from '../reports/reports.service';
import {
  buildWeeks,
  daysBetween,
  ForecastItem,
  ForecastWeek,
  nextGstDueDate,
  nextTdsDueDate,
  projectTrend,
  typicalDelayDays,
} from './forecast';

export interface CashForecast {
  asOf: string;
  openingCashPaise: number;
  weeks: ForecastWeek[];
  lowestPaise: number;
  lowestWeekStart: string;
  runRate: { weeklyInPaise: number; weeklyOutPaise: number; basedOnDays: number };
  /** Receivables more than 90 days late: left out, not counted on. */
  doubtful: { count: number; amountPaise: number };
  assumptions: string[];
}

export interface PlProjection {
  months: Array<{ period: string; revenuePaise: number; expensesPaise: number; netPaise: number; projected: boolean }>;
}

const RUN_RATE_DAYS = 90;
const DOUBTFUL_AFTER_DAYS = 90;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Where cash is heading over the next weeks, from what is already known:
 * what customers owe (dated by how late each one usually pays), what is owed
 * to vendors, recurring bills and invoices, GST and TDS falling due, and the
 * usual spending and receipts that never pass through a bill or invoice.
 *
 * Everything is read from the books. It is an estimate and says what it
 * assumed; it posts nothing.
 */
@Injectable()
export class ForecastService {
  constructor(
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(RecurringTemplate.name) private templateModel: Model<RecurringTemplateDocument>,
    private accounts: AccountsService,
    private reports: ReportsService,
  ) {}

  async cashForecast(orgId: string, weeks = 13, today = todayIst()): Promise<CashForecast> {
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 26) throw new BadRequestException('weeks must be 1 to 26');
    const horizonEnd = addDays(today, weeks * 7 - 1);
    const sys = await this.accounts.resolveSystemAccounts(orgId, [
      SystemAccountKey.BANK, SystemAccountKey.CASH, SystemAccountKey.ACCOUNTS_RECEIVABLE, SystemAccountKey.ACCOUNTS_PAYABLE,
      SystemAccountKey.TDS_PAYABLE, SystemAccountKey.RCM_GST_PAYABLE,
      SystemAccountKey.GST_OUTPUT_CGST, SystemAccountKey.GST_OUTPUT_SGST, SystemAccountKey.GST_OUTPUT_IGST, SystemAccountKey.GST_OUTPUT_CESS,
      SystemAccountKey.GST_INPUT_CGST, SystemAccountKey.GST_INPUT_SGST, SystemAccountKey.GST_INPUT_IGST, SystemAccountKey.GST_INPUT_CESS,
    ]);
    const id = (key: SystemAccountKey) => sys.get(key)!._id.toString();
    const cash = [id(SystemAccountKey.BANK), id(SystemAccountKey.CASH)];
    const gstOut = [SystemAccountKey.GST_OUTPUT_CGST, SystemAccountKey.GST_OUTPUT_SGST, SystemAccountKey.GST_OUTPUT_IGST, SystemAccountKey.GST_OUTPUT_CESS, SystemAccountKey.RCM_GST_PAYABLE].map(id);
    const gstIn = [SystemAccountKey.GST_INPUT_CGST, SystemAccountKey.GST_INPUT_SGST, SystemAccountKey.GST_INPUT_IGST, SystemAccountKey.GST_INPUT_CESS].map(id);

    const balances = await this.balances(orgId, today, [...cash, ...gstOut, ...gstIn, id(SystemAccountKey.TDS_PAYABLE)]);
    const net = (ids: string[]) => ids.reduce((s, a) => s + (balances.get(a) ?? 0), 0); // debit − credit
    const openingCashPaise = net(cash);
    const items: ForecastItem[] = [];
    const assumptions: string[] = [];

    // ── Money in: open invoices, when each customer usually pays ─────────────
    const [openInvoices, paidInvoices] = await Promise.all([
      // Drafts a recurring schedule made count too: they are this month's rent or retainer, only not posted yet.
      this.invoiceModel
        .find({ orgId, $or: [{ status: { $in: [InvoiceStatus.SENT, InvoiceStatus.POSTED] } }, { status: InvoiceStatus.DRAFT, recurringTemplateId: { $ne: null } }] })
        .lean()
        .exec(),
      this.invoiceModel
        .find({ orgId, dueDate: { $ne: null }, 'payments.0': { $exists: true }, invoiceDate: { $gte: addDays(today, -365) } })
        .lean()
        .exec(),
    ]);
    const paymentsByCustomer = new Map<string, Array<{ dueDate: string; paidOn: string }>>();
    for (const inv of paidInvoices) {
      const list = paymentsByCustomer.get(inv.customerId.toString()) ?? [];
      for (const p of inv.payments ?? []) list.push({ dueDate: inv.dueDate!, paidOn: p.paidOn });
      paymentsByCustomer.set(inv.customerId.toString(), list);
    }
    const everyone = typicalDelayDays([...paymentsByCustomer.values()].flat()) ?? 0;
    const customerNames = await this.names((ids) =>
      this.customerModel.find({ orgId, _id: { $in: ids } }, { name: 1 }).lean().exec(),
    openInvoices.map((i) => i.customerId));
    const doubtful = { count: 0, amountPaise: 0 };
    for (const inv of openInvoices) {
      const owed = outstandingPaise(inv);
      if (owed <= 0) continue;
      const due = inv.dueDate ?? addDays(inv.invoiceDate, 30);
      if (daysBetween(due, today) > DOUBTFUL_AFTER_DAYS) {
        doubtful.count += 1;
        doubtful.amountPaise += owed;
        continue;
      }
      const own = typicalDelayDays(paymentsByCustomer.get(inv.customerId.toString()) ?? []);
      const delay = own ?? everyone;
      const expected = addDays(due, delay);
      const date = expected < today ? today : expected;
      if (date > horizonEnd) continue;
      const customer = customerNames.get(inv.customerId.toString()) ?? 'Customer';
      items.push({
        kind: 'receivable',
        direction: 'in',
        label: `${customer} · ${inv.invoiceNumber ?? 'invoice'}`,
        date,
        amountPaise: owed,
        note: delay > 0 ? `${own !== null ? 'pays' : 'customers pay'} about ${delay} days after the due date` : undefined,
      });
    }

    // ── Money out: open bills, on their due dates ────────────────────────────
    const openBills = await this.billModel
      .find({ orgId, $or: [{ status: BillStatus.POSTED }, { status: BillStatus.DRAFT, recurringTemplateId: { $ne: null } }] })
      .lean()
      .exec();
    const vendorNames = await this.names((ids) =>
      this.vendorModel.find({ orgId, _id: { $in: ids } }, { name: 1 }).lean().exec(),
    openBills.map((b) => b.vendorId));
    for (const bill of openBills) {
      const owed = outstandingPaise(bill);
      if (owed <= 0) continue;
      const due = bill.dueDate ?? addDays(bill.billDate, 30);
      const date = due < today ? today : due;
      if (date > horizonEnd) continue;
      items.push({
        kind: 'payable',
        direction: 'out',
        label: `${vendorNames.get(bill.vendorId.toString()) ?? 'Vendor'} · ${bill.billNumber ?? 'bill'}`,
        date,
        amountPaise: owed,
        note: due < today ? 'overdue' : undefined,
      });
    }

    // ── Recurring bills and invoices still to come ───────────────────────────
    // Journals move no money: only bills and invoices are cash to come.
    const templates = await this.templateModel.find({ orgId, status: 'active', kind: { $in: ['bill', 'invoice'] }, nextRunDate: { $ne: null } }).lean().exec();
    for (const t of templates) {
      if (!t.amountsPaise || !t.partyId) continue;
      const amounts = t.amountsPaise;
      const partyId = t.partyId;
      let run = t.nextRunDate!;
      for (let guard = 0; guard < 60 && run <= horizonEnd; guard++, run = nextOccurrence(run, t.dayOfMonth, t.frequency)) {
        if (t.endDate && run > t.endDate) break;
        const incoming = t.kind === 'invoice';
        const delay = incoming ? typicalDelayDays(paymentsByCustomer.get(partyId.toString()) ?? []) ?? everyone : 0;
        const date = addDays(run, t.dueInDays + delay);
        if (date > horizonEnd) continue;
        // A reverse-charge vendor is paid the taxable value; the GST goes to the government.
        const amount = t.isReverseCharge ? amounts.taxableValue : amounts.total;
        items.push({
          kind: incoming ? 'recurring_in' : 'recurring_out',
          direction: incoming ? 'in' : 'out',
          label: `${t.name} (recurring)`,
          date: date < today ? today : date,
          amountPaise: amount,
        });
      }
    }

    // ── Taxes on the books, due on their dates ───────────────────────────────
    const tdsOwed = -(balances.get(id(SystemAccountKey.TDS_PAYABLE)) ?? 0);
    if (tdsOwed > 0) {
      items.push({ kind: 'tds', direction: 'out', label: 'TDS deposit', date: nextTdsDueDate(today), amountPaise: tdsOwed, note: 'TDS deducted and not yet deposited' });
    }
    const gstOwed = -net(gstOut) - net(gstIn);
    if (gstOwed > 0) {
      items.push({ kind: 'gst', direction: 'out', label: 'GST (GSTR-3B)', date: nextGstDueDate(today), amountPaise: gstOwed, note: 'output tax less input credit on the books' });
    }

    // ── The usual: receipts and payments with no invoice or bill ─────────────
    const runRate = await this.runRate(orgId, today, cash, [id(SystemAccountKey.ACCOUNTS_RECEIVABLE), id(SystemAccountKey.ACCOUNTS_PAYABLE), id(SystemAccountKey.TDS_PAYABLE), ...gstOut, ...gstIn]);

    assumptions.push(
      `Opening cash is the bank and cash ledgers as of ${today}.`,
      `Customers are expected to pay as late as they usually do${everyone ? `; across all customers that is about ${everyone} days` : ''}.`,
      'Bills are paid on their due dates; overdue ones this week.',
      `Spending and receipts that never pass through a bill or invoice are averaged over the last ${RUN_RATE_DAYS} days.`,
    );
    if (doubtful.count) {
      assumptions.push(`${doubtful.count} invoice${doubtful.count === 1 ? ' is' : 's are'} over ${DOUBTFUL_AFTER_DAYS} days late and not counted on.`);
    }

    const forecastWeeks = buildWeeks({ today, openingCashPaise, weeks, items, runRate });
    const lowest = forecastWeeks.reduce((low, w) => (w.closingPaise < low.closingPaise ? w : low), forecastWeeks[0]);
    return {
      asOf: today,
      openingCashPaise,
      weeks: forecastWeeks,
      lowestPaise: Math.min(openingCashPaise, lowest.closingPaise),
      lowestWeekStart: lowest.weekStart,
      runRate: { ...runRate, basedOnDays: RUN_RATE_DAYS },
      doubtful,
      assumptions,
    };
  }

  /** The last six complete months as booked, and the next three by their trend. */
  async plProjection(orgId: string, today = todayIst()): Promise<PlProjection> {
    const months: string[] = [];
    for (let k = 6; k >= 1; k--) {
      const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - k, 1));
      months.push(d.toISOString().slice(0, 7));
    }
    const actual = await Promise.all(
      months.map(async (period) => {
        const pl = await this.reports.getProfitAndLoss(orgId, financialYearOf(`${period}-01`), period);
        return { period, revenuePaise: pl.totalRevenuePaise, expensesPaise: pl.totalExpensesPaise };
      }),
    );
    // Months before the books began would drag the trend to zero; start from the first with activity.
    const first = actual.findIndex((m) => m.revenuePaise !== 0 || m.expensesPaise !== 0);
    const basis = first === -1 ? [] : actual.slice(first);
    const revenue = projectTrend(basis.map((m) => m.revenuePaise), 3);
    const expenses = projectTrend(basis.map((m) => m.expensesPaise), 3);
    const ahead = [0, 1, 2].map((k) => {
      const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + k, 1));
      const period = d.toISOString().slice(0, 7);
      return { period, revenuePaise: revenue[k], expensesPaise: expenses[k], netPaise: revenue[k] - expenses[k], projected: true };
    });
    return {
      months: [
        ...actual.map((m) => ({ ...m, netPaise: m.revenuePaise - m.expensesPaise, projected: false })),
        ...(basis.length ? ahead : []),
      ],
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Debit − credit per account, over every posted entry up to `asOf`. */
  private async balances(orgId: string, asOf: string, accountIds: string[]): Promise<Map<string, number>> {
    const rows = await this.journalModel
      .aggregate<{ _id: Types.ObjectId; net: number }>([
        { $match: { orgId, status: JournalStatus.POSTED, date: { $lte: asOf } } },
        { $unwind: '$lines' },
        { $match: { 'lines.accountId': { $in: accountIds.map((a) => new Types.ObjectId(a)) } } },
        { $group: { _id: '$lines.accountId', net: { $sum: { $subtract: ['$lines.debitPaise', '$lines.creditPaise'] } } } },
      ])
      .exec();
    return new Map(rows.map((r) => [r._id.toString(), r.net]));
  }

  /**
   * Weekly averages of bank and cash movements that touch no receivable,
   * payable or tax account: salaries, rent paid straight from the bank,
   * charges, interest. Those already forecast by name are left out.
   */
  private async runRate(orgId: string, today: string, cash: string[], named: string[]) {
    const since = addDays(today, -RUN_RATE_DAYS);
    const journals = await this.journalModel
      .find({
        orgId,
        status: JournalStatus.POSTED,
        isClosingEntry: { $ne: true },
        voucherType: { $in: [VoucherType.PAYMENT, VoucherType.RECEIPT, VoucherType.JOURNAL] },
        date: { $gt: since, $lte: today },
      })
      .lean()
      .exec();
    const cashSet = new Set(cash);
    const namedSet = new Set(named);
    let inPaise = 0;
    let outPaise = 0;
    for (const j of journals) {
      const ids = j.lines.map((l) => l.accountId.toString());
      if (ids.some((a) => namedSet.has(a))) continue;
      // A transfer between bank and cash moves nothing in or out of the business.
      if (ids.every((a) => cashSet.has(a))) continue;
      for (const l of j.lines) {
        if (!cashSet.has(l.accountId.toString())) continue;
        inPaise += l.debitPaise;
        outPaise += l.creditPaise;
      }
    }
    const weeks = RUN_RATE_DAYS / 7;
    return { weeklyInPaise: Math.round(inPaise / weeks), weeklyOutPaise: Math.round(outPaise / weeks) };
  }

  /** Party names by id; a callback, because the two models' types do not unify. */
  private async names(
    find: (ids: Types.ObjectId[]) => Promise<Array<{ _id: Types.ObjectId; name: string }>>,
    ids: Types.ObjectId[],
  ): Promise<Map<string, string>> {
    const found = await find(ids);
    return new Map(found.map((p) => [p._id.toString(), p.name]));
  }
}
