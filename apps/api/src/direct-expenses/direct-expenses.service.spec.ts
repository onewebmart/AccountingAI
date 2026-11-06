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
 *  ✓ Itemized: each line debits its own account with its own GST; the totals GSTR-3B reads are the lines' sums
 *  ✓ Itemized GST that cannot be claimed stays on each line's account; a bad line is named
 *  ✓ A draft switches between itemized and one account
 *  ✓ An expense for a customer, billable: listed until invoiced, per customer; billable needs the customer
 *  ✓ Mileage preferences: km by default, rates by start date, checked and audited
 *  ✓ A mileage expense takes the rate in force on its date (or one typed), round(distance × rate), no GST, and posts
 *  ✓ Bulk add saves every row as a draft in order, or nothing with each bad row's number and reason
 *  ✓ Bulk add with posting posts each in its own voucher; an approval policy holds some
 *  ✓ The request shapes pass the validation pipe as the API runs it
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { AccountType, UserRole, VoucherType } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { DirectExpensesService } from './direct-expenses.service';
import { DirectExpense, DirectExpenseSchema } from './schemas/direct-expense.schema';
import { MileageSettings, MileageSettingsSchema } from './schemas/mileage-settings.schema';
import { BulkExpensesDto, DirectExpenseDto, MileageSettingsDto } from './direct-expenses.controller';
import { distanceHundredths, mileageAmount, rateOn } from './expense-lines';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
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
let customers: Model<unknown>;
let expenseModel: Model<DirectExpense>;
let audits: Model<{ entityType: string; entityId: string; action: string; after?: Record<string, unknown> }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: DirectExpense.name, schema: DirectExpenseSchema },
        { name: MileageSettings.name, schema: MileageSettingsSchema },
        { name: Customer.name, schema: CustomerSchema },
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
  customers = moduleRef.get(getModelToken(Customer.name));
  expenseModel = moduleRef.get(getModelToken(DirectExpense.name));
  // Collections and indexes exist before the first write inside a transaction.
  await journals.init();
  await expenseModel.init();
  await moduleRef.get<Model<unknown>>(getModelToken(MileageSettings.name)).init();
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

/** Net debit on an account, by id: line descriptions may carry the line's own words. */
const onAccount = (j: JournalDocument, accountId: string) => j.lines.filter((l) => String(l.accountId) === accountId).reduce((s, l) => s + l.debitPaise - l.creditPaise, 0);
const journalOf = async (orgId: string, id: string) => (await journals.findById((await expenses.post(orgId, MAKER, UserRole.ACCOUNTANT, id)).journalId).exec())!;

