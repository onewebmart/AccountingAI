import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccountType } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { LedgerAccount, LedgerAccountDocument } from '../gl/schemas/ledger-account.schema';
import { Budget, BudgetDocument } from './schemas/budget.schema';
import { NamedBudget, NamedBudgetDocument } from './schemas/named-budget.schema';
import { migrateLegacyBudgets } from './budget-migration';
import { BUDGET_PERIODS, BudgetPeriod, periodCount, periodLabels, splitToMonths, sumToPeriods } from './budget-periods';
import { monthsBetween } from './management';
import { ManagementReportsService } from './management.service';

const FY = /^\d{4}-\d{2}$/;
const PL: ReadonlySet<string> = new Set([AccountType.INCOME, AccountType.EXPENSE]);
const BS: ReadonlySet<string> = new Set([AccountType.ASSETS, AccountType.LIABILITIES, AccountType.CAPITAL]);
const TYPE_ORDER = [AccountType.INCOME, AccountType.EXPENSE, AccountType.ASSETS, AccountType.LIABILITIES, AccountType.CAPITAL] as string[];
/** ₹1 lakh crore a period: far past any SME's plan, well inside safe integers. */
const MAX_PAISE = 1e15;
const MAX_ROWS = 500;

export interface BudgetInput {
  name: string;
  financialYear: string;
  period: BudgetPeriod;
  includeBalanceSheet?: boolean;
  /** Per account, one amount per period in whole paise: 12, 4, 2 or 1 of them. */
  rows: Array<{ accountId: string; amountsPaise: number[] }>;
}

type Lean = NamedBudget & { _id: Types.ObjectId; updatedAt?: Date; createdAt?: Date };

/**
 * Named budgets: several a year, each with a name, a period to type amounts
 * by, and the accounts it plans. Kept as twelve months whatever the period,
 * so budget against actual reads them all alike. Plans only: nothing here
 * touches the ledger. Every change is audited.
 */
@Injectable()
export class BudgetsService {
  constructor(
    @InjectModel(NamedBudget.name) private model: Model<NamedBudgetDocument>,
    @InjectModel(Budget.name) private legacy: Model<BudgetDocument>,
    @InjectModel(LedgerAccount.name) private accountModel: Model<LedgerAccountDocument>,
    private audit: AuditService,
    private management: ManagementReportsService,
  ) {}

  private migrate(orgId: string) {
    return migrateLegacyBudgets({ legacy: this.legacy, named: this.model, audit: this.audit }, orgId);
  }

  private async accounts(orgId: string, ids?: string[]) {
    const filter: Record<string, unknown> = { orgId };
    if (ids) filter._id = { $in: ids.map((id) => new Types.ObjectId(id)) };
    const rows = await this.accountModel.find(filter, { name: 1, code: 1, type: 1, isGroup: 1, isActive: 1 }).lean().exec();
    return new Map(rows.map((a) => [String(a._id), a]));
  }

  private async find(orgId: string, id: string): Promise<Lean> {
    const b = Types.ObjectId.isValid(id) ? await this.model.findOne({ orgId, _id: new Types.ObjectId(id), status: { $ne: 'deleted' } }).lean().exec() : null;
    if (!b) throw new NotFoundException('No such budget.');
    return b as Lean;
  }

  private summary(b: Lean, types: Map<string, { type: string }>) {
    const total = (t: string) => b.rows.filter((r) => types.get(String(r.accountId))?.type === t).reduce((s, r) => s + r.monthsPaise.reduce((x, v) => x + v, 0), 0);
    return {
      id: String(b._id), name: b.name, financialYear: b.financialYear, period: b.period, includeBalanceSheet: b.includeBalanceSheet,
      isDefault: b.isDefault, status: b.status, migrated: !!b.migratedFrom, accounts: b.rows.length,
      incomePaise: total(AccountType.INCOME), expensePaise: total(AccountType.EXPENSE), updatedAt: b.updatedAt ?? null,
    };
  }

