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
 *  ✓ An old 'time' project reads as project hours; 'time' is still accepted; a new budget supersedes the old one
 *  ✓ The creator is on a new project; users must be on the team; the watchlist flag is kept
 *  ✓ Tasks keep their ids across edits, can be imported, and stay while they have billable time waiting;
 *    time on a task takes its name and billable setting
 *  ✓ A draft prices time by the method (project, task or staff hours) and refuses time without a rate,
 *    naming the task or person; a fixed fee works as before
 *  ✓ Time spent as hours and minutes or start and end times; time for someone else needs a manager and
 *    a person on the project; who logged it is kept and audited
 *  ✓ The timer: one per person, on the server; stopped (even twice at once) it logs its minutes once
 *  ✓ The timesheet filters by period, customer, project, person and billing, with totals
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { InvoiceStatus, JournalStatus, UserRole } from '@ai-accounting/shared';
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
import { OrgMembership, OrgMembershipSchema } from '../tenancy/schemas/org-membership.schema';
import { TimeTimer, TimeTimerSchema } from './schemas/time-timer.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { TdsDeposit, TdsDepositSchema } from '../tds/schemas/tds-deposit.schema';
import { addDays, todayIst } from '../automation/schedule';

const ASHA = new Types.ObjectId().toString();
const RAVI = new Types.ObjectId().toString();
/** A real user, but not on the team of any org these tests make. */
const MEERA = new Types.ObjectId().toString();
/** Asha as someone who manages projects (MANAGE_SALES). */
const ASHA_MANAGER = { userId: ASHA, canManage: true };
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
let projectModel: Model<{ orgId: string; billing: string }>;
let membershipModel: Model<unknown>;
let timerModel: Model<{ orgId: string; userId: string }>;
let auditModel: Model<{ orgId: string; entityType: string; entityId: string; action: string; performedBy: string; after: Record<string, unknown> | null; meta?: Record<string, unknown> }>;

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
        { name: OrgMembership.name, schema: OrgMembershipSchema },
        { name: TimeTimer.name, schema: TimeTimerSchema },
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
  projectModel = moduleRef.get(getModelToken(Project.name));
  membershipModel = moduleRef.get(getModelToken(OrgMembership.name));
  timerModel = moduleRef.get(getModelToken(TimeTimer.name));
  auditModel = moduleRef.get(getModelToken(AuditLog.name));
  const users = moduleRef.get<Model<unknown>>(getModelToken(User.name));
  await users.create({ _id: new Types.ObjectId(ASHA), email: `asha.${ASHA}@studio.in`, name: 'Asha' });
  await users.create({ _id: new Types.ObjectId(RAVI), email: `ravi.${RAVI}@studio.in`, name: 'Ravi' });
  await users.create({ _id: new Types.ObjectId(MEERA), email: `meera.${MEERA}@elsewhere.in`, name: 'Meera' });
  await journals.init();
  await timerModel.init();
  await timeModel.init();
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
  // Asha and Ravi are on the team; Meera is not.
  await membershipModel.create({ orgId, userId: new Types.ObjectId(ASHA), role: UserRole.ACCOUNTANT, isActive: true });
  await membershipModel.create({ orgId, userId: new Types.ObjectId(RAVI), role: UserRole.EMPLOYEE, isActive: true });
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
    await expect(projects.updateTime(orgId, RAVI, String(t._id), { hours: 2 })).rejects.toThrow(/Only the person whose time it is/);
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

