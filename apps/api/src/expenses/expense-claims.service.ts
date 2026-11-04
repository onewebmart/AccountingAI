import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccountType, Permission, UserRole, VoucherType, hasPermission } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { AccountsService } from '../gl/accounts.service';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { LedgerAccount, LedgerAccountDocument, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import { User, UserDocument } from '../tenancy/schemas/user.schema';
import { ApprovalNeeded, ApprovalsService } from '../approvals/approvals.service';
import { todayIst } from '../automation/schedule';
import { ExpenseClaim, ExpenseClaimDocument, ExpenseRulesDoc, ExpenseRulesDocument } from './schemas/expense-claim.schema';
import { ClaimLine, ExpenseRules, checkLines, claimJournal } from './claim-rules';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ClaimLineInput {
  date: string;
  kind?: 'expense' | 'mileage';
  merchant?: string | null;
  description: string;
  expenseAccountId: string;
  amountPaise?: number;
  gstPaise?: number;
  merchantGstin?: string | null;
  hsnSac?: string | null;
  km?: number | null;
  receiptId?: string | null;
}

/**
 * Expense claims. The employee makes and submits; someone else approves
 * (always, policy or not); an accountant posts; the reimbursement clears it.
 * The claim never posts itself, and its maker can neither approve nor post it.
 */
@Injectable()
export class ExpenseClaimsService implements OnModuleInit {
  constructor(
    @InjectModel(ExpenseClaim.name) private claimModel: Model<ExpenseClaimDocument>,
    @InjectModel(ExpenseRulesDoc.name) private rulesModel: Model<ExpenseRulesDocument>,
    @InjectModel(LedgerAccount.name) private accountModel: Model<LedgerAccountDocument>,
    @InjectModel(OrgSettings.name) private settingsModel: Model<OrgSettingsDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private approvals: ApprovalsService,
    private posting: PostingService,
    private accounts: AccountsService,
    private audit: AuditService,
  ) {}

  onModuleInit() {
    // The last approval marks it approved; an accountant still posts it.
    this.approvals.register('expense_claim', async (orgId, actorId, request) => {
      await this.claimModel.updateOne({ _id: request.docId, orgId, status: 'submitted' }, { $set: { status: 'approved' } }).exec();
      await this.audit.record({ orgId, entityType: 'ExpenseClaim', entityId: request.docId!, action: 'APPROVE', performedBy: actorId, after: { status: 'approved' } });
      return request.docId!;
    });
    this.approvals.register('claim_reimbursement', async (orgId, actorId, request) => {
      const p = request.payload as { claimId: string; paidOn: string };
      return String((await this.payNow(orgId, actorId, p.claimId, p.paidOn))._id);
    });
  }

  async rules(orgId: string): Promise<ExpenseRules> {
    const r = await this.rulesModel.findOne({ orgId }).lean().exec();
    return { receiptRequiredAbovePaise: r?.receiptRequiredAbovePaise ?? 500_00, lineLimitPaise: r?.lineLimitPaise ?? null, mileageRatePaise: r?.mileageRatePaise ?? 10_00 };
  }

  async setRules(orgId: string, actorId: string, input: Partial<ExpenseRules>) {
    for (const [k, v] of Object.entries(input)) if (v !== null && v !== undefined && (!Number.isInteger(v) || v < 0)) throw new BadRequestException(`${k} is whole paise, not negative.`);
    const before = await this.rules(orgId);
    await this.rulesModel.updateOne({ orgId }, { $set: input }, { upsert: true }).exec();
    await this.audit.record({ orgId, entityType: 'ExpenseRules', entityId: orgId, action: 'UPDATE', performedBy: actorId, before: before as unknown as Record<string, unknown>, after: input as Record<string, unknown> });
    return this.rules(orgId);
  }

  /** An employee sees their own claims; whoever may see reports sees all. */
  async list(orgId: string, actorId: string, role: string): Promise<Array<Record<string, unknown>>> {
    const all = hasPermission(role as UserRole, Permission.POST_JOURNAL) || hasPermission(role as UserRole, Permission.APPROVE_PROPOSAL);
    const claims = await this.claimModel.find({ orgId, ...(all ? {} : { employeeId: actorId }) }).sort({ createdAt: -1 }).limit(300).lean().exec();
    // Sent back by an approver: back to the maker as a draft to fix.
    const latest = await this.approvals.latestFor(orgId, 'expense_claim', claims.filter((c) => c.status === 'submitted').map((c) => String(c._id)));
    const out: Array<Record<string, unknown>> = [];
    for (const c of claims) {
      const r = latest.get(String(c._id));
      if (c.status === 'submitted' && r?.status === 'rejected') {
        await this.claimModel.updateOne({ _id: c._id, orgId, status: 'submitted' }, { $set: { status: 'draft', sentBackReason: r.rejectionReason } }).exec();
        out.push({ ...c, status: 'draft', sentBackReason: r.rejectionReason });
      } else out.push(c);
    }
    return out;
  }

  async create(orgId: string, actorId: string, input: { title: string; lines: ClaimLineInput[] }) {
    if (!input.title?.trim()) throw new BadRequestException('Give the claim a title, like "Client visit, Pune".');
    const user = Types.ObjectId.isValid(actorId) ? await this.userModel.findById(actorId, { name: 1 }).lean().exec() : null;
    const lines = await this.cleanLines(orgId, input.lines);
    const fy = financialYearOf(todayIst());
    const number = `EC/${fy}/${String(await this.posting.nextDocumentNumber(orgId, 'EXPENSE_CLAIM', fy)).padStart(4, '0')}`;
    const claim = await this.claimModel.create({ orgId, number, employeeId: actorId, employeeName: user?.name ?? 'Employee', title: input.title.trim(), status: 'draft', lines, totalPaise: lines.reduce((s, l) => s + l.amountPaise, 0) });
    await this.audit.record({ orgId, entityType: 'ExpenseClaim', entityId: claim._id.toString(), action: 'CREATE', performedBy: actorId, after: { number, totalPaise: claim.totalPaise } });
    return claim;
  }

  async update(orgId: string, actorId: string, id: string, input: { title?: string; lines?: ClaimLineInput[] }) {
    const claim = await this.claim(orgId, id);
    if (claim.employeeId !== actorId) throw new ForbiddenException('Only the employee who made the claim can change it.');
    if (claim.status !== 'draft') throw new BadRequestException('Only a draft claim can be changed.');
    if (input.title?.trim()) claim.title = input.title.trim();
    if (input.lines) {
      const lines = await this.cleanLines(orgId, input.lines);
      claim.set({ lines, totalPaise: lines.reduce((s, l) => s + l.amountPaise, 0) });
    }
    await claim.save();
    return claim;
  }

  /** The policy checks it, and it goes to someone else for approval. */
  async submit(orgId: string, actorId: string, role: string, id: string) {
    const claim = await this.claim(orgId, id);
    if (claim.employeeId !== actorId) throw new ForbiddenException('Only the employee who made the claim can submit it.');
    if (claim.status !== 'draft') throw new BadRequestException(`This claim is ${claim.status}.`);
    if (claim.lines.length === 0) throw new BadRequestException('Add at least one line.');
    const earlier = await this.claimModel.find({ orgId, _id: { $ne: claim._id }, status: { $ne: 'draft' } }, { number: 1, lines: 1 }).lean().exec();
    const flags = checkLines(this.ruleLines(claim), await this.rules(orgId), earlier.flatMap((c) => c.lines.map((l) => ({ date: l.date, amountPaise: l.amountPaise, merchant: l.merchant, claimNumber: c.number }))));
    claim.set({ status: 'submitted', flags, sentBackReason: null });
    await claim.save();
    try {
      await this.approvals.gate({
        orgId, docType: 'expense_claim', docId: id, summary: `${claim.employeeName}: ${claim.title} (${claim.number})`, amountPaise: claim.totalPaise,
        makerId: claim.employeeId, actorId, actorRole: role, facts: { date: claim.lines[0].date, amountPaise: claim.totalPaise, possibleDuplicate: flags.find((f) => f.code === 'duplicate')?.message ?? null },
        fallback: { name: 'Expense claims', approvalsRequired: 1 },
      });
    } catch (err) {
      if (!(err instanceof ApprovalNeeded)) throw err;
      const body = err.getResponse() as { approvalRequestId: string };
      claim.approvalRequestId = body.approvalRequestId;
      await claim.save();
    }
    await this.audit.record({ orgId, entityType: 'ExpenseClaim', entityId: id, action: 'SUBMIT', performedBy: actorId, after: { totalPaise: claim.totalPaise, flags: flags.length } });
    return claim;
  }

  /** The accountant's step: expense less claimable GST, the GST to input credit, the whole owed to the employee. */
  async post(orgId: string, actorId: string, id: string) {
    const claim = await this.claim(orgId, id);
    if (claim.status !== 'approved') throw new BadRequestException(claim.status === 'submitted' ? 'It is waiting for approval.' : `This claim is ${claim.status}.`);
    if (claim.employeeId === actorId) throw new ForbiddenException('You made this claim, so someone else must post it.');
    const settings = await this.settingsModel.findOne({ orgId }).lean().exec();
    const { expense, itc, total } = claimJournal(this.ruleLines(claim), settings?.gstin?.slice(0, 2) ?? settings?.stateCode ?? null);
    const keys = await this.accounts.resolveSystemAccounts(orgId, [SystemAccountKey.EMPLOYEE_PAYABLE, SystemAccountKey.GST_INPUT_CGST, SystemAccountKey.GST_INPUT_SGST, SystemAccountKey.GST_INPUT_IGST]);
    const names = await this.accounts.namesOf(orgId, [...expense.keys()]);
    const sys = (k: SystemAccountKey) => keys.get(k)!;
    const lines = [
      ...[...expense].filter(([, a]) => a > 0).map(([accountId, a]) => ({ accountId, description: names.get(accountId) ?? 'Expense', debitPaise: a, creditPaise: 0 })),
      ...([['GST_INPUT_CGST', itc.cgst], ['GST_INPUT_SGST', itc.sgst], ['GST_INPUT_IGST', itc.igst]] as const).filter(([, a]) => a > 0).map(([k, a]) => ({ accountId: String(sys(SystemAccountKey[k])._id), description: sys(SystemAccountKey[k]).name, debitPaise: a, creditPaise: 0 })),
      { accountId: String(sys(SystemAccountKey.EMPLOYEE_PAYABLE)._id), description: `${sys(SystemAccountKey.EMPLOYEE_PAYABLE).name}: ${claim.employeeName}`, debitPaise: 0, creditPaise: total },
    ];
    const journal = await this.posting.inTransaction(async (session) => {
      const claimed = await this.claimModel.findOneAndUpdate({ _id: claim._id, orgId, status: 'approved' }, { $set: { status: 'posted' } }, { session }).exec();
      if (!claimed) throw new BadRequestException('This claim has just been posted.');
      const posted = await this.posting.post(
        { orgId, voucherType: VoucherType.JOURNAL, financialYear: financialYearOf(todayIst()), date: todayIst(), narration: `Expense claim ${claim.number}: ${claim.employeeName}, ${claim.title}`, postedBy: actorId, lines },
        session,
      );
      await this.claimModel.updateOne({ _id: claim._id }, { $set: { journalId: posted._id } }, { session }).exec();
      await this.audit.record({ orgId, entityType: 'ExpenseClaim', entityId: id, action: 'POST', performedBy: actorId, before: { status: 'approved' }, after: { status: 'posted', journalId: String(posted._id) } }, session);
      return posted;
    });
    return journal;
  }

  /** Pay the employee back: a payment, under the payment approval policy when there is one. */
  async reimburse(orgId: string, actorId: string, role: string, id: string, paidOn = todayIst()) {
    const claim = await this.claim(orgId, id);
    if (claim.status !== 'posted') throw new BadRequestException(claim.status === 'paid' ? 'Already reimbursed.' : 'Post the claim first.');
    if (!DATE.test(paidOn)) throw new BadRequestException('paidOn must look like 2026-11-20');
    await this.approvals.gate({
      orgId, docType: 'payment', docId: null, payload: { kind: 'claim_reimbursement', claimId: id, paidOn },
      summary: `Reimburse ${claim.employeeName} for ${claim.number}`, amountPaise: claim.totalPaise, makerId: actorId, actorId, actorRole: role, facts: { date: paidOn, amountPaise: claim.totalPaise },
    });
    return this.payNow(orgId, actorId, id, paidOn);
  }

  private async payNow(orgId: string, actorId: string, id: string, paidOn: string) {
    const claim = await this.claim(orgId, id);
    const [payable, bank] = await Promise.all([this.accounts.resolveSystemAccount(orgId, SystemAccountKey.EMPLOYEE_PAYABLE), this.accounts.resolveSystemAccount(orgId, SystemAccountKey.BANK)]);
    return this.posting.inTransaction(async (session) => {
      const claimed = await this.claimModel.findOneAndUpdate({ _id: claim._id, orgId, status: 'posted' }, { $set: { status: 'paid', paidOn } }, { session }).exec();
      if (!claimed) throw new BadRequestException('This claim is not waiting to be paid.');
      const posted = await this.posting.post(
        {
          orgId, voucherType: VoucherType.PAYMENT, financialYear: financialYearOf(paidOn), date: paidOn, narration: `Reimbursement of ${claim.number} to ${claim.employeeName}`, postedBy: actorId,
          lines: [
            { accountId: String(payable._id), description: `${payable.name}: ${claim.employeeName}`, debitPaise: claim.totalPaise, creditPaise: 0 },
            { accountId: String(bank._id), description: bank.name, debitPaise: 0, creditPaise: claim.totalPaise },
          ],
        },
        session,
      );
      await this.claimModel.updateOne({ _id: claim._id }, { $set: { paymentJournalId: posted._id } }, { session }).exec();
      await this.audit.record({ orgId, entityType: 'ExpenseClaim', entityId: id, action: 'REIMBURSE', performedBy: actorId, after: { paidOn, journalId: String(posted._id) } }, session);
      return posted;
    });
  }

  private ruleLines(claim: ExpenseClaimDocument): ClaimLine[] {
    return claim.lines.map((l) => ({
      date: l.date, kind: l.kind, merchant: l.merchant, description: l.description, expenseAccountId: String(l.expenseAccountId), amountPaise: l.amountPaise,
      gstPaise: l.gstPaise, merchantGstin: l.merchantGstin, hsnSac: l.hsnSac, km: l.km, hasReceipt: !!l.receiptId,
    }));
  }

  private async cleanLines(orgId: string, input: ClaimLineInput[]) {
    if (!input?.length) throw new BadRequestException('Add at least one line.');
    const rules = await this.rules(orgId);
    const ids = [...new Set(input.map((l) => l.expenseAccountId))];
    const accounts = await this.accountModel.find({ orgId, _id: { $in: ids.filter((i) => Types.ObjectId.isValid(i)) } }).lean().exec();
    const ok = new Set(accounts.filter((a) => !a.isGroup && a.isActive && a.type === AccountType.EXPENSE).map((a) => String(a._id)));
    return input.map((l, i) => {
      const at = `Line ${i + 1}`;
      if (!DATE.test(l.date ?? '')) throw new BadRequestException(`${at}: the date looks like 2026-11-04.`);
      if (!l.description?.trim()) throw new BadRequestException(`${at}: say what it was for.`);
      if (!ok.has(l.expenseAccountId)) throw new BadRequestException(`${at}: pick an expense account.`);
      const kind = l.kind ?? 'expense';
      let amount = l.amountPaise ?? 0;
      let gst = l.gstPaise ?? 0;
      if (kind === 'mileage') {
        if (!(l.km && l.km > 0)) throw new BadRequestException(`${at}: enter the kilometres.`);
        amount = Math.round(l.km * rules.mileageRatePaise);
        gst = 0;
      }
      if (!Number.isInteger(amount) || amount <= 0) throw new BadRequestException(`${at}: the amount is whole paise, more than nothing.`);
      if (!Number.isInteger(gst) || gst < 0 || gst >= amount) throw new BadRequestException(`${at}: the GST is part of the amount, less than it.`);
      const gstin = l.merchantGstin?.trim().toUpperCase() || null;
      return {
        date: l.date, kind, merchant: l.merchant?.trim() || null, description: l.description.trim(), expenseAccountId: new Types.ObjectId(l.expenseAccountId),
        amountPaise: amount, gstPaise: gst, merchantGstin: gstin, hsnSac: l.hsnSac?.trim() || null, km: kind === 'mileage' ? l.km! : null,
        receiptId: l.receiptId && Types.ObjectId.isValid(l.receiptId) ? new Types.ObjectId(l.receiptId) : null,
      };
    });
  }

  private async claim(orgId: string, id: string) {
    const c = Types.ObjectId.isValid(id) ? await this.claimModel.findOne({ _id: id, orgId }).exec() : null;
    if (!c) throw new NotFoundException('Claim not found');
    return c;
  }
}