describe('itemized expenses', () => {
  it('debits each line to its own account with its own GST, and keeps the totals GSTR-3B reads', async () => {
    const { orgId, id } = await org();
    const [vendor] = (await vendors.create([{ orgId, name: 'Office Mart', gstin: gstin('27') }])) as Array<{ _id: Types.ObjectId }>;
    const draft = await expenses.create(orgId, MAKER, {
      date: '2026-11-04', vendorId: String(vendor._id), paidThroughAccountId: id('Bank Accounts'), claimable: true,
      lines: [
        { expenseAccountId: id('Office & Stationery'), amountPaise: 10000, gstRatePct: 18 },
        { expenseAccountId: id('Telephone & Internet'), amountPaise: 5001, gstRatePct: 5 },
        { expenseAccountId: id('Office & Stationery'), amountPaise: 333, gstRatePct: 12, description: 'Pens' },
      ],
    });
    // 1800 + 250 (5% of 5001, rounded) + 40 (12% of 333, rounded), each halved into CGST and SGST.
    expect(draft.toObject()).toMatchObject({ taxablePaise: 15334, cgstPaise: 1045, sgstPaise: 1045, igstPaise: 0, totalPaise: 17424, gstRatePct: 18, claimable: true });
    expect(String(draft.expenseAccountId)).toBe(id('Office & Stationery'));
    expect(draft.lines.map((l) => [l.amountPaise, l.cgstPaise, l.sgstPaise])).toEqual([[10000, 900, 900], [5001, 125, 125], [333, 20, 20]]);

    const view = await expenses.get(orgId, String(draft._id));
    expect(view.itemized).toBe(true);
    expect(view.lines.map((l) => l.expenseAccountName)).toEqual(['Office & Stationery', 'Telephone & Internet', 'Office & Stationery']);

    const journal = await journalOf(orgId, String(draft._id));
    expect(balanced(journal)).toBe(true);
    expect(onAccount(journal, id('Office & Stationery'))).toBe(10333);
    expect(onAccount(journal, id('Telephone & Internet'))).toBe(5001);
    expect(net(journal, 'Office & Stationery: Pens')).toBe(333);
    expect(net(journal, 'Input CGST')).toBe(1045);
    expect(net(journal, 'Input SGST')).toBe(1045);
    expect(onAccount(journal, id('Bank Accounts'))).toBe(-17424);
  });

  it('keeps GST it cannot claim on each line, across states as well, and names a bad line', async () => {
    const { orgId, id } = await org();
    const draft = await expenses.create(orgId, MAKER, {
      date: '2026-11-04', paidThroughAccountId: id('Cash in Hand'), interState: true,
      lines: [
        { expenseAccountId: id('Rent'), amountPaise: 100000, gstRatePct: 18 },
        { expenseAccountId: id('Repairs & Maintenance'), amountPaise: 20000, gstRatePct: 0 },
      ],
    });
    expect(draft.toObject()).toMatchObject({ taxablePaise: 120000, igstPaise: 18000, cgstPaise: 0, totalPaise: 138000, claimable: false });
    const journal = await journalOf(orgId, String(draft._id));
    expect(journal.lines).toHaveLength(3);
    expect(onAccount(journal, id('Rent'))).toBe(118000);
    expect(onAccount(journal, id('Repairs & Maintenance'))).toBe(20000);
    expect(onAccount(journal, id('Cash in Hand'))).toBe(-138000);

    const base = { date: '2026-11-04', paidThroughAccountId: id('Bank Accounts') };
    await expect(expenses.create(orgId, MAKER, { ...base, lines: [{ expenseAccountId: id('Rent'), amountPaise: 1000 }, { expenseAccountId: id('Cash in Hand'), amountPaise: 500 }] })).rejects.toThrow(/Line 2: Pick an expense account/);
    await expect(expenses.create(orgId, MAKER, { ...base, lines: [{ expenseAccountId: id('Rent'), amountPaise: 1000 }, { expenseAccountId: id('Rent'), amountPaise: 500, gstRatePct: 7 }] })).rejects.toThrow(/Line 2: 7% is not a GST slab/);
    await expect(expenses.create(orgId, MAKER, { ...base, lines: [{ expenseAccountId: id('Rent'), amountPaise: 10.5 }] })).rejects.toThrow(/whole paise/);
    await expect(expenses.create(orgId, MAKER, { ...base, lines: Array.from({ length: 51 }, () => ({ expenseAccountId: id('Rent'), amountPaise: 100 })) })).rejects.toThrow(/at most 50 lines/);
  });

  it('switches a draft between itemized and one account', async () => {
    const { orgId, id } = await org();
    const draft = await expenses.create(orgId, MAKER, { date: '2026-11-05', expenseAccountId: id('Rent'), paidThroughAccountId: id('Bank Accounts'), taxablePaise: 100000, gstRatePct: 18 });
    expect(draft.lines).toHaveLength(1);

    const split = await expenses.update(orgId, MAKER, String(draft._id), { lines: [{ expenseAccountId: id('Rent'), amountPaise: 60000, gstRatePct: 18 }, { expenseAccountId: id('Repairs & Maintenance'), amountPaise: 40000, gstRatePct: 5 }] });
    expect(split.toObject()).toMatchObject({ taxablePaise: 100000, cgstPaise: 5400 + 1000, sgstPaise: 5400 + 1000, totalPaise: 112800 });
    expect(split.lines).toHaveLength(2);

    // Notes only: the lines stay.
    const noted = await expenses.update(orgId, MAKER, String(draft._id), { notes: 'Office and repairs' });
    expect(noted.lines).toHaveLength(2);
    expect(noted.totalPaise).toBe(112800);

    const single = await expenses.update(orgId, MAKER, String(draft._id), { expenseAccountId: id('Rent'), taxablePaise: 50000, gstRatePct: 18, lines: [] });
    expect(single.lines).toHaveLength(1);
    expect(single.toObject()).toMatchObject({ taxablePaise: 50000, totalPaise: 59000, notes: 'Office and repairs' });
    const audit = await audits.findOne({ entityType: 'DirectExpense', entityId: String(draft._id), action: 'UPDATE' }).lean().exec();
    expect(audit).toBeTruthy();
  });
});