describe('a project’s method, users and tasks', () => {
  it("reads an old 'time' project as project hours, and keeps accepting 'time'", async () => {
    const { orgId, projectId, customerId } = await org();
    // Saved through the service as 'time': stored under the new name.
    expect((await projectModel.findById(projectId).lean().exec())!.billing).toBe('project_hours');
    // A project from before the four methods, as it sits in the database.
    const old = await projectModel.collection.insertOne({
      orgId, name: 'Audit 2025', nameKey: 'audit 2025', code: null, customerId: new Types.ObjectId(customerId), billing: 'time', budgetPaise: 50_000_00, budgetHours: null,
      ratePaise: 1500_00, serviceItemId: null, status: 'active', startDate: null, endDate: null, notes: 'Statutory audit', createdBy: ASHA, billingLock: null, billingLockAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const id = String(old.insertedId);
    expect((await projects.list(orgId)).find((p) => p.id === id)).toMatchObject({ billing: 'project_hours', description: 'Statutory audit', budgetPaise: 50_000_00, revenueBudgetPaise: null, members: [], tasks: [], watchlist: false });
    // It still saves, takes billable time at its rate, and bills it.
    await projects.setStatus(orgId, ASHA, id, 'on_hold');
    await projects.setStatus(orgId, ASHA, id, 'active');
    expect((await projects.logTime(orgId, ASHA, { projectId: id, date: '2026-10-05', hours: 2, task: 'Fieldwork' })).billable).toBe(true);
    expect((await projects.unbilled(orgId, id)).lines.map((l) => [l.hours, l.ratePaise])).toEqual([[2, 1500_00]]);
    // Saved with a revenue budget, the old budget gives way; a description replaces the old notes.
    await projects.update(orgId, ASHA, id, { billing: 'time', revenueBudgetPaise: 60_000_00, costBudgetPaise: null, description: 'Statutory audit, FY 2025-26' });
    expect(await projectModel.findById(id).lean().exec()).toMatchObject({ billing: 'project_hours', budgetPaise: null, revenueBudgetPaise: 60_000_00, description: 'Statutory audit, FY 2025-26', notes: null });
  });

  it('puts its creator on it, takes only people on the team, and keeps the watchlist flag', async () => {
    const { orgId, customerId } = await org();
    const p = await projects.create(orgId, ASHA, { name: 'Brand book', customerId, billing: 'staff_hours', members: [{ userId: RAVI, ratePaise: 1500_00 }], watchlist: true, costBudgetPaise: 20_000_00 });
    expect(p.members.map((m) => [m.userId, m.ratePaise])).toEqual([[ASHA, null], [RAVI, 1500_00]]);
    await expect(projects.create(orgId, ASHA, { name: 'Outsider', billing: 'fixed', members: [{ userId: MEERA }] })).rejects.toThrow(/Only people on your team/);
    await expect(projects.update(orgId, ASHA, String(p._id), { members: [{ userId: RAVI }, { userId: RAVI }] })).rejects.toThrow(/once/);
    await expect(projects.update(orgId, ASHA, String(p._id), { description: 'x'.repeat(2001) })).rejects.toThrow(/2,000 characters/);
    expect((await projects.people(orgId)).map((x) => x.name)).toEqual(['Asha', 'Ravi']);
    const listed = (await projects.list(orgId)).find((x) => x.id === String(p._id));
    expect(listed).toMatchObject({ billing: 'staff_hours', watchlist: true, costBudgetPaise: 20_000_00, members: [{ userId: ASHA, name: 'Asha' }, { userId: RAVI, name: 'Ravi', ratePaise: 1500_00 }] });
    const created = await auditModel.findOne({ orgId, entityType: 'Project', action: 'CREATE', entityId: String(p._id) }).lean().exec();
    expect(created!.after).toMatchObject({ billing: 'staff_hours', watchlist: true, members: [{ userId: ASHA, ratePaise: null }, { userId: RAVI, ratePaise: 1500_00 }] });
  });

  it('keeps task ids across edits, imports tasks, and keeps a task that has time waiting', async () => {
    const { orgId, customerId } = await org();
    const p = await projects.create(orgId, ASHA, { name: 'Shop fit-out', customerId, billing: 'task_hours', tasks: [{ name: 'Design', ratePaise: 2500_00 }, { name: 'Site visits', billable: false, description: 'Travel to site' }] });
    const pid = String(p._id);
    const [design, visits] = p.tasks;
    const t = await projects.logTime(orgId, RAVI, { projectId: pid, date: '2026-10-06', hours: 3, taskId: String(design._id) });
    expect(t).toMatchObject({ task: 'Design', billable: true });
    expect(String(t.taskId)).toBe(String(design._id));
    // Free text naming a task is that task, and the task's setting is the billable default.
    const v = await projects.logTime(orgId, RAVI, { projectId: pid, date: '2026-10-06', hours: 1, task: 'site VISITS' });
    expect(v).toMatchObject({ task: 'Site visits', billable: false });
    expect(String(v.taskId)).toBe(String(visits._id));
    await expect(projects.logTime(orgId, RAVI, { projectId: pid, date: '2026-10-06', hours: 1, taskId: new Types.ObjectId().toString() })).rejects.toThrow(/not on Shop fit-out/);

    // Renamed and re-rated, a task keeps its id, so its time stays on it.
    await projects.update(orgId, ASHA, pid, { tasks: [{ id: String(design._id), name: 'Interior design', ratePaise: 2800_00 }, { id: String(visits._id), name: 'Site visits', billable: false }] });
    expect((await projects.unbilled(orgId, pid)).lines.map((l) => [l.description, l.ratePaise])).toEqual([['Interior design, 6 Oct 2026', 2800_00]]);
    expect((await projects.listTime(orgId, { projectId: pid })).entries.map((e) => e.task).sort()).toEqual(['Interior design', 'Site visits']);

    // Imported: the other project's tasks with ids of their own; names already there are skipped.
    const q = await projects.create(orgId, ASHA, { name: 'Second shop', customerId, billing: 'task_hours', tasks: [{ name: 'site visits' }], importTasksFrom: pid });
    expect(q.tasks.map((x) => [x.name, x.ratePaise])).toEqual([['site visits', null], ['Interior design', 2800_00]]);
    expect(String(q.tasks[1]._id)).not.toBe(String(design._id));

    // A task with billable time waiting cannot go; one with only non-billable time can.
    await expect(projects.update(orgId, ASHA, pid, { tasks: [{ id: String(visits._id), name: 'Site visits' }] })).rejects.toThrow('"Interior design" has billable time not yet invoiced');
    await projects.update(orgId, ASHA, pid, { tasks: [{ id: String(design._id), name: 'Interior design', ratePaise: 2800_00 }] });
  });

  it('prices a draft by its method, and refuses time with no rate, naming the task or person', async () => {
    const { orgId, customerId } = await org();
    // By task hours.
    const byTask = await projects.create(orgId, ASHA, { name: 'Catalogue', customerId, billing: 'task_hours', tasks: [{ name: 'Photography', ratePaise: 3000_00 }, { name: 'Editing' }] });
    const [photo, editing] = byTask.tasks;
    await projects.logTime(orgId, ASHA, { projectId: String(byTask._id), date: '2026-10-07', hours: 4, taskId: String(photo._id) });
    await projects.logTime(orgId, RAVI, { projectId: String(byTask._id), date: '2026-10-08', duration: '1:30', taskId: String(editing._id) });
    await expect(projects.draftInvoice(orgId, ASHA, String(byTask._id))).rejects.toThrow('No rate per hour for the task "Editing": give it a rate on the project, or the time its own.');
    expect(await timeModel.countDocuments({ orgId, status: 'unbilled' })).toBe(2);
    await projects.update(orgId, ASHA, String(byTask._id), { tasks: [{ id: String(photo._id), name: 'Photography', ratePaise: 3000_00 }, { id: String(editing._id), name: 'Editing', ratePaise: 1200_00 }] });
    // The list prices waiting time the same way.
    expect((await projects.list(orgId)).find((p) => p.id === String(byTask._id))).toMatchObject({ unbilledHours: 5.5, unbilledPaise: 4 * 3000_00 + 1.5 * 1200_00 });
    const d1 = await projects.draftInvoice(orgId, ASHA, String(byTask._id));
    expect((await invoiceModel.findById(d1.invoiceId).lean().exec())!.lineItems.map((l) => [l.description, l.qty, l.ratePaise])).toEqual([
      ['Photography, 7 Oct 2026', 4, 3000_00],
      ['Editing, 8 Oct 2026', 1.5, 1200_00],
    ]);

    // By staff hours: a line per task and person.
    const byStaff = await projects.create(orgId, ASHA, { name: 'Tax review', customerId, billing: 'staff_hours', members: [{ userId: ASHA, ratePaise: 4000_00 }, { userId: RAVI }] });
    await projects.logTime(orgId, ASHA, { projectId: String(byStaff._id), date: '2026-10-09', hours: 2, task: 'Review' });
    await projects.logTime(orgId, RAVI, { projectId: String(byStaff._id), date: '2026-10-09', hours: 3, task: 'Review' });
    await expect(projects.draftInvoice(orgId, ASHA, String(byStaff._id))).rejects.toThrow("No rate per hour for Ravi: add them to the project's users with a rate.");
    expect((await projects.unbilled(orgId, String(byStaff._id))).missing).toEqual(['Ravi']);
    await projects.update(orgId, ASHA, String(byStaff._id), { members: [{ userId: ASHA, ratePaise: 4000_00 }, { userId: RAVI, ratePaise: 1500_00 }] });
    const d2 = await projects.draftInvoice(orgId, ASHA, String(byStaff._id));
    expect((await invoiceModel.findById(d2.invoiceId).lean().exec())!.lineItems.map((l) => [l.description, l.qty, l.ratePaise])).toEqual([
      ['Review (Asha), 9 Oct 2026', 2, 4000_00],
      ['Review (Ravi), 9 Oct 2026', 3, 1500_00],
    ]);

    // By project hours with no rate: refused.
    const noRate = await projects.create(orgId, ASHA, { name: 'Retainer', customerId, billing: 'project_hours' });
    await projects.logTime(orgId, ASHA, { projectId: String(noRate._id), date: '2026-10-09', hours: 1, task: 'Calls' });
    await expect(projects.draftInvoice(orgId, ASHA, String(noRate._id))).rejects.toThrow('No rate per hour for this project');

    // A fixed fee, as before: time starts not billable; billable time with a rate is billed, without one left off.
    const fixed = await projects.create(orgId, ASHA, { name: 'Logo', customerId, billing: 'fixed', revenueBudgetPaise: 50_000_00 });
    expect((await projects.logTime(orgId, ASHA, { projectId: String(fixed._id), date: '2026-10-09', hours: 2, task: 'Sketches' })).billable).toBe(false);
    await projects.logTime(orgId, ASHA, { projectId: String(fixed._id), date: '2026-10-09', hours: 1, task: 'Extra round', billable: true });
    await expect(projects.draftInvoice(orgId, ASHA, String(fixed._id))).rejects.toThrow(/No unbilled time with a rate/);
    await projects.logTime(orgId, ASHA, { projectId: String(fixed._id), date: '2026-10-09', hours: 1, task: 'Extra round', billable: true, ratePaise: 2000_00 });
    expect(await projects.draftInvoice(orgId, ASHA, String(fixed._id))).toMatchObject({ lines: 1, hours: 1 });
  });
});

describe('logging time', () => {
  it('takes hours and minutes, or a start and end time, which the server checks', async () => {
    const { orgId, projectId } = await org();
    expect(await projects.logTime(orgId, ASHA, { projectId, date: '2026-10-05', duration: '1:20', task: 'Design' })).toMatchObject({ hours: 1.33, startTime: null, endTime: null });
    const b = await projects.logTime(orgId, ASHA, { projectId, date: '2026-10-05', startTime: '9:15', endTime: '11:45', task: 'Design' });
    expect(b).toMatchObject({ hours: 2.5, startTime: '09:15', endTime: '11:45' });
    await expect(projects.logTime(orgId, ASHA, { projectId, date: '2026-10-05', startTime: '14:00', endTime: '13:00', task: 'Design' })).rejects.toThrow(/end time is after the start/);
    await expect(projects.logTime(orgId, ASHA, { projectId, date: '2026-10-05', startTime: '14:00', task: 'Design' })).rejects.toThrow(/both the start and the end/);
    await expect(projects.logTime(orgId, ASHA, { projectId, date: '2026-10-05', startTime: '09:00', endTime: '10:00', hours: 3, task: 'Design' })).rejects.toThrow('09:00 to 10:00 is 1 hour, not 3.');
    await expect(projects.logTime(orgId, ASHA, { projectId, date: '2026-10-05', task: 'Design' })).rejects.toThrow(/Say how long/);
    // New hours alone drop the start and end they came from; new times work out the hours again.
    expect(await projects.updateTime(orgId, ASHA, String(b._id), { duration: '2:00' })).toMatchObject({ hours: 2, startTime: null, endTime: null });
    expect(await projects.updateTime(orgId, ASHA, String(b._id), { startTime: '10:00', endTime: '10:45' })).toMatchObject({ hours: 0.75, startTime: '10:00', endTime: '10:45' });
  });

  it('is logged for someone else only by a manager, for a person on the project, and records who logged it', async () => {
    const { orgId, projectId } = await org();
    await expect(projects.logTime(orgId, ASHA, { projectId, date: '2026-10-05', hours: 1, task: 'Design', userId: RAVI })).rejects.toThrow(/You log your own time/);
    // Ravi is on the team, but not yet on the project.
    await expect(projects.logTime(orgId, ASHA_MANAGER, { projectId, date: '2026-10-05', hours: 1, task: 'Design', userId: RAVI })).rejects.toThrow(/not on Website redesign/);
    await projects.update(orgId, ASHA, projectId, { members: [{ userId: ASHA }, { userId: RAVI }] });
    const t = await projects.logTime(orgId, ASHA_MANAGER, { projectId, date: '2026-10-05', hours: 1.5, task: 'Design', userId: RAVI });
    expect(t).toMatchObject({ userId: RAVI, userName: 'Ravi', loggedBy: ASHA });
    expect((await projects.listTime(orgId, { userId: RAVI })).entries[0]).toMatchObject({ userName: 'Ravi', loggedBy: ASHA });
    // Ravi changes his own time; a manager can too; anyone else cannot.
    expect((await projects.updateTime(orgId, RAVI, String(t._id), { notes: 'Homepage' })).notes).toBe('Homepage');
    expect((await projects.updateTime(orgId, ASHA_MANAGER, String(t._id), { hours: 2 })).hours).toBe(2);
    await expect(projects.updateTime(orgId, ASHA, String(t._id), { hours: 3 })).rejects.toThrow(/Only the person whose time it is/);
    await expect(projects.deleteTime(orgId, ASHA, String(t._id))).rejects.toThrow(/Only the person whose time it is/);
    const trail = await auditModel.find({ orgId, entityType: 'TimeEntry', entityId: String(t._id) }).sort({ _id: 1 }).lean().exec();
    expect(trail.map((x) => [x.action, x.performedBy])).toEqual([['CREATE', ASHA], ['UPDATE', RAVI], ['UPDATE', ASHA]]);
    expect(trail[0].after).toMatchObject({ userId: RAVI, loggedBy: ASHA });
    await projects.deleteTime(orgId, ASHA_MANAGER, String(t._id));
    expect(await timeModel.countDocuments({ orgId })).toBe(0);
  });
});

describe('the timer', () => {
  it('runs one at a time per person on the server, and stopping it logs the minutes once', async () => {
    const { orgId, projectId } = await org();
    const day = addDays(todayIst(), -2);
    const at = new Date(`${day}T10:00:00+05:30`);
    const timer = await projects.startTimer(orgId, ASHA, { projectId, task: 'Design', notes: 'Hero banner' }, at);
    expect(timer).toMatchObject({ projectName: 'Website redesign', task: 'Design', billable: true, startedAt: at.toISOString() });
    await expect(projects.startTimer(orgId, ASHA, { projectId, task: 'Meetings' })).rejects.toThrow('Your timer is already running on Website redesign: stop it first.');
    // Ravi's timer is his own.
    await projects.startTimer(orgId, RAVI, { projectId, task: 'Meetings' });
    expect(await projects.currentTimer(orgId, ASHA)).toMatchObject({ id: timer.id });

    // 25 minutes and 20 seconds, stopped twice at once: one entry of 25 minutes.
    const stop = new Date(at.getTime() + (25 * 60 + 20) * 1000);
    const results = await Promise.allSettled([projects.stopTimer(orgId, ASHA, stop), projects.stopTimer(orgId, ASHA, stop)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.message).toMatch(/No timer is running/);
    const entries = await timeModel.find({ orgId, userId: ASHA }).lean().exec();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ date: day, hours: 0.42, startTime: '10:00', endTime: '10:25', task: 'Design', notes: 'Hero banner', billable: true, loggedBy: ASHA });
    expect(await projects.currentTimer(orgId, ASHA)).toBeNull();
    expect((await auditModel.findOne({ orgId, entityType: 'TimeEntry', action: 'CREATE' }).lean().exec())!.meta).toMatchObject({ fromTimer: { minutes: 25 } });
    expect(await auditModel.countDocuments({ orgId, entityType: 'TimeTimer', action: 'START' })).toBe(2);

    // Left running for more than a day, it is not logged: it stays until discarded.
    await projects.startTimer(orgId, ASHA, { projectId, task: 'Design' }, new Date(Date.now() - 26 * 3_600_000));
    await expect(projects.stopTimer(orgId, ASHA)).rejects.toThrow(/more than a day/);
    expect(await projects.currentTimer(orgId, ASHA)).not.toBeNull();
    await projects.discardTimer(orgId, ASHA);
    expect(await projects.currentTimer(orgId, ASHA)).toBeNull();
    expect(await timeModel.countDocuments({ orgId, userId: ASHA })).toBe(1);
    expect(await timerModel.countDocuments({ orgId, userId: RAVI })).toBe(1);
  });
});

describe('the timesheet list', () => {
  it('filters by period, customer, project, person and billing, with totals for what matches', async () => {
    const { orgId, projectId } = await org();
    const other = await customers.create({ orgId, name: 'Marigold Traders', stateCode: '27' });
    const audit = await projects.create(orgId, ASHA, { name: 'Stock audit', customerId: String(other._id), billing: 'staff_hours', members: [{ userId: ASHA, ratePaise: 3000_00 }, { userId: RAVI, ratePaise: 1000_00 }] });
    const today = todayIst();
    const longAgo = addDays(today, -400);
    await projects.logTime(orgId, ASHA, { projectId, date: today, hours: 2, task: 'Design' }); // 2 h × ₹2,000
    await projects.logTime(orgId, RAVI, { projectId, date: longAgo, hours: 1, task: 'Admin', billable: false });
    await projects.logTime(orgId, ASHA, { projectId: String(audit._id), date: today, hours: 1, task: 'Counting' }); // 1 h × ₹3,000
    await projects.logTime(orgId, RAVI, { projectId: String(audit._id), date: today, hours: 4, task: 'Counting' }); // 4 h × ₹1,000

    const all = await projects.listTime(orgId, {});
    expect(all.totals).toEqual({ entries: 4, hours: 8, billableHours: 7, unbilledHours: 7, unbilledPaise: 2 * 2000_00 + 3000_00 + 4 * 1000_00 });
    expect(all.truncated).toBe(false);
    expect((await projects.listTime(orgId, { customerId: String(other._id) })).totals).toMatchObject({ entries: 2, hours: 5, unbilledPaise: 7000_00 });
    expect((await projects.listTime(orgId, { customerId: String(other._id), projectId })).entries).toEqual([]);
    expect((await projects.listTime(orgId, { userId: RAVI })).totals).toMatchObject({ entries: 2, hours: 5, billableHours: 4 });
    expect((await projects.listTime(orgId, { billing: 'non_billable' })).entries.map((e) => e.task)).toEqual(['Admin']);
    expect((await projects.listTime(orgId, { billing: 'unbilled', projectId })).totals).toMatchObject({ entries: 1, unbilledPaise: 4000_00 });
    for (const period of ['today', 'this_week', 'this_month'] as const) expect((await projects.listTime(orgId, { period })).totals.entries).toBe(3);
    expect((await projects.listTime(orgId, { from: longAgo, to: longAgo })).entries.map((e) => [e.userName, e.customerName])).toEqual([['Ravi', 'Saffron Foods']]);
  });
});
