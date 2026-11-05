/**
 * Integration tests — expenses paid straight from bank or cash.
 *
 *  ✓ Drafts take gapless numbers from the EXPENSE series, and nothing posts
 *  ✓ Posting is one balanced payment voucher: claimable GST to input credit, CGST and SGST within the state
 *  ✓ Claimable GST across states is IGST
 *  ✓ GST that cannot be claimed is part of the expense
 *  ✓ Paid through must be a bank or cash account; claiming GST needs the supplier's GSTIN
 *  ✓ A posted expense cannot be changed, nor posted twice
 *  ✓ A payment approval policy holds the posting; the last approval posts it
 *  ✓ Another org's expense is not found
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { AccountType, UserRole, VoucherType } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { DirectExpensesService } from './direct-expenses.service';
import { DirectExpense, DirectExpenseSchema } from './schemas/direct-expense.schema';
import { ApprovalsService } from '../approvals/approvals.service';
import { ApprovalPolicy, ApprovalPolicySchema, ApprovalRequest, ApprovalRequestSchema } from '../approvals/schemas/approval.schema';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { gstinCheckChar } from '../extraction/invoice-checks';

const MAKER = new Types.ObjectId().toString();
const MANAGER = new Types.ObjectId().toString();
/** A GSTIN with a valid check character, registered in the given state. */
const gstin = (state: string) => `${state}AAPFU0939F1Z${gstinCheckChar(`${state}AAPFU0939F1Z`)}`;

let moduleRef: TestingModule;
let expenses: DirectExpensesService;
let approvals: ApprovalsService;
let accounts: AccountsService;
let journals: Model<JournalDocument>;
let vendors: Model<unknown>;
let projects: Model<unknown>;
let policies: Model<unknown>;
let audits: Model<{ entityType: string; entityId: string; action: string }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: DirectExpense.name, schema: DirectExpenseSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: Project.name, schema: ProjectSchema },
        { name: ApprovalPolicy.name, schema: ApprovalPolicySchema },
        { name: ApprovalRequest.name, schema: ApprovalRequestSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
      ]),
    ],
    providers: [DirectExpensesService, ApprovalsService, PostingService, AccountsService, AuditService],
  }).compile();
  await moduleRef.init(); // registers the approval executor
  expenses = moduleRef.get(DirectExpensesService);
  approvals = moduleRef.get(ApprovalsService);
  accounts = moduleRef.get(AccountsService);
  journals = moduleRef.get(getModelToken(Journal.name));
  vendors = moduleRef.get(getModelToken(Vendor.name));
  projects = moduleRef.get(getModelToken(Project.name));
  policies = moduleRef.get(getModelToken(ApprovalPolicy.name));
  audits = moduleRef.get(getModelToken(AuditLog.name));
  // Collections and indexes exist before the first write inside a transaction.
  await journals.init();
  await moduleRef.get<Model<unknown>>(getModelToken(DirectExpense.name)).init();
  await moduleRef.get<Model<unknown>>(getModelToken(Counter.name)).init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

async function org() {
  const orgId = new Types.ObjectId().toString();
  await accounts.seedDefaults(orgId);
  const all = await accounts.list(orgId);
  const id = (name: string) => String(all.find((a) => a.name === name)!._id);
  return { orgId, id };
}

const net = (j: JournalDocument, name: string) => j.lines.filter((l) => l.description === name).reduce((s, l) => s + l.debitPaise - l.creditPaise, 0);
const balanced = (j: JournalDocument) => j.lines.reduce((s, l) => s + l.debitPaise, 0) === j.lines.reduce((s, l) => s + l.creditPaise, 0);

