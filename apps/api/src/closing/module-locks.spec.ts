/**
 * Integration tests — transaction locking by module (Sales, Purchases,
 * Banking, Accountant), against a real replica set.
 *
 *  ✓ Which module each kind of entry belongs to
 *  ✓ A module lock needs a reason, cannot pass today, and is kept in the history and the audit trail
 *  ✓ Sales: an invoice dated in a locked Sales period is refused; Purchases still posts
 *  ✓ Purchases: a bill, and a payment of it, dated in a locked Purchases period are refused
 *  ✓ Banking: a transfer dated in a locked Banking period is refused; a customer receipt is Sales'
 *  ✓ Accountant: a manual journal dated in a locked Accountant period is refused
 *  ✓ Reversals: one dated into a locked period is refused, and so is reversing an entry dated in one
 *  ✓ The whole-books lock still applies on top of the module locks
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { AccountType, VoucherType } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { ClosingService } from './closing.service';
import { ClosingRun, ClosingRunSchema } from './schemas/closing-run.schema';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { modulesOfEntry } from '../gl/module-locks';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { PeriodLock, PeriodLockSchema } from '../gl/schemas/period-lock.schema';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { CustomersService } from '../sales/customers.service';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { VendorsService } from '../purchase/vendors.service';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { BankAccount, BankAccountSchema } from '../banking/schemas/bank-account.schema';
import { TransfersService } from '../banking/transfers.service';
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';
import { TdsDeposit, TdsDepositSchema } from '../tds/schemas/tds-deposit.schema';
import { ManualVouchersService } from '../journals/manual-vouchers.service';
import { JournalReversalService } from '../journals/journal-reversal.service';

const ACTOR = new Types.ObjectId().toString();
const amounts = { taxableValue: 847458, cgst: 76271, sgst: 76271, igst: 0, cess: 0, total: 1000000 };
const LOCK = '2026-10-15';

let moduleRef: TestingModule;
let closing: ClosingService;
let posting: PostingService;
let accounts: AccountsService;
let invoices: SalesInvoicesService;
let customers: CustomersService;
let bills: PurchaseBillsService;
let vendors: VendorsService;
let transfers: TransfersService;
let vouchers: ManualVouchersService;
let reversals: JournalReversalService;
let journalModel: Model<JournalDocument>;
let audit: Model<{ orgId: string; entityType: string; entityId: string; action: string; before: Record<string, unknown>; after: Record<string, unknown> }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: PeriodLock.name, schema: PeriodLockSchema },
        { name: ClosingRun.name, schema: ClosingRunSchema },
        { name: ProposedEntry.name, schema: ProposedEntrySchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
        { name: BankAccount.name, schema: BankAccountSchema },
        { name: CreditNote.name, schema: CreditNoteSchema },
        { name: DebitNote.name, schema: DebitNoteSchema },
        { name: TdsDeposit.name, schema: TdsDepositSchema },
      ]),
    ],
    providers: [
      ClosingService, PostingService, AccountsService, AuditService,
      SalesInvoicesService, CustomersService, PurchaseBillsService, VendorsService,
      TransfersService, ManualVouchersService, JournalReversalService,
    ],
  }).compile();

  closing = moduleRef.get(ClosingService);
  posting = moduleRef.get(PostingService);
  accounts = moduleRef.get(AccountsService);
  invoices = moduleRef.get(SalesInvoicesService);
  customers = moduleRef.get(CustomersService);
  bills = moduleRef.get(PurchaseBillsService);
  vendors = moduleRef.get(VendorsService);
  transfers = moduleRef.get(TransfersService);
  vouchers = moduleRef.get(ManualVouchersService);
  reversals = moduleRef.get(JournalReversalService);
  journalModel = moduleRef.get(getModelToken(Journal.name));
  audit = moduleRef.get(getModelToken(AuditLog.name));
  await journalModel.init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

async function org() {
  const orgId = new Types.ObjectId().toString();
  const sys = await accounts.resolveSystemAccounts(orgId, [
    SystemAccountKey.BANK, SystemAccountKey.CASH, SystemAccountKey.ACCOUNTS_RECEIVABLE, SystemAccountKey.SALES_REVENUE, SystemAccountKey.PURCHASE_EXPENSE,
  ]);
  const id = (k: SystemAccountKey) => sys.get(k)!._id.toString();
  const rent = (await accounts.list(orgId)).find((a) => a.name === 'Rent')!._id;
  const accrued = (await accounts.list(orgId)).find((a) => a.systemKey === SystemAccountKey.ACCRUED_EXPENSES)!._id;
  return { orgId, id, rent, accrued };
}

const journal = (orgId: string, date: string, debit: string, credit: string, paise = 50000) =>
  vouchers.post(orgId, ACTOR, 'owner', {
    date, narration: 'Provision for October rent',
    lines: [{ accountId: debit, debitPaise: paise, creditPaise: 0 }, { accountId: credit, debitPaise: 0, creditPaise: paise }],
  });

describe('which module an entry belongs to', () => {
  const facts = new Map([
    ['ar', { systemKey: 'ACCOUNTS_RECEIVABLE', type: AccountType.ASSETS }],
    ['ap', { systemKey: 'ACCOUNTS_PAYABLE', type: AccountType.LIABILITIES }],
    ['cadv', { systemKey: 'CUSTOMER_ADVANCES', type: AccountType.LIABILITIES }],
    ['vadv', { systemKey: 'VENDOR_ADVANCES', type: AccountType.ASSETS }],
    ['emp', { systemKey: 'EMPLOYEE_PAYABLE', type: AccountType.LIABILITIES }],
    ['bank', { systemKey: 'BANK', type: AccountType.ASSETS }],
    ['tds', { systemKey: 'TDS_PAYABLE', type: AccountType.LIABILITIES }],
    ['fx', { systemKey: 'FX_GAIN', type: AccountType.INCOME }],
    ['rent', { systemKey: null, type: AccountType.EXPENSE }],
    ['capital', { systemKey: null, type: AccountType.CAPITAL }],
  ]);
  const of = (type: VoucherType, dr: string, cr: string) =>
    modulesOfEntry(type, [{ accountId: dr, debitPaise: 1, creditPaise: 0 }, { accountId: cr, debitPaise: 0, creditPaise: 1 }], facts);

  it.each([
    ['a sale', VoucherType.SALES, 'ar', 'rent', ['sales']],
    ['a credit note', VoucherType.CREDIT_NOTE, 'rent', 'ar', ['sales']],
    ['a purchase', VoucherType.PURCHASE, 'rent', 'ap', ['purchases']],
    ['a debit note', VoucherType.DEBIT_NOTE, 'ap', 'rent', ['purchases']],
    ['a transfer', VoucherType.CONTRA, 'bank', 'bank', ['banking']],
    ['a customer receipt', VoucherType.RECEIPT, 'bank', 'ar', ['sales']],
    ['a customer advance', VoucherType.RECEIPT, 'bank', 'cadv', ['sales']],
    ['a refund to a customer', VoucherType.PAYMENT, 'cadv', 'bank', ['sales']],
    ['a vendor payment', VoucherType.PAYMENT, 'ap', 'bank', ['purchases']],
    ['a claim reimbursed', VoucherType.PAYMENT, 'emp', 'bank', ['purchases']],
    ['an expense paid from the bank', VoucherType.PAYMENT, 'rent', 'bank', ['purchases']],
    ['TDS deposited', VoucherType.PAYMENT, 'tds', 'bank', ['banking']],
    ['an owner putting money in', VoucherType.RECEIPT, 'bank', 'capital', ['banking']],
    ['an advance applied to an invoice', VoucherType.JOURNAL, 'cadv', 'ar', ['sales']],
    ['an advance applied to a bill', VoucherType.JOURNAL, 'ap', 'vadv', ['purchases']],
    ['an expense claim approved', VoucherType.JOURNAL, 'rent', 'emp', ['purchases']],
    ['a revaluation', VoucherType.JOURNAL, 'ar', 'fx', ['accountant']],
    ['a manual journal', VoucherType.JOURNAL, 'rent', 'bank', ['accountant']],
  ])('%s', (_what, type, dr, cr, expected) => {
    expect(of(type as VoucherType, dr as string, cr as string)).toEqual(expected);
  });
});

describe('locking a module', () => {
  it('needs a reason, cannot pass today, and is kept in the history and the audit trail', async () => {
    const { orgId } = await org();
    await expect(closing.setModuleLock(orgId, ACTOR, 'sales', LOCK, '  ')).rejects.toThrow(/Say why you are locking Sales/);
    await expect(closing.setModuleLock(orgId, ACTOR, 'sales', '2999-01-01', 'Too far')).rejects.toThrow(/past today/);
    await expect(closing.setModuleLock(orgId, ACTOR, 'sales', null, 'Nothing to unlock')).rejects.toThrow(/Sales is not locked/);

    await closing.setModuleLock(orgId, ACTOR, 'sales', LOCK, 'GSTR-1 for October filed');
    await closing.setModuleLock(orgId, ACTOR, 'banking', '2026-09-30', 'September reconciled');
    await closing.setModuleLock(orgId, ACTOR, 'banking', null, 'A missed bank charge');

    const s = await closing.status(orgId);
    expect(s.lockedThrough).toBeNull(); // the whole-books lock is separate
    expect(s.modules.map((m) => [m.module, m.lockedThrough, m.reason])).toEqual([
      ['sales', LOCK, 'GSTR-1 for October filed'],
      ['purchases', null, null],
      ['banking', null, 'A missed bank charge'],
      ['accountant', null, null],
    ]);
    expect(s.history.map((h) => [h.module, h.lockedThrough, h.reason])).toEqual([
      ['banking', null, 'A missed bank charge'],
      ['banking', '2026-09-30', 'September reconciled'],
      ['sales', LOCK, 'GSTR-1 for October filed'],
    ]);
    const trail = await audit.find({ orgId, entityType: 'ModuleLock' }).sort({ _id: 1 }).lean().exec();
    expect(trail.map((a) => [a.entityId, a.action, a.before.lockedThrough, a.after.lockedThrough])).toEqual([
      ['sales', 'LOCK', null, LOCK],
      ['banking', 'LOCK', null, '2026-09-30'],
      ['banking', 'UNLOCK', '2026-09-30', null],
    ]);
  });
});

describe('each module, one path', () => {
  it('Sales: refuses an invoice dated in the locked period, posts after it, and leaves Purchases open', async () => {
    const { orgId } = await org();
    await closing.setModuleLock(orgId, ACTOR, 'sales', LOCK, 'October GSTR-1 filed');
    const customer = await customers.create({ orgId, name: 'Rao Traders' });
    const early = await invoices.create({ orgId, customerId: String(customer._id), invoiceNumber: 'INV-1', invoiceDate: '2026-10-10', amountsPaise: amounts });
    await expect(invoices.post(String(early._id), orgId, ACTOR)).rejects.toThrow(/Sales is locked through 2026-10-15, and this entry is dated 2026-10-10/);

    const later = await invoices.create({ orgId, customerId: String(customer._id), invoiceNumber: 'INV-2', invoiceDate: '2026-10-16', amountsPaise: amounts });
    await expect(invoices.post(String(later._id), orgId, ACTOR)).resolves.toMatchObject({ status: 'posted' });

    const vendor = await vendors.create({ orgId, name: 'Sterling Supplies' });
    const bill = await bills.create({ orgId, vendorId: String(vendor._id), billNumber: 'B-1', billDate: '2026-10-10', amountsPaise: amounts });
    await expect(bills.post(String(bill._id), orgId, ACTOR)).resolves.toMatchObject({ status: 'posted' });
  });

  it('Purchases: refuses a bill, and a payment of one, dated in the locked period', async () => {
    const { orgId } = await org();
    const vendor = await vendors.create({ orgId, name: 'Sterling Supplies' });
    const posted = await bills.create({ orgId, vendorId: String(vendor._id), billNumber: 'B-0', billDate: '2026-10-01', amountsPaise: amounts });
    await bills.post(String(posted._id), orgId, ACTOR);

    await closing.setModuleLock(orgId, ACTOR, 'purchases', LOCK, 'Input credit claimed');
    const bill = await bills.create({ orgId, vendorId: String(vendor._id), billNumber: 'B-1', billDate: '2026-10-12', amountsPaise: amounts });
    await expect(bills.post(String(bill._id), orgId, ACTOR)).rejects.toThrow(/Purchases is locked through 2026-10-15/);
    await expect(bills.markPaid(String(posted._id), orgId, ACTOR, '2026-10-14')).rejects.toThrow(/Purchases is locked/);
    await expect(bills.markPaid(String(posted._id), orgId, ACTOR, '2026-10-20')).resolves.toBeTruthy();
  });

  it('Banking: refuses a transfer dated in the locked period; a customer receipt is Sales\', not Banking\'s', async () => {
    const { orgId, id } = await org();
    await closing.setModuleLock(orgId, ACTOR, 'banking', LOCK, 'October reconciled');
    await expect(
      transfers.record(orgId, ACTOR, { fromAccountId: id(SystemAccountKey.BANK), toAccountId: id(SystemAccountKey.CASH), amountPaise: 100000, date: '2026-10-05' }),
    ).rejects.toThrow(/Banking is locked through 2026-10-15/);
    await expect(
      transfers.record(orgId, ACTOR, { fromAccountId: id(SystemAccountKey.BANK), toAccountId: id(SystemAccountKey.CASH), amountPaise: 100000, date: '2026-10-16' }),
    ).resolves.toBeTruthy();

    const customer = await customers.create({ orgId, name: 'Rao Traders' });
    const inv = await invoices.create({ orgId, customerId: String(customer._id), invoiceNumber: 'INV-1', invoiceDate: '2026-10-01', amountsPaise: amounts });
    await invoices.post(String(inv._id), orgId, ACTOR);
    await expect(invoices.markPaid(String(inv._id), orgId, ACTOR, '2026-10-05')).resolves.toBeTruthy();
  });

  it('Accountant: refuses a manual journal dated in the locked period', async () => {
    const { orgId, rent, accrued } = await org();
    await closing.setModuleLock(orgId, ACTOR, 'accountant', LOCK, 'October closed');
    await expect(journal(orgId, '2026-10-31', rent, accrued)).resolves.toBeTruthy();
    await expect(journal(orgId, '2026-10-15', rent, accrued)).rejects.toThrow(/Accountant is locked through 2026-10-15, and this entry is dated 2026-10-15/);
  });
});

describe('reversals and locked periods', () => {
  it('refuses a reversal dated into a locked period, and reversing an entry dated in one', async () => {
    const { orgId, rent, accrued } = await org();
    const october = await journal(orgId, '2026-10-10', rent, accrued);
    const after = await journal(orgId, '2026-10-21', rent, accrued);
    await closing.setModuleLock(orgId, ACTOR, 'accountant', LOCK, 'October closed');

    // A reversal dated into the locked period, as an accrual's or a scheduled one would be.
    await expect(posting.reverse(String(october._id), ACTOR, undefined, { date: '2026-10-12' })).rejects.toThrow(
      /Accountant is locked through 2026-10-15, and this entry is dated 2026-10-12/,
    );
    await expect(reversals.reverse(String(october._id), orgId, ACTOR, { date: '2026-10-12', scheduled: true })).rejects.toThrow(/Accountant is locked/);
    // Reversing, today, an entry dated in the locked period: refused from the voucher page.
    await expect(reversals.reverse(String(october._id), orgId, ACTOR)).rejects.toThrow(/dated 2026-10-10, and Accountant is locked through 2026-10-15, so it cannot be reversed/);
    expect(await journalModel.countDocuments({ orgId, reversalOf: october._id }).exec()).toBe(0);
    // An entry after the lock reverses as usual.
    await expect(reversals.reverse(String(after._id), orgId, ACTOR)).resolves.toBeTruthy();
    // A reversal fixed when the entry was posted (a reverse journal date) posts on its own date once that is open.
    await expect(reversals.reverse(String(october._id), orgId, ACTOR, { date: '2026-10-16', scheduled: true })).resolves.toMatchObject({ date: '2026-10-16' });
  });

  it('a module lock does not stop reversing what another module holds', async () => {
    const { orgId, rent, accrued } = await org();
    const entry = await journal(orgId, '2026-10-05', rent, accrued);
    await closing.setModuleLock(orgId, ACTOR, 'sales', LOCK, 'GSTR-1 filed');
    await expect(reversals.reverse(String(entry._id), orgId, ACTOR)).resolves.toBeTruthy();
  });
});

describe('the whole-books lock', () => {
  it('still applies when every module is open', async () => {
    const { orgId, rent, accrued } = await org();
    await closing.setLock(orgId, ACTOR, '2026-09-30', 'Half-year audit');
    await expect(journal(orgId, '2026-09-30', rent, accrued)).rejects.toThrow(/The books are locked through 2026-09-30/);
    await closing.setModuleLock(orgId, ACTOR, 'accountant', LOCK, 'October closed');
    await closing.setModuleLock(orgId, ACTOR, 'accountant', null, 'Reopened for an audit entry');
    // Unlocking the module leaves the whole-books lock in place.
    await expect(journal(orgId, '2026-09-15', rent, accrued)).rejects.toThrow(/The books are locked/);
    await expect(journal(orgId, '2026-10-01', rent, accrued)).resolves.toBeTruthy();
  });
});
