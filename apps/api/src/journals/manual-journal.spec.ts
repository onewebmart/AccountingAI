/**
 * Integration tests — the manual journal: Notes, Reference#, a Journal# of
 * one's own, a contact per line, a reverse journal date, and the accounts a
 * journal cannot touch. Against a real replica set.
 *
 *  ✓ Reference#, an own Journal# and line contacts are kept; the JNL voucher series runs on, gapless
 *  ✓ The contact shows in the account's ledger
 *  ✓ A used or voucher-shaped Journal#, and missing or long notes, are refused
 *  ✓ Receivable, payable, advance and claim accounts are refused, so the ageing always equals the control account
 *  ✓ A contact from another org is refused
 *  ✓ Reverse date, publish now: the reversal posts with the journal, dated the reverse date
 *  ✓ Reverse date, publish on the date: the daily job posts it on that date, once
 *  ✓ A scheduled reversal waits while its date is locked, and posts once it is unlocked
 *  ✓ A reverse date on or before the journal date is refused
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { ManualVouchersService, ManualVoucherInput } from './manual-vouchers.service';
import { JournalsService } from './journals.service';
import { JournalReversalService } from './journal-reversal.service';
import { ScheduledReversalsService } from './scheduled-reversals.service';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { ReportsService } from '../reports/reports.service';
import { ClosingService } from '../closing/closing.service';
import { ClosingRun, ClosingRunSchema } from '../closing/schemas/closing-run.schema';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { PeriodLock, PeriodLockSchema } from '../gl/schemas/period-lock.schema';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';
import { SalesInvoice, SalesInvoiceSchema, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { CustomersService } from '../sales/customers.service';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { VendorsService } from '../purchase/vendors.service';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';
import { TdsDeposit, TdsDepositSchema } from '../tds/schemas/tds-deposit.schema';

const ACTOR = new Types.ObjectId().toString();
const amounts = { taxableValue: 847458, cgst: 76271, sgst: 76271, igst: 0, cess: 0, total: 1000000 };

let moduleRef: TestingModule;
let vouchers: ManualVouchersService;
let journals: JournalsService;
let reversals: JournalReversalService;
let scheduled: ScheduledReversalsService;
let accounts: AccountsService;
let reports: ReportsService;
let closing: ClosingService;
let invoices: SalesInvoicesService;
let customers: CustomersService;
let vendors: VendorsService;
let journalModel: Model<JournalDocument>;
let invoiceModel: Model<SalesInvoiceDocument>;

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
        { name: CreditNote.name, schema: CreditNoteSchema },
        { name: DebitNote.name, schema: DebitNoteSchema },
        { name: TdsDeposit.name, schema: TdsDepositSchema },
      ]),
    ],
    providers: [
      ManualVouchersService, JournalsService, JournalReversalService, ScheduledReversalsService,
      PostingService, AccountsService, AuditService, ReportsService, ClosingService,
      SalesInvoicesService, CustomersService, VendorsService,
    ],
  }).compile();

  vouchers = moduleRef.get(ManualVouchersService);
  journals = moduleRef.get(JournalsService);
  reversals = moduleRef.get(JournalReversalService);
  scheduled = moduleRef.get(ScheduledReversalsService);
  accounts = moduleRef.get(AccountsService);
  reports = moduleRef.get(ReportsService);
  closing = moduleRef.get(ClosingService);
  invoices = moduleRef.get(SalesInvoicesService);
  customers = moduleRef.get(CustomersService);
  vendors = moduleRef.get(VendorsService);
  journalModel = moduleRef.get(getModelToken(Journal.name));
  invoiceModel = moduleRef.get(getModelToken(SalesInvoice.name));
  await journalModel.init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

async function org() {
  const orgId = new Types.ObjectId().toString();
  const chart = await accounts.list(orgId);
  const byKey = (k: SystemAccountKey) => chart.find((a) => a.systemKey === k)!._id;
  const byName = (n: string) => chart.find((a) => a.name === n)!._id;
  return { orgId, byKey, byName, rent: byName('Rent'), accrued: byKey(SystemAccountKey.ACCRUED_EXPENSES) };
}

const two = (debit: string, credit: string, paise = 500000, extra: Partial<ManualVoucherInput['lines'][number]> = {}) => [
  { accountId: debit, debitPaise: paise, creditPaise: 0, ...extra },
  { accountId: credit, debitPaise: 0, creditPaise: paise },
];

/** Net debit − credit on an account across posted journals. */
async function balance(orgId: string, accountId: string) {
  const posted = await journalModel.find({ orgId, status: 'posted' }).lean().exec();
  return posted.flatMap((j) => j.lines).filter((l) => String(l.accountId) === accountId).reduce((s, l) => s + l.debitPaise - l.creditPaise, 0);
}

