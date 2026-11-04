/**
 * Tests — projects, time, and the project dimension on the books.
 *
 *  ✓ An invoice or bill line's project reaches its journal line at posting; a credit note and a
 *    reversal come off the same project; the project P&L reads them
 *  ✓ Time is logged by its person, changed only by them and only while unbilled; a completed project takes none
 *  ✓ Unbilled time becomes one draft invoice, a line per task and rate, tagged with the project; the
 *    same time cannot go on two invoices, even asked twice at once
 *  ✓ With a model, the lines are worded from the notes on an untouched draft only
 *  ✓ The list shows budget burn
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { InvoiceStatus, JournalStatus } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { PROJECT_AI_QUEUE, ProjectsService } from './projects.service';
import { Project, ProjectSchema } from './schemas/project.schema';
import { TimeEntry, TimeEntrySchema } from './schemas/time-entry.schema';
import { REPORT_MODEL } from '../reports/report-model';
import { ManagementReportsService } from '../reports/management.service';
import { Budget, BudgetSchema } from '../reports/schemas/budget.schema';
import { HSN_QUEUE, ItemsService } from '../items/items.service';
import { HSN_MODEL } from '../items/hsn-model';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { AiSuggestion, AiSuggestionSchema } from '../ai-suggestions/schemas/ai-suggestion.schema';
import { UsageMeterService } from '../ocr/usage-meter.service';
import { UsageMeter, UsageMeterSchema } from '../ocr/schemas/usage-meter.schema';
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
import { SalesInvoice, SalesInvoiceSchema, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { VendorsService } from '../purchase/vendors.service';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { User, UserSchema } from '../tenancy/schemas/user.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { TdsDeposit, TdsDepositSchema } from '../tds/schemas/tds-deposit.schema';

const ASHA = new Types.ObjectId().toString();
const RAVI = new Types.ObjectId().toString();
const queue = { add: jest.fn() };
const model = { available: false, json: jest.fn() };

let moduleRef: TestingModule;
let projects: ProjectsService;
let management: ManagementReportsService;
let items: ItemsService;
let accounts: AccountsService;
let posting: PostingService;
let invoices: SalesInvoicesService;
let customers: CustomersService;
let creditNotes: CreditNotesService;
let bills: PurchaseBillsService;
let vendors: VendorsService;
let journals: Model<JournalDocument>;
let invoiceModel: Model<SalesInvoiceDocument>;
let timeModel: Model<{ orgId: string; status: string; invoiceId: Types.ObjectId | null }>;
let settingsModel: Model<unknown>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: Project.name, schema: ProjectSchema },
        { name: TimeEntry.name, schema: TimeEntrySchema },
        { name: Item.name, schema: ItemSchema },
        { name: AiSuggestion.name, schema: AiSuggestionSchema },
        { name: UsageMeter.name, schema: UsageMeterSchema },
        { name: Budget.name, schema: BudgetSchema },
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
        { name: OrgSettings.name, schema: OrgSettingsSchema },
        { name: User.name, schema: UserSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
        { name: TdsDeposit.name, schema: TdsDepositSchema },
      ]),
    ],
    providers: [
      ProjectsService, ManagementReportsService, ItemsService, UsageMeterService,
      { provide: getQueueToken(PROJECT_AI_QUEUE), useValue: queue },
      { provide: getQueueToken(HSN_QUEUE), useValue: { add: jest.fn() } },
      { provide: HSN_MODEL, useValue: { available: false, ask: jest.fn() } },
      { provide: REPORT_MODEL, useValue: model },
      PostingService, AccountsService, AuditService, SalesInvoicesService, CustomersService, CreditNotesService, PurchaseBillsService, VendorsService,
    ],
  }).compile();
  projects = moduleRef.get(ProjectsService);
  management = moduleRef.get(ManagementReportsService);
  items = moduleRef.get(ItemsService);
  accounts = moduleRef.get(AccountsService);
  posting = moduleRef.get(PostingService);
  invoices = moduleRef.get(SalesInvoicesService);
  customers = moduleRef.get(CustomersService);
  creditNotes = moduleRef.get(CreditNotesService);
  bills = moduleRef.get(PurchaseBillsService);
  vendors = moduleRef.get(VendorsService);
  journals = moduleRef.get(getModelToken(Journal.name));
  invoiceModel = moduleRef.get(getModelToken(SalesInvoice.name));
  timeModel = moduleRef.get(getModelToken(TimeEntry.name));
  settingsModel = moduleRef.get(getModelToken(OrgSettings.name));
  const users = moduleRef.get<Model<unknown>>(getModelToken(User.name));
  await users.create({ _id: new Types.ObjectId(ASHA), email: `asha.${ASHA}@studio.in`, name: 'Asha' });
  await users.create({ _id: new Types.ObjectId(RAVI), email: `ravi.${RAVI}@studio.in`, name: 'Ravi' });
  await journals.init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

beforeEach(() => {
  jest.clearAllMocks();
  model.available = false;
});

async function org() {
  const orgId = new Types.ObjectId().toString();
  await accounts.seedDefaults(orgId);
  await settingsModel.create({ orgId, gstin: '27AAPFU0939F1ZV', stateCode: '27' });
  const customer = await customers.create({ orgId, name: 'Saffron Foods', stateCode: '27' });
  const design = await items.create(orgId, ASHA, { name: 'Design services', kind: 'service', hsnSac: '998391', gstRatePct: 18 });
  const project = await projects.create(orgId, ASHA, { name: 'Website redesign', customerId: String(customer._id), billing: 'time', ratePaise: 2000_00, budgetPaise: 1_00_000_00, serviceItemId: String(design._id) });
  return { orgId, customerId: String(customer._id), projectId: String(project._id) };
}

const lineOf = async (journalId: unknown, re: RegExp) => (await journals.findById(journalId).lean().exec())!.lines.filter((l) => re.test(l.description));

describe('the project dimension', () => {
  it('reaches journal lines at posting, comes off with notes and reversals, and adds up per project', async () => {
    const { orgId, customerId, projectId } = await org();
    const sold = await invoices.create({
      orgId, customerId, invoiceNumber: 'WEB/1', invoiceDate: '2026-10-10',
      lineItems: await items.resolveLines(orgId, [
        { description: 'Design', ratePaise: 60_000_00, amountPaise: 60_000_00, taxRatePct: 18, projectId },
        { description: 'Hosting', ratePaise: 40_000_00, amountPaise: 40_000_00, taxRatePct: 18 },
      ], 'sale'),
      amountsPaise: { taxableValue: 1_00_000_00, cgst: 9_000_00, sgst: 9_000_00, igst: 0, cess: 0, total: 1_18_000_00 },
    });
    const posted = await invoices.post(String(sold._id), orgId, ASHA);
    const revenue = await lineOf(posted.journalId, /Sales Revenue/);
    expect(revenue.map((l) => [l.creditPaise, l.projectId ? String(l.projectId) : null]).sort()).toEqual([[40_000_00, null], [60_000_00, projectId]]);

    const vendor = await vendors.create({ orgId, name: 'Pixel Freelancers' });
    const bought = await bills.create({ orgId, vendorId: String(vendor._id), billNumber: 'PF/9', billDate: '2026-10-12', lineItems: await items.resolveLines(orgId, [{ description: 'Illustrations', ratePaise: 15_000_00, amountPaise: 15_000_00, taxRatePct: 18, projectId }], 'purchase'), amountsPaise: { taxableValue: 15_000_00, cgst: 1_350_00, sgst: 1_350_00, igst: 0, cess: 0, total: 17_700_00 } });
    const billed = await bills.post(String(bought._id), orgId, ASHA);
    expect((await lineOf(billed.journalId, /Purchases/)).map((l) => String(l.projectId))).toEqual([projectId]);

    // A credit note comes off each income line in proportion, on its project.
    const note = await creditNotes.create(String(posted._id), orgId, ASHA, { noteDate: '2026-10-20', reason: 'Discount', taxableValuePaise: 10_000_00 });
    expect((await lineOf(note.journalId, /Sales Revenue/)).map((l) => [l.debitPaise, l.projectId ? String(l.projectId) : null]).sort()).toEqual([[4_000_00, null], [6_000_00, projectId]]);

    let f = (await management.projectFigures(orgId)).get(projectId)!;
    expect(f).toMatchObject({ incomePaise: 54_000_00, costPaise: 15_000_00 });

    // Reversing the bill takes its cost off the project too.
    await posting.reverse(String(billed.journalId), ASHA, undefined, { date: '2026-10-25' });
    const reversal = await journals.findOne({ orgId, reversalOf: billed.journalId, status: JournalStatus.POSTED }).lean().exec();
    expect(reversal!.lines.find((l) => l.debitPaise === 0 && l.creditPaise === 15_000_00)!.projectId!.toString()).toBe(projectId);
    f = (await management.projectFigures(orgId)).get(projectId)!;
    expect(f.costPaise).toBe(0);

    const pnl = await management.projectPnl(orgId, { from: '2026-10', to: '2026-10' });
    expect(pnl.rows[0].cells.slice(0, 6)).toEqual(['Website redesign', 'Saffron Foods', 54_000_00, 0, 54_000_00, 100]);
    await expect(items.resolveLines(orgId, [{ description: 'x', ratePaise: 1, amountPaise: 1, projectId: new Types.ObjectId().toString() }], 'sale')).rejects.toThrow(/No such project/);
  });
});

describe('time', () => {
  it('is changed only by its person while unbilled; a completed project takes none', async () => {
    const { orgId, projectId } = await org();
    const t = await projects.logTime(orgId, ASHA, { projectId, date: '2026-10-05', hours: 7.15, task: 'Design', notes: 'Homepage' });
    expect(t).toMatchObject({ userName: 'Asha', billable: true, status: 'unbilled', hours: 7.15 });
    await expect(projects.updateTime(orgId, RAVI, String(t._id), { hours: 2 })).rejects.toThrow(/Only the person who logged it/);
    expect((await projects.updateTime(orgId, ASHA, String(t._id), { hours: 6.5 })).hours).toBe(6.5);
    await projects.setStatus(orgId, ASHA, projectId, 'completed');
    await expect(projects.logTime(orgId, ASHA, { projectId, date: '2026-10-06', hours: 1, task: 'Design' })).rejects.toThrow(/completed/);
  });

  it('becomes one draft invoice, a line per task and rate, and cannot be billed twice', async () => {
    const { orgId, projectId } = await org();
    await projects.logTime(orgId, ASHA, { projectId, date: '2026-10-01', hours: 3, task: 'Design', notes: 'Wireframes' });
    await projects.logTime(orgId, RAVI, { projectId, date: '2026-10-03', hours: 2.5, task: 'Design', notes: 'Mobile layouts' });
    await projects.logTime(orgId, ASHA, { projectId, date: '2026-10-04', hours: 1, task: 'Meetings', notes: 'Review with the client' });
    await projects.logTime(orgId, ASHA, { projectId, date: '2026-10-04', hours: 2, task: 'Admin', billable: false });

    const preview = await projects.unbilled(orgId, projectId);
    expect(preview.lines.map((l) => [l.description, l.hours, l.amountPaise])).toEqual([['Design, 1–3 Oct 2026', 5.5, 11_000_00], ['Meetings, 4 Oct 2026', 1, 2_000_00]]);

    const [a, b] = await Promise.allSettled([projects.draftInvoice(orgId, ASHA, projectId), projects.draftInvoice(orgId, ASHA, projectId)]);
    const done = [a, b].filter((r) => r.status === 'fulfilled');
    expect(done).toHaveLength(1);
    expect([a, b].find((r) => r.status === 'rejected')!.reason.message).toMatch(/being drafted|just invoiced|No unbilled time/);

    const { invoiceId, hours } = (done[0] as PromiseFulfilledResult<{ invoiceId: string; hours: number }>).value;
    expect(hours).toBe(6.5);
    const inv = (await invoiceModel.findById(invoiceId).lean().exec())!;
    expect(inv).toMatchObject({ status: InvoiceStatus.DRAFT, source: { kind: 'project', id: projectId }, amountsPaise: { taxableValue: 13_000_00, cgst: 1_170_00, sgst: 1_170_00, igst: 0, total: 15_340_00 } });
    expect(inv.lineItems.map((l) => [l.description, l.qty, l.ratePaise, l.hsnSac, String(l.projectId)])).toEqual([
      ['Design, 1–3 Oct 2026', 5.5, 2000_00, '998391', projectId],
      ['Meetings, 4 Oct 2026', 1, 2000_00, '998391', projectId],
    ]);
    expect(await timeModel.countDocuments({ orgId, status: 'billed', invoiceId: new Types.ObjectId(invoiceId) })).toBe(3);
    expect(await timeModel.countDocuments({ orgId, status: 'unbilled' })).toBe(1); // the admin hour, not billable
    await expect(projects.draftInvoice(orgId, ASHA, projectId)).rejects.toThrow(/No unbilled time/);

    // Posted, its income lands on the project.
    await invoices.post(invoiceId, orgId, ASHA);
    expect((await management.projectFigures(orgId)).get(projectId)).toMatchObject({ incomePaise: 13_000_00, hours: 8.5, unbilledPaise: 0 });
  });

  it('has its lines worded from the notes by AI, on an untouched draft only', async () => {
    const { orgId, projectId } = await org();
    model.available = true;
    await projects.logTime(orgId, ASHA, { projectId, date: '2026-10-01', hours: 3, task: 'Design', notes: 'Wireframes for 3 landing pages' });
    const r = await projects.draftInvoice(orgId, ASHA, projectId);
    expect(queue.add).toHaveBeenCalledWith('time-lines', { orgId, suggestionId: r.wording }, expect.anything());
    model.json.mockResolvedValueOnce({ raw: { lines: [{ line: 0, description: 'Wireframes for 3 landing pages' }] }, tokensIn: 50, tokensOut: 10 });
    await projects.runTimeLines(orgId, r.wording!);
    expect((await invoiceModel.findById(r.invoiceId).lean().exec())!.lineItems[0].description).toBe('Wireframes for 3 landing pages, 1 Oct 2026');
    expect(await projects.wordingStatus(orgId, r.wording!)).toMatchObject({ status: 'done' });

    // Edited before the job ran: left alone.
    await projects.logTime(orgId, ASHA, { projectId, date: '2026-10-02', hours: 1, task: 'Design', notes: 'Logo tweaks' });
    const again = await projects.draftInvoice(orgId, ASHA, projectId);
    await invoiceModel.updateOne({ _id: again.invoiceId }, { $set: { notes: 'Edited by hand' } }).exec();
    model.json.mockResolvedValueOnce({ raw: { lines: [{ line: 0, description: 'Logo refinements' }] }, tokensIn: 5, tokensOut: 5 });
    await projects.runTimeLines(orgId, again.wording!);
    expect((await invoiceModel.findById(again.invoiceId).lean().exec())!.lineItems[0].description).toBe('Design, 2 Oct 2026');
    expect(await projects.wordingStatus(orgId, again.wording!)).toMatchObject({ status: 'none' });
  });

  it('shows budget burn on the list', async () => {
    const { orgId, projectId } = await org();
    await projects.logTime(orgId, ASHA, { projectId, date: '2026-10-01', hours: 20, task: 'Design' });
    await projects.logTime(orgId, ASHA, { projectId, date: '2026-10-02', hours: 22.5, task: 'Design' });
    const [p] = await projects.list(orgId);
    // 42.5 hours at ₹2,000 against a ₹1,00,000 cap.
    expect(p).toMatchObject({ name: 'Website redesign', customerName: 'Saffron Foods', hours: 42.5, unbilledPaise: 85_000_00, alerts: [{ level: 'warn', text: 'Time billed and unbilled is at 85% of the budget.' }] });
  });
});
