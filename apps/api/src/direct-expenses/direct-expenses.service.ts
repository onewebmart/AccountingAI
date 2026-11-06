import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AccountType, VoucherType } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { AccountsService } from '../gl/accounts.service';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { LedgerAccount, LedgerAccountDocument, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { MONEY_NAME } from '../gl/money-accounts';
import { ApprovalsService } from '../approvals/approvals.service';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { gstinProblem } from '../extraction/invoice-checks';
import { DirectExpense, DirectExpenseDocument, DirectExpenseStatus, ExpenseLine } from './schemas/direct-expense.schema';
import { MileageSettings, MileageSettingsDocument } from './schemas/mileage-settings.schema';
import {
  ExpenseKind,
  GST_SLABS,
  MAX_BULK,
  MAX_LINES,
  MILEAGE_UNITS,
  MileageUnit,
  distanceHundredths,
  expenseTax,
  mileageAmount,
  mileageWords,
  rateOn,
  rupees,
} from './expense-lines';

export { GST_SLABS, expenseTax } from './expense-lines';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One account of an itemized expense, as typed. */
export interface ExpenseLineInput {
  expenseAccountId: string;
  /** Before tax, integer paise. */
  amountPaise: number;
  gstRatePct?: number;
  description?: string | null;
}

/** A mileage expense, as typed. */
export interface MileageInput {
  /** Up to two decimals. */
  distance: number;
  /** Blank: the preferences' unit. */
  unit?: MileageUnit;
  /** Typed on the expense; blank takes the preferences' rate in force on its date. */
  ratePaise?: number | null;
  employeeName?: string | null;
}

export interface DirectExpenseInput {
  date: string;
  /** An ordinary expense (the default), or a mileage expense. */
  kind?: ExpenseKind;
  vendorId?: string | null;
  /** One account and one amount; or `lines` instead, for an itemized expense. A mileage expense defaults to the preferences' account. */
  expenseAccountId?: string | null;
  /** The amount before tax, integer paise. */
  taxablePaise?: number | null;
  gstRatePct?: number;
  /** Itemized: the expense split across accounts, each with its own GST rate. */
  lines?: ExpenseLineInput[] | null;
  mileage?: MileageInput | null;
  paidThroughAccountId: string;
  interState?: boolean;
  /** The GST goes to input credit; otherwise it is part of the cost. */
  claimable?: boolean;
  vendorGstin?: string | null;
  reference?: string | null;
  notes?: string | null;
  projectId?: string | null;
  /** The customer it was spent for; billable when it is to be billed on to them. */
  customerId?: string | null;
  billable?: boolean;
  /** Set when a recurring expense drafts it. */
  recurringTemplateId?: string | null;
}

export interface PaidThroughAccount {
  _id: string;
  name: string;
  code: string;
  kind: 'bank' | 'cash' | 'other';
}

export interface MileageSettingsView {
  defaultAccountId: string | null;
  unit: MileageUnit;
  rates: Array<{ startDate: string; ratePaise: number }>;
  /** At least one rate is set. */
  configured: boolean;
}

export interface MileageSettingsInput {
  defaultAccountId?: string | null;
  unit: MileageUnit;
  rates: Array<{ startDate: string; ratePaise: number }>;
}

/** What bulk add did: every row saved (and posted, held or refused when posting was asked). */
export interface BulkResult {
  created: Array<{ row: number; _id: string; number: string }>;
  posted: Array<{ row: number; _id: string; number: string }>;
  held: Array<{ row: number; _id: string; number: string; reason: string }>;
  failed: Array<{ row: number; _id: string; number: string; reason: string }>;
}

/** Looked up once for a whole bulk add, not once a row. */
interface CheckMemo {
  paidThrough?: PaidThroughAccount[];
  mileage?: MileageSettingsView;
}

type CheckedLine = Omit<ExpenseLine, 'expenseAccountId'> & { expenseAccountId: Types.ObjectId };
type Checked = Awaited<ReturnType<DirectExpensesService['check']>>;

/** The fields one bulk row may carry: an ordinary expense on one account. */
const BULK_FIELDS = new Set(['date', 'expenseAccountId', 'taxablePaise', 'gstRatePct', 'paidThroughAccountId', 'vendorId', 'customerId', 'billable', 'projectId', 'interState', 'claimable', 'vendorGstin', 'reference', 'notes']);

/**
 * Expenses paid straight from the bank or cash, with no bill to pay later.
 * Drafted by a person (or a recurring expense), posted by a person: one
 * payment voucher, under the payment approval policy when there is one.
 */
@Injectable()
export class DirectExpensesService implements OnModuleInit {
  private readonly logger = new Logger(DirectExpensesService.name);

  constructor(
    @InjectModel(DirectExpense.name) private expenseModel: Model<DirectExpenseDocument>,
    @InjectModel(LedgerAccount.name) private accountModel: Model<LedgerAccountDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    private posting: PostingService,
    private accounts: AccountsService,
    private audit: AuditService,
    // Optional so specs (and recurring) that build this by hand need no approvals.
    @Optional() private approvals?: ApprovalsService,
    @Optional() @InjectModel(Project.name) private projectModel?: Model<ProjectDocument>,
    // Optional for the same reason: the customer an expense is billed to, and the mileage preferences.
    @Optional() @InjectModel(Customer.name) private customerModel?: Model<CustomerDocument>,
    @Optional() @InjectModel(MileageSettings.name) private mileageModel?: Model<MileageSettingsDocument>,
  ) {}

  /** An approved expense posts in the last approver's name. */
  onModuleInit() {
    this.approvals?.register('direct_expense', async (orgId, actorId, request) => {
      const p = request.payload as { expenseId: string };
      const posted = await this.post(orgId, actorId, '', p.expenseId, { approved: true });
      return String(posted.journalId);
    });
  }

  /** The accounts money can be paid from: Bank, Cash, and any asset ledger named like one. */
  async paidThroughAccounts(orgId: string): Promise<PaidThroughAccount[]> {
    const sys = await this.accounts.resolveSystemAccounts(orgId, [SystemAccountKey.BANK, SystemAccountKey.CASH]);
    const bank = sys.get(SystemAccountKey.BANK)!;
    const cash = sys.get(SystemAccountKey.CASH)!;
    const others = await this.accountModel
      .find({ orgId, type: AccountType.ASSETS, isGroup: false, isActive: { $ne: false }, systemKey: { $exists: false }, _id: { $nin: [bank._id, cash._id] } })
      .sort({ code: 1 })
      .lean()
      .exec();
    return [
      ...[bank, cash].filter((a) => a.isActive !== false).map((a) => ({ _id: String(a._id), name: a.name, code: a.code, kind: a.systemKey === SystemAccountKey.BANK ? ('bank' as const) : ('cash' as const) })),
      ...others.filter((a) => MONEY_NAME.test(a.name)).map((a) => ({ _id: String(a._id), name: a.name, code: a.code, kind: 'other' as const })),
    ];
  }

  // ── Mileage preferences ───────────────────────────────────────────────────

  /** The default account, the unit and the rates by start date. Nothing set: km, no rates. */
  async mileageSettings(orgId: string): Promise<MileageSettingsView> {
    const s = this.mileageModel ? await this.mileageModel.findOne({ orgId }).lean().exec() : null;
    const rates = (s?.rates ?? []).map((r) => ({ startDate: r.startDate, ratePaise: r.ratePaise })).sort((a, b) => a.startDate.localeCompare(b.startDate));
    return { defaultAccountId: s?.defaultAccountId ? String(s.defaultAccountId) : null, unit: s?.unit ?? 'km', rates, configured: rates.length > 0 };
  }

  async setMileageSettings(orgId: string, actorId: string, input: MileageSettingsInput): Promise<MileageSettingsView> {
    if (!this.mileageModel) throw new BadRequestException('Mileage preferences are not available here.');
    if (!(MILEAGE_UNITS as readonly string[]).includes(input.unit)) throw new BadRequestException('The unit is km or mile.');
    const rates = input.rates ?? [];
    if (rates.length > 50) throw new BadRequestException('At most 50 mileage rates.');
    const seen = new Set<string>();
    rates.forEach((r, i) => {
      if (!DATE.test(r.startDate ?? '')) throw new BadRequestException(`Rate ${i + 1}: the start date looks like 2026-04-01.`);
      if (!Number.isInteger(r.ratePaise) || r.ratePaise <= 0) throw new BadRequestException(`Rate ${i + 1}: the rate is whole paise, more than nothing.`);
      if (seen.has(r.startDate)) throw new BadRequestException(`Two rates start on ${r.startDate}: keep one.`);
      seen.add(r.startDate);
    });
    let defaultAccountId: Types.ObjectId | null = null;
    if (input.defaultAccountId) {
      await this.expenseAccounts(orgId, [input.defaultAccountId], () => 'The default mileage account must be an expense account (not a group, not deactivated).');
      defaultAccountId = new Types.ObjectId(input.defaultAccountId);
    }
    const before = await this.mileageSettings(orgId);
    const sorted = [...rates].sort((a, b) => a.startDate.localeCompare(b.startDate)).map((r) => ({ startDate: r.startDate, ratePaise: r.ratePaise }));
    await this.mileageModel.updateOne({ orgId }, { $set: { defaultAccountId, unit: input.unit, rates: sorted } }, { upsert: true, runValidators: true }).exec();
    const after = await this.mileageSettings(orgId);
    await this.audit.record({ orgId, entityType: 'MileageSettings', entityId: orgId, action: 'UPDATE', performedBy: actorId, before: { ...before }, after: { ...after } });
    return after;
  }

  // ── Drafts ────────────────────────────────────────────────────────────────

  async create(orgId: string, actorId: string, input: DirectExpenseInput): Promise<DirectExpenseDocument> {
    const clean = await this.check(orgId, input);
    // The number is taken in the same transaction as the save: a failed save leaves no gap (Invariant 7).
    const expense = await this.posting.inTransaction((session) => this.saveDraft(orgId, actorId, clean, input.recurringTemplateId ?? null, session));
    this.logger.log(`Expense ${expense.number} drafted for ${orgId}`);
    return expense;
  }

  /**
   * Many expenses at once, from the bulk grid. Every row is checked as a
   * single expense is; if any row is wrong nothing is saved, and the rows are
   * returned with their numbers and reasons (a 400 whose `rows` lists them).
   * Otherwise every row is saved as a draft in one transaction, numbered in
   * order. With `post`, each draft is then posted in its own transaction, as
   * Post to ledger would: a payment approval policy may hold some, and a
   * refused posting leaves its draft saved, reported against its row.
   */
  async bulk(orgId: string, actorId: string, actorRole: string, rows: unknown[], post = false): Promise<BulkResult> {
    if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException('Add at least one expense.');
    if (rows.length > MAX_BULK) throw new BadRequestException(`At most ${MAX_BULK} expenses at a time.`);
    const memo: CheckMemo = {};
    const problems: Array<{ row: number; error: string }> = [];
    const checked: Checked[] = [];
    for (let i = 0; i < rows.length; i++) {
      try {
        checked.push(await this.check(orgId, this.bulkRow(rows[i]), memo));
      } catch (e) {
        problems.push({ row: i + 1, error: reason(e) });
      }
    }
    if (problems.length) {
      throw new BadRequestException({
        statusCode: 400,
        message: `${problems.length === 1 ? `Row ${problems[0].row} needs` : `${problems.length} rows need`} a fix. Nothing was saved.`,
        rows: problems,
      });
    }

    // All the drafts, or none: one transaction, the numbers taken in it in row order.
    const drafts = await this.posting.inTransaction(async (session) => {
      const saved: DirectExpenseDocument[] = [];
      for (const clean of checked) saved.push(await this.saveDraft(orgId, actorId, clean, null, session, true));
      return saved;
    });
    this.logger.log(`${drafts.length} expenses drafted in bulk for ${orgId}`);

    const result: BulkResult = { created: drafts.map((d, i) => ({ row: i + 1, _id: String(d._id), number: d.number })), posted: [], held: [], failed: [] };
    if (!post) return result;
    for (const c of result.created) {
      try {
        await this.post(orgId, actorId, actorRole, c._id);
        result.posted.push(c);
      } catch (e) {
        if (e instanceof ConflictException) result.held.push({ ...c, reason: reason(e) });
        else result.failed.push({ ...c, reason: reason(e) });
      }
    }
    return result;
  }

  /** Change a draft. A posted expense is never changed: reverse its voucher instead. */
  async update(orgId: string, actorId: string, id: string, input: Partial<DirectExpenseInput>): Promise<DirectExpenseDocument> {
    const current = await this.expense(orgId, id);
    if (current.status !== 'draft') throw new BadRequestException('A posted expense cannot be changed. Reverse its voucher and enter it again.');
    const kind: ExpenseKind = current.kind ?? 'expense';
    if (input.kind && input.kind !== kind) throw new BadRequestException(kind === 'mileage' ? 'This is a mileage expense: enter an ordinary one separately.' : 'This is an ordinary expense: enter mileage separately.');
    const stored = linesOf(current);
    const keep = <K extends keyof DirectExpenseInput>(k: K, now: DirectExpenseInput[K]): DirectExpenseInput[K] => (input[k] !== undefined ? input[k] : now);

    // Where the cost goes: lines sent replace the lines; one account or amount sent makes it a single-account expense; neither keeps what is there.
    let costing: Pick<DirectExpenseInput, 'expenseAccountId' | 'taxablePaise' | 'gstRatePct' | 'lines' | 'mileage'>;
    if (kind === 'mileage') {
      const m = current.mileage;
      costing = {
        expenseAccountId: input.expenseAccountId ?? String(current.expenseAccountId),
        mileage: input.mileage !== undefined && input.mileage !== null
          ? input.mileage
          : m
            // A rate that came from the preferences is looked up again: the date may have moved.
            ? { distance: m.distance, unit: m.unit, ratePaise: m.rateSource === 'typed' ? m.ratePaise : null, employeeName: m.employeeName }
            : null,
      };
    } else if (input.lines && input.lines.length > 0) {
      costing = { lines: input.lines };
    } else if (input.expenseAccountId !== undefined || input.taxablePaise !== undefined || input.gstRatePct !== undefined) {
      costing = {
        expenseAccountId: input.expenseAccountId ?? String(stored[0].expenseAccountId),
        taxablePaise: input.taxablePaise ?? current.taxablePaise,
        gstRatePct: input.gstRatePct ?? (stored.length === 1 ? stored[0].gstRatePct : current.gstRatePct),
      };
    } else {
      costing = { lines: stored.map((l) => ({ expenseAccountId: String(l.expenseAccountId), amountPaise: l.amountPaise, gstRatePct: l.gstRatePct, description: l.description })) };
    }

    const merged: DirectExpenseInput = {
      date: input.date ?? current.date,
      kind,
      ...costing,
      vendorId: keep('vendorId', current.vendorId ? String(current.vendorId) : null),
      paidThroughAccountId: input.paidThroughAccountId ?? String(current.paidThroughAccountId),
      interState: input.interState ?? current.interState,
      claimable: input.claimable ?? current.claimable,
      vendorGstin: keep('vendorGstin', current.vendorGstin),
      reference: keep('reference', current.reference),
      notes: keep('notes', current.notes),
      projectId: keep('projectId', current.projectId ? String(current.projectId) : null),
      customerId: keep('customerId', current.customerId ? String(current.customerId) : null),
      // A customer taken off takes billable with it.
      billable: input.billable ?? (input.customerId === null ? false : current.billable),
    };
    const clean = await this.check(orgId, merged);
    const before = this.summary(current);
    const updated = await this.expenseModel.findOneAndUpdate({ _id: current._id, orgId, status: 'draft' }, { $set: clean }, { new: true, runValidators: true }).exec();
    if (!updated) throw new BadRequestException('This expense was posted meanwhile: it cannot be changed now.');
    await this.audit.record({ orgId, entityType: 'DirectExpense', entityId: id, action: 'UPDATE', performedBy: actorId, before, after: this.summary(updated) });
    return updated;
  }

  /**
   * Post a draft: one payment voucher through PostingService (the single
   * writer to the ledger). Each line debits its own expense account (with its
   * GST, when that cannot be claimed); claimable GST goes to input credit,
   * the lines' CGST, SGST and IGST summed; the bank or cash it was paid from
   * is credited the total. A payment approval policy can hold it: the
   * request is made, and the server says so.
   */
  async post(orgId: string, actorId: string, actorRole: string, id: string, opts: { approved?: boolean } = {}): Promise<DirectExpenseDocument> {
    const e = await this.expense(orgId, id);
    if (e.status !== 'draft') throw new BadRequestException('This expense is already posted.');
    if (this.approvals && !opts.approved) {
      await this.approvals.gate({
        orgId, docType: 'payment', docId: id, payload: { kind: 'direct_expense', expenseId: id },
        summary: `Expense ${e.number} — ${rupees(e.totalPaise)}`, amountPaise: e.totalPaise, makerId: e.createdBy, actorId, actorRole,
        facts: { date: e.date, amountPaise: e.totalPaise },
      });
    }

    const costLines = linesOf(e);
    const names = await this.accounts.namesOf(orgId, [...costLines.map((l) => String(l.expenseAccountId)), String(e.paidThroughAccountId)]);
    const projectId = e.projectId ? String(e.projectId) : null;
    const lines: Array<{ accountId: string; description: string; debitPaise: number; creditPaise: number; projectId?: string | null }> = costLines.map((l) => {
      const name = names.get(String(l.expenseAccountId)) ?? 'Expense';
      return {
        accountId: String(l.expenseAccountId),
        description: l.description ? `${name}: ${l.description}` : name,
        // GST that cannot be claimed is part of what the thing cost.
        debitPaise: e.claimable ? l.amountPaise : l.amountPaise + l.cgstPaise + l.sgstPaise + l.igstPaise,
        creditPaise: 0,
        projectId,
      };
    });
    const tax = e.cgstPaise + e.sgstPaise + e.igstPaise;
    if (e.claimable && tax > 0) {
      const keys = await this.accounts.resolveSystemAccounts(orgId, [SystemAccountKey.GST_INPUT_CGST, SystemAccountKey.GST_INPUT_SGST, SystemAccountKey.GST_INPUT_IGST]);
      for (const [key, amount] of [
        [SystemAccountKey.GST_INPUT_CGST, e.cgstPaise],
        [SystemAccountKey.GST_INPUT_SGST, e.sgstPaise],
        [SystemAccountKey.GST_INPUT_IGST, e.igstPaise],
      ] as const) {
        if (amount > 0) lines.push({ accountId: String(keys.get(key)!._id), description: keys.get(key)!.name, debitPaise: amount, creditPaise: 0 });
      }
    }
    lines.push({ accountId: String(e.paidThroughAccountId), description: names.get(String(e.paidThroughAccountId)) ?? 'Bank', debitPaise: 0, creditPaise: e.totalPaise });

    const what = e.kind === 'mileage' && e.mileage ? ` — mileage ${mileageWords(e.mileage.distance, e.mileage.unit, e.mileage.ratePaise)}` : '';
    const updated = await this.posting.inTransaction(async (session) => {
      // Claim the draft first, so a second click finds nothing to post.
      const claimed = await this.expenseModel.findOneAndUpdate({ _id: e._id, orgId, status: 'draft' }, { $set: { status: 'posted', postedBy: actorId } }, { session }).exec();
      if (!claimed) throw new BadRequestException('This expense has just been posted.');
      const journal = await this.posting.post(
        {
          orgId,
          voucherType: VoucherType.PAYMENT,
          financialYear: financialYearOf(e.date),
          date: e.date,
          narration: `Expense ${e.number}${e.reference ? ` (${e.reference})` : ''}${what}${e.notes ? ` — ${e.notes}` : ''}`,
          postedBy: actorId,
          lines,
        },
        session,
      );
      await this.audit.record(
        { orgId, entityType: 'DirectExpense', entityId: id, action: 'POST', performedBy: actorId, before: { status: 'draft' }, after: { status: 'posted', journalId: String(journal._id), totalPaise: e.totalPaise } },
        session,
      );
      return this.expenseModel.findOneAndUpdate({ _id: e._id, orgId }, { $set: { journalId: journal._id } }, { new: true, session }).exec();
    });
    this.logger.log(`Expense ${e.number} posted → Journal ${updated!.journalId}`);
    return updated!;
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  async list(orgId: string, filter: { status?: DirectExpenseStatus; q?: string; billable?: boolean; customerId?: string } = {}) {
    const query: Record<string, unknown> = { orgId };
    if (filter.status === 'draft' || filter.status === 'posted') query.status = filter.status;
    if (filter.billable) query.billable = true;
    if (filter.customerId) {
      if (!Types.ObjectId.isValid(filter.customerId)) return [];
      query.customerId = new Types.ObjectId(filter.customerId);
    }
    const rows = await this.expenseModel.find(query).sort({ date: -1, number: -1 }).limit(300).lean().exec();
    const view = await this.views(orgId, rows);
    const q = filter.q?.trim().toLowerCase();
    return q
      ? view.filter((r) => [r.number, r.vendorName, r.customerName, r.reference, r.notes, ...r.lines.map((l) => l.expenseAccountName), ...r.lines.map((l) => l.description)].some((s) => s?.toLowerCase().includes(q)))
      : view;
  }

  /** Billable expenses not yet put on an invoice: one customer's, or everyone's. Drafts included, marked by status. */
  async billable(orgId: string, customerId?: string) {
    const query: Record<string, unknown> = { orgId, billable: true, invoiceId: null };
    if (customerId) {
      if (!Types.ObjectId.isValid(customerId)) throw new BadRequestException('No such customer.');
      query.customerId = new Types.ObjectId(customerId);
    }
    const rows = await this.expenseModel.find(query).sort({ date: 1, number: 1 }).limit(500).lean().exec();
    return this.views(orgId, rows);
  }

  async get(orgId: string, id: string) {
    const e = await this.expense(orgId, id);
    const [view] = await this.views(orgId, [e.toObject()]);
    return view;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Number a checked draft from the EXPENSE series and save it, with its audit entry, in the caller's transaction. */
  private async saveDraft(orgId: string, actorId: string, clean: Checked, recurringTemplateId: string | null, session: ClientSession, bulk = false): Promise<DirectExpenseDocument> {
    const fy = financialYearOf(clean.date);
    const seq = await this.posting.nextDocumentNumber(orgId, 'EXPENSE', fy, session);
    const [doc] = await this.expenseModel.create(
      [{ orgId, number: `EXP/${fy}/${String(seq).padStart(4, '0')}`, ...clean, status: 'draft', createdBy: actorId, recurringTemplateId: recurringTemplateId && Types.ObjectId.isValid(recurringTemplateId) ? new Types.ObjectId(recurringTemplateId) : null }],
      { session },
    );
    await this.audit.record(
      {
        orgId, entityType: 'DirectExpense', entityId: String(doc._id), action: 'CREATE', performedBy: actorId,
        after: {
          number: doc.number, kind: doc.kind, date: doc.date, totalPaise: doc.totalPaise, claimable: doc.claimable, lines: doc.lines.length,
          customerId: doc.customerId ? String(doc.customerId) : null, billable: doc.billable, recurringTemplateId, ...(bulk ? { bulk: true } : {}),
        },
      },
      session,
    );
    return doc;
  }

  /** Rows with the names a screen shows beside the ids. */
  private async views(orgId: string, rows: Array<DirectExpense & { _id: Types.ObjectId; createdAt?: Date }>) {
    const accountIds = [...new Set(rows.flatMap((r) => [String(r.expenseAccountId), String(r.paidThroughAccountId), ...(r.lines ?? []).map((l) => String(l.expenseAccountId))]))];
    const vendorIds = [...new Set(rows.map((r) => r.vendorId).filter((v): v is Types.ObjectId => !!v).map(String))];
    const customerIds = [...new Set(rows.map((r) => r.customerId).filter((v): v is Types.ObjectId => !!v).map(String))];
    const [names, vendors, customers] = await Promise.all([
      this.accounts.namesOf(orgId, accountIds),
      vendorIds.length ? this.vendorModel.find({ orgId, _id: { $in: vendorIds } }, { name: 1 }).lean().exec() : Promise.resolve([]),
      customerIds.length && this.customerModel ? this.customerModel.find({ orgId, _id: { $in: customerIds } }, { name: 1 }).lean().exec() : Promise.resolve([]),
    ]);
    const vendorName = new Map(vendors.map((v) => [String(v._id), v.name]));
    const customerName = new Map(customers.map((c) => [String(c._id), c.name]));
    return rows.map((r) => {
      const lines = linesOf(r).map((l) => ({
        expenseAccountId: String(l.expenseAccountId),
        expenseAccountName: names.get(String(l.expenseAccountId)) ?? 'Unknown account',
        description: l.description ?? null,
        amountPaise: l.amountPaise,
        gstRatePct: l.gstRatePct,
        cgstPaise: l.cgstPaise,
        sgstPaise: l.sgstPaise,
        igstPaise: l.igstPaise,
      }));
      return {
        _id: String(r._id),
        number: r.number,
        kind: (r.kind ?? 'expense') as ExpenseKind,
        date: r.date,
        vendorId: r.vendorId ? String(r.vendorId) : null,
        vendorName: r.vendorId ? vendorName.get(String(r.vendorId)) ?? 'Unknown vendor' : null,
        expenseAccountId: String(r.expenseAccountId),
        expenseAccountName: names.get(String(r.expenseAccountId)) ?? 'Unknown account',
        /** More than one line: split across accounts. */
        itemized: lines.length > 1,
        lines,
        mileage: r.mileage ? { distance: r.mileage.distance, unit: r.mileage.unit, ratePaise: r.mileage.ratePaise, rateSource: r.mileage.rateSource, employeeName: r.mileage.employeeName ?? null } : null,
        paidThroughAccountId: String(r.paidThroughAccountId),
        paidThroughAccountName: names.get(String(r.paidThroughAccountId)) ?? 'Unknown account',
        taxablePaise: r.taxablePaise,
        gstRatePct: r.gstRatePct,
        interState: r.interState,
        claimable: r.claimable,
        vendorGstin: r.vendorGstin,
        cgstPaise: r.cgstPaise,
        sgstPaise: r.sgstPaise,
        igstPaise: r.igstPaise,
        totalPaise: r.totalPaise,
        reference: r.reference,
        notes: r.notes,
        projectId: r.projectId ? String(r.projectId) : null,
        customerId: r.customerId ? String(r.customerId) : null,
        customerName: r.customerId ? customerName.get(String(r.customerId)) ?? 'Unknown customer' : null,
        billable: !!r.billable,
        invoiceId: r.invoiceId ? String(r.invoiceId) : null,
        status: r.status,
        journalId: r.journalId ? String(r.journalId) : null,
        recurringTemplateId: r.recurringTemplateId ? String(r.recurringTemplateId) : null,
        createdBy: r.createdBy,
      };
    });
  }

  /**
   * The input checked and priced: accounts of the right kind, whole paise, a
   * GST slab on every line, the mileage rate in force. Saves nothing:
   * recurring expenses and bulk add check theirs with it.
   */
  async check(orgId: string, input: DirectExpenseInput, memo: CheckMemo = {}) {
    if (!DATE.test(input.date ?? '')) throw new BadRequestException('date must look like 2026-11-04');
    const kind: ExpenseKind = input.kind ?? 'expense';
    if (kind !== 'expense' && kind !== 'mileage') throw new BadRequestException('kind is expense or mileage.');
    const interState = kind === 'expense' && !!input.interState;

    // The lines the cost is booked to, as typed: a mileage expense is one, worked out from the distance.
    let typed: ExpenseLineInput[];
    let mileage: { distance: number; unit: MileageUnit; ratePaise: number; rateSource: 'preferences' | 'typed'; employeeName: string | null } | null = null;
    if (kind === 'mileage') {
      if (input.lines && input.lines.length > 1) throw new BadRequestException('A mileage expense is one distance at one rate: it is not itemized.');
      const m = input.mileage;
      const hundredths = distanceHundredths(m?.distance);
      if (!m || hundredths === null) throw new BadRequestException('Enter the distance: more than nothing, up to two decimals, at most 1,00,000.');
      const prefs = memo.mileage ?? (memo.mileage = await this.mileageSettings(orgId));
      const unit = m.unit ?? prefs.unit;
      if (!(MILEAGE_UNITS as readonly string[]).includes(unit)) throw new BadRequestException('The unit is km or mile.');
      let ratePaise: number;
      let rateSource: 'preferences' | 'typed';
      if (m.ratePaise !== undefined && m.ratePaise !== null) {
        if (!Number.isInteger(m.ratePaise) || m.ratePaise <= 0) throw new BadRequestException('The mileage rate is whole paise, more than nothing.');
        ratePaise = m.ratePaise;
        rateSource = 'typed';
      } else {
        const inForce = rateOn(prefs.rates, input.date);
        if (!inForce) throw new BadRequestException(`No mileage rate is in force on ${input.date}. Add one in mileage preferences, or type the rate.`);
        if (unit !== prefs.unit) throw new BadRequestException(`The mileage rates are per ${prefs.unit}: enter the distance in ${prefs.unit === 'km' ? 'km' : 'miles'}, or type the rate per ${unit}.`);
        ratePaise = inForce.ratePaise;
        rateSource = 'preferences';
      }
      const amountPaise = mileageAmount(hundredths, ratePaise);
      if (amountPaise <= 0) throw new BadRequestException('That distance at that rate comes to nothing.');
      const accountId = input.expenseAccountId || prefs.defaultAccountId;
      if (!accountId) throw new BadRequestException('Pick the expense account mileage is booked to, or set a default in mileage preferences.');
      mileage = { distance: hundredths / 100, unit, ratePaise, rateSource, employeeName: input.mileage?.employeeName?.trim().slice(0, 120) || null };
      typed = [{ expenseAccountId: accountId, amountPaise, gstRatePct: 0, description: mileageWords(mileage.distance, unit, ratePaise) }];
    } else if (input.lines && input.lines.length > 0) {
      if (input.lines.length > MAX_LINES) throw new BadRequestException(`An expense can be split across at most ${MAX_LINES} lines.`);
      typed = input.lines;
    } else {
      typed = [{ expenseAccountId: input.expenseAccountId ?? '', amountPaise: input.taxablePaise as number, gstRatePct: input.gstRatePct ?? 0, description: null }];
    }

    const itemized = typed.length > 1;
    const at = (i: number) => (itemized ? `Line ${i + 1}: ` : '');
    typed.forEach((l, i) => {
      if (!Number.isInteger(l.amountPaise) || l.amountPaise <= 0) throw new BadRequestException(`${at(i)}The amount before tax is whole paise, more than nothing.`);
      const rate = l.gstRatePct ?? 0;
      if (!(GST_SLABS as readonly number[]).includes(rate)) throw new BadRequestException(`${at(i)}${rate}% is not a GST slab.`);
      if (kind === 'mileage' && rate !== 0) throw new BadRequestException('A mileage expense carries no GST.');
      if (l.description !== undefined && l.description !== null && typeof l.description !== 'string') throw new BadRequestException(`${at(i)}The description is text.`);
    });
    if (!Types.ObjectId.isValid(input.paidThroughAccountId ?? '')) throw new BadRequestException('Pick the bank or cash account it was paid from.');
    await this.expenseAccounts(orgId, typed.map((l) => l.expenseAccountId), (i) => `${at(i)}Pick an expense account (not a group, not deactivated).`);
    const paidThroughList = memo.paidThrough ?? (memo.paidThrough = await this.paidThroughAccounts(orgId));
    if (!paidThroughList.some((a) => a._id === input.paidThroughAccountId)) throw new BadRequestException('Paid through must be a bank or cash account.');

    const lines: CheckedLine[] = typed.map((l) => {
      const rate = l.gstRatePct ?? 0;
      const { cgstPaise, sgstPaise, igstPaise } = expenseTax(l.amountPaise, rate, interState);
      return { expenseAccountId: new Types.ObjectId(l.expenseAccountId), description: l.description?.trim().slice(0, 300) || null, amountPaise: l.amountPaise, gstRatePct: rate, cgstPaise, sgstPaise, igstPaise };
    });
    const sum = (k: 'amountPaise' | 'cgstPaise' | 'sgstPaise' | 'igstPaise') => lines.reduce((s, l) => s + l[k], 0);
    const taxablePaise = sum('amountPaise');
    const cgstPaise = sum('cgstPaise');
    const sgstPaise = sum('sgstPaise');
    const igstPaise = sum('igstPaise');
    const rates = [...new Set(lines.map((l) => l.gstRatePct))];
    const claimable = kind === 'expense' && !!input.claimable && cgstPaise + sgstPaise + igstPaise > 0;

    const typedGstin = typeof input.vendorGstin === 'string' ? input.vendorGstin.trim().toUpperCase() || null : null;
    let vendorId: Types.ObjectId | null = null;
    let onRecord: string | null = null;
    if (input.vendorId) {
      const vendor = Types.ObjectId.isValid(input.vendorId) ? await this.vendorModel.findOne({ _id: input.vendorId, orgId }).lean().exec() : null;
      if (!vendor) throw new NotFoundException('Vendor not found');
      vendorId = vendor._id as Types.ObjectId;
      onRecord = vendor.gstin?.trim().toUpperCase() || null;
    }
    // A GSTIN typed here is checked; the one on the vendor's record is taken as it is.
    if (typedGstin && typedGstin !== onRecord) {
      const problem = gstinProblem(typedGstin);
      if (problem) throw new BadRequestException(`GSTIN ${typedGstin} ${problem}`);
    }
    const vendorGstin = typedGstin ?? onRecord;
    if (claimable && !vendorGstin) throw new BadRequestException("Claiming the GST needs the supplier's GSTIN, as printed on their invoice.");

    let projectId: Types.ObjectId | null = null;
    if (input.projectId) {
      if (!Types.ObjectId.isValid(input.projectId)) throw new BadRequestException('No such project.');
      if (this.projectModel && !(await this.projectModel.exists({ _id: input.projectId, orgId }).exec())) throw new BadRequestException('No such project.');
      projectId = new Types.ObjectId(input.projectId);
    }

    let customerId: Types.ObjectId | null = null;
    if (input.customerId) {
      if (!Types.ObjectId.isValid(input.customerId)) throw new NotFoundException('Customer not found');
      if (!this.customerModel) throw new BadRequestException('Expenses for a customer need the sales module.');
      if (!(await this.customerModel.exists({ _id: input.customerId, orgId }).exec())) throw new NotFoundException('Customer not found');
      customerId = new Types.ObjectId(input.customerId);
    }
    if (input.billable && !customerId) throw new BadRequestException('A billable expense needs the customer it is billed to.');

    return {
      kind,
      date: input.date,
      vendorId,
      // The first line's account, for lists and for recurring expenses of one account.
      expenseAccountId: lines[0].expenseAccountId,
      lines,
      mileage,
      paidThroughAccountId: new Types.ObjectId(input.paidThroughAccountId),
      taxablePaise,
      gstRatePct: rates.length === 1 ? rates[0] : Math.max(...rates),
      interState,
      claimable,
      vendorGstin,
      cgstPaise,
      sgstPaise,
      igstPaise,
      totalPaise: taxablePaise + cgstPaise + sgstPaise + igstPaise,
      reference: typeof input.reference === 'string' ? input.reference.trim().slice(0, 120) || null : null,
      notes: typeof input.notes === 'string' ? input.notes.trim().slice(0, 1000) || null : null,
      projectId,
      customerId,
      billable: !!input.billable && !!customerId,
    };
  }

  /** Every id an expense account of this org: not a group, not deactivated. The message says which one is not. */
  private async expenseAccounts(orgId: string, ids: string[], problem: (index: number) => string) {
    const bad = ids.findIndex((i) => !Types.ObjectId.isValid(i ?? ''));
    if (bad >= 0) throw new BadRequestException(problem(bad));
    const found = await this.accountModel.find({ orgId, _id: { $in: [...new Set(ids)] } }).lean().exec();
    const ok = new Set(found.filter((a) => !a.isGroup && a.isActive !== false && a.type === AccountType.EXPENSE).map((a) => String(a._id)));
    const wrong = ids.findIndex((i) => !ok.has(String(i)));
    if (wrong >= 0) throw new BadRequestException(problem(wrong));
  }

  /** One row of a bulk add, its fields checked for their kinds before the expense rules run. */
  private bulkRow(raw: unknown): DirectExpenseInput {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('Not an expense.');
    const r = raw as Record<string, unknown>;
    const unknown = Object.keys(r).find((k) => !BULK_FIELDS.has(k));
    if (unknown) throw new BadRequestException(`${unknown} is not a field of a bulk expense.`);
    const text = (k: string, max: number): string | null => {
      const v = r[k];
      if (v === undefined || v === null || v === '') return null;
      if (typeof v !== 'string') throw new BadRequestException(`${k} must be text.`);
      if (v.length > max) throw new BadRequestException(`${k} is at most ${max} characters.`);
      return v;
    };
    const flag = (k: string): boolean => {
      const v = r[k];
      if (v === undefined || v === null) return false;
      if (typeof v !== 'boolean') throw new BadRequestException(`${k} is true or false.`);
      return v;
    };
    const num = (k: string): number | undefined => {
      const v = r[k];
      if (v === undefined || v === null) return undefined;
      if (typeof v !== 'number') throw new BadRequestException(`${k} must be a number.`);
      return v;
    };
    const taxablePaise = num('taxablePaise');
    if (taxablePaise === undefined) throw new BadRequestException('Enter the amount.');
    return {
      date: text('date', 10) ?? '',
      expenseAccountId: text('expenseAccountId', 24) ?? '',
      taxablePaise,
      gstRatePct: num('gstRatePct'),
      paidThroughAccountId: text('paidThroughAccountId', 24) ?? '',
      vendorId: text('vendorId', 24),
      customerId: text('customerId', 24),
      billable: flag('billable'),
      projectId: text('projectId', 24),
      interState: flag('interState'),
      claimable: flag('claimable'),
      vendorGstin: text('vendorGstin', 15),
      reference: text('reference', 120),
      notes: text('notes', 1000),
    };
  }

  private summary(e: DirectExpense) {
    return {
      kind: e.kind ?? 'expense', date: e.date, taxablePaise: e.taxablePaise, gstRatePct: e.gstRatePct, interState: e.interState, claimable: e.claimable, totalPaise: e.totalPaise,
      expenseAccountId: String(e.expenseAccountId), paidThroughAccountId: String(e.paidThroughAccountId),
      lines: linesOf(e).map((l) => ({ expenseAccountId: String(l.expenseAccountId), amountPaise: l.amountPaise, gstRatePct: l.gstRatePct })),
      mileage: e.mileage ? { distance: e.mileage.distance, unit: e.mileage.unit, ratePaise: e.mileage.ratePaise } : null,
      customerId: e.customerId ? String(e.customerId) : null, billable: !!e.billable,
    };
  }

  private async expense(orgId: string, id: string): Promise<DirectExpenseDocument> {
    const e = Types.ObjectId.isValid(id) ? await this.expenseModel.findOne({ _id: id, orgId }).exec() : null;
    if (!e) throw new NotFoundException('Expense not found');
    return e;
  }
}

/** An expense's lines; one made from its own fields when it was saved before expenses had lines. */
export function linesOf(e: Pick<DirectExpense, 'lines' | 'expenseAccountId' | 'taxablePaise' | 'gstRatePct' | 'cgstPaise' | 'sgstPaise' | 'igstPaise'>): ExpenseLine[] {
  if (e.lines && e.lines.length) return e.lines;
  return [{ expenseAccountId: e.expenseAccountId, description: null, amountPaise: e.taxablePaise, gstRatePct: e.gstRatePct, cgstPaise: e.cgstPaise, sgstPaise: e.sgstPaise, igstPaise: e.igstPaise }];
}

/** A refusal's words, for a row of a bulk add. */
function reason(e: unknown): string {
  if (e instanceof HttpException) {
    const body = e.getResponse();
    if (typeof body === 'string') return body;
    const m = (body as { message?: unknown }).message;
    if (Array.isArray(m)) return m.join(', ');
    if (typeof m === 'string') return m;
  }
  return e instanceof Error ? e.message : String(e);
}