describe('direct expenses', () => {
  it('drafts with gapless numbers, and posts nothing', async () => {
    const { orgId, id } = await org();
    const base = { date: '2026-11-04', expenseAccountId: id('Office & Stationery'), paidThroughAccountId: id('Bank Accounts'), taxablePaise: 10000 };
    const first = await expenses.create(orgId, MAKER, { ...base, gstRatePct: 18 });
    const second = await expenses.create(orgId, MAKER, base);
    expect(first.toObject()).toMatchObject({ number: 'EXP/2026-27/0001', status: 'draft', taxablePaise: 10000, cgstPaise: 900, sgstPaise: 900, igstPaise: 0, totalPaise: 11800, journalId: null });
    expect(second.number).toBe('EXP/2026-27/0002');
    expect(await journals.countDocuments({ orgId })).toBe(0);
    expect(await audits.countDocuments({ entityType: 'DirectExpense', entityId: String(first._id), action: 'CREATE' })).toBe(1);
  });

  it('posts claimable GST within the state to CGST and SGST, the cost to its project', async () => {
    const { orgId, id } = await org();
    const [vendor] = (await vendors.create([{ orgId, name: 'Office Mart', gstin: gstin('27') }])) as Array<{ _id: Types.ObjectId }>;
    const [project] = (await projects.create([{ orgId, name: 'Fit-out', nameKey: 'fit-out', billing: 'fixed', status: 'active', createdBy: MAKER }])) as Array<{ _id: Types.ObjectId }>;
    const draft = await expenses.create(orgId, MAKER, {
      date: '2026-11-04', vendorId: String(vendor._id), expenseAccountId: id('Office & Stationery'), paidThroughAccountId: id('Bank Accounts'),
      taxablePaise: 10000, gstRatePct: 18, claimable: true, reference: 'UPI 4412', projectId: String(project._id),
    });
    expect(draft.vendorGstin).toBe(gstin('27')); // taken from the vendor

    const posted = await expenses.post(orgId, MAKER, UserRole.ACCOUNTANT, String(draft._id));
    expect(posted.status).toBe('posted');
    const journal = (await journals.findById(posted.journalId).exec())!;
    expect(journal.voucherType).toBe(VoucherType.PAYMENT);
    expect(balanced(journal)).toBe(true);
    expect(net(journal, 'Office & Stationery')).toBe(10000);
    expect(net(journal, 'Input CGST')).toBe(900);
    expect(net(journal, 'Input SGST')).toBe(900);
    expect(net(journal, 'Bank Accounts')).toBe(-11800);
    expect(String(journal.lines.find((l) => l.description === 'Office & Stationery')!.projectId)).toBe(String(project._id));
  });

  it('posts claimable GST across states as IGST', async () => {
    const { orgId, id } = await org();
    const draft = await expenses.create(orgId, MAKER, {
      date: '2026-11-05', expenseAccountId: id('Telephone & Internet'), paidThroughAccountId: id('Cash in Hand'),
      taxablePaise: 50000, gstRatePct: 18, interState: true, claimable: true, vendorGstin: gstin('29'),
    });
    const journal = (await journals.findById((await expenses.post(orgId, MAKER, UserRole.ACCOUNTANT, String(draft._id))).journalId).exec())!;
    expect(balanced(journal)).toBe(true);
    expect(net(journal, 'Telephone & Internet')).toBe(50000);
    expect(net(journal, 'Input IGST')).toBe(9000);
    expect(net(journal, 'Input CGST')).toBe(0);
    expect(net(journal, 'Cash in Hand')).toBe(-59000);
  });

  it('books GST it cannot claim as part of the expense', async () => {
    const { orgId, id } = await org();
    const draft = await expenses.create(orgId, MAKER, {
      date: '2026-11-05', expenseAccountId: id('Travelling & Conveyance'), paidThroughAccountId: id('Bank Accounts'), taxablePaise: 20000, gstRatePct: 5, claimable: false,
    });
    expect(draft.toObject()).toMatchObject({ cgstPaise: 500, sgstPaise: 500, totalPaise: 21000, claimable: false });
    const journal = (await journals.findById((await expenses.post(orgId, MAKER, UserRole.ACCOUNTANT, String(draft._id))).journalId).exec())!;
    expect(journal.lines).toHaveLength(2);
    expect(net(journal, 'Travelling & Conveyance')).toBe(21000);
    expect(net(journal, 'Bank Accounts')).toBe(-21000);
  });

  it('pays only from a bank or cash account, and claims GST only with a GSTIN', async () => {
    const { orgId, id } = await org();
    const base = { date: '2026-11-05', expenseAccountId: id('Rent'), taxablePaise: 100000 };
    await expect(expenses.create(orgId, MAKER, { ...base, paidThroughAccountId: id('Office Equipment') })).rejects.toThrow(/bank or cash/);
    await expect(expenses.create(orgId, MAKER, { ...base, paidThroughAccountId: id('Accounts Receivable') })).rejects.toThrow(/bank or cash/);
    await expect(expenses.create(orgId, MAKER, { ...base, paidThroughAccountId: id('Bank Accounts'), expenseAccountId: id('Cash in Hand') })).rejects.toThrow(/expense account/);
    await expect(expenses.create(orgId, MAKER, { ...base, paidThroughAccountId: id('Bank Accounts'), gstRatePct: 18, claimable: true })).rejects.toThrow(/GSTIN/);
    await expect(expenses.create(orgId, MAKER, { ...base, paidThroughAccountId: id('Bank Accounts'), taxablePaise: 100.5 })).rejects.toThrow(/whole paise/);

    // A bank account of the org's own, named like one, will do.
    const hdfc = await accounts.create({ orgId, name: 'HDFC Current A/c', type: AccountType.ASSETS, actorId: MAKER });
    expect((await expenses.paidThroughAccounts(orgId)).map((a) => a.name)).toEqual(['Bank Accounts', 'Cash in Hand', 'HDFC Current A/c']);
    const ok = await expenses.create(orgId, MAKER, { ...base, paidThroughAccountId: String(hdfc._id) });
    expect(ok.status).toBe('draft');
  });

  it('cannot change or re-post a posted expense', async () => {
    const { orgId, id } = await org();
    const draft = await expenses.create(orgId, MAKER, { date: '2026-11-05', expenseAccountId: id('Rent'), paidThroughAccountId: id('Bank Accounts'), taxablePaise: 100000 });
    const edited = await expenses.update(orgId, MAKER, String(draft._id), { taxablePaise: 120000, notes: 'November' });
    expect(edited.toObject()).toMatchObject({ taxablePaise: 120000, totalPaise: 120000, notes: 'November' });
    await expenses.post(orgId, MAKER, UserRole.ACCOUNTANT, String(draft._id));
    await expect(expenses.update(orgId, MAKER, String(draft._id), { taxablePaise: 1 })).rejects.toThrow(/posted expense cannot be changed/);
    await expect(expenses.post(orgId, MAKER, UserRole.ACCOUNTANT, String(draft._id))).rejects.toThrow(/already posted/);
    expect(await journals.countDocuments({ orgId })).toBe(1);
    expect((await expenses.get(orgId, String(draft._id))).totalPaise).toBe(120000);
  });

  it('waits for approval under a payment policy, and posts on the last approval', async () => {
    const { orgId, id } = await org();
    await policies.create({ orgId, name: 'Payments over ₹500', docType: 'payment', minAmountPaise: 50000, approvalsRequired: 1, createdBy: MANAGER });
    const small = await expenses.create(orgId, MAKER, { date: '2026-11-05', expenseAccountId: id('Rent'), paidThroughAccountId: id('Bank Accounts'), taxablePaise: 10000 });
    expect((await expenses.post(orgId, MAKER, UserRole.ACCOUNTANT, String(small._id))).status).toBe('posted');

    const big = await expenses.create(orgId, MAKER, { date: '2026-11-05', expenseAccountId: id('Rent'), paidThroughAccountId: id('Bank Accounts'), taxablePaise: 100000 });
    await expect(expenses.post(orgId, MAKER, UserRole.ACCOUNTANT, String(big._id))).rejects.toThrow(/Sent for approval/);
    // Clicking again does not make a second request.
    await expect(expenses.post(orgId, MAKER, UserRole.ACCOUNTANT, String(big._id))).rejects.toThrow(/Sent for approval/);
    const pending = await approvals.list(orgId, 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ docType: 'payment', docId: String(big._id), makerId: MAKER });
    expect((await expenses.get(orgId, String(big._id))).status).toBe('draft');

    const result = await approvals.approve(orgId, MANAGER, UserRole.COMPANY_ADMIN, String(pending[0]._id));
    expect(result.posted).toBe(true);
    const after = await expenses.get(orgId, String(big._id));
    expect(after.status).toBe('posted');
    const journal = (await journals.findById(after.journalId).exec())!;
    expect(String(journal.postedBy)).toBe(MANAGER);
  });

  it("does not find another org's expense", async () => {
    const a = await org();
    const b = await org();
    const draft = await expenses.create(a.orgId, MAKER, { date: '2026-11-05', expenseAccountId: a.id('Rent'), paidThroughAccountId: a.id('Bank Accounts'), taxablePaise: 100000 });
    await expect(expenses.get(b.orgId, String(draft._id))).rejects.toThrow(/not found/);
    await expect(expenses.post(b.orgId, MAKER, UserRole.ACCOUNTANT, String(draft._id))).rejects.toThrow(/not found/);
    expect(await expenses.list(b.orgId)).toEqual([]);
    expect((await expenses.list(a.orgId, { q: 'exp/2026' })).map((r) => r.number)).toEqual(['EXP/2026-27/0001']);
  });
});