describe('a new journal', () => {
  it('keeps Reference#, its own Journal# and a contact per line, and the JNL series runs on gapless', async () => {
    const { orgId, rent, accrued } = await org();
    const landlord = await vendors.create({ orgId, name: 'Mehta Estates' });

    const first = await vouchers.post(orgId, ACTOR, 'owner', {
      date: '2026-10-31', narration: 'Rent for October, bill not yet received', reference: 'AUD/26/14', journalNumber: 'ADJ-001',
      lines: two(rent, accrued, 4500000, { description: 'Godown rent', contact: { kind: 'vendor', id: String(landlord._id) } }),
    });
    const second = await vouchers.post(orgId, ACTOR, 'owner', { date: '2026-10-31', narration: 'Second provision', lines: two(rent, accrued) });

    const one = await journals.findOne(orgId, String(first._id));
    expect(one).toMatchObject({ voucherNumber: 'JNL/2026-27/0001', journalNumber: 'ADJ-001', reference: 'AUD/26/14', description: 'Rent for October, bill not yet received' });
    expect(one.lines[0]).toMatchObject({ description: 'Godown rent', contact: { kind: 'vendor', id: String(landlord._id), name: 'Mehta Estates' } });
    expect(one.lines[1].contact).toBeNull();
    expect((await journals.findOne(orgId, String(second._id))).voucherNumber).toBe('JNL/2026-27/0002');
    expect(await journals.nextNumber(orgId, '2026-11-02')).toEqual({ voucherNumber: 'JNL/2026-27/0003', financialYear: '2026-27' });

    // The ledger shows who the line was about.
    const ledger = await reports.getLedger(orgId, '2026-27', rent);
    expect(ledger.entries.map((e) => e.contact)).toEqual(['Mehta Estates', null]);
  });

  it('refuses a used or voucher-shaped Journal#, and missing or long notes, without using a number', async () => {
    const { orgId, rent, accrued } = await org();
    await vouchers.post(orgId, ACTOR, 'owner', { date: '2026-10-05', narration: 'First', journalNumber: 'ADJ-7', lines: two(rent, accrued) });
    await expect(vouchers.post(orgId, ACTOR, 'owner', { date: '2026-10-05', narration: 'Again', journalNumber: 'ADJ-7', lines: two(rent, accrued) })).rejects.toThrow(/Journal# ADJ-7 is already used/);
    await expect(vouchers.post(orgId, ACTOR, 'owner', { date: '2026-10-05', narration: 'Shape', journalNumber: 'JNL/2026-27/0009', lines: two(rent, accrued) })).rejects.toThrow(/looks like a voucher number/);
    await expect(vouchers.post(orgId, ACTOR, 'owner', { date: '2026-10-05', narration: '  ', lines: two(rent, accrued) })).rejects.toThrow(/Add notes/);
    await expect(vouchers.post(orgId, ACTOR, 'owner', { date: '2026-10-05', narration: 'x'.repeat(501), lines: two(rent, accrued) })).rejects.toThrow(/500 characters/);
    expect((await journals.nextNumber(orgId, '2026-10-05')).voucherNumber).toBe('JNL/2026-27/0002');
    // Another org may use the same Journal#.
    const other = await org();
    await expect(vouchers.post(other.orgId, ACTOR, 'owner', { date: '2026-10-05', narration: 'Theirs', journalNumber: 'ADJ-7', lines: two(other.rent, other.accrued) })).resolves.toBeTruthy();
  });

  it('refuses receivable, payable, advance and claim accounts, so the ageing always equals the control account', async () => {
    const { orgId, byKey, byName, rent } = await org();
    const customer = await customers.create({ orgId, name: 'Rao Traders' });
    const sale = await invoices.create({ orgId, customerId: String(customer._id), invoiceNumber: 'INV-1', invoiceDate: '2026-10-08', amountsPaise: amounts });
    await invoices.post(String(sale._id), orgId, ACTOR);

    const ar = byKey(SystemAccountKey.ACCOUNTS_RECEIVABLE);
    const outstanding = async () =>
      (await invoiceModel.find({ orgId, status: { $in: ['posted', 'paid'] } }).lean().exec())
        .reduce((s, i) => s + i.amountsPaise.total - (i.amountPaidPaise ?? 0) - (i.adjustedPaise ?? 0), 0);
    expect(await balance(orgId, ar)).toBe(await outstanding());
    const before = await journalModel.countDocuments({ orgId }).exec();

    const sales = byKey(SystemAccountKey.SALES_REVENUE);
    const bank = byKey(SystemAccountKey.BANK);
    await expect(vouchers.post(orgId, ACTOR, 'owner', { date: '2026-10-20', narration: 'Write off', lines: two(sales, ar) }))
      .rejects.toThrow(/Line 2: Accounts Receivable is kept customer by customer .* Raise a credit note, record a receipt, or enter the amount in Opening Balances/);
    await expect(vouchers.post(orgId, ACTOR, 'owner', { date: '2026-10-20', narration: 'Owed', lines: two(rent, byKey(SystemAccountKey.ACCOUNTS_PAYABLE)) }))
      .rejects.toThrow(/Accounts Payable is kept vendor by vendor .* Raise a debit note/);
    for (const key of [SystemAccountKey.CUSTOMER_ADVANCES, SystemAccountKey.VENDOR_ADVANCES, SystemAccountKey.EMPLOYEE_PAYABLE]) {
      await expect(vouchers.post(orgId, ACTOR, 'owner', { date: '2026-10-20', narration: 'Move', lines: two(byKey(key), bank) })).rejects.toThrow(/so a journal cannot post to it/);
    }

    // A contact on any other line is a tag: it moves no party's balance.
    await vouchers.post(orgId, ACTOR, 'owner', {
      date: '2026-10-20', narration: 'Discount given', lines: two(byName('Advertising & Marketing'), bank, 10000, { contact: { kind: 'customer', id: String(customer._id) } }),
    });

    expect(await journalModel.countDocuments({ orgId }).exec()).toBe(before + 1);
    expect(await balance(orgId, ar)).toBe(1000000);
    expect(await balance(orgId, ar)).toBe(await outstanding());
  });

  it('refuses a contact from another org', async () => {
    const { orgId, rent, accrued } = await org();
    const elsewhere = await vendors.create({ orgId: new Types.ObjectId().toString(), name: 'Not ours' });
    await expect(
      vouchers.post(orgId, ACTOR, 'owner', { date: '2026-10-05', narration: 'Rent', lines: two(rent, accrued, 1000, { contact: { kind: 'vendor', id: String(elsewhere._id) } }) }),
    ).rejects.toThrow(/Line 1: that vendor is not in your books/);
  });
});

describe('reverse journal date', () => {
  it('publish now: posts the reversal with the journal, dated the reverse date', async () => {
    const { orgId, rent, accrued } = await org();
    const landlord = await vendors.create({ orgId, name: 'Mehta Estates' });
    const j = await vouchers.post(orgId, ACTOR, 'owner', {
      date: '2026-10-31', narration: 'October rent accrued', reverseOn: '2026-11-01', publishReversalOnDate: false,
      lines: two(rent, accrued, 4500000, { contact: { kind: 'vendor', id: String(landlord._id) } }),
    });

    const original = await journals.findOne(orgId, String(j._id));
    expect(original.autoReverse).toEqual({ on: '2026-11-01', publishOnDate: false });
    expect(original.status).toBe('reversed');
    const reversal = await journals.findOne(orgId, original.reversedById!);
    expect(reversal).toMatchObject({ date: '2026-11-01', voucherNumber: 'JNL/2026-27/0002', reverses: { id: String(j._id), voucherNumber: 'JNL/2026-27/0001' } });
    expect(reversal.description).toBe('Reversal of JNL/2026-27/0001: October rent accrued');
    expect(reversal.lines[0]).toMatchObject({ creditPaise: 4500000, contact: { name: 'Mehta Estates' } });
    expect(await scheduled.due('2026-12-01', orgId)).toEqual([]);
    expect(await balance(orgId, rent)).toBe(0);
  });

  it('publish on the date: nothing until then, and the daily job posts it that day, once', async () => {
    const { orgId, rent, accrued } = await org();
    const j = await vouchers.post(orgId, ACTOR, 'owner', {
      date: '2026-10-31', narration: 'October rent accrued', journalNumber: 'ACR-10', reverseOn: '2026-11-01', publishReversalOnDate: true,
      lines: two(rent, accrued, 4500000),
    });
    const byHand = await vouchers.post(orgId, ACTOR, 'owner', { date: '2026-10-31', narration: 'Reversed by hand first', reverseOn: '2026-11-01', lines: two(rent, accrued, 100) });

    expect((await journals.findOne(orgId, String(j._id))).status).toBe('posted');
    expect(await scheduled.runDue('2026-10-31', orgId)).toEqual({ reversed: 0, failed: 0 });
    await reversals.reverse(String(byHand._id), orgId, ACTOR);

    expect(await scheduled.runDue('2026-11-01', orgId)).toEqual({ reversed: 1, failed: 0 });
    const original = await journals.findOne(orgId, String(j._id));
    const reversal = await journals.findOne(orgId, original.reversedById!);
    expect(reversal).toMatchObject({ date: '2026-11-01', description: 'Reversal of ACR-10: October rent accrued', journalNumber: null });
    // Run again (a restart, the next day): nothing more.
    expect(await scheduled.runDue('2026-11-02', orgId)).toEqual({ reversed: 0, failed: 0 });
    expect(await journalModel.countDocuments({ orgId, reversalOf: j._id }).exec()).toBe(1);
  });

  it('a scheduled reversal waits while its date is locked, and posts once it is unlocked', async () => {
    const { orgId, rent, accrued } = await org();
    const j = await vouchers.post(orgId, ACTOR, 'owner', { date: '2026-10-10', narration: 'Short accrual', reverseOn: '2026-10-12', lines: two(rent, accrued) });
    await closing.setModuleLock(orgId, ACTOR, 'accountant', '2026-10-15', 'October closed');

    expect(await scheduled.runDue('2026-10-20', orgId)).toEqual({ reversed: 0, failed: 1 });
    expect((await scheduled.due('2026-10-20', orgId)).map((d) => String(d._id))).toEqual([String(j._id)]);

    await closing.setModuleLock(orgId, ACTOR, 'accountant', null, 'Let the accrual reverse');
    expect(await scheduled.runDue('2026-10-20', orgId)).toEqual({ reversed: 1, failed: 0 });
    expect((await journalModel.findOne({ orgId, reversalOf: j._id }).lean().exec())!.date).toBe('2026-10-12');
  });

  it('refuses a reverse date on or before the journal date', async () => {
    const { orgId, rent, accrued } = await org();
    await expect(vouchers.post(orgId, ACTOR, 'owner', { date: '2026-10-31', narration: 'x', reverseOn: '2026-10-31', lines: two(rent, accrued) }))
      .rejects.toThrow(/must be after the journal date/);
  });
});