  /** The budgets, newest year first, the default first in each year. */
  async list(orgId: string, q: { financialYear?: string; status?: 'active' | 'archived' } = {}) {
    if (q.financialYear && !FY.test(q.financialYear)) throw new BadRequestException('financialYear looks like 2026-27.');
    await this.migrate(orgId);
    const docs = (await this.model
      .find({ orgId, status: q.status ?? 'active', ...(q.financialYear ? { financialYear: q.financialYear } : {}) })
      .sort({ financialYear: -1, isDefault: -1, name: 1 })
      .lean()
      .exec()) as Lean[];
    const types = await this.accounts(orgId);
    return docs.map((b) => this.summary(b, types));
  }

  /** One budget with its grid: each account's amounts by the budget's period, and by month. */
  async get(orgId: string, id: string) {
    await this.migrate(orgId);
    const b = await this.find(orgId, id);
    const accounts = await this.accounts(orgId);
    const rows = b.rows
      .map((r) => {
        const a = accounts.get(String(r.accountId));
        return { accountId: String(r.accountId), name: a?.name ?? 'Unknown account', code: a?.code ?? '', type: a?.type ?? null, monthsPaise: r.monthsPaise, amountsPaise: sumToPeriods(b.period, r.monthsPaise) };
      })
      .sort((x, y) => TYPE_ORDER.indexOf(x.type ?? '') - TYPE_ORDER.indexOf(y.type ?? '') || x.code.localeCompare(y.code));
    const start = Number(b.financialYear.slice(0, 4));
    return {
      ...this.summary(b, accounts),
      periods: periodLabels(b.period, b.financialYear),
      months: monthsBetween(`${start}-04`, `${start + 1}-03`),
      rows,
    };
  }

  /** The input checked against the books, with each row's amounts spread to months. */
  private async clean(orgId: string, input: BudgetInput, self?: Types.ObjectId) {
    const name = (input.name ?? '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 100) throw new BadRequestException('Give the budget a name, up to 100 characters.');
    if (!FY.test(input.financialYear ?? '')) throw new BadRequestException('financialYear looks like 2026-27.');
    const start = Number(input.financialYear.slice(0, 4));
    if (input.financialYear !== `${start}-${String((start + 1) % 100).padStart(2, '0')}`) throw new BadRequestException(`${input.financialYear} is not a financial year: 2026-27 runs April 2026 to March 2027.`);
    if (!BUDGET_PERIODS.includes(input.period)) throw new BadRequestException('The budget period is monthly, quarterly, half-yearly or yearly.');
    const includeBalanceSheet = !!input.includeBalanceSheet;
    const rows = input.rows ?? [];
    if (rows.length > MAX_ROWS) throw new BadRequestException(`A budget plans ${MAX_ROWS} accounts at most.`);

    const same = await this.model
      .findOne({ orgId, financialYear: input.financialYear, status: { $ne: 'deleted' }, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), ...(self ? { _id: { $ne: self } } : {}) }, { _id: 1 })
      .lean()
      .exec();
    if (same) throw new ConflictException(`There is already a budget called ${name} for ${input.financialYear}.`);

    const ids = rows.map((r) => r.accountId);
    if (ids.some((id) => !Types.ObjectId.isValid(id))) throw new BadRequestException('An account is not one of yours.');
    if (new Set(ids).size !== ids.length) throw new BadRequestException('An account is in the budget twice.');
    const accounts = ids.length ? await this.accounts(orgId, ids) : new Map();
    const count = periodCount(input.period);
    const out = rows.map((r) => {
      const a = accounts.get(r.accountId);
      if (!a) throw new BadRequestException('An account is not one of yours.');
      if (a.isGroup) throw new BadRequestException(`${a.name} is a group; budget the accounts under it.`);
      if (BS.has(a.type) && !includeBalanceSheet) throw new BadRequestException(`${a.name} is an asset, liability or capital account: tick Include asset, liability and capital accounts to budget it.`);
      if (!PL.has(a.type) && !BS.has(a.type)) throw new BadRequestException(`${a.name} cannot be budgeted.`);
      const amounts = r.amountsPaise ?? [];
      if (amounts.length !== count) throw new BadRequestException(`${a.name}: a ${input.period.replace('_', '-')} budget has ${count} amount${count === 1 ? '' : 's'}.`);
      for (const v of amounts) {
        if (!Number.isInteger(v)) throw new BadRequestException(`${a.name}: amounts are whole paise.`);
        if (Math.abs(v) > MAX_PAISE) throw new BadRequestException(`${a.name}: that amount is too large.`);
        // Income and expense are planned as a person says them, never below nil; a balance-sheet account may be planned to go down.
        if (v < 0 && PL.has(a.type)) throw new BadRequestException(`${a.name}: income and expense budgets are not below nil.`);
      }
      return { accountId: new Types.ObjectId(r.accountId), monthsPaise: splitToMonths(input.period, amounts) };
    });
    return { name, financialYear: input.financialYear, period: input.period, includeBalanceSheet, rows: out };
  }

