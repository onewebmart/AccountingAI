import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccountType, BillStatus, InvoiceStatus, JournalStatus } from '@ai-accounting/shared';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { LedgerAccount, LedgerAccountDocument, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { outstandingPaise } from '../gl/schemas/settlement.schema';
import { AuditService } from '../gl/audit.service';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { CreditNote, CreditNoteDocument } from '../sales/schemas/credit-note.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { DebitNote, DebitNoteDocument } from '../purchase/schemas/debit-note.schema';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { Item, ItemDocument } from '../items/schemas/item.schema';
import { todayIst } from '../automation/schedule';
import { Budget, BudgetDocument } from './schemas/budget.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { TimeEntry, TimeEntryDocument } from '../projects/schemas/time-entry.schema';
import {
  AccountMeta, DocFact, GstMonth, LineFact, MONTH, MonthNet, OpenDoc, PaidFact,
  ageingByParty, budgetVsActual, byItem, byMonth, byParty, comparison, fyMonths, gstSummary, monthEnd, monthsBetween, plMonthly, plTotals, rangeLabel, shiftMonth,
} from './management';
import { ReportRow, ReportTable } from './report-table';

const DONE_INVOICE = [InvoiceStatus.POSTED, InvoiceStatus.PAID];
const DONE_BILL = [BillStatus.POSTED, BillStatus.PAID];
const OUTPUT = [SystemAccountKey.GST_OUTPUT_CGST, SystemAccountKey.GST_OUTPUT_SGST, SystemAccountKey.GST_OUTPUT_IGST, SystemAccountKey.GST_OUTPUT_CESS];
const INPUT = [SystemAccountKey.GST_INPUT_CGST, SystemAccountKey.GST_INPUT_SGST, SystemAccountKey.GST_INPUT_IGST, SystemAccountKey.GST_INPUT_CESS];
const gstOf = (a: { cgst: number; sgst: number; igst: number; cess: number }) => a.cgst + a.sgst + a.igst + a.cess;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const FY = /^\d{4}-\d{2}$/;

export interface Range {
  from: string;
  to: string;
}

/**
 * Management reports from the books: profit and loss by month and against
 * other periods, sales and purchases by party, item and month, expenses by
 * category, receivables and payables by party, GST, and budgets. Read-only,
 * except budgets, which are plans and never touch the ledger.
 */
@Injectable()
export class ManagementReportsService {
  constructor(
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
    @InjectModel(LedgerAccount.name) private accountModel: Model<LedgerAccountDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(CreditNote.name) private creditNoteModel: Model<CreditNoteDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(DebitNote.name) private debitNoteModel: Model<DebitNoteDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(Item.name) private itemModel: Model<ItemDocument>,
    @InjectModel(Budget.name) private budgetModel: Model<BudgetDocument>,
    private audit: AuditService,
    @Optional() @InjectModel(Project.name) private projectModel?: Model<ProjectDocument>,
    @Optional() @InjectModel(TimeEntry.name) private timeModel?: Model<TimeEntryDocument>,
  ) {}

  /** A month range; by default this financial year to the current month. */
  range(from?: string | null, to?: string | null): Range {
    const end = to || todayIst().slice(0, 7);
    const start = from || fyMonths(end).from;
    if (!MONTH.test(start) || !MONTH.test(end)) throw new BadRequestException('from and to are months like 2026-04.');
    if (start > end) throw new BadRequestException('from comes before to.');
    if (monthsBetween(start, end).length > 36) throw new BadRequestException('Ask for three years at most.');
    return { from: start, to: end };
  }

  async accounts(orgId: string): Promise<Map<string, AccountMeta>> {
    const all = await this.accountModel.find({ orgId }, { name: 1, code: 1, type: 1, parentId: 1, isGroup: 1, systemKey: 1 }).lean().exec();
    const names = new Map(all.map((a) => [String(a._id), a.name]));
    return new Map(all.map((a) => [String(a._id), { id: String(a._id), name: a.name, code: a.code, type: a.type as AccountType, group: a.parentId ? names.get(String(a.parentId)) ?? null : null }]));
  }

  /** Net debit less credit per account per month, from posted journals; the year-end closing entry left out. */
  async monthNets(orgId: string, r: Range): Promise<MonthNet[]> {
    const rows = await this.journalModel
      .aggregate<{ _id: { a: Types.ObjectId; m: string }; net: number }>([
        { $match: { orgId, status: JournalStatus.POSTED, isClosingEntry: { $ne: true }, date: { $gte: `${r.from}-01`, $lte: monthEnd(r.to) } } },
        { $unwind: '$lines' },
        { $group: { _id: { a: '$lines.accountId', m: { $substrBytes: ['$date', 0, 7] } }, net: { $sum: { $subtract: ['$lines.debitPaise', '$lines.creditPaise'] } } } },
      ])
      .exec();
    return rows.filter((x) => x._id.a).map((x) => ({ accountId: String(x._id.a), month: x._id.m, net: x.net }));
  }

  async plMonthly(orgId: string, r: Range): Promise<ReportTable> {
    return plMonthly(await this.monthNets(orgId, r), await this.accounts(orgId), monthsBetween(r.from, r.to));
  }

  async expenses(orgId: string, r: Range): Promise<ReportTable> {
    return plMonthly(await this.monthNets(orgId, r), await this.accounts(orgId), monthsBetween(r.from, r.to), { expensesOnly: true });
  }

  /** The range against the same number of months just before it, and the same months a year earlier. */
  async comparison(orgId: string, r: Range): Promise<ReportTable> {
    const n = monthsBetween(r.from, r.to).length;
    const previous = { from: shiftMonth(r.from, -n), to: shiftMonth(r.from, -1) };
    const lastYear = { from: shiftMonth(r.from, -12), to: shiftMonth(r.to, -12) };
    const accounts = await this.accounts(orgId);
    const [c, p, l] = await Promise.all([this.monthNets(orgId, r), this.monthNets(orgId, previous), this.monthNets(orgId, lastYear)]);
    return comparison(
      { current: plTotals(c, accounts), previous: plTotals(p, accounts), lastYear: plTotals(l, accounts) },
      accounts,
      { current: rangeLabel(r.from, r.to), previous: rangeLabel(previous.from, previous.to), lastYear: rangeLabel(lastYear.from, lastYear.to) },
    );
  }

  // ── Sales and purchases ───────────────────────────────────────────────

  private async docs(orgId: string, side: 'sales' | 'purchases', r: Range) {
    const from = `${r.from}-01`;
    const to = monthEnd(r.to);
    if (side === 'sales') {
      const [docs, notes] = await Promise.all([
        this.invoiceModel.find({ orgId, status: { $in: DONE_INVOICE }, isOpeningBalance: { $ne: true }, invoiceDate: { $gte: from, $lte: to } }, { customerId: 1, invoiceDate: 1, amountsPaise: 1, lineItems: 1, partyAtIssue: 1 }).lean().exec(),
        this.creditNoteModel.find({ orgId, status: 'posted', noteDate: { $gte: from, $lte: to } }, { customerId: 1, noteDate: 1, amountsPaise: 1 }).lean().exec(),
      ]);
      const parties = await this.customerModel.find({ orgId, _id: { $in: [...new Set([...docs, ...notes].map((d) => String(d.customerId)))] } }, { name: 1 }).lean().exec();
      const name = new Map(parties.map((p) => [String(p._id), p.name]));
      return {
        docs: docs.map((d) => ({ partyId: String(d.customerId), partyName: name.get(String(d.customerId)) ?? 'Unknown customer', date: d.invoiceDate, taxablePaise: d.amountsPaise.taxableValue, gstPaise: gstOf(d.amountsPaise) })),
        notes: notes.map((n) => ({ partyId: String(n.customerId), partyName: name.get(String(n.customerId)) ?? 'Unknown customer', date: n.noteDate, taxablePaise: n.amountsPaise.taxableValue, gstPaise: gstOf(n.amountsPaise) })),
        lines: docs.flatMap((d) => d.lineItems ?? []),
      };
    }
    const [docs, notes] = await Promise.all([
      this.billModel.find({ orgId, status: { $in: DONE_BILL }, isOpeningBalance: { $ne: true }, billDate: { $gte: from, $lte: to } }, { vendorId: 1, billDate: 1, amountsPaise: 1, lineItems: 1 }).lean().exec(),
      this.debitNoteModel.find({ orgId, status: 'posted', noteDate: { $gte: from, $lte: to } }, { vendorId: 1, noteDate: 1, amountsPaise: 1 }).lean().exec(),
    ]);
    const parties = await this.vendorModel.find({ orgId, _id: { $in: [...new Set([...docs, ...notes].map((d) => String(d.vendorId)))] } }, { name: 1 }).lean().exec();
    const name = new Map(parties.map((p) => [String(p._id), p.name]));
    return {
      docs: docs.map((d) => ({ partyId: String(d.vendorId), partyName: name.get(String(d.vendorId)) ?? 'Unknown vendor', date: d.billDate, taxablePaise: d.amountsPaise.taxableValue, gstPaise: gstOf(d.amountsPaise) })),
      notes: notes.map((n) => ({ partyId: String(n.vendorId), partyName: name.get(String(n.vendorId)) ?? 'Unknown vendor', date: n.noteDate, taxablePaise: n.amountsPaise.taxableValue, gstPaise: gstOf(n.amountsPaise) })),
      lines: docs.flatMap((d) => d.lineItems ?? []),
    };
  }

  async byParty(orgId: string, side: 'sales' | 'purchases', r: Range): Promise<ReportTable> {
    const { docs, notes } = await this.docs(orgId, side, r);
    return byParty(side, docs as DocFact[], notes as DocFact[], rangeLabel(r.from, r.to));
  }

  async byMonth(orgId: string, side: 'sales' | 'purchases', r: Range): Promise<ReportTable> {
    const { docs, notes } = await this.docs(orgId, side, r);
    return byMonth(side, docs as DocFact[], notes as DocFact[], monthsBetween(r.from, r.to));
  }

  async byItem(orgId: string, side: 'sales' | 'purchases', r: Range): Promise<ReportTable> {
    const { lines } = await this.docs(orgId, side, r);
    const items = await this.itemModel.find({ orgId, _id: { $in: [...new Set(lines.filter((l) => l.itemId).map((l) => String(l.itemId)))] } }, { name: 1, uqc: 1 }).lean().exec();
    const byId = new Map(items.map((i) => [String(i._id), i]));
    const facts: LineFact[] = lines.map((l) => {
      const item = l.itemId ? byId.get(String(l.itemId)) : undefined;
      return { itemId: item ? String(item._id) : null, name: item?.name ?? l.description, uqc: item?.uqc ?? null, qty: l.qty ?? 1, amountPaise: l.amountPaise - ((l as { discountPaise?: number }).discountPaise ?? 0) };
    });
    return byItem(side, facts, rangeLabel(r.from, r.to));
  }

  // ── Receivables and payables ──────────────────────────────────────────

  /** What each party owes or is owed now, by how overdue, and how long they take to pay. */
  async ageing(orgId: string, side: 'receivables' | 'payables', asOf = todayIst()) {
    const facts = await this.ageingFacts(orgId, side, asOf);
    return ageingByParty(side, facts.open, facts.paid, asOf);
  }

  async ageingFacts(orgId: string, side: 'receivables' | 'payables', asOf = todayIst()): Promise<{ open: OpenDoc[]; paid: PaidFact[]; names: Map<string, string> }> {
    const since = new Date(Date.parse(`${asOf}T00:00:00Z`) - 455 * 86_400_000).toISOString().slice(0, 10);
    if (side === 'receivables') {
      const [open, paid] = await Promise.all([
        this.invoiceModel.find({ orgId, status: { $in: [InvoiceStatus.SENT, InvoiceStatus.POSTED] } }).lean().exec(),
        this.invoiceModel.find({ orgId, 'payments.paidOn': { $gte: since } }, { customerId: 1, invoiceDate: 1, payments: 1 }).lean().exec(),
      ]);
      const names = await this.names(this.customerModel, orgId, [...open, ...paid].map((d) => String(d.customerId)));
      return {
        names,
        open: open.map((d) => ({ partyId: String(d.customerId), partyName: names.get(String(d.customerId)) ?? 'Unknown customer', date: d.invoiceDate, dueDate: d.dueDate, owedPaise: outstandingPaise(d) })),
        paid: paid.flatMap((d) => (d.payments ?? []).filter((p) => p.paidOn >= since).map((p) => ({ partyId: String(d.customerId), paidOn: p.paidOn, days: Math.max(0, daysBetween(d.invoiceDate, p.paidOn)), amountPaise: p.amountPaise + (p.tdsPaise ?? 0) }))),
      };
    }
    const [open, paid] = await Promise.all([
      this.billModel.find({ orgId, status: BillStatus.POSTED }).lean().exec(),
      this.billModel.find({ orgId, 'payments.paidOn': { $gte: since } }, { vendorId: 1, billDate: 1, payments: 1 }).lean().exec(),
    ]);
    const names = await this.names(this.vendorModel, orgId, [...open, ...paid].map((d) => String(d.vendorId)));
    return {
      names,
      open: open.map((d) => ({ partyId: String(d.vendorId), partyName: names.get(String(d.vendorId)) ?? 'Unknown vendor', date: d.billDate, dueDate: d.dueDate, owedPaise: outstandingPaise(d) })),
      paid: paid.flatMap((d) => (d.payments ?? []).filter((p) => p.paidOn >= since).map((p) => ({ partyId: String(d.vendorId), paidOn: p.paidOn, days: Math.max(0, daysBetween(d.billDate, p.paidOn)), amountPaise: p.amountPaise }))),
    };
  }

  private async names(model: Model<CustomerDocument> | Model<VendorDocument>, orgId: string, ids: string[]) {
    const rows = await (model as Model<CustomerDocument>).find({ orgId, _id: { $in: [...new Set(ids)] } }, { name: 1 }).lean().exec();
    return new Map(rows.map((p) => [String(p._id), p.name]));
  }

  // ── GST ───────────────────────────────────────────────────────────────

  async gst(orgId: string, r: Range): Promise<ReportTable> {
    const all = await this.accountModel.find({ orgId, systemKey: { $in: [...OUTPUT, ...INPUT, SystemAccountKey.RCM_GST_PAYABLE] } }, { systemKey: 1 }).lean().exec();
    const key = new Map(all.map((a) => [String(a._id), a.systemKey!]));
    const by = new Map<string, GstMonth>();
    for (const n of await this.monthNets(orgId, r)) {
      const k = key.get(n.accountId);
      if (!k) continue;
      const m = by.get(n.month) ?? by.set(n.month, { month: n.month, outputPaise: 0, rcmPaise: 0, inputPaise: 0 }).get(n.month)!;
      if (OUTPUT.includes(k)) m.outputPaise -= n.net;
      else if (INPUT.includes(k)) m.inputPaise += n.net;
      else m.rcmPaise -= n.net;
    }
    return gstSummary([...by.values()], monthsBetween(r.from, r.to));
  }

  // ── Budgets ───────────────────────────────────────────────────────────

  private fy(financialYear: string) {
    if (!FY.test(financialYear ?? '')) throw new BadRequestException('financialYear looks like 2026-27.');
    const start = Number(financialYear.slice(0, 4));
    return { from: `${start}-04`, to: `${start + 1}-03` };
  }

  /** Every income and expense account with its budget for the year, nil where none is set. */
  async budgets(orgId: string, financialYear: string) {
    this.fy(financialYear);
    const [accounts, saved] = await Promise.all([
      this.accountModel.find({ orgId, isGroup: false, isActive: true, type: { $in: [AccountType.INCOME, AccountType.EXPENSE] } }, { name: 1, code: 1, type: 1 }).sort({ code: 1 }).lean().exec(),
      this.budgetModel.find({ orgId, financialYear }).lean().exec(),
    ]);
    const byAccount = new Map(saved.map((b) => [String(b.accountId), b.monthsPaise]));
    return {
      financialYear,
      months: monthsBetween(`${financialYear.slice(0, 4)}-04`, `${Number(financialYear.slice(0, 4)) + 1}-03`),
      rows: accounts.map((a) => ({ accountId: String(a._id), name: a.name, code: a.code, type: a.type, monthsPaise: byAccount.get(String(a._id)) ?? Array(12).fill(0) })),
    };
  }

  /** Set the budgets given; an all-nil row removes the account's budget. Audited. */
  async saveBudgets(orgId: string, actorId: string, financialYear: string, rows: Array<{ accountId: string; monthsPaise: number[] }>) {
    this.fy(financialYear);
    const ids = rows.map((r) => r.accountId);
    if (ids.some((id) => !Types.ObjectId.isValid(id))) throw new BadRequestException('No such account.');
    const accounts = await this.accountModel.find({ orgId, _id: { $in: ids } }, { name: 1, type: 1, isGroup: 1 }).lean().exec();
    const byId = new Map(accounts.map((a) => [String(a._id), a]));
    for (const r of rows) {
      const a = byId.get(r.accountId);
      if (!a || a.isGroup || ![AccountType.INCOME, AccountType.EXPENSE].includes(a.type as AccountType)) throw new BadRequestException('Budgets are for income and expense accounts.');
      if (!Array.isArray(r.monthsPaise) || r.monthsPaise.length !== 12 || !r.monthsPaise.every((n) => Number.isInteger(n) && n >= 0)) {
        throw new BadRequestException(`${a.name}: twelve whole-paise amounts, April to March, none negative.`);
      }
    }
    let saved = 0;
    for (const r of rows) {
      const filter = { orgId, financialYear, accountId: new Types.ObjectId(r.accountId) };
      const before = await this.budgetModel.findOne(filter).lean().exec();
      if (before && before.monthsPaise.every((v, i) => v === r.monthsPaise[i])) continue;
      if (!before && r.monthsPaise.every((v) => v === 0)) continue;
      if (r.monthsPaise.every((v) => v === 0)) await this.budgetModel.deleteOne(filter).exec();
      else await this.budgetModel.updateOne(filter, { $set: { monthsPaise: r.monthsPaise, updatedBy: actorId } }, { upsert: true, runValidators: true }).exec();
      await this.audit.record({
        orgId, entityType: 'Budget', entityId: `${financialYear}:${r.accountId}`, action: 'SET_BUDGET', performedBy: actorId,
        before: before ? { monthsPaise: before.monthsPaise } : null, after: { account: byId.get(r.accountId)!.name, monthsPaise: r.monthsPaise },
      });
      saved++;
    }
    return { saved };
  }

  /** A year's actuals, month by month, raised or cut by a percentage: a starting point to edit, not saved. */
  async budgetsFromYear(orgId: string, financialYear: string, fromYear: string, changePct = 0) {
    const r = this.fy(fromYear);
    this.fy(financialYear);
    if (!(changePct > -100 && changePct <= 500)) throw new BadRequestException('The change is a percentage above −100.');
    const accounts = await this.accounts(orgId);
    const months = monthsBetween(r.from, r.to);
    const grid = new Map<string, number[]>();
    for (const n of await this.monthNets(orgId, r)) {
      const a = accounts.get(n.accountId);
      if (!a || (a.type !== AccountType.INCOME && a.type !== AccountType.EXPENSE)) continue;
      const row = grid.get(n.accountId) ?? Array(12).fill(0);
      const v = a.type === AccountType.INCOME ? -n.net : n.net;
      row[months.indexOf(n.month)] += v;
      grid.set(n.accountId, row);
    }
    return {
      financialYear,
      rows: [...grid].map(([accountId, row]) => ({ accountId, monthsPaise: row.map((v) => Math.max(0, Math.round((v * (100 + changePct)) / 100))) })),
    };
  }

  /** Budget against actual over the year's months to `through` (by default the year so far). */
  async budgetVsActual(orgId: string, financialYear: string, through?: string | null): Promise<ReportTable> {
    const year = this.fy(financialYear);
    const end = through || (todayIst().slice(0, 7) < year.to ? todayIst().slice(0, 7) : year.to);
    if (!MONTH.test(end) || end < year.from || end > year.to) throw new BadRequestException(`through is a month of ${financialYear}.`);
    const months = monthsBetween(year.from, end);
    const [accounts, saved, nets] = await Promise.all([this.accounts(orgId), this.budgetModel.find({ orgId, financialYear }).lean().exec(), this.monthNets(orgId, { from: year.from, to: end })]);
    const budget = new Map(saved.map((b) => [String(b.accountId), b.monthsPaise.slice(0, months.length).reduce((s, v) => s + v, 0)]));
    return budgetVsActual(budget, plTotals(nets, accounts), accounts, `${financialYear}, ${rangeLabel(year.from, end)}`);
  }

  // ── Projects ──────────────────────────────────────────────────────────

  /**
   * Each project's income and costs from the journal lines that carry it,
   * the hours logged, and billable time not yet invoiced at its rates. A
   * range limits the books and the hours; unbilled time is as it stands.
   */
  async projectFigures(orgId: string, r: Range | null = null) {
    const out = new Map<string, { incomePaise: number; costPaise: number; hours: number; unbilledHours: number; unbilledPaise: number }>();
    const row = (id: string) => out.get(id) ?? out.set(id, { incomePaise: 0, costPaise: 0, hours: 0, unbilledHours: 0, unbilledPaise: 0 }).get(id)!;
    const accounts = await this.accounts(orgId);
    const inRange = r ? { date: { $gte: `${r.from}-01`, $lte: monthEnd(r.to) } } : {};
    const lines = await this.journalModel
      .aggregate<{ _id: { p: Types.ObjectId; a: Types.ObjectId }; net: number }>([
        { $match: { orgId, status: JournalStatus.POSTED, isClosingEntry: { $ne: true }, lines: { $elemMatch: { projectId: { $ne: null } } }, ...inRange } },
        { $unwind: '$lines' },
        { $match: { 'lines.projectId': { $ne: null } } },
        { $group: { _id: { p: '$lines.projectId', a: '$lines.accountId' }, net: { $sum: { $subtract: ['$lines.debitPaise', '$lines.creditPaise'] } } } },
      ])
      .exec();
    for (const l of lines) {
      const a = accounts.get(String(l._id.a));
      if (!a) continue;
      if (a.type === AccountType.INCOME) row(String(l._id.p)).incomePaise -= l.net;
      else if (a.type === AccountType.EXPENSE) row(String(l._id.p)).costPaise += l.net;
    }
    if (this.timeModel && this.projectModel) {
      const rates = new Map((await this.projectModel.find({ orgId }, { ratePaise: 1 }).lean().exec()).map((p) => [String(p._id), p.ratePaise]));
      const time = await this.timeModel.find({ orgId }, { projectId: 1, date: 1, hours: 1, billable: 1, status: 1, ratePaise: 1 }).lean().exec();
      for (const t of time) {
        const f = row(String(t.projectId));
        if (!r || (t.date >= `${r.from}-01` && t.date <= monthEnd(r.to))) f.hours = Math.round((f.hours + t.hours) * 100) / 100;
        if (t.billable && t.status === 'unbilled') {
          f.unbilledHours = Math.round((f.unbilledHours + t.hours) * 100) / 100;
          f.unbilledPaise += Math.round(t.hours * (t.ratePaise ?? rates.get(String(t.projectId)) ?? 0));
        }
      }
    }
    return out;
  }

  async projectPnl(orgId: string, r: Range): Promise<ReportTable> {
    const [figures, projects] = await Promise.all([this.projectFigures(orgId, r), this.projectModel ? this.projectModel.find({ orgId }).lean().exec() : Promise.resolve([])]);
    const customers = await this.customerModel.find({ orgId, _id: { $in: projects.map((p) => p.customerId).filter(Boolean) } }, { name: 1 }).lean().exec();
    const customerName = new Map(customers.map((c) => [String(c._id), c.name]));
    const rows: ReportRow[] = projects
      .map((p) => ({ p, f: figures.get(String(p._id)) }))
      .filter(({ f }) => f && (f.incomePaise || f.costPaise || f.hours || f.unbilledPaise))
      .sort((a, b) => b.f!.incomePaise - a.f!.incomePaise || a.p.name.localeCompare(b.p.name))
      .map(({ p, f }) => {
        const profit = f!.incomePaise - f!.costPaise;
        return { cells: [p.name, p.customerId ? customerName.get(String(p.customerId)) ?? '' : 'Internal', f!.incomePaise, f!.costPaise, profit, f!.incomePaise ? Math.round((profit / f!.incomePaise) * 1000) / 10 : null, f!.hours, f!.unbilledPaise] };
      });
    const t = rows.reduce((a, row) => [a[0] + Number(row.cells[2]), a[1] + Number(row.cells[3]), a[2] + Number(row.cells[6]), a[3] + Number(row.cells[7])], [0, 0, 0, 0]);
    return {
      key: 'project_pnl',
      title: 'Profit by project',
      subtitle: rangeLabel(r.from, r.to),
      columns: [
        { key: 'project', label: 'Project', kind: 'text' },
        { key: 'customer', label: 'Customer', kind: 'text' },
        { key: 'income', label: 'Income', kind: 'money' },
        { key: 'cost', label: 'Costs', kind: 'money' },
        { key: 'profit', label: 'Profit', kind: 'money' },
        { key: 'margin', label: 'Margin %', kind: 'number' },
        { key: 'hours', label: 'Hours', kind: 'number' },
        { key: 'unbilled', label: 'Unbilled time', kind: 'money' },
      ],
      rows: [...rows, { cells: ['Total', null, t[0], t[1], t[0] - t[1], t[0] ? Math.round(((t[0] - t[1]) / t[0]) * 1000) / 10 : null, Math.round(t[2] * 100) / 100, t[3]], style: 'grand' }],
      notes: ['Income and costs from posted lines tagged with the project. Unbilled time is billable time not yet invoiced, at its rates, as it stands today.'],
    };
  }
}
