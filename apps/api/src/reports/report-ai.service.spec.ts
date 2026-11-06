/**
 * Tests — the monthly narrative and Ask your books, against the books.
 *
 *  ✓ Without a model the narrative is the rules', at once; with one it is queued, and the model's words
 *    are kept only where every figure is checked, its tokens metered; all invented, the rules' words stand
 *  ✓ The common questions are answered by rules from a report, citing its rows and naming it
 *  ✓ With no rule and no model: what can be asked
 *  ✓ The model picks a report and words the answer in a job; an answer with a figure of its own falls back
 *    to the rules' answer from the same report; a pick that is no report answers nothing
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { VoucherType } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { REPORT_AI_QUEUE, ReportAiService } from './report-ai.service';
import { REPORT_MODEL } from './report-model';
import { ManagementReportsService } from './management.service';
import { ReportCatalogService } from './report-catalog.service';
import { ReportsService } from './reports.service';
import { Budget, BudgetSchema } from './schemas/budget.schema';
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
const queue = { add: jest.fn() };
const model = { available: false, json: jest.fn() };

let moduleRef: TestingModule;
let ai: ReportAiService;
let posting: PostingService;
let accounts: AccountsService;
let invoices: SalesInvoicesService;
let customers: CustomersService;
let meterModel: Model<{ orgId: string; groqTokensIn: number }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
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
        { name: Item.name, schema: ItemSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
      ]),
    ],
    providers: [
      ReportAiService, ManagementReportsService, ReportCatalogService, ReportsService, UsageMeterService,
      { provide: getQueueToken(REPORT_AI_QUEUE), useValue: queue },
      // The model is outside: what it is asked and what is kept of its answer is what matters here.
      { provide: REPORT_MODEL, useValue: model },
      PostingService, AccountsService, AuditService, SalesInvoicesService, CustomersService,
    ],
  }).compile();
  ai = moduleRef.get(ReportAiService);
  posting = moduleRef.get(PostingService);
  accounts = moduleRef.get(AccountsService);
  invoices = moduleRef.get(SalesInvoicesService);
  customers = moduleRef.get(CustomersService);
  meterModel = moduleRef.get(getModelToken(UsageMeter.name));
  await moduleRef.get<Model<JournalDocument>>(getModelToken(Journal.name)).init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

beforeEach(() => {
  jest.clearAllMocks();
  model.available = false;
});

async function books() {
  const orgId = new Types.ObjectId().toString();
  await accounts.seedDefaults(orgId);
  const all = await accounts.list(orgId);
  const id = (name: string) => String(all.find((a) => a.name === name)!._id);
  const journal = (date: string, dr: string, cr: string, amount: number) =>
    posting.post({ orgId, voucherType: VoucherType.JOURNAL, financialYear: '2026-27', date, narration: 'test', postedBy: ACTOR, lines: [{ accountId: id(dr), debitPaise: amount, creditPaise: 0 }, { accountId: id(cr), debitPaise: 0, creditPaise: amount }] });
  // September: ₹1,00,000 in, ₹10,000 freight. October: the same in, freight up to ₹25,000.
  await journal('2026-09-10', 'Bank Accounts', 'Sales Revenue', 1_00_000_00);
  await journal('2026-09-20', 'Freight & Carriage', 'Bank Accounts', 10_000_00);
  await journal('2026-10-10', 'Bank Accounts', 'Sales Revenue', 1_00_000_00);
  await journal('2026-10-20', 'Freight & Carriage', 'Bank Accounts', 25_000_00);
  return orgId;
}

describe('the monthly narrative', () => {
  it('is the rules’ words at once without a model', async () => {
    const orgId = await books();
    const n = await ai.requestNarrative(orgId, ACTOR, '2026-10');
    expect(n).toMatchObject({ status: 'done', source: 'rule', period: '2026-10' });
    expect(n.sentences[0]).toBe('Profit for Oct 2026 was ₹75,000, down 17% on the month before (₹90,000).');
    expect(n.sentences).toContain('Freight & Carriage more than doubled, from ₹10,000 to ₹25,000.');
    expect(n.sentences).toContain("Cash and bank stood at ₹1,65,000 at the month's end, up ₹75,000 on the month before.");
    expect(queue.add).not.toHaveBeenCalled();
    expect((await ai.latestNarrative(orgId, '2026-10'))!.id).toBe(n.id);
  });

  it("keeps the model's checked sentences, meters its tokens, and falls back when it invents", async () => {
    const orgId = await books();
    model.available = true;
    const n = await ai.requestNarrative(orgId, ACTOR, '2026-10');
    expect(n.status).toBe('queued');
    expect(queue.add).toHaveBeenCalledWith('narrative', { orgId, suggestionId: n.id }, expect.anything());

    model.json.mockResolvedValueOnce({
      raw: {
        sentences: [
          { text: 'Profit fell 17% to ₹75,000 because freight more than doubled, to ₹25,000.', facts: ['profit', 'mover_1'] },
          { text: 'Cash and bank rose by ₹75,000 to ₹1,65,000.', facts: ['cash'] },
          { text: 'Expect ₹1,00,000 of profit next month.', facts: ['profit'] },
        ],
      },
      tokensIn: 300,
      tokensOut: 80,
    });
    await ai.runNarrative(orgId, n.id);
    const done = await ai.narrative(orgId, n.id);
    expect(done).toMatchObject({ status: 'done', source: 'model', confidence: 0.8 });
    expect(done.sentences).toEqual(['Profit fell 17% to ₹75,000 because freight more than doubled, to ₹25,000.', 'Cash and bank rose by ₹75,000 to ₹1,65,000.']);
    expect((await meterModel.findOne({ orgId }).lean().exec())!.groqTokensIn).toBe(300);

    const again = await ai.requestNarrative(orgId, ACTOR, '2026-10');
    model.json.mockResolvedValueOnce({ raw: { sentences: [{ text: 'Profit tripled to ₹2,25,000.', facts: ['profit'] }] }, tokensIn: 10, tokensOut: 10 });
    await ai.runNarrative(orgId, again.id);
    const fell = await ai.narrative(orgId, again.id);
    expect(fell).toMatchObject({ status: 'done', source: 'rule' });
    expect(fell.sentences[0]).toBe('Profit for Oct 2026 was ₹75,000, down 17% on the month before (₹90,000).');
    expect(fell.reason).toMatch(/figures the books do not have/);
  });
});

describe('ask your books', () => {
  async function withSales() {
    const orgId = await books();
    const asha = await customers.create({ orgId, name: 'Asha Traders' });
    const bharat = await customers.create({ orgId, name: 'Bharat Stores' });
    for (const [c, n, taxable] of [[asha, 'A/1', 1_00_000_00], [bharat, 'B/1', 40_000_00]] as const) {
      const gst = Math.round(taxable * 0.09);
      const draft = await invoices.create({ orgId, customerId: String(c._id), invoiceNumber: n, invoiceDate: '2026-10-05', dueDate: '2026-10-20', amountsPaise: { taxableValue: taxable, cgst: gst, sgst: gst, igst: 0, cess: 0, total: taxable + 2 * gst } });
      await invoices.post(String(draft._id), orgId, ACTOR);
    }
    return orgId;
  }

  it('answers the common questions by rules, citing the report', async () => {
    const orgId = await withSales();
    const top = await ai.ask(orgId, ACTOR, 'Who were my top customers in October 2026?');
    expect(top).toMatchObject({ status: 'done', source: 'rule', answer: 'The top customers for Oct 2026: Asha Traders (₹1,00,000) and Bharat Stores (₹40,000). Net sales in all: ₹1,40,000.', report: { key: 'sales_by_customer', from: '2026-10', to: '2026-10' } });
    expect(top.rows.map((i) => top.table!.rows[i].cells[0])).toEqual(['Asha Traders', 'Bharat Stores', 'Total']);

    expect((await ai.ask(orgId, ACTOR, 'Who owes me money?')).answer).toMatch(/^Customers owe ₹1,65,200; /);
    expect((await ai.ask(orgId, ACTOR, 'How much did we spend on freight in October 2026?')).answer).toBe('Freight & Carriage came to ₹25,000 over Oct 2026.');

    const none = await ai.ask(orgId, ACTOR, 'Tell me a joke');
    expect(none).toMatchObject({ status: 'none', answer: null });
    expect(none.reason).toMatch(/^I can answer questions like: /);
    expect(queue.add).not.toHaveBeenCalled();
    expect((await ai.recentQuestions(orgId)).map((r) => r.question)).toEqual(['Tell me a joke', 'How much did we spend on freight in October 2026?', 'Who owes me money?', 'Who were my top customers in October 2026?']);
  });

  it('lets the model pick a report and word the answer, keeping only figures from the rows', async () => {
    const orgId = await withSales();
    model.available = true;
    const plan = { raw: { tool: 'sales', args: { by: 'customer', from: '2026-10', to: '2026-10' } }, tokensIn: 100, tokensOut: 20 };

    const q = await ai.ask(orgId, ACTOR, 'Which customer brought in the most this autumn?');
    expect(q.status).toBe('queued');
    expect(queue.add).toHaveBeenCalledWith('ask', { orgId, suggestionId: q.id }, expect.anything());
    model.json.mockResolvedValueOnce(plan).mockResolvedValueOnce({ raw: { answer: 'Asha Traders brought in the most: ₹1,00,000 in Oct 2026.', rows: [0] }, tokensIn: 200, tokensOut: 30 });
    await ai.runAsk(orgId, q.id);
    expect(await ai.answer(orgId, q.id)).toMatchObject({ status: 'done', source: 'model', confidence: 0.8, answer: 'Asha Traders brought in the most: ₹1,00,000 in Oct 2026.', rows: [0], report: { key: 'sales_by_customer' } });
    expect((await meterModel.findOne({ orgId }).lean().exec())!.groqTokensIn).toBe(300);

    // A figure of its own: the rules answer from the same report instead.
    const q2 = await ai.ask(orgId, ACTOR, 'Which customer brought in the most this autumn?');
    model.json.mockResolvedValueOnce(plan).mockResolvedValueOnce({ raw: { answer: 'Asha Traders brought in ₹1,18,000 with GST.', rows: [0] }, tokensIn: 1, tokensOut: 1 });
    await ai.runAsk(orgId, q2.id);
    expect(await ai.answer(orgId, q2.id)).toMatchObject({ status: 'done', source: 'rule', answer: 'The top customers for Oct 2026: Asha Traders (₹1,00,000) and Bharat Stores (₹40,000). Net sales in all: ₹1,40,000.' });

    // A pick that is no report: nothing is run.
    const q3 = await ai.ask(orgId, ACTOR, 'Which customer brought in the most this autumn?');
    model.json.mockResolvedValueOnce({ raw: { tool: 'drop_collection' }, tokensIn: 1, tokensOut: 1 });
    await ai.runAsk(orgId, q3.id);
    expect(await ai.answer(orgId, q3.id)).toMatchObject({ status: 'none', answer: null, table: null });
  });

  it('ends the wait with a reason when the AI provider fails, for a question and for the summary', async () => {
    const orgId = await withSales();
    model.available = true;
    const q = await ai.ask(orgId, ACTOR, 'Which customer brought in the most this autumn?');
    model.json.mockRejectedValueOnce(new Error('[GoogleGenerativeAI Error]: [402 Payment Required] credits are depleted'));
    await ai.runAsk(orgId, q.id);
    const failed = await ai.answer(orgId, q.id);
    expect(failed.status).toBe('failed');
    expect(failed.reason).toMatch(/no credit left/);

    const n = await ai.requestNarrative(orgId, ACTOR, '2026-10');
    model.json.mockRejectedValueOnce(new Error('fetch failed'));
    await ai.runNarrative(orgId, n.id);
    const words = await ai.narrative(orgId, n.id);
    expect(words.status).toBe('done');
    expect(words.reason).toMatch(/could not be reached.*rules' words/);
  });
});