  private snapshot(b: Pick<NamedBudget, 'name' | 'financialYear' | 'period' | 'includeBalanceSheet' | 'rows'>) {
    return { name: b.name, financialYear: b.financialYear, period: b.period, includeBalanceSheet: b.includeBalanceSheet, rows: b.rows.map((r) => ({ accountId: String(r.accountId), monthsPaise: r.monthsPaise })) };
  }

  async create(orgId: string, actorId: string, input: BudgetInput) {
    await this.migrate(orgId);
    const clean = await this.clean(orgId, input);
    // The year's first budget is its default.
    const hasDefault = await this.model.exists({ orgId, financialYear: clean.financialYear, status: 'active', isDefault: true });
    let doc: NamedBudgetDocument;
    try {
      doc = await this.model.create({ orgId, ...clean, isDefault: !hasDefault, status: 'active', createdBy: actorId, updatedBy: actorId });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      // Another budget became the year's default meanwhile.
      doc = await this.model.create({ orgId, ...clean, isDefault: false, status: 'active', createdBy: actorId, updatedBy: actorId });
    }
    await this.audit.record({ orgId, entityType: 'Budget', entityId: String(doc._id), action: 'CREATE_BUDGET', performedBy: actorId, before: null, after: { ...this.snapshot(doc), isDefault: doc.isDefault } });
    return this.get(orgId, String(doc._id));
  }

  /** Name, period, accounts and amounts. The year stays: a budget is for the year it was made for. */
  async update(orgId: string, actorId: string, id: string, input: BudgetInput) {
    await this.migrate(orgId);
    const b = await this.find(orgId, id);
    if (input.financialYear && input.financialYear !== b.financialYear) throw new BadRequestException(`This budget is for ${b.financialYear}: make a new one for ${input.financialYear}.`);
    const clean = await this.clean(orgId, { ...input, financialYear: b.financialYear }, b._id);
    const before = this.snapshot(b);
    const after = this.snapshot(clean);
    if (JSON.stringify(before) === JSON.stringify(after)) return { ...(await this.get(orgId, id)), changed: false };
    await this.model.updateOne({ orgId, _id: b._id }, { $set: { name: clean.name, period: clean.period, includeBalanceSheet: clean.includeBalanceSheet, rows: clean.rows, updatedBy: actorId } }, { runValidators: true }).exec();
    await this.audit.record({ orgId, entityType: 'Budget', entityId: id, action: 'UPDATE_BUDGET', performedBy: actorId, before, after });
    return { ...(await this.get(orgId, id)), changed: true };
  }