describe('expenses for a customer', () => {
  it('lists billable expenses not yet invoiced, per customer; billable needs the customer', async () => {
    const { orgId, id } = await org();
    const [acme, zen] = (await customers.create([{ orgId, name: 'Acme Ltd' }, { orgId, name: 'Zen Traders' }])) as Array<{ _id: Types.ObjectId }>;
    const base = { date: '2026-11-05', expenseAccountId: id('Travelling & Conveyance'), paidThroughAccountId: id('Bank Accounts') };
    const forAcme = await expenses.create(orgId, MAKER, { ...base, taxablePaise: 25000, customerId: String(acme._id), billable: true });
    await expenses.create(orgId, MAKER, { ...base, taxablePaise: 5000, customerId: String(acme._id) });
    const forZen = await expenses.create(orgId, MAKER, { ...base, taxablePaise: 7000, customerId: String(zen._id), billable: true });
    await expenses.create(orgId, MAKER, { ...base, taxablePaise: 9000 });
    await expenses.post(orgId, MAKER, UserRole.ACCOUNTANT, String(forAcme._id));

    const acmeBillable = await expenses.billable(orgId, String(acme._id));
    expect(acmeBillable.map((e) => e._id)).toEqual([String(forAcme._id)]);
    expect(acmeBillable[0]).toMatchObject({ customerName: 'Acme Ltd', billable: true, invoiceId: null, status: 'posted' });
    expect((await expenses.billable(orgId)).map((e) => e._id)).toEqual([String(forAcme._id), String(forZen._id)]);
    expect(await expenses.list(orgId, { billable: true })).toHaveLength(2);
    expect(await expenses.list(orgId, { customerId: String(acme._id) })).toHaveLength(2);
    expect((await expenses.list(orgId, { q: 'zen' })).map((e) => e._id)).toEqual([String(forZen._id)]);

    await expect(expenses.create(orgId, MAKER, { ...base, taxablePaise: 100, billable: true })).rejects.toThrow(/needs the customer/);
    const other = await org();
    const [stranger] = (await customers.create([{ orgId: other.orgId, name: 'Elsewhere' }])) as Array<{ _id: Types.ObjectId }>;
    await expect(expenses.create(orgId, MAKER, { ...base, taxablePaise: 100, customerId: String(stranger._id) })).rejects.toThrow(/Customer not found/);
    expect(await expenses.billable(other.orgId, String(acme._id))).toEqual([]);

    // Taking the customer off a draft takes billable with it.
    const zenDraft = await expenses.update(orgId, MAKER, String(forZen._id), { customerId: null });
    expect(zenDraft.toObject()).toMatchObject({ customerId: null, billable: false });
  });
});

