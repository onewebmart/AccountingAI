/**
 * Integration tests — recurring documents and payment reminders.
 *
 *  ✓ A recurring bill drafts each missed month, dated and due as set, never posted
 *  ✓ Two runs at once draft each month once
 *  ✓ An end date ends the template; resuming skips the paused months
 *  ✓ A failed draft hands its date back for tomorrow, with the reason
 *  ✓ A recurring invoice drafts, and takes its serial when posted
 *  ✓ A recurring invoice with lines is priced on the server (discount, adjustment), repeats weekly, every two or six months, carries its words
 *  ✓ A recurring expense drafts a draft expense once on its date, never posted; it pays only from bank or cash
 *  ✓ An itemized weekly recurring expense for a customer drafts its lines, customer and billable on each date until it ends
 *  ✓ An itemized recurring expense is checked as an expense is; one with no end date runs every two months on the last day
 *  ✓ The ladder is off until switched on, sends each rung once, and jumps to the latest rung
 *  ✓ A customer with no email or phone is reported, not skipped silently
 *  ✓ Chasing one invoice works with the ladder off, but not twice in a day nor once paid
 *  ✓ Delivery marks the reminder sent through the mock adapter
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { BillStatus, InvoiceStatus } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { RecurringService } from './recurring.service';
import { BOOKS_AUTOMATION_QUEUE, composeReminder, RemindersService } from './reminders.service';
import { RecurringTemplate, RecurringTemplateSchema } from './schemas/recurring-template.schema';
import { PaymentReminder, PaymentReminderSchema } from './schemas/payment-reminder.schema';
import { ReminderSettings, ReminderSettingsSchema } from './schemas/reminder-settings.schema';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { MESSAGING_PROVIDER } from '../crm/messaging/messaging.provider.interface';
import { MockMessagingProvider } from '../crm/messaging/mock-messaging.provider';
import { DirectExpensesService } from '../direct-expenses/direct-expenses.service';
import { DirectExpense, DirectExpenseSchema } from '../direct-expenses/schemas/direct-expense.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';

const ACTOR = new Types.ObjectId().toString();
const queue = { add: jest.fn().mockResolvedValue(undefined) };

let moduleRef: TestingModule;
let recurring: RecurringService;
let reminders: RemindersService;
let invoicesSvc: SalesInvoicesService;
let vendors: Model<unknown>;
let customers: Model<unknown>;
let bills: Model<{ status: string; billDate: string; dueDate: string | null; recurringTemplateId: unknown; notes: string | null }>;
let invoices: Model<{ status: string; invoiceNumber: string | null; recurringTemplateId: unknown }>;
let templates: Model<{ status: string; nextRunDate: string | null; lastError: string | null; generated: unknown[] }>;
let reminderModel: Model<{ rung: string; status: string; isMock: boolean; to: string; channel: string }>;
let expenseModel: Model<{ status: string; date: string; recurringTemplateId: unknown; journalId: unknown }>;
let journalModel: Model<unknown>;
let accountsSvc: AccountsService;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: RecurringTemplate.name, schema: RecurringTemplateSchema },
        { name: PaymentReminder.name, schema: PaymentReminderSchema },
        { name: ReminderSettings.name, schema: ReminderSettingsSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: DirectExpense.name, schema: DirectExpenseSchema },
        { name: Project.name, schema: ProjectSchema },
      ]),
    ],
    providers: [
      RecurringService,
      RemindersService,
      PurchaseBillsService,
      SalesInvoicesService,
      PostingService,
      AccountsService,
      AuditService,
      DirectExpensesService,
      { provide: MESSAGING_PROVIDER, useClass: MockMessagingProvider },
      { provide: getQueueToken(BOOKS_AUTOMATION_QUEUE), useValue: queue },
    ],
  }).compile();

  recurring = moduleRef.get(RecurringService);
  reminders = moduleRef.get(RemindersService);
  invoicesSvc = moduleRef.get(SalesInvoicesService);
  vendors = moduleRef.get(getModelToken(Vendor.name));
  customers = moduleRef.get(getModelToken(Customer.name));
  bills = moduleRef.get(getModelToken(PurchaseBill.name));
  invoices = moduleRef.get(getModelToken(SalesInvoice.name));
  templates = moduleRef.get(getModelToken(RecurringTemplate.name));
  reminderModel = moduleRef.get(getModelToken(PaymentReminder.name));
  await reminderModel.init();
  expenseModel = moduleRef.get(getModelToken(DirectExpense.name));
  journalModel = moduleRef.get(getModelToken(Journal.name));
  accountsSvc = moduleRef.get(AccountsService);
  // Expenses are numbered and saved inside a transaction: the collections exist first.
  await expenseModel.init();
  await moduleRef.get<Model<unknown>>(getModelToken(Counter.name)).init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

const RENT = { taxableValue: 5000000, cgst: 450000, sgst: 450000, igst: 0, cess: 0, total: 5900000 };

async function org() {
  const orgId = new Types.ObjectId().toString();
  const vendor = await vendors.create({ orgId, name: 'Landlord LLP', gstin: '27AAACR5055K1Z5' });
  const customer = await customers.create({ orgId, name: 'Rao Traders', email: 'accounts@rao.example', phone: null });
  return { orgId, vendorId: String(vendor._id), customerId: String(customer._id) };
}

function rent(orgId: string, vendorId: string, extra: Record<string, unknown> = {}) {
  return recurring.create(orgId, ACTOR, {
    kind: 'bill', name: 'Office rent', partyId: vendorId, frequency: 'monthly', dayOfMonth: 31,
    startDate: '2026-07-01', dueInDays: 10, amountsPaise: RENT, ...extra,
  });
}

describe('recurring bills', () => {
  it('drafts each missed month, dated and due as set, and stops there', async () => {
    const { orgId, vendorId } = await org();
    const template = await rent(orgId, vendorId);
    expect(template.nextRunDate).toBe('2026-07-31');

    const run = await recurring.runDue(orgId, '2026-09-15');
    expect(run.drafted.map((d) => d.documentDate)).toEqual(['2026-07-31', '2026-08-31']);
    const drafted = await bills.find({ orgId }).sort({ billDate: 1 }).lean().exec();
    expect(drafted.map((b) => [b.status, b.billDate, b.dueDate, String(b.recurringTemplateId), b.notes])).toEqual([
      [BillStatus.DRAFT, '2026-07-31', '2026-08-10', String(template._id), 'Office rent'],
      [BillStatus.DRAFT, '2026-08-31', '2026-09-10', String(template._id), 'Office rent'],
    ]);
    expect((await templates.findById(template._id).lean().exec())?.nextRunDate).toBe('2026-09-30');
    expect((await recurring.runDue(orgId, '2026-09-15')).drafted).toHaveLength(0);
  });

  it('drafts each month once when two runs race', async () => {
    const { orgId, vendorId } = await org();
    await rent(orgId, vendorId);
    const [a, b] = await Promise.all([recurring.runDue(orgId, '2026-08-31'), recurring.runDue(orgId, '2026-08-31')]);
    expect(a.drafted.length + b.drafted.length).toBe(2);
    expect(await bills.countDocuments({ orgId })).toBe(2);
  });

  it('ends at the end date, and resuming skips the paused months', async () => {
    const { orgId, vendorId } = await org();
    const ending = await rent(orgId, vendorId, { endDate: '2026-08-31' });
    await recurring.runDue(orgId, '2026-09-15');
    expect(await templates.findById(ending._id).lean().exec()).toMatchObject({ status: 'ended', nextRunDate: null });

    const paused = await rent(orgId, vendorId, { name: 'Internet' });
    await recurring.setStatus(orgId, String(paused._id), ACTOR, 'paused');
    expect((await recurring.runDue(orgId, '2026-12-10')).drafted.filter((d) => d.name === 'Internet')).toHaveLength(0);
    const resumed = await recurring.setStatus(orgId, String(paused._id), ACTOR, 'active', '2026-12-10');
    expect(resumed.nextRunDate).toBe('2026-12-31');
  });

  it('hands the date back when a draft fails, with the reason', async () => {
    const { orgId, vendorId } = await org();
    const template = await rent(orgId, vendorId);
    await vendors.deleteOne({ _id: vendorId });
    const run = await recurring.runDue(orgId, '2026-08-05');
    expect(run.failed.map((f) => f.error)).toEqual(['Vendor not found']);
    expect(await templates.findById(template._id).lean().exec()).toMatchObject({
      status: 'active', nextRunDate: '2026-07-31', lastError: 'Vendor not found',
    });
  });

  it('refuses a total that is not the sum of its parts, and another org’s vendor', async () => {
    const { orgId, vendorId } = await org();
    await expect(rent(orgId, vendorId, { amountsPaise: { ...RENT, total: 1 } })).rejects.toThrow(/taxable value plus the taxes/);
    const other = await org();
    await expect(rent(orgId, other.vendorId)).rejects.toThrow(/Vendor not found/);
  });
});

describe('recurring invoices', () => {
  it('drafts an invoice that takes its serial when posted', async () => {
    const { orgId, customerId } = await org();
    await recurring.create(orgId, ACTOR, {
      kind: 'invoice', name: 'Monthly retainer', partyId: customerId, frequency: 'monthly', dayOfMonth: 1,
      startDate: '2026-10-01', amountsPaise: { taxableValue: 2000000, cgst: 180000, sgst: 180000, igst: 0, cess: 0, total: 2360000 },
    });
    const run = await recurring.runDue(orgId, '2026-10-01');
    expect(run.drafted).toHaveLength(1);
    const draft = await invoices.findById(run.drafted[0].documentId).lean().exec();
    expect(draft).toMatchObject({ status: InvoiceStatus.DRAFT, invoiceNumber: null });

    await invoicesSvc.post(run.drafted[0].documentId, orgId, ACTOR);
    expect((await invoices.findById(run.drafted[0].documentId).lean().exec())?.invoiceNumber).toBe('INV/2026-27/0001');
  });
});

describe('recurring expenses', () => {
  async function chart(orgId: string) {
    await accountsSvc.seedDefaults(orgId);
    const all = await accountsSvc.list(orgId);
    return (name: string) => String(all.find((a) => a.name === name)!._id);
  }

  it('drafts a draft expense once on its date, for a person to post', async () => {
    const { orgId, vendorId } = await org();
    const id = await chart(orgId);
    const template = await recurring.create(orgId, ACTOR, {
      kind: 'expense', name: 'Accounting software', partyId: vendorId, frequency: 'monthly', dayOfMonth: 5, startDate: '2026-10-01',
      expense: { expenseAccountId: id('Telephone & Internet'), paidThroughAccountId: id('Bank Accounts'), taxablePaise: 150000, gstRatePct: 18, claimable: true },
    });
    expect(template.toObject()).toMatchObject({ kind: 'expense', nextRunDate: '2026-10-05', amountsPaise: { taxableValue: 150000, cgst: 13500, sgst: 13500, total: 177000 } });

    expect((await recurring.runDue(orgId, '2026-10-04')).drafted).toHaveLength(0);
    const run = await recurring.runDue(orgId, '2026-10-05');
    expect(run.drafted).toEqual([expect.objectContaining({ kind: 'expense', name: 'Accounting software', documentDate: '2026-10-05' })]);
    expect((await recurring.runDue(orgId, '2026-10-05')).drafted).toHaveLength(0);

    const drafted = await expenseModel.find({ orgId }).lean().exec();
    expect(drafted).toHaveLength(1);
    expect(drafted[0]).toMatchObject({
      number: 'EXP/2026-27/0001', status: 'draft', date: '2026-10-05', taxablePaise: 150000, cgstPaise: 13500, sgstPaise: 13500, totalPaise: 177000,
      claimable: true, vendorGstin: '27AAACR5055K1Z5', notes: 'Accounting software', journalId: null, createdBy: 'system:recurring',
    });
    expect(String(drafted[0].recurringTemplateId)).toBe(String(template._id));
    expect(String((drafted[0] as unknown as { vendorId: unknown }).vendorId)).toBe(vendorId);
    // Drafted, never posted: the ledger has not moved.
    expect(await journalModel.countDocuments({ orgId })).toBe(0);

    const listed = (await recurring.list(orgId)).find((t) => t._id === String(template._id))!;
    expect(listed).toMatchObject({ kind: 'expense', partyName: 'Landlord LLP', totalPaise: 177000, draftedCount: 1, nextRunDate: '2026-11-05' });
    expect(listed.expense).toMatchObject({ expenseAccountId: id('Telephone & Internet'), paidThroughAccountId: id('Bank Accounts') });
  });

  it('pays only from a bank or cash account, and needs no vendor', async () => {
    const { orgId } = await org();
    const id = await chart(orgId);
    const base = { kind: 'expense' as const, name: 'Office cleaning', frequency: 'monthly' as const, dayOfMonth: 1, startDate: '2026-10-01' };
    await expect(recurring.create(orgId, ACTOR, { ...base, expense: { expenseAccountId: id('Repairs & Maintenance'), paidThroughAccountId: id('Rent'), taxablePaise: 300000 } })).rejects.toThrow(/bank or cash/);
    const ok = await recurring.create(orgId, ACTOR, { ...base, expense: { expenseAccountId: id('Repairs & Maintenance'), paidThroughAccountId: id('Cash in Hand'), taxablePaise: 300000 } });
    expect(ok.partyId).toBeNull();
    const run = await recurring.runDue(orgId, '2026-10-01');
    expect(run.drafted).toHaveLength(1);
    expect((await expenseModel.findById(run.drafted[0].documentId).lean().exec())?.status).toBe('draft');
  });

  it('drafts an itemized weekly expense for a customer on each date until it ends, never posted', async () => {
    const { orgId, vendorId } = await org();
    const id = await chart(orgId);
    const [customer] = (await customers.create([{ orgId, name: 'Acme Ltd' }])) as Array<{ _id: Types.ObjectId }>;
    const template = await recurring.create(orgId, ACTOR, {
      kind: 'expense', name: 'Site visits', partyId: vendorId, frequency: 'weekly', dayOfMonth: 4, startDate: '2026-11-04', endDate: '2026-11-18', notes: 'Cab and tea',
      expense: {
        paidThroughAccountId: id('Cash in Hand'), customerId: String(customer._id), billable: true,
        lines: [
          { expenseAccountId: id('Travelling & Conveyance'), amountPaise: 80000, gstRatePct: 5 },
          { expenseAccountId: id('Office & Stationery'), amountPaise: 20000, description: 'Tea' },
        ],
      },
    });
    expect(template.toObject()).toMatchObject({ frequency: 'weekly', nextRunDate: '2026-11-04', endDate: '2026-11-18', amountsPaise: { taxableValue: 100000, cgst: 2000, sgst: 2000, total: 104000 } });
    expect(template.expense!.lines).toHaveLength(2);

    const run = await recurring.runDue(orgId, '2026-11-30');
    expect(run.drafted.map((d) => d.documentDate)).toEqual(['2026-11-04', '2026-11-11', '2026-11-18']);
    const drafted = (await expenseModel.find({ orgId }).sort({ date: 1 }).lean().exec()) as unknown as DirectExpense[];
    expect(drafted.map((d) => d.number)).toEqual(['EXP/2026-27/0001', 'EXP/2026-27/0002', 'EXP/2026-27/0003']);
    for (const d of drafted) {
      expect(d).toMatchObject({ status: 'draft', taxablePaise: 100000, cgstPaise: 2000, sgstPaise: 2000, totalPaise: 104000, billable: true, notes: 'Site visits — Cab and tea', journalId: null });
      expect(d.lines.map((l) => [String(l.expenseAccountId), l.amountPaise, l.description])).toEqual([[id('Travelling & Conveyance'), 80000, null], [id('Office & Stationery'), 20000, 'Tea']]);
      expect(String(d.customerId)).toBe(String(customer._id));
    }
    // Drafted, never posted.
    expect(await journalModel.countDocuments({ orgId })).toBe(0);

    const listed = (await recurring.list(orgId)).find((t) => t._id === String(template._id))!;
    expect(listed).toMatchObject({ status: 'ended', nextRunDate: null, frequency: 'weekly', draftedCount: 3, notes: 'Cab and tea' });
    expect(listed.expense).toMatchObject({
      customerId: String(customer._id), customerName: 'Acme Ltd', billable: true,
      lines: [expect.objectContaining({ expenseAccountId: id('Travelling & Conveyance'), amountPaise: 80000, gstRatePct: 5 }), expect.objectContaining({ description: 'Tea' })],
    });
  });

  it('checks an itemized recurring expense as an expense is, and runs with no end date', async () => {
    const { orgId } = await org();
    const id = await chart(orgId);
    const base = { kind: 'expense' as const, name: 'Software', frequency: 'bimonthly' as const, dayOfMonth: 31, startDate: '2026-10-01' };
    await expect(recurring.create(orgId, ACTOR, { ...base, expense: { paidThroughAccountId: id('Bank Accounts'), lines: [{ expenseAccountId: id('Rent'), amountPaise: 100 }, { expenseAccountId: id('Bank Accounts'), amountPaise: 100 }] } })).rejects.toThrow(/Line 2: Pick an expense account/);
    await expect(recurring.create(orgId, ACTOR, { ...base, expense: { paidThroughAccountId: id('Bank Accounts'), expenseAccountId: id('Rent'), taxablePaise: 100, billable: true } })).rejects.toThrow(/needs the customer/);
    const ok = await recurring.create(orgId, ACTOR, { ...base, endDate: null, expense: { paidThroughAccountId: id('Bank Accounts'), expenseAccountId: id('Telephone & Internet'), taxablePaise: 99900 } });
    expect(ok.toObject()).toMatchObject({ nextRunDate: '2026-10-31', endDate: null, status: 'active' });
    const run = await recurring.runDue(orgId, '2027-03-01');
    // Every two months on the last day: 31 Oct, 31 Dec, 28 Feb.
    expect(run.drafted.map((d) => d.documentDate)).toEqual(['2026-10-31', '2026-12-31', '2027-02-28']);
    expect((await recurring.list(orgId))[0]).toMatchObject({ status: 'active', nextRunDate: '2027-04-30' });
  });
});

describe('payment reminders', () => {
  async function openInvoice(orgId: string, customerId: string, dueDate = '2026-10-10') {
    const inv = await invoicesSvc.create({
      orgId, customerId, invoiceNumber: `INV-${new Types.ObjectId().toString().slice(-5)}`, invoiceDate: '2026-09-25', dueDate,
      amountsPaise: { taxableValue: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0, total: 118000 },
    });
    await invoicesSvc.send(String(inv._id), orgId, ACTOR);
    return String(inv._id);
  }

  it('does nothing until switched on, then climbs the ladder a rung at a time', async () => {
    const { orgId, customerId } = await org();
    const invoiceId = await openInvoice(orgId, customerId);
    expect(await reminders.runDue(orgId, '2026-10-07')).toMatchObject({ enabled: false, queued: 0 });

    await reminders.updateSettings(orgId, ACTOR, { enabled: true });
    expect((await reminders.runDue(orgId, '2026-10-05')).queued).toBe(0); // five days early: nothing yet
    expect((await reminders.runDue(orgId, '2026-10-07')).queued).toBe(1);
    expect((await reminders.runDue(orgId, '2026-10-08')).queued).toBe(0); // same rung, already sent
    expect((await reminders.runDue(orgId, '2026-10-10')).queued).toBe(1);
    // Six weeks late, having missed 7 and 15: one 30-day reminder, not three.
    expect((await reminders.runDue(orgId, '2026-11-25')).queued).toBe(1);
    expect((await reminders.runDue(orgId, '2026-11-26')).queued).toBe(0);

    const sent = await reminderModel.find({ orgId, invoiceId }).sort({ createdAt: 1 }).lean().exec();
    expect(sent.map((r) => [r.rung, r.channel, r.to])).toEqual([
      ['before_due', 'email', 'accounts@rao.example'],
      ['on_due', 'email', 'accounts@rao.example'],
      ['late_30', 'email', 'accounts@rao.example'],
    ]);
    expect(queue.add).toHaveBeenCalledWith('send-reminder', expect.objectContaining({ orgId }), expect.objectContaining({ attempts: 3 }));
  });

  it('reports customers it cannot reach', async () => {
    const { orgId } = await org();
    const silent = await customers.create({ orgId, name: 'No Contact Co', email: null, phone: null });
    await openInvoice(orgId, String(silent._id), '2026-10-01');
    await reminders.updateSettings(orgId, ACTOR, { enabled: true });
    const run = await reminders.runDue(orgId, '2026-10-01');
    expect(run.queued).toBe(0);
    expect(run.noContact.map((c) => c.customerName)).toEqual(['No Contact Co']);
  });

  it('chases one invoice on request, once a day, and never a paid one', async () => {
    const { orgId, customerId } = await org();
    const invoiceId = await openInvoice(orgId, customerId);
    const reminder = await reminders.sendNow(orgId, invoiceId, ACTOR, '2026-10-20');
    expect(reminder.rung).toBe('manual');
    expect(reminder.body).toContain('was due on 10 Oct 2026');
    await expect(reminders.sendNow(orgId, invoiceId, ACTOR, '2026-10-20')).rejects.toThrow(/within the last day/);

    await invoicesSvc.post(invoiceId, orgId, ACTOR);
    await invoicesSvc.markPaid(invoiceId, orgId, ACTOR, '2026-10-21');
    await expect(reminders.sendNow(orgId, invoiceId, ACTOR)).rejects.toThrow(/already paid/);
  });

  it('marks a delivered reminder sent, through the mock adapter', async () => {
    const { orgId, customerId } = await org();
    const invoiceId = await openInvoice(orgId, customerId);
    const reminder = await reminders.sendNow(orgId, invoiceId, ACTOR, '2026-10-20');
    await reminders.deliver(String(reminder._id));
    expect(await reminderModel.findById(reminder._id).lean().exec()).toMatchObject({ status: 'sent', isMock: true });
  });

  it('words a late reminder firmly and an early one politely', () => {
    const base = { customerName: 'Rao Traders', orgName: 'Sharma & Co', invoiceNumber: 'INV-9', outstandingPaise: 118000, dueDate: '2026-10-10' };
    expect(composeReminder({ ...base, rung: 'late_7', daysLate: 7 }).subject).toBe('Invoice INV-9 is 7 days overdue');
    const early = composeReminder({ ...base, rung: 'before_due', daysLate: -3 });
    expect(early.subject).toBe('Invoice INV-9 is due on 10 Oct 2026');
    expect(early.body).toContain('₹1,180.00');
  });
});

describe('recurring invoices, as a full document', () => {
  it('prices its lines on the server, repeats weekly, and drafts each with its words, never posted', async () => {
    const { orgId, customerId } = await org();
    const template = await recurring.create(orgId, ACTOR, {
      kind: 'invoice', name: 'Weekly cleaning', partyId: customerId, frequency: 'weekly', dayOfMonth: 4,
      startDate: '2026-11-04', endDate: '2026-11-18', dueInDays: 7,
      // What the browser previewed is not what is stored: the server prices the lines.
      amountsPaise: { taxableValue: 1, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 1 },
      lineItems: [
        { description: 'Cleaning visit', hsnSac: '998533', qty: 2, ratePaise: 50000, amountPaise: 100000, taxRatePct: 18 },
        { description: 'Supplies', qty: 1, ratePaise: 50000, amountPaise: 50000, taxRatePct: 18 },
      ],
      discount: { percent: 10 }, adjustment: { label: 'Round off', paise: 30 },
      referenceNumber: 'AMC-2026', subject: 'Weekly office cleaning', salespersonName: 'Asha', termsAndConditions: 'Payable within 7 days.',
    });
    expect(template.toObject()).toMatchObject({
      frequency: 'weekly', nextRunDate: '2026-11-04',
      amountsPaise: { taxableValue: 135000, cgst: 12150, sgst: 12150, total: 159330 },
      discount: { percent: 10, amountPaise: 15000 }, adjustment: { paise: 30 }, subject: 'Weekly office cleaning',
    });
    expect(template.lineItems.map((l) => l.discountPaise)).toEqual([10000, 5000]);

    const run = await recurring.runDue(orgId, '2026-11-20');
    expect(run.drafted.map((d) => d.documentDate)).toEqual(['2026-11-04', '2026-11-11', '2026-11-18']);
    expect((await templates.findById(template._id).lean().exec())).toMatchObject({ status: 'ended', nextRunDate: null });
    const drafts = await invoices.find({ orgId, recurringTemplateId: template._id }).sort({ invoiceDate: 1 }).lean().exec();
    expect(drafts.map((d) => d.status)).toEqual([InvoiceStatus.DRAFT, InvoiceStatus.DRAFT, InvoiceStatus.DRAFT]);
    expect(drafts[0]).toMatchObject({ dueDate: '2026-11-11', referenceNumber: 'AMC-2026', subject: 'Weekly office cleaning', salespersonName: 'Asha', paymentTermsDays: 7, amountsPaise: { total: 159330 } });

    // Posted by a person: the adjustment goes to Round Off and the voucher balances.
    const posted = await invoicesSvc.post(String(drafts[0]._id), orgId, ACTOR);
    const j = (await journalModel.findById(posted.journalId).lean().exec()) as unknown as { lines: Array<{ description: string; debitPaise: number; creditPaise: number }> };
    expect(j.lines.reduce((s, l) => s + l.debitPaise, 0)).toBe(j.lines.reduce((s, l) => s + l.creditPaise, 0));
    expect(j.lines.find((l) => /Round Off/.test(l.description))?.creditPaise).toBe(30);
  });

  it('repeats every two months and every six months', async () => {
    const { orgId, customerId } = await org();
    const base = { kind: 'invoice' as const, partyId: customerId, dayOfMonth: 1, startDate: '2026-04-01', amountsPaise: { taxableValue: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0, total: 118000 } };
    await recurring.create(orgId, ACTOR, { ...base, name: 'Every two months', frequency: 'bimonthly' });
    await recurring.create(orgId, ACTOR, { ...base, name: 'Every six months', frequency: 'half_yearly' });
    const run = await recurring.runDue(orgId, '2026-11-01');
    const dates = (name: string) => run.drafted.filter((d) => d.name === name).map((d) => d.documentDate);
    expect(dates('Every two months')).toEqual(['2026-04-01', '2026-06-01', '2026-08-01', '2026-10-01']);
    expect(dates('Every six months')).toEqual(['2026-04-01', '2026-10-01']);
  });
});
