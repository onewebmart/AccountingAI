import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccountType, VoucherType } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { AccountsService } from '../gl/accounts.service';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { LedgerAccount, LedgerAccountDocument, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { MONEY_NAME } from '../gl/money-accounts';
import { ApprovalsService } from '../approvals/approvals.service';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { gstinProblem } from '../extraction/invoice-checks';
import { DirectExpense, DirectExpenseDocument, DirectExpenseStatus } from './schemas/direct-expense.schema';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const GST_SLABS = [0, 3, 5, 12, 18, 28, 40] as const;

export interface DirectExpenseInput {
  date: string;
  vendorId?: string | null;
  expenseAccountId: string;
  paidThroughAccountId: string;
  /** The amount before tax, integer paise. */
  taxablePaise: number;
  gstRatePct?: number;
  interState?: boolean;
  /** The GST goes to input credit; otherwise it is part of the cost. */
  claimable?: boolean;
  vendorGstin?: string | null;
  reference?: string | null;
  notes?: string | null;
  projectId?: string | null;
  /** Set when a recurring expense drafts it. */
  recurringTemplateId?: string | null;
}

export interface PaidThroughAccount {
  _id: string;
  name: string;
  code: string;
  kind: 'bank' | 'cash' | 'other';
}

/** GST on an amount before tax: IGST whole, or CGST and SGST halves that add up to it. Integer paise. */
export function expenseTax(taxablePaise: number, gstRatePct: number, interState: boolean) {
  const tax = Math.round((taxablePaise * gstRatePct) / 100);
  if (interState) return { cgstPaise: 0, sgstPaise: 0, igstPaise: tax, totalPaise: taxablePaise + tax };
  const half = Math.round(tax / 2);
  return { cgstPaise: half, sgstPaise: tax - half, igstPaise: 0, totalPaise: taxablePaise + tax };
}

const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

  async create(orgId: string, actorId: string, input: DirectExpenseInput): Promise<DirectExpenseDocument> {
    const clean = await this.check(orgId, input);
    const fy = financialYearOf(clean.date);
    // The number is taken in the same transaction as the save: a failed save leaves no gap (Invariant 7).
    const expense = await this.posting.inTransaction(async (session) => {
      const seq = await this.posting.nextDocumentNumber(orgId, 'EXPENSE', fy, session);
      const [doc] = await this.expenseModel.create(
        [{ orgId, number: `EXP/${fy}/${String(seq).padStart(4, '0')}`, ...clean, status: 'draft', createdBy: actorId, recurringTemplateId: input.recurringTemplateId && Types.ObjectId.isValid(input.recurringTemplateId) ? new Types.ObjectId(input.recurringTemplateId) : null }],
        { session },
      );
      await this.audit.record(
        { orgId, entityType: 'DirectExpense', entityId: String(doc._id), action: 'CREATE', performedBy: actorId, after: { number: doc.number, date: doc.date, totalPaise: doc.totalPaise, claimable: doc.claimable, recurringTemplateId: input.recurringTemplateId ?? null } },
        session,
      );
      return doc;
    });
    this.logger.log(`Expense ${expense.number} drafted for ${orgId}`);
    return expense;
  }

  /** Change a draft. A posted expense is never changed: reverse its voucher instead. */
  async update(orgId: string, actorId: string, id: string, input: Partial<DirectExpenseInput>): Promise<DirectExpenseDocument> {
    const current = await this.expense(orgId, id);
    if (current.status !== 'draft') throw new BadRequestException('A posted expense cannot be changed. Reverse its voucher and enter it again.');
    const merged: DirectExpenseInput = {
      date: input.date ?? current.date,
      vendorId: input.vendorId !== undefined ? input.vendorId : current.vendorId ? String(current.vendorId) : null,
      expenseAccountId: input.expenseAccountId ?? String(current.expenseAccountId),
      paidThroughAccountId: input.paidThroughAccountId ?? String(current.paidThroughAccountId),
      taxablePaise: input.taxablePaise ?? current.taxablePaise,
      gstRatePct: input.gstRatePct ?? current.gstRatePct,
      interState: input.interState ?? current.interState,
      claimable: input.claimable ?? current.claimable,
      vendorGstin: input.vendorGstin !== undefined ? input.vendorGstin : current.vendorGstin,
      reference: input.reference !== undefined ? input.reference : current.reference,
      notes: input.notes !== undefined ? input.notes : current.notes,
      projectId: input.projectId !== undefined ? input.projectId : current.projectId ? String(current.projectId) : null,
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
   * writer to the ledger). Dr the expense (and input GST when claimable),
   * Cr the bank or cash it was paid from. A payment approval policy can
   * hold it: the request is made, and the server says so.
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

    const tax = e.cgstPaise + e.sgstPaise + e.igstPaise;
    const names = await this.accounts.namesOf(orgId, [String(e.expenseAccountId), String(e.paidThroughAccountId)]);
    const lines: Array<{ accountId: string; description: string; debitPaise: number; creditPaise: number; projectId?: string | null }> = [
      {
        accountId: String(e.expenseAccountId),
        description: names.get(String(e.expenseAccountId)) ?? 'Expense',
        // GST that cannot be claimed is part of what the thing cost.
        debitPaise: e.claimable ? e.taxablePaise : e.taxablePaise + tax,
        creditPaise: 0,
        projectId: e.projectId ? String(e.projectId) : null,
      },
    ];
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
          narration: `Expense ${e.number}${e.reference ? ` (${e.reference})` : ''}${e.notes ? ` — ${e.notes}` : ''}`,
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

  async list(orgId: string, filter: { status?: DirectExpenseStatus; q?: string } = {}) {
    const query: Record<string, unknown> = { orgId };
    if (filter.status === 'draft' || filter.status === 'posted') query.status = filter.status;
    const rows = await this.expenseModel.find(query).sort({ date: -1, number: -1 }).limit(300).lean().exec();
    const view = await this.views(orgId, rows);
    const q = filter.q?.trim().toLowerCase();
    return q
      ? view.filter((r) => [r.number, r.vendorName, r.expenseAccountName, r.reference, r.notes].some((s) => s?.toLowerCase().includes(q)))
      : view;
  }

  async get(orgId: string, id: string) {
    const e = await this.expense(orgId, id);
    const [view] = await this.views(orgId, [e.toObject()]);
    return view;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Rows with the names a screen shows beside the ids. */
  private async views(orgId: string, rows: Array<DirectExpense & { _id: Types.ObjectId; createdAt?: Date }>) {
    const accountIds = [...new Set(rows.flatMap((r) => [String(r.expenseAccountId), String(r.paidThroughAccountId)]))];
    const vendorIds = [...new Set(rows.map((r) => r.vendorId).filter((v): v is Types.ObjectId => !!v).map(String))];
    const [names, vendors] = await Promise.all([
      this.accounts.namesOf(orgId, accountIds),
      vendorIds.length ? this.vendorModel.find({ orgId, _id: { $in: vendorIds } }, { name: 1 }).lean().exec() : Promise.resolve([]),
    ]);
    const vendorName = new Map(vendors.map((v) => [String(v._id), v.name]));
    return rows.map((r) => ({
      _id: String(r._id),
      number: r.number,
      date: r.date,
      vendorId: r.vendorId ? String(r.vendorId) : null,
      vendorName: r.vendorId ? vendorName.get(String(r.vendorId)) ?? 'Unknown vendor' : null,
      expenseAccountId: String(r.expenseAccountId),
      expenseAccountName: names.get(String(r.expenseAccountId)) ?? 'Unknown account',
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
      status: r.status,
      journalId: r.journalId ? String(r.journalId) : null,
      recurringTemplateId: r.recurringTemplateId ? String(r.recurringTemplateId) : null,
      createdBy: r.createdBy,
    }));
  }

  /** The input checked and priced: accounts of the right kind, whole paise, a GST slab. Saves nothing: recurring expenses check theirs with it. */
  async check(orgId: string, input: DirectExpenseInput) {
    if (!DATE.test(input.date ?? '')) throw new BadRequestException('date must look like 2026-11-04');
    if (!Number.isInteger(input.taxablePaise) || input.taxablePaise <= 0) throw new BadRequestException('The amount before tax is whole paise, more than nothing.');
    const rate = input.gstRatePct ?? 0;
    if (!(GST_SLABS as readonly number[]).includes(rate)) throw new BadRequestException(`${rate}% is not a GST slab.`);
    const interState = !!input.interState;
    const claimable = !!input.claimable && rate > 0;

    const ids = [input.expenseAccountId, input.paidThroughAccountId];
    if (ids.some((i) => !Types.ObjectId.isValid(i ?? ''))) throw new BadRequestException('Pick the expense account and the account it was paid from.');
    const expenseAccount = await this.accountModel.findOne({ _id: input.expenseAccountId, orgId }).lean().exec();
    if (!expenseAccount || expenseAccount.isGroup || expenseAccount.isActive === false || expenseAccount.type !== AccountType.EXPENSE) {
      throw new BadRequestException('Pick an expense account (not a group, not deactivated).');
    }
    const paidThrough = (await this.paidThroughAccounts(orgId)).find((a) => a._id === input.paidThroughAccountId);
    if (!paidThrough) throw new BadRequestException('Paid through must be a bank or cash account.');

    const typedGstin = input.vendorGstin?.trim().toUpperCase() || null;
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

    return {
      date: input.date,
      vendorId,
      expenseAccountId: new Types.ObjectId(input.expenseAccountId),
      paidThroughAccountId: new Types.ObjectId(input.paidThroughAccountId),
      taxablePaise: input.taxablePaise,
      gstRatePct: rate,
      interState,
      claimable,
      vendorGstin,
      ...expenseTax(input.taxablePaise, rate, interState),
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      projectId,
    };
  }

  private summary(e: DirectExpense) {
    return { date: e.date, taxablePaise: e.taxablePaise, gstRatePct: e.gstRatePct, interState: e.interState, claimable: e.claimable, totalPaise: e.totalPaise, expenseAccountId: String(e.expenseAccountId), paidThroughAccountId: String(e.paidThroughAccountId) };
  }

  private async expense(orgId: string, id: string): Promise<DirectExpenseDocument> {
    const e = Types.ObjectId.isValid(id) ? await this.expenseModel.findOne({ _id: id, orgId }).exec() : null;
    if (!e) throw new NotFoundException('Expense not found');
    return e;
  }
}