  /** Make this the year's default: budget against actual reads it when no budget is chosen. */
  async makeDefault(orgId: string, actorId: string, id: string) {
    const b = await this.find(orgId, id);
    if (b.status !== 'active') throw new BadRequestException('Restore the budget before making it the default.');
    if (b.isDefault) return this.get(orgId, id);
    const previous = await this.model.findOne({ orgId, financialYear: b.financialYear, isDefault: true }, { _id: 1, name: 1 }).lean().exec();
    await this.model.updateMany({ orgId, financialYear: b.financialYear, isDefault: true }, { $set: { isDefault: false } }).exec();
    try {
      await this.model.updateOne({ orgId, _id: b._id }, { $set: { isDefault: true, updatedBy: actorId } }).exec();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictException('Another budget was made the default at the same moment: reload and try again.');
      throw err;
    }
    await this.audit.record({ orgId, entityType: 'Budget', entityId: id, action: 'SET_DEFAULT_BUDGET', performedBy: actorId, before: { default: previous ? { id: String(previous._id), name: previous.name } : null }, after: { default: { id, name: b.name }, financialYear: b.financialYear } });
    return this.get(orgId, id);
  }

  /** When the default goes, the year's most recently changed active budget takes its place. */
  private async promoteDefault(orgId: string, actorId: string, financialYear: string, because: string) {
    if (await this.model.exists({ orgId, financialYear, status: 'active', isDefault: true })) return;
    const next = await this.model.findOne({ orgId, financialYear, status: 'active' }).sort({ updatedAt: -1 }).lean().exec();
    if (!next) return;
    try {
      await this.model.updateOne({ orgId, _id: next._id }, { $set: { isDefault: true } }).exec();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return; // another took the place meanwhile
      throw err;
    }
    await this.audit.record({ orgId, entityType: 'Budget', entityId: String(next._id), action: 'SET_DEFAULT_BUDGET', performedBy: actorId, before: { default: null }, after: { default: { id: String(next._id), name: next.name }, financialYear }, meta: { because } });
  }

  private async setStatus(orgId: string, actorId: string, id: string, status: 'active' | 'archived' | 'deleted', action: string) {
    const b = await this.find(orgId, id);
    if (b.status === status) return { id, status };
    await this.model.updateOne({ orgId, _id: b._id }, { $set: { status, isDefault: false, updatedBy: actorId } }).exec();
    await this.audit.record({
      orgId, entityType: 'Budget', entityId: id, action, performedBy: actorId,
      before: { status: b.status, isDefault: b.isDefault, ...(status === 'deleted' ? this.snapshot(b) : { name: b.name }) },
      after: { status },
    });
    await this.promoteDefault(orgId, actorId, b.financialYear, `${b.name} ${{ active: 'restored', archived: 'archived', deleted: 'deleted' }[status]}`);
    return { id, status };
  }

  /** Out of the list, kept; restore brings it back. */
  archive(orgId: string, actorId: string, id: string) {
    return this.setStatus(orgId, actorId, id, 'archived', 'ARCHIVE_BUDGET');
  }

  restore(orgId: string, actorId: string, id: string) {
    return this.setStatus(orgId, actorId, id, 'active', 'RESTORE_BUDGET');
  }

  /** Gone from every list; its last state stays in the audit trail. */
  remove(orgId: string, actorId: string, id: string) {
    return this.setStatus(orgId, actorId, id, 'deleted', 'DELETE_BUDGET');
  }

  /** Last year's actuals by month, changed by a percentage, for the accounts asked (or every one with a figure). */
  async fromYear(orgId: string, input: { financialYear: string; fromYear: string; changePct?: number; includeBalanceSheet?: boolean; accountIds?: string[] }) {
    const r = await this.management.budgetsFromYear(orgId, input.financialYear, input.fromYear, input.changePct ?? 0, { includeBalanceSheet: !!input.includeBalanceSheet });
    if (!input.accountIds?.length) return r;
    const wanted = new Set(input.accountIds);
    return { ...r, rows: r.rows.filter((row) => wanted.has(row.accountId)) };
  }
}