describe('mileage', () => {
  it('reads and saves the preferences: km by default, rates by start date, checked and audited', async () => {
    const { orgId, id } = await org();
    expect(await expenses.mileageSettings(orgId)).toEqual({ defaultAccountId: null, unit: 'km', rates: [], configured: false });
    const saved = await expenses.setMileageSettings(orgId, MANAGER, {
      defaultAccountId: id('Travelling & Conveyance'), unit: 'km',
      rates: [{ startDate: '2026-10-01', ratePaise: 1200 }, { startDate: '2026-04-01', ratePaise: 1000 }],
    });
    expect(saved).toEqual({ defaultAccountId: id('Travelling & Conveyance'), unit: 'km', rates: [{ startDate: '2026-04-01', ratePaise: 1000 }, { startDate: '2026-10-01', ratePaise: 1200 }], configured: true });
    expect(await audits.countDocuments({ entityType: 'MileageSettings', entityId: orgId, action: 'UPDATE' })).toBe(1);

    await expect(expenses.setMileageSettings(orgId, MANAGER, { unit: 'km', rates: [{ startDate: '2026-04-01', ratePaise: 1000 }, { startDate: '2026-04-01', ratePaise: 900 }] })).rejects.toThrow(/Two rates start on 2026-04-01/);
    await expect(expenses.setMileageSettings(orgId, MANAGER, { unit: 'km', rates: [{ startDate: '2026-04-01', ratePaise: 10.5 }] })).rejects.toThrow(/whole paise/);
    await expect(expenses.setMileageSettings(orgId, MANAGER, { unit: 'km', defaultAccountId: id('Bank Accounts'), rates: [] })).rejects.toThrow(/expense account/);
    // A refused change leaves them as they were.
    expect((await expenses.mileageSettings(orgId)).rates).toHaveLength(2);
    // Another org sees its own (none).
    expect((await expenses.mileageSettings((await org()).orgId)).configured).toBe(false);
  });

  it('prices a mileage expense at the rate in force on its date, or one typed, with no GST, and posts it', async () => {
    const { orgId, id } = await org();
    await expenses.setMileageSettings(orgId, MANAGER, { defaultAccountId: id('Travelling & Conveyance'), unit: 'km', rates: [{ startDate: '2026-04-01', ratePaise: 1000 }, { startDate: '2026-10-01', ratePaise: 1200 }] });
    const base = { kind: 'mileage' as const, paidThroughAccountId: id('Cash in Hand') };

    const september = await expenses.create(orgId, MAKER, { ...base, date: '2026-09-30', mileage: { distance: 42.5, employeeName: 'Ravi' }, claimable: true, gstRatePct: 18 });
    expect(september.toObject()).toMatchObject({ kind: 'mileage', taxablePaise: 42500, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 42500, claimable: false, gstRatePct: 0 });
    expect(september.mileage).toMatchObject({ distance: 42.5, unit: 'km', ratePaise: 1000, rateSource: 'preferences', employeeName: 'Ravi' });
    expect(String(september.expenseAccountId)).toBe(id('Travelling & Conveyance'));
    expect(september.lines[0].description).toBe('42.5 km at ₹10.00/km');

    // From 1 October the new rate; a typed rate wins; round(10.01 × ₹12.50) = ₹125.13.
    const october = await expenses.create(orgId, MAKER, { ...base, date: '2026-10-01', mileage: { distance: 10 } });
    expect(october.totalPaise).toBe(12000);
    const typed = await expenses.create(orgId, MAKER, { ...base, date: '2026-10-02', expenseAccountId: id('Repairs & Maintenance'), mileage: { distance: 10.01, ratePaise: 1250 } });
    expect(typed.toObject()).toMatchObject({ totalPaise: 12513, mileage: { rateSource: 'typed', ratePaise: 1250 } });
    expect(String(typed.expenseAccountId)).toBe(id('Repairs & Maintenance'));

    await expect(expenses.create(orgId, MAKER, { ...base, date: '2026-03-31', mileage: { distance: 5 } })).rejects.toThrow(/No mileage rate is in force on 2026-03-31/);
    expect((await expenses.create(orgId, MAKER, { ...base, date: '2026-03-31', mileage: { distance: 5, ratePaise: 900 } })).totalPaise).toBe(4500);
    await expect(expenses.create(orgId, MAKER, { ...base, date: '2026-10-02', mileage: { distance: 5, unit: 'mile' } })).rejects.toThrow(/rates are per km/);
    await expect(expenses.create(orgId, MAKER, { ...base, date: '2026-10-02', mileage: { distance: 1.234 } })).rejects.toThrow(/distance/);
    await expect(expenses.create(orgId, MAKER, { ...base, date: '2026-10-02', mileage: { distance: 5, ratePaise: 12.5 } })).rejects.toThrow(/whole paise/);

    const journal = await journalOf(orgId, String(september._id));
    expect(balanced(journal)).toBe(true);
    expect(journal.lines).toHaveLength(2);
    expect(onAccount(journal, id('Travelling & Conveyance'))).toBe(42500);
    expect(onAccount(journal, id('Cash in Hand'))).toBe(-42500);
    expect(journal.narration).toContain('mileage 42.5 km at ₹10.00/km');

    // Moving a draft's date takes the rate in force on the new date.
    const moved = await expenses.update(orgId, MAKER, String(october._id), { date: '2026-09-15' });
    expect(moved.toObject()).toMatchObject({ totalPaise: 10000, mileage: { ratePaise: 1000, rateSource: 'preferences' } });
    const view = await expenses.get(orgId, String(typed._id));
    expect(view).toMatchObject({ kind: 'mileage', mileage: { distance: 10.01, unit: 'km', ratePaise: 1250, rateSource: 'typed' } });
  });

  it('needs an account when the preferences have none', async () => {
    const { orgId, id } = await org();
    await expect(expenses.create(orgId, MAKER, { kind: 'mileage', date: '2026-10-02', paidThroughAccountId: id('Cash in Hand'), mileage: { distance: 5, ratePaise: 1000 } })).rejects.toThrow(/mileage is booked to/);
  });

  it('works out distances and rates without floating point', () => {
    expect(distanceHundredths(42.5)).toBe(4250);
    expect(distanceHundredths(0.1 + 0.2)).toBe(30);
    expect(distanceHundredths(1.234)).toBeNull();
    expect(distanceHundredths(0)).toBeNull();
    expect(distanceHundredths('5')).toBeNull();
    expect(mileageAmount(1001, 1250)).toBe(12513);
    const rates = [{ startDate: '2026-04-01', ratePaise: 1000 }, { startDate: '2026-10-01', ratePaise: 1200 }];
    expect(rateOn(rates, '2026-03-31')).toBeNull();
    expect(rateOn(rates, '2026-09-30')?.ratePaise).toBe(1000);
    expect(rateOn(rates, '2026-10-01')?.ratePaise).toBe(1200);
  });
});

