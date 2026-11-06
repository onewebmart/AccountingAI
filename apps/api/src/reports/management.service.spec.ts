/**
 * Tests — management reports, budgets and scheduled report emails, against the books.
 *
 *  ✓ P&L by month and compared with the month before and the year before, from posted journals
 *  ✓ Budgets: last year's actuals as a start; the old per-year budget against actual when named budgets are not registered
 *  ✓ Any report by key, as a table or a PDF; an unknown one refused
 *  ✓ Sales by customer, month and item, less credit notes; GST from the books
 *  ✓ Receivables by how overdue, with how long the customer takes to pay
 *  ✓ A schedule emails its PDF when due and moves to its next date; a failure is kept on it; stopped, it waits
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { VoucherType } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { ManagementReportsService } from './management.service';
import { ReportCatalogService } from './report-catalog.service';
import { ReportSchedulesService, nextRun } from './report-schedules.service';
import { ReportsService } from './reports.service';
import { Budget, BudgetSchema } from './schemas/budget.schema';
import { ReportSchedule, ReportScheduleSchema } from './schemas/report-schedule.schema';
import { MailerService } from '../mail/mailer.service';
import { todayIst } from '../automation/schedule';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { CustomersService } from '../sales/customers.service';
import { CreditNotesService } from '../sales/credit-notes.service';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';

const ACTOR = new Types.ObjectId().toString();
const mailer = { configured: true, send: jest.fn(async (_mail: unknown) => ({ messageId: 'm1' })) };

let moduleRef: TestingModule;
let management: ManagementReportsService;
let catalog: ReportCatalogService;
let schedules: ReportSchedulesService;
let posting: PostingService;
let accounts: AccountsService;
let invoices: SalesInvoicesService;
let customers: CustomersService;
let creditNotes: CreditNotesService;
let itemModel: Model<unknown>;
let settingsModel: Model<unknown>;
let scheduleModel: Model<{ orgId: string; nextRunOn: string; lastSentOn: string | null; lastError: string | null; active: boolean }>;
let auditModel: Model<{ orgId: string; entityType: string; action: string }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: Budget.name, schema: BudgetSchema },
        { name: ReportSchedule.name, schema: ReportScheduleSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: CreditNote.name, schema: CreditNoteSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: DebitNote.name, schema: DebitNoteSchema },
        { name: Item.name, schema: ItemSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
      ]),
    ],
    providers: [
      ManagementReportsService, ReportCatalogService, ReportSchedulesService, ReportsService,
      // SMTP is outside the books: what is handed to it is what matters here.
      { provide: MailerService, useValue: mailer },
      PostingService, AccountsService, AuditService, SalesInvoicesService, CustomersService, CreditNotesService,
    ],
  }).compile();
  management = moduleRef.get(ManagementReportsService);
  catalog = moduleRef.get(ReportCatalogService);
  schedules = moduleRef.get(ReportSchedulesService);
  posting = moduleRef.get(PostingService);
  accounts = moduleRef.get(AccountsService);
  invoices = moduleRef.get(SalesInvoicesService);
  customers = moduleRef.get(CustomersService);
  creditNotes = moduleRef.get(CreditNotesService);
  itemModel = moduleRef.get(getModelToken(Item.name));
  settingsModel = moduleRef.get(getModelToken(OrgSettings.name));
  scheduleModel = moduleRef.get(getModelToken(ReportSchedule.name));
  auditModel = moduleRef.get(getModelToken(AuditLog.name));
  await moduleRef.get<Model<JournalDocument>>(getModelToken(Journal.name)).init();
  await moduleRef.get<Model<unknown>>(getModelToken(Budget.name)).init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

async function org() {
  const orgId = new Types.ObjectId().toString();
  await accounts.seedDefaults(orgId);
  await settingsModel.create({ orgId, displayName: 'Saffron Foods', gstin: '27AAPFU0939F1ZV', stateCode: '27' });
  const all = await accounts.list(orgId);
  const id = (name: string) => String(all.find((a) => a.name === name)!._id);
  return { orgId, id };
}

const journal = (orgId: string, date: string, dr: string, cr: string, amount: number) =>
  posting.post({ orgId, voucherType: VoucherType.JOURNAL, financialYear: Number(date.slice(5, 7)) >= 4 ? `${date.slice(0, 4)}-${String((Number(date.slice(0, 4)) + 1) % 100).padStart(2, '0')}` : `${Number(date.slice(0, 4)) - 1}-${date.slice(2, 4)}`, date, narration: 'test', postedBy: ACTOR, lines: [{ accountId: dr, debitPaise: amount, creditPaise: 0 }, { accountId: cr, debitPaise: 0, creditPaise: amount }] });
const cells = (t: { rows: Array<{ cells: unknown[] }> }, name: string) => t.rows.find((r) => r.cells[0] === name)?.cells;

describe('profit, comparisons and budgets', () => {
  it('reads the months from the books and compares them', async () => {
    const { orgId, id } = await org();
    await journal(orgId, '2025-11-15', id('Bank Accounts'), id('Sales Revenue'), 80_000_00);
    await journal(orgId, '2026-10-10', id('Bank Accounts'), id('Sales Revenue'), 1_00_000_00);
    await journal(orgId, '2026-10-12', id('Rent'), id('Bank Accounts'), 30_000_00);
    await journal(orgId, '2026-11-10', id('Bank Accounts'), id('Sales Revenue'), 1_20_000_00);
    await journal(orgId, '2026-11-12', id('Rent'), id('Bank Accounts'), 30_000_00);

    const pl = await management.plMonthly(orgId, { from: '2026-10', to: '2026-11' });
    expect(cells(pl, 'Sales Revenue')).toEqual(['Sales Revenue', 1_00_000_00, 1_20_000_00, 2_20_000_00]);
    expect(cells(pl, 'Net profit')).toEqual(['Net profit', 70_000_00, 90_000_00, 1_60_000_00]);
    expect(cells(pl, 'Bank Accounts')).toBeUndefined();

    const cmp = await management.comparison(orgId, { from: '2026-11', to: '2026-11' });
    expect(cmp.subtitle).toBe('Nov 2026 against Oct 2026 and Nov 2025');
    expect(cells(cmp, 'Sales Revenue')).toEqual(['Sales Revenue', 1_20_000_00, 1_00_000_00, 20_000_00, 20, 80_000_00, 40_000_00, 50]);

    // Any report by its key; the trial balance as a PDF.
    expect((await catalog.run(orgId, 'pl_monthly', { from: '2026-10', to: '2026-11' })).rows).toEqual(pl.rows);
    await expect(catalog.run(orgId, 'nope')).rejects.toThrow(/No report called nope/);
    const tb = await catalog.pdf(orgId, 'trial_balance', { financialYear: '2026-27' });
    expect(tb.buffer.toString('latin1', 0, 8)).toBe('%PDF-1.4');
    expect(tb.table.notes).toEqual(['Debits equal credits.']);
    expect(tb.buffer.toString('latin1')).toContain('(Saffron Foods) Tj');
  });

  // Named budgets themselves are tested in budgets.service.spec.ts; this module registers only the old per-year model.
  it('starts from last year, and without named budgets sets the old per-year budget against the actual', async () => {
    const { orgId, id } = await org();
    await journal(orgId, '2025-11-15', id('Bank Accounts'), id('Sales Revenue'), 80_000_00);
    await journal(orgId, '2026-10-10', id('Bank Accounts'), id('Sales Revenue'), 1_00_000_00);
    await journal(orgId, '2026-11-10', id('Bank Accounts'), id('Sales Revenue'), 1_20_000_00);
    await journal(orgId, '2026-11-12', id('Rent'), id('Bank Accounts'), 30_000_00);

    const start = await management.budgetsFromYear(orgId, '2026-27', '2025-26', 10);
    expect(start.rows).toEqual([{ accountId: id('Sales Revenue'), monthsPaise: [0, 0, 0, 0, 0, 0, 0, 88_000_00, 0, 0, 0, 0] }]);
    await expect(management.budgetsFromYear(orgId, '2026-27', '2025-26', -100)).rejects.toThrow(/above −100/);

    const months = [0, 0, 0, 0, 0, 0, 1_10_000_00, 1_10_000_00, 1_10_000_00, 0, 0, 0];
    await moduleRef.get<Model<unknown>>(getModelToken(Budget.name)).create({ orgId, financialYear: '2026-27', accountId: new Types.ObjectId(id('Sales Revenue')), monthsPaise: months, updatedBy: ACTOR });

    const bva = await management.budgetVsActual(orgId, '2026-27', '2026-11');
    expect(cells(bva, 'Sales Revenue')).toEqual(['Sales Revenue', 2_20_000_00, 2_20_000_00, 0, 100]);
    expect(cells(bva, 'Rent')).toEqual(['Rent', 0, 30_000_00, 30_000_00, null]);
  });
});

describe('sales, GST and receivables', () => {
  it('reads sales by customer, month and item, less credit notes, and what each customer owes', async () => {
    const { orgId } = await org();
    const rice = await itemModel.create({ orgId, name: 'Basmati Rice', nameKey: 'basmati rice', kind: 'goods', uqc: 'BAG' });
    const asha = await customers.create({ orgId, name: 'Asha Traders' });
    const bharat = await customers.create({ orgId, name: 'Bharat Stores' });
    const sale = async (customerId: string, number: string, date: string, dueDate: string, taxable: number, itemId: unknown = null) => {
      const gst = Math.round(taxable * 0.09);
      const draft = await invoices.create({
        orgId, customerId, invoiceNumber: number, invoiceDate: date, dueDate,
        lineItems: [{ description: itemId ? 'Basmati Rice' : 'Delivery', qty: itemId ? 10 : 1, ratePaise: itemId ? taxable / 10 : taxable, amountPaise: taxable, taxRatePct: 18, itemId: itemId as Types.ObjectId | null }],
        amountsPaise: { taxableValue: taxable, cgst: gst, sgst: gst, igst: 0, cess: 0, total: taxable + 2 * gst },
      });
      return invoices.post(String(draft._id), orgId, ACTOR);
    };
    const a1 = await sale(String(asha._id), 'A/1', '2026-10-05', '2026-10-20', 1_00_000_00, (rice as { _id: Types.ObjectId })._id);
    await sale(String(asha._id), 'A/2', '2026-11-01', '2026-11-30', 50_000_00);
    const b1 = await sale(String(bharat._id), 'B/1', '2026-09-01', '2026-09-15', 40_000_00);
    await invoices.markPaid(String(b1._id), orgId, ACTOR, '2026-10-01');
    await creditNotes.create(String(a1._id), orgId, ACTOR, { noteDate: '2026-10-25', reason: 'Two bags damaged', taxableValuePaise: 10_000_00 });

    const range = { from: '2026-09', to: '2026-11' };
    const byCustomer = await management.byParty(orgId, 'sales', range);
    expect(byCustomer.rows.map((r) => r.cells.slice(0, 5))).toEqual([
      ['Asha Traders', 2, 1_50_000_00, 10_000_00, 1_40_000_00],
      ['Bharat Stores', 1, 40_000_00, 0, 40_000_00],
      ['Total', 3, 1_90_000_00, 10_000_00, 1_80_000_00],
    ]);
    expect((await management.byMonth(orgId, 'sales', range)).rows.map((r) => [r.cells[0], r.cells[4]])).toEqual([['Sep 2026', 40_000_00], ['Oct 2026', 90_000_00], ['Nov 2026', 50_000_00], ['Total', 1_80_000_00]]);
    expect((await management.byItem(orgId, 'sales', range)).rows.map((r) => r.cells.slice(0, 4))).toEqual([['Basmati Rice', 10, 'BAG', 1_00_000_00], ['Lines not linked to an item', null, null, 90_000_00], ['Total', null, null, 1_90_000_00]]);

    const gst = await management.gst(orgId, range);
    expect(gst.rows.map((r) => [r.cells[0], r.cells[1]])).toEqual([['Sep 2026', 7_200_00], ['Oct 2026', 16_200_00], ['Nov 2026', 9_000_00], ['Total', 32_400_00]]);

    const owed = await management.ageing(orgId, 'receivables', '2026-11-04');
    // A/1: ₹1,18,000 less the note's ₹11,800, 15 days overdue; A/2 not due yet. Bharat paid B/1 30 days after it.
    expect(owed.rows.map((r) => r.cells)).toEqual([
      ['Asha Traders', 59_000_00, 1_06_200_00, 0, 0, 0, 1_65_200_00, null],
      ['Total', 59_000_00, 1_06_200_00, 0, 0, 0, 1_65_200_00, 30],
    ]);
  });
});

describe('scheduled reports', () => {
  it('emails the PDF when due, moves to the next date, keeps a failure, and waits when stopped', async () => {
    const { orgId } = await org();
    await expect(schedules.create(orgId, ACTOR, { report: 'receivables', frequency: 'monthly', day: 2, recipients: ['not-an-email'] })).rejects.toThrow(/email addresses/);
    await expect(schedules.create(orgId, ACTOR, { report: 'receivables', frequency: 'weekly', day: 9, recipients: ['a@b.in'] })).rejects.toThrow(/weekday/);
    const s = await schedules.create(orgId, ACTOR, { report: 'pl_monthly', period: 'last_month', frequency: 'monthly', day: 2, recipients: ['Owner@Shop.in', 'ca@firm.in'] });
    expect(s.nextRunOn).toBe(nextRun('monthly', 2, todayIst()));

    const due = s.nextRunOn;
    expect(await schedules.runDue(due)).toEqual({ sent: 1, failed: 0 });
    const mail = mailer.send.mock.calls[0][0] as unknown as { to: string; fromName: string; subject: string; attachments: Array<{ filename: string; content: Buffer; contentType: string }> };
    expect(mail).toMatchObject({ to: 'owner@shop.in, ca@firm.in', fromName: 'Saffron Foods' });
    expect(mail.subject).toMatch(/^Profit and loss by month: /);
    expect(mail.attachments[0]).toMatchObject({ contentType: 'application/pdf', filename: `pl-monthly-${todayIst()}.pdf` });
    expect(mail.attachments[0].content.toString('latin1', 0, 8)).toBe('%PDF-1.4');
    let saved = (await scheduleModel.findById(s._id).lean().exec())!;
    expect(saved).toMatchObject({ lastSentOn: due, lastError: null, nextRunOn: nextRun('monthly', 2, due) });
    expect(await auditModel.countDocuments({ orgId, entityType: 'ReportSchedule', action: 'SEND_REPORT' })).toBe(1);

    // Not due again until its next date.
    expect(await schedules.runDue(due)).toEqual({ sent: 0, failed: 0 });
    mailer.send.mockRejectedValueOnce(new Error('SMTP refused the login'));
    expect(await schedules.runDue(saved.nextRunOn)).toEqual({ sent: 0, failed: 1 });
    saved = (await scheduleModel.findById(s._id).lean().exec())!;
    expect(saved.lastError).toBe('SMTP refused the login');
    expect(saved.nextRunOn > due).toBe(true);

    await schedules.setActive(orgId, ACTOR, String(s._id), false);
    expect(await schedules.runDue('2099-01-01')).toEqual({ sent: 0, failed: 0 });
    expect((await schedules.list(orgId))[0]).toMatchObject({ title: 'Profit and loss by month', periodLabel: 'Last month', active: false });
  });
});
