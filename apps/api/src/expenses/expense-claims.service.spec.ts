/**
 * Tests — expense claims.
 *
 *  ✓ The policy flags a missing receipt, a weekend, a repeat; GST without a GSTIN or blocked goes to expense
 *  ✓ Submitted, a claim waits for someone else's approval, policy or not; its maker can neither approve nor post it
 *  ✓ Posted: expense less claimable GST, the GST to input credit, the whole owed to the employee; reimbursed, it is cleared
 *  ✓ Sent back, it is a draft again with the reason
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { UserRole } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { checkLines, claimJournal, ClaimLine } from './claim-rules';
import { ExpenseClaimsService } from './expense-claims.service';
import { ExpenseClaim, ExpenseClaimSchema, ExpenseRulesDoc, ExpenseRulesSchema } from './schemas/expense-claim.schema';
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
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { User, UserSchema } from '../tenancy/schemas/user.schema';

const line = (over: Partial<ClaimLine>): ClaimLine => ({
  date: '2026-11-04', kind: 'expense', merchant: 'Uber', description: 'Taxi to client', expenseAccountId: 'travel', amountPaise: 60000, gstPaise: 0,
  merchantGstin: null, hsnSac: null, km: null, hasReceipt: false, ...over,
});

describe('claim rules', () => {
  it('flags what the policy asks to look at', () => {
    const rules = { receiptRequiredAbovePaise: 500_00, lineLimitPaise: 5000_00, mileageRatePaise: 10_00 };
    const flags = checkLines(
      [line({}), line({ date: '2026-11-08', amountPaise: 9000_00, hasReceipt: true, merchant: 'Taj' }), line({ hasReceipt: true }), line({ merchant: 'Barbeque Nation', description: 'Team dinner', gstPaise: 5000, merchantGstin: '27AABCB1234A1Z5', hasReceipt: true })],
      rules,
      [{ date: '2026-11-04', amountPaise: 60000, merchant: 'uber', claimNumber: 'EC/2026-27/0001' }],
    );
    expect(flags.map((f) => [f.line, f.code])).toEqual([
      [0, 'no_receipt'], [0, 'duplicate'], [1, 'over_limit'], [1, 'weekend'], [2, 'duplicate'], [3, 'blocked_itc'],
    ]);
  });

  it('books GST it cannot claim as expense, and splits what it can by state', () => {
    const j = claimJournal([
      line({ amountPaise: 11800, gstPaise: 1800, merchantGstin: '27AAACR5055K1Z7', description: 'Printer cartridge', expenseAccountId: 'office' }),
      line({ amountPaise: 11800, gstPaise: 1800, merchantGstin: '29AAACR5055K1Z3', description: 'Courier', expenseAccountId: 'office' }),
      line({ amountPaise: 5250, gstPaise: 250, merchantGstin: null, description: 'Tea' }),
    ], '27');
    expect([...j.expense]).toEqual([['office', 20000], ['travel', 5250]]);
    expect(j.itc).toEqual({ cgst: 900, sgst: 900, igst: 1800 });
    expect(j.total).toBe(28850);
  });
});

const EMPLOYEE = new Types.ObjectId().toString();
const MANAGER = new Types.ObjectId().toString();
const ACCOUNTANT = new Types.ObjectId().toString();
let moduleRef: TestingModule;
let claims: ExpenseClaimsService;
let approvals: ApprovalsService;
let accounts: AccountsService;
let journals: Model<JournalDocument>;
let settings: Model<unknown>;
let users: Model<unknown>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: ExpenseClaim.name, schema: ExpenseClaimSchema },
        { name: ExpenseRulesDoc.name, schema: ExpenseRulesSchema },
        { name: ApprovalPolicy.name, schema: ApprovalPolicySchema },
        { name: ApprovalRequest.name, schema: ApprovalRequestSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
        { name: User.name, schema: UserSchema },
      ]),
    ],
    providers: [ExpenseClaimsService, ApprovalsService, PostingService, AccountsService, AuditService],
  }).compile();
  await moduleRef.init();
  claims = moduleRef.get(ExpenseClaimsService);
  approvals = moduleRef.get(ApprovalsService);
  accounts = moduleRef.get(AccountsService);
  journals = moduleRef.get(getModelToken(Journal.name));
  settings = moduleRef.get(getModelToken(OrgSettings.name));
  users = moduleRef.get(getModelToken(User.name));
  await journals.init();
  await users.create({ _id: new Types.ObjectId(EMPLOYEE), email: `asha.${EMPLOYEE}@shop.in`, name: 'Asha' });
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

async function org() {
  const orgId = new Types.ObjectId().toString();
  await settings.create({ orgId, gstin: '27AAPFU0939F1ZV', stateCode: '27' });
  await accounts.seedDefaults(orgId);
  const all = await accounts.list(orgId);
  const id = (name: string) => String(all.find((a) => a.name === name)!._id);
  return { orgId, id };
}

describe('expense claims', () => {
  it('is approved by someone else, posted by an accountant, and reimbursed', async () => {
    const { orgId, id } = await org();
    const claim = await claims.create(orgId, EMPLOYEE, {
      title: 'Client visit, Pune',
      lines: [
        { date: '2026-11-03', merchant: 'Uber', description: 'Taxi to client', expenseAccountId: id('Travelling & Conveyance'), amountPaise: 60000 },
        { date: '2026-11-03', merchant: 'Office Mart', description: 'Printer cartridge', expenseAccountId: id('Office & Stationery'), amountPaise: 11800, gstPaise: 1800, merchantGstin: '27AAACR5055K1Z7' },
        { date: '2026-11-03', kind: 'mileage', description: 'Drive back to office', expenseAccountId: id('Travelling & Conveyance'), km: 42 },
      ],
    });
    expect(claim.toObject()).toMatchObject({ number: 'EC/2026-27/0001', employeeName: 'Asha', totalPaise: 60000 + 11800 + 42000, status: 'draft' });

    const submitted = await claims.submit(orgId, EMPLOYEE, UserRole.EMPLOYEE, String(claim._id));
    expect(submitted.status).toBe('submitted');
    expect(submitted.flags.map((f) => f.code)).toEqual(['no_receipt']);
    const request = (await approvals.list(orgId, 'pending'))[0];
    expect(request).toMatchObject({ docType: 'expense_claim', policyNames: ['Expense claims'], makerId: EMPLOYEE });
    await expect(approvals.approve(orgId, EMPLOYEE, UserRole.COMPANY_ADMIN, String(request._id))).rejects.toThrow(/someone else/);
    await expect(claims.post(orgId, ACCOUNTANT, String(claim._id))).rejects.toThrow(/waiting for approval/);

    await approvals.approve(orgId, MANAGER, UserRole.COMPANY_ADMIN, String(request._id));
    const journal = await claims.post(orgId, ACCOUNTANT, String(claim._id));
    const by = (re: RegExp) => journal.lines.filter((l) => re.test(l.description)).reduce((s, l) => s + l.debitPaise - l.creditPaise, 0);
    expect(by(/Travelling/)).toBe(102000);
    expect(by(/Office & Stationery/)).toBe(10000);
    expect(by(/Input CGST/i) + by(/Input SGST/i)).toBe(1800);
    expect(by(/Employee Reimbursements Payable/)).toBe(-113800);

    const paid = await claims.reimburse(orgId, ACCOUNTANT, UserRole.ACCOUNTANT, String(claim._id), '2026-11-10');
    expect(paid.lines.find((l) => /Bank/.test(l.description))!.creditPaise).toBe(113800);
    const [listed] = await claims.list(orgId, EMPLOYEE, UserRole.EMPLOYEE);
    expect(listed).toMatchObject({ status: 'paid', paidOn: '2026-11-10' });
  });

  it('comes back as a draft, with the reason, when sent back', async () => {
    const { orgId, id } = await org();
    const claim = await claims.create(orgId, EMPLOYEE, { title: 'Stationery', lines: [{ date: '2026-11-04', merchant: 'Kiran Stores', description: 'Files', expenseAccountId: id('Office & Stationery'), amountPaise: 40000 }] });
    await claims.submit(orgId, EMPLOYEE, UserRole.EMPLOYEE, String(claim._id));
    const [request] = await approvals.list(orgId, 'pending');
    await approvals.reject(orgId, MANAGER, UserRole.COMPANY_ADMIN, String(request._id), 'Attach the receipt');
    const [listed] = await claims.list(orgId, EMPLOYEE, UserRole.EMPLOYEE);
    expect(listed).toMatchObject({ status: 'draft', sentBackReason: 'Attach the receipt' });
    // Someone else's claims are not an employee's to see or change.
    expect(await claims.list(orgId, new Types.ObjectId().toString(), UserRole.EMPLOYEE)).toEqual([]);
    await expect(claims.update(orgId, MANAGER, String(claim._id), { title: 'x' })).rejects.toThrow(/Only the employee/);
  });
});
