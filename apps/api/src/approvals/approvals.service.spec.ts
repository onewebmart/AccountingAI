/**
 * Tests — approval policies, maker-checker, and the risk score.
 *
 *  ✓ Risk: a likely duplicate, a fresh bank change, a first bill, an outsized amount, a Sunday
 *  ✓ No policy, no change: bills post as before
 *  ✓ Under a policy the maker cannot approve; someone else's approval posts it, in their name
 *  ✓ Approve & post: an approver posting someone else's bill is its approval
 *  ✓ High risk needs two; payments and vouchers wait with what to post, and post on approval
 *  ✓ Rejected, with the reason; another org sees none of it
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { UserRole } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { scoreRisk } from './risk';
import { ApprovalsService } from './approvals.service';
import { ApprovalPolicy, ApprovalPolicySchema, ApprovalRequest, ApprovalRequestSchema } from './schemas/approval.schema';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { VendorsService } from '../purchase/vendors.service';
import { PurchaseBill, PurchaseBillSchema, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { PartyPaymentsService } from '../payments/party-payments.service';
import { PartyPayment, PartyPaymentSchema } from '../payments/schemas/party-payment.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { ManualVouchersService } from '../journals/manual-vouchers.service';

describe('risk', () => {
  it('scores what makes a document worth a second look', () => {
    expect(scoreRisk({ date: '2026-11-04', amountPaise: 100 })).toEqual({ score: 0, level: 'low', reasons: [] });
    const r = scoreRisk({ date: '2026-11-08', amountPaise: 9_00_000_00, firstFromVendor: false, bankChangedDaysAgo: 3, usualPaise: 1_00_000_00, possibleDuplicate: 'Bill X is already in the books.' });
    expect(r.level).toBe('high');
    expect(r.reasons).toEqual(['Bill X is already in the books.', "The vendor's bank account changed 3 days ago.", '₹9,00,000 is 9× this vendor\'s usual ₹1,00,000.', 'Dated on a Sunday.']);
    expect(scoreRisk({ date: '2026-11-04', amountPaise: 1, bankChangedDaysAgo: 45 }).level).toBe('low');
  });
});

const MAKER = new Types.ObjectId().toString();
const CHECKER = new Types.ObjectId().toString();
const SECOND = new Types.ObjectId().toString();

let moduleRef: TestingModule;
let approvals: ApprovalsService;
let bills: PurchaseBillsService;
let vendors: VendorsService;
let payments: PartyPaymentsService;
let vouchers: ManualVouchersService;
let accounts: AccountsService;
let billModel: Model<PurchaseBillDocument>;
let journals: Model<JournalDocument>;
let audit: Model<{ orgId: string; entityType: string; entityId: string; action: string }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: ApprovalPolicy.name, schema: ApprovalPolicySchema },
        { name: ApprovalRequest.name, schema: ApprovalRequestSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: PartyPayment.name, schema: PartyPaymentSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
      ]),
    ],
    providers: [ApprovalsService, PurchaseBillsService, VendorsService, PartyPaymentsService, ManualVouchersService, PostingService, AccountsService, AuditService],
  }).compile();
  await moduleRef.init(); // executors register on init
  approvals = moduleRef.get(ApprovalsService);
  bills = moduleRef.get(PurchaseBillsService);
  vendors = moduleRef.get(VendorsService);
  payments = moduleRef.get(PartyPaymentsService);
  vouchers = moduleRef.get(ManualVouchersService);
  accounts = moduleRef.get(AccountsService);
  billModel = moduleRef.get(getModelToken(PurchaseBill.name));
  journals = moduleRef.get(getModelToken(Journal.name));
  audit = moduleRef.get(getModelToken(AuditLog.name));
  await journals.init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

const amounts = (taxable: number) => ({ taxableValue: taxable, cgst: 0, sgst: 0, igst: 0, cess: 0, total: taxable });

async function setup() {
  const orgId = new Types.ObjectId().toString();
  await accounts.seedDefaults(orgId);
  const vendor = await vendors.create({ orgId, name: 'Sigma Supplies' });
  // An earlier bill, so the next is not the vendor's first.
  const old = await bills.create({ orgId, actorId: MAKER, vendorId: String(vendor._id), billNumber: 'SG/1', billDate: '2026-09-01', amountsPaise: amounts(60_000_00) });
  await bills.post(String(old._id), orgId, CHECKER, UserRole.COMPANY_ADMIN);
  const bill = (n: string, taxable = 60_000_00) => bills.create({ orgId, actorId: MAKER, vendorId: String(vendor._id), billNumber: n, billDate: '2026-11-04', amountsPaise: amounts(taxable) });
  return { orgId, vendorId: String(vendor._id), bill };
}

describe('approval policies', () => {
  it('changes nothing without a policy', async () => {
    const { orgId, bill } = await setup();
    const b = await bill('SG/2');
    expect((await bills.post(String(b._id), orgId, MAKER, UserRole.ACCOUNTANT)).status).toBe('posted');
  });

  it("keeps the maker from approving, and posts on someone else's approval, in their name", async () => {
    const { orgId, bill } = await setup();
    await approvals.createPolicy(orgId, CHECKER, { name: 'Bills over ₹50,000', docType: 'bill', minAmountPaise: 50_000_00, approvalsRequired: 1 });
    const small = await bill('SG/3', 10_000_00);
    expect((await bills.post(String(small._id), orgId, MAKER, UserRole.COMPANY_ADMIN)).status).toBe('posted');

    const big = await bill('SG/4');
    await expect(bills.post(String(big._id), orgId, MAKER, UserRole.COMPANY_ADMIN)).rejects.toThrow(/Sent for approval: 1 more approval is needed \(Bills over ₹50,000\)\. You made it/);
    const [request] = await approvals.list(orgId, 'pending');
    expect(request).toMatchObject({ docType: 'bill', docId: String(big._id), makerId: MAKER, required: 1 });
    await expect(approvals.approve(orgId, MAKER, UserRole.COMPANY_ADMIN, String(request._id))).rejects.toThrow(/someone else/);
    await expect(approvals.approve(orgId, SECOND, UserRole.EMPLOYEE, String(request._id))).rejects.toThrow(/role cannot/);

    const done = await approvals.approve(orgId, CHECKER, UserRole.COMPANY_ADMIN, String(request._id), 'Checked against the PO');
    expect(done.posted).toBe(true);
    expect(await billModel.findById(big._id).lean().exec()).toMatchObject({ status: 'posted', postedBy: CHECKER });
    expect(await audit.countDocuments({ orgId, entityType: 'ApprovalRequest', action: { $in: ['REQUEST', 'APPROVE'] } })).toBe(2);
    expect(await approvals.list(new Types.ObjectId().toString())).toEqual([]);
  });

  it("treats an approver posting someone else's bill as its approval", async () => {
    const { orgId, bill } = await setup();
    await approvals.createPolicy(orgId, CHECKER, { name: 'Every bill', docType: 'bill', approvalsRequired: 1 });
    const b = await bill('SG/5');
    expect((await bills.post(String(b._id), orgId, CHECKER, UserRole.COMPANY_ADMIN)).status).toBe('posted');
    const [request] = await approvals.list(orgId, 'approved');
    expect(request.approvals.map((a) => a.userId)).toEqual([CHECKER]);
  });

  it('needs two approvers for a risky bill', async () => {
    const { orgId, vendorId, bill } = await setup();
    await approvals.createPolicy(orgId, CHECKER, { name: 'Every bill', docType: 'bill', approvalsRequired: 1 });
    await audit.create({ orgId, entityType: 'Vendor', entityId: vendorId, action: 'UPDATE_BANK_ACCOUNT', performedBy: MAKER });
    const b = await bill('SG/6');
    await expect(bills.post(String(b._id), orgId, CHECKER, UserRole.COMPANY_ADMIN)).rejects.toThrow(/1 more approval is needed \(Every bill; high risk\)/);
    const [request] = await approvals.list(orgId, 'pending');
    expect(request.risk.reasons[0]).toMatch(/bank account changed today/);
    await expect(approvals.approve(orgId, CHECKER, UserRole.COMPANY_ADMIN, String(request._id))).rejects.toThrow(/approved this already/);
    expect((await approvals.approve(orgId, SECOND, UserRole.ACCOUNTANT, String(request._id))).posted).toBe(true);
    expect((await billModel.findById(b._id).lean().exec())!.status).toBe('posted');
  });

  it('holds payments and vouchers with what to post, and posts them on approval', async () => {
    const { orgId, vendorId, bill } = await setup();
    const b = await bill('SG/7', 20_000_00);
    await bills.post(String(b._id), orgId, CHECKER, UserRole.COMPANY_ADMIN);
    await approvals.createPolicy(orgId, CHECKER, { name: 'All payments', docType: 'payment', approvalsRequired: 1 });
    await approvals.createPolicy(orgId, CHECKER, { name: 'All vouchers', docType: 'journal', approvalsRequired: 1 });

    const input = { kind: 'payment' as const, partyId: vendorId, date: '2026-11-05', amountPaise: 20_000_00, allocations: [{ documentId: String(b._id), amountPaise: 20_000_00 }] };
    await expect(payments.record(orgId, MAKER, input, { actorRole: UserRole.ACCOUNTANT })).rejects.toThrow(/Sent for approval/);
    const all = await accounts.list(orgId);
    const id = (name: string) => String(all.find((a) => a.name === name)!._id);
    await expect(vouchers.post(orgId, MAKER, UserRole.ACCOUNTANT, { narration: 'Petty cash top-up', date: '2026-11-05', lines: [{ accountId: id('Cash in Hand'), debitPaise: 5000_00, creditPaise: 0 }, { accountId: id('Bank Accounts'), debitPaise: 0, creditPaise: 5000_00 }] })).rejects.toThrow(/Sent for approval/);

    const pending = await approvals.list(orgId, 'pending');
    expect(pending.map((r) => r.docType).sort()).toEqual(['journal', 'payment']);
    for (const r of pending) expect((await approvals.approve(orgId, CHECKER, UserRole.COMPANY_ADMIN, String(r._id))).posted).toBe(true);
    expect((await billModel.findById(b._id).lean().exec())!.status).toBe('paid');
    expect(await journals.countDocuments({ orgId, narration: 'Petty cash top-up', postedBy: new Types.ObjectId(CHECKER) })).toBe(1);
  });

  it('rejects with a reason; posting again asks afresh', async () => {
    const { orgId, bill } = await setup();
    await approvals.createPolicy(orgId, CHECKER, { name: 'Every bill', docType: 'bill', approvalsRequired: 1 });
    const b = await bill('SG/8');
    await expect(bills.post(String(b._id), orgId, MAKER, UserRole.ACCOUNTANT)).rejects.toThrow(/Sent for approval/);
    const [request] = await approvals.list(orgId, 'pending');
    await expect(approvals.reject(orgId, CHECKER, UserRole.COMPANY_ADMIN, String(request._id), '')).rejects.toThrow(/Say why/);
    await approvals.reject(orgId, CHECKER, UserRole.COMPANY_ADMIN, String(request._id), 'Wrong GSTIN on the bill');
    await expect(bills.post(String(b._id), orgId, MAKER, UserRole.ACCOUNTANT)).rejects.toThrow(/Sent for approval/);
    expect(await approvals.list(orgId, 'pending')).toHaveLength(1);
  });
});