describe('bulk add', () => {
  it('saves every row as a draft in row order, or nothing, naming each bad row', async () => {
    const { orgId, id } = await org();
    const [acme] = (await customers.create([{ orgId, name: 'Acme Ltd' }])) as Array<{ _id: Types.ObjectId }>;
    const row = (over: Record<string, unknown> = {}) => ({ date: '2026-11-04', expenseAccountId: id('Office & Stationery'), paidThroughAccountId: id('Bank Accounts'), taxablePaise: 10000, ...over });

    let refused: unknown;
    try {
      await expenses.bulk(orgId, MAKER, UserRole.ACCOUNTANT, [row(), row({ expenseAccountId: id('Bank Accounts') }), row({ taxablePaise: undefined }), row({ colour: 'red' }), row({ billable: true })]);
    } catch (e) {
      refused = e;
    }
    expect(refused).toBeInstanceOf(BadRequestException);
    const body = (refused as BadRequestException).getResponse() as { message: string; rows: Array<{ row: number; error: string }> };
    expect(body.message).toBe('4 rows need a fix. Nothing was saved.');
    expect(body.rows.map((r) => r.row)).toEqual([2, 3, 4, 5]);
    expect(body.rows[0].error).toMatch(/expense account/);
    expect(body.rows[1].error).toBe('Enter the amount.');
    expect(body.rows[2].error).toMatch(/colour is not a field/);
    expect(body.rows[3].error).toMatch(/needs the customer/);
    expect(await expenseModel.countDocuments({ orgId })).toBe(0);

    const saved = await expenses.bulk(orgId, MAKER, UserRole.ACCOUNTANT, [
      row({ date: '2026-11-01' }),
      row({ date: '2026-11-02', expenseAccountId: id('Rent'), taxablePaise: 500000, customerId: String(acme._id), billable: true }),
      row({ date: '2026-11-03', paidThroughAccountId: id('Cash in Hand'), notes: 'Courier' }),
    ]);
    // No gap from the refused attempt: numbering starts at 0001, in row order.
    expect(saved.created.map((c) => [c.row, c.number])).toEqual([[1, 'EXP/2026-27/0001'], [2, 'EXP/2026-27/0002'], [3, 'EXP/2026-27/0003']]);
    expect(saved.posted).toEqual([]);
    const drafts = await expenseModel.find({ orgId }).sort({ number: 1 }).lean().exec();
    expect(drafts.map((d) => d.status)).toEqual(['draft', 'draft', 'draft']);
    expect(drafts[1]).toMatchObject({ billable: true, taxablePaise: 500000 });
    expect(await journals.countDocuments({ orgId })).toBe(0);
    expect(await audits.countDocuments({ entityType: 'DirectExpense', action: 'CREATE', entityId: { $in: drafts.map((d) => String(d._id)) }, 'after.bulk': true })).toBe(3);

    await expect(expenses.bulk(orgId, MAKER, UserRole.ACCOUNTANT, Array.from({ length: 101 }, () => row()))).rejects.toThrow(/At most 100/);
    await expect(expenses.bulk(orgId, MAKER, UserRole.ACCOUNTANT, [])).rejects.toThrow(/at least one/);
  });

  it('posts each row in its own voucher when asked; a payment policy holds the ones it covers', async () => {
    const { orgId, id } = await org();
    await policies.create({ orgId, name: 'Payments over ₹500', docType: 'payment', minAmountPaise: 50000, approvalsRequired: 1, createdBy: MANAGER });
    const row = (taxablePaise: number) => ({ date: '2026-11-04', expenseAccountId: id('Rent'), paidThroughAccountId: id('Bank Accounts'), taxablePaise });
    const result = await expenses.bulk(orgId, MAKER, UserRole.ACCOUNTANT, [row(10000), row(100000), row(20000)], true);
    expect(result.created).toHaveLength(3);
    expect(result.posted.map((p) => p.row)).toEqual([1, 3]);
    expect(result.held.map((h) => h.row)).toEqual([2]);
    expect(result.held[0].reason).toMatch(/Sent for approval/);
    expect(result.failed).toEqual([]);

    const posted = await journals.find({ orgId }).exec();
    expect(posted).toHaveLength(2);
    expect(posted.every(balanced)).toBe(true);
    expect(new Set(posted.map((j) => String(j.voucherNumber))).size).toBe(2);
    expect((await expenses.get(orgId, result.held[0]._id)).status).toBe('draft');
  });
});

describe('request shapes', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
  const id = new Types.ObjectId().toString();

  it('passes bulk rows through whole for the service to check, and caps them', async () => {
    const body = (await pipe.transform({ expenses: [{ date: '2026-11-04', expenseAccountId: id, taxablePaise: 100, billable: true, colour: 'red' }], post: true }, { type: 'body', metatype: BulkExpensesDto })) as BulkExpensesDto;
    expect(body.expenses[0]).toEqual({ date: '2026-11-04', expenseAccountId: id, taxablePaise: 100, billable: true, colour: 'red' });
    await expect(pipe.transform({ expenses: [] }, { type: 'body', metatype: BulkExpensesDto })).rejects.toThrow(BadRequestException);
    await expect(pipe.transform({ expenses: Array.from({ length: 101 }, () => ({})) }, { type: 'body', metatype: BulkExpensesDto })).rejects.toThrow(BadRequestException);
  });

  it('takes lines and mileage on an expense, and refuses what is not theirs', async () => {
    const ok = (await pipe.transform(
      { date: '2026-11-04', paidThroughAccountId: id, lines: [{ expenseAccountId: id, amountPaise: 100, gstRatePct: 18, description: 'Pens' }], customerId: id, billable: true },
      { type: 'body', metatype: DirectExpenseDto },
    )) as DirectExpenseDto;
    expect(ok.lines).toHaveLength(1);
    const mileage = (await pipe.transform({ date: '2026-11-04', kind: 'mileage', paidThroughAccountId: id, mileage: { distance: 42.5, unit: 'km' } }, { type: 'body', metatype: DirectExpenseDto })) as DirectExpenseDto;
    expect(mileage.mileage?.distance).toBe(42.5);
    await expect(pipe.transform({ date: '2026-11-04', kind: 'mileage', paidThroughAccountId: id, mileage: { distance: 1.234 } }, { type: 'body', metatype: DirectExpenseDto })).rejects.toThrow(BadRequestException);
    await expect(pipe.transform({ date: '2026-11-04', paidThroughAccountId: id, lines: [{ expenseAccountId: id, amountPaise: 100, colour: 'red' }] }, { type: 'body', metatype: DirectExpenseDto })).rejects.toThrow(BadRequestException);
    await expect(pipe.transform({ unit: 'km', rates: [{ startDate: '2026-04-01', ratePaise: 10.5 }] }, { type: 'body', metatype: MileageSettingsDto })).rejects.toThrow(BadRequestException);
  });
});
