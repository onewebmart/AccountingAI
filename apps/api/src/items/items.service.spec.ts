/**
 * Integration tests — the item master, items on lines, and HSN/SAC suggestions.
 *
 *  ✓ An item is checked (code for its kind, unit, slab, accounts of the right type) and audited
 *  ✓ Names are unique per org however they are typed; another org sees none of them
 *  ✓ A line that picks an item takes its code, unit, rate and account, and keeps what it says itself
 *  ✓ An invoice credits each item's income account, the rest Sales; a credit note comes off each in proportion
 *  ✓ A bill debits each item's expense or asset account; a debit note comes off each in proportion
 *  ✓ Suggestions: the org's own history first, then a rule, then the model in a job, checked and capped
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { AccountType } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { withOrg } from '../database/tenant.plugin';
import { HSN_QUEUE, ItemsService } from './items.service';
import { Item, ItemSchema } from './schemas/item.schema';
import { HSN_MODEL } from './hsn-model';
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
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { VendorsService } from '../purchase/vendors.service';
import { DebitNotesService } from '../purchase/debit-notes.service';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { TdsDeposit, TdsDepositSchema } from '../tds/schemas/tds-deposit.schema';

const ACTOR = new Types.ObjectId().toString();
const queue = { add: jest.fn().mockResolvedValue({ id: 'job' }) };
const model = { available: true, ask: jest.fn() };

let moduleRef: TestingModule;
let items: ItemsService;
let accounts: AccountsService;
let invoices: SalesInvoicesService;
let customers: CustomersService;
let creditNotes: CreditNotesService;
let bills: PurchaseBillsService;
let vendors: VendorsService;
let debitNotes: DebitNotesService;
let journals: Model<JournalDocument>;
let audit: Model<{ orgId: string; entityType: string; action: string; before: unknown; after: unknown }>;
let usage: Model<{ orgId: string; aiTokensIn?: number }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: Item.name, schema: ItemSchema },
        { name: AiSuggestion.name, schema: AiSuggestionSchema },
        { name: UsageMeter.name, schema: UsageMeterSchema },
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
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
        { name: TdsDeposit.name, schema: TdsDepositSchema },
      ]),
    ],
    providers: [
      ItemsService, UsageMeterService,
      { provide: getQueueToken(HSN_QUEUE), useValue: queue },
      { provide: HSN_MODEL, useValue: model },
      PostingService, AccountsService, AuditService,
      SalesInvoicesService, CustomersService, CreditNotesService,
      PurchaseBillsService, VendorsService, DebitNotesService,
    ],
  }).compile();
  items = moduleRef.get(ItemsService);
  accounts = moduleRef.get(AccountsService);
  invoices = moduleRef.get(SalesInvoicesService);
  customers = moduleRef.get(CustomersService);
  creditNotes = moduleRef.get(CreditNotesService);
  bills = moduleRef.get(PurchaseBillsService);
  vendors = moduleRef.get(VendorsService);
  debitNotes = moduleRef.get(DebitNotesService);
  journals = moduleRef.get(getModelToken(Journal.name));
  audit = moduleRef.get(getModelToken(AuditLog.name));
  usage = moduleRef.get(getModelToken(UsageMeter.name));
  await journals.init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

const org = () => new Types.ObjectId().toString();

/** Credit − debit per account name on one journal. */
async function byAccount(journalId: unknown) {
  const j = await journals.findById(journalId).lean().exec();
  const out: Record<string, number> = {};
  for (const l of j!.lines) out[l.description] = (out[l.description] ?? 0) + l.creditPaise - l.debitPaise;
  return out;
}

describe('the item master', () => {
  it('checks an item, fills its defaults, and audits it', async () => {
    const o = org();
    await accounts.seedDefaults(o);
    const consulting = await accounts.create({ orgId: o, name: 'Consulting Income', type: AccountType.INCOME });
    const rent = await accounts.create({ orgId: o, name: 'Rent', type: AccountType.EXPENSE });

    const item = await items.create(o, ACTOR, { name: 'Strategy session', kind: 'service', hsnSac: '998311', gstRatePct: 18, salePricePaise: 1500000, incomeAccountId: String(consulting._id) });
    expect(item.toObject()).toMatchObject({ uqc: 'NA', nameKey: 'strategy session', hsnSource: { by: 'person' }, isActive: true });
    expect(await audit.countDocuments({ orgId: o, entityType: 'Item', action: 'CREATE' })).toBe(1);

    const refused: Array<[Parameters<ItemsService['create']>[2], RegExp]> = [
      [{ name: 'A', kind: 'goods', hsnSac: '998311' }, /SAC codes for services/],
      [{ name: 'B', kind: 'service', uqc: 'KGS' }, /unit is NA/],
      [{ name: 'C', kind: 'goods', uqc: 'NA' }, /need a unit/],
      [{ name: 'D', kind: 'goods', gstRatePct: 17 }, /not a slab/],
      [{ name: 'E', kind: 'service', incomeAccountId: String(rent._id) }, /not an income account/],
      [{ name: 'F', kind: 'goods', salePricePaise: 10.5 }, /whole number of paise/],
      [{ name: '  ', kind: 'goods' }, /name/],
    ];
    for (const [input, message] of refused) await expect(items.create(o, ACTOR, input)).rejects.toThrow(message);
    await expect(items.create(o, ACTOR, { name: ' STRATEGY  session ', kind: 'service' })).rejects.toThrow(/already exists/);

    // Taking a suggestion records where the code came from; typing over it makes it the person's.
    const updated = await items.update(o, ACTOR, String(item._id), { hsnSac: '998312', hsnSource: { by: 'rule', reason: 'Business consulting', confidence: 0.7 } });
    expect(updated.hsnSource).toMatchObject({ by: 'rule', confidence: 0.7 });
    const renamed = await items.update(o, ACTOR, String(item._id), { name: 'Strategy workshop' });
    expect(renamed.toObject()).toMatchObject({ name: 'Strategy workshop', hsnSac: '998312', hsnSource: { by: 'rule' } });
    expect((await items.update(o, ACTOR, String(item._id), { hsnSac: '998311' })).hsnSource).toMatchObject({ by: 'person' });
    const change = await audit.findOne({ orgId: o, entityType: 'Item', action: 'UPDATE' }).sort({ _id: 1 }).lean().exec();
    expect(change).toMatchObject({ before: { hsnSac: '998311' }, after: { hsnSac: '998312', hsnSource: 'rule' } });

    // Another org sees none of it, even asking without a filter.
    expect(await withOrg(org(), () => items.list(org()))).toEqual([]);
    expect((await items.list(o, { q: 'strategy' })).map((i) => i.name)).toEqual(['Strategy workshop']);
  });

  it('fills a line from its item, keeping what the line says itself', async () => {
    const o = org();
    const laptop = await items.create(o, ACTOR, { name: 'Laptop', kind: 'goods', hsnSac: '8471', gstRatePct: 18 });
    const [filled, own, plain] = await items.resolveLines(o, [
      { description: 'Laptop', itemId: String(laptop._id), qty: 2, ratePaise: 5000000, amountPaise: 10000000 },
      { description: 'Laptop, old stock', itemId: String(laptop._id), hsnSac: '84713010', taxRatePct: 28, uqc: 'PCS', ratePaise: 1, amountPaise: 1 },
      { description: 'Delivery', ratePaise: 50000, amountPaise: 50000 },
    ], 'sale');
    expect(filled).toMatchObject({ hsnSac: '8471', uqc: 'NOS', taxRatePct: 18, accountId: null });
    expect(String(filled.itemId)).toBe(String(laptop._id));
    expect(own).toMatchObject({ hsnSac: '84713010', uqc: 'PCS', taxRatePct: 28 });
    expect(plain).toMatchObject({ itemId: null, uqc: null, accountId: null });

    // Another org's item is no item at all here.
    await expect(items.resolveLines(org(), [{ description: 'Laptop', itemId: String(laptop._id), ratePaise: 1, amountPaise: 1 }], 'sale')).rejects.toThrow(/No such item/);
    await items.setActive(o, ACTOR, String(laptop._id), false);
    await expect(items.resolveLines(o, [{ description: 'Laptop', itemId: String(laptop._id), ratePaise: 1, amountPaise: 1 }], 'sale')).rejects.toThrow(/archived/);
    expect(await items.list(o)).toEqual([]);
    expect(await items.list(o, { includeArchived: true })).toHaveLength(1);
  });
});

describe('items in the ledger', () => {
  it("credits each item's income account, and a credit note comes off each in proportion", async () => {
    const o = org();
    await accounts.seedDefaults(o);
    const consulting = await accounts.create({ orgId: o, name: 'Consulting Income', type: AccountType.INCOME });
    const session = await items.create(o, ACTOR, { name: 'Strategy session', kind: 'service', hsnSac: '998311', gstRatePct: 18, incomeAccountId: String(consulting._id) });
    const customer = await customers.create({ orgId: o, name: 'Rao Traders' });

    const lineItems = await items.resolveLines(o, [
      { description: 'Strategy session', itemId: String(session._id), ratePaise: 60000, amountPaise: 60000 },
      { description: 'Travel, billed at cost', hsnSac: '996412', taxRatePct: 18, ratePaise: 40000, amountPaise: 40000 },
    ], 'sale');
    const draft = await invoices.create({
      orgId: o, customerId: String(customer._id), invoiceNumber: 'RT/1', invoiceDate: '2026-10-08', lineItems,
      amountsPaise: { taxableValue: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0, total: 118000 },
    });
    const posted = await invoices.post(String(draft._id), o, ACTOR);
    expect(await byAccount(posted.journalId)).toMatchObject({ 'Consulting Income': 60000, 'Sales Revenue': 40000 });

    const note = await creditNotes.create(String(posted._id), o, ACTOR, { noteDate: '2026-10-20', reason: 'Half the work undone', taxableValuePaise: 50000 });
    expect(await byAccount(note.journalId)).toMatchObject({ 'Consulting Income': -30000, 'Sales Revenue': -20000 });
  });

  it("debits each item's expense or asset account, and a debit note comes off each in proportion", async () => {
    const o = org();
    await accounts.seedDefaults(o);
    const equipment = await accounts.create({ orgId: o, name: 'Computer Equipment', type: AccountType.ASSETS });
    const laptop = await items.create(o, ACTOR, { name: 'Laptop', kind: 'goods', hsnSac: '8471', gstRatePct: 18, expenseAccountId: String(equipment._id) });
    const vendor = await vendors.create({ orgId: o, name: 'Infotech Supplies' });

    const lineItems = await items.resolveLines(o, [
      { description: 'Laptop', itemId: String(laptop._id), ratePaise: 7500000, amountPaise: 7500000 },
      { description: 'Laptop bag', taxRatePct: 18, ratePaise: 2500000, amountPaise: 2500000 },
    ], 'purchase');
    const draft = await bills.create({
      orgId: o, vendorId: String(vendor._id), billNumber: 'INF/77', billDate: '2026-10-05', lineItems,
      amountsPaise: { taxableValue: 10000000, cgst: 900000, sgst: 900000, igst: 0, cess: 0, total: 11800000 },
    });
    const posted = await bills.post(String(draft._id), o, ACTOR);
    const lines = await byAccount(posted.journalId);
    expect(lines['Computer Equipment']).toBe(-7500000);
    expect(Object.entries(lines).find(([name]) => /purchase/i.test(name))?.[1]).toBe(-2500000);

    const note = await debitNotes.create(String(posted._id), o, ACTOR, { noteDate: '2026-10-15', reason: 'One bag short', taxableValuePaise: 1000000 });
    const back = await byAccount(note.journalId);
    expect(back['Computer Equipment']).toBe(750000);
    expect(Object.entries(back).find(([name]) => /purchase/i.test(name))?.[1]).toBe(250000);
  });
});

describe('HSN/SAC suggestions', () => {
  it("prefers the org's own history, then a rule", async () => {
    const o = org();
    const customer = await customers.create({ orgId: o, name: 'Mehta Retail' });
    for (const n of [1, 2]) {
      await invoices.create({
        orgId: o, customerId: String(customer._id), invoiceNumber: `MR/${n}`, invoiceDate: '2026-09-01',
        amountsPaise: { taxableValue: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0, total: 118000 },
        lineItems: [{ description: 'Website maintenance retainer', hsnSac: '998319', taxRatePct: 18, ratePaise: 100000, amountPaise: 100000 }],
      });
    }
    // Without the history, a rule would say development (998314); this org files it under 998319.
    const past = await items.suggestHsn(o, ACTOR, { name: 'website maintenance  retainer' });
    expect(past).toMatchObject({ status: 'done', suggestion: { hsnSac: '998319', kind: 'service', gstRatePct: 18, source: 'history' } });
    expect(past.suggestion!.reason).toMatch(/2 earlier lines/);

    expect(await items.suggestHsn(o, ACTOR, { name: 'Laptop repair' })).toMatchObject({ status: 'done', suggestion: { hsnSac: '998713', source: 'rule', confidence: 0.7 } });
    expect(model.ask).not.toHaveBeenCalled();
  });

  it('asks the model in a job, checks its answer, caps its confidence and meters it', async () => {
    const o = org();
    queue.add.mockClear();
    const queued = await items.suggestHsn(o, ACTOR, { name: 'Turmeric powder', description: '1 kg packs', kind: 'goods' });
    expect(queued).toMatchObject({ status: 'queued', suggestion: null });
    expect(queue.add).toHaveBeenCalledWith('hsn', { orgId: o, suggestionId: queued.id }, expect.anything());
    expect(await items.suggestion(o, queued.id!)).toMatchObject({ status: 'queued' });

    model.ask.mockResolvedValueOnce({ raw: { hsnSac: '091030', kind: 'goods', gstRatePct: 5, uqc: 'KGS', confidence: 0.95, reason: 'Turmeric, ground' }, tokensIn: 120, tokensOut: 30 });
    await items.runModel(o, queued.id!);
    expect(await items.suggestion(o, queued.id!)).toMatchObject({ status: 'done', suggestion: { hsnSac: '091030', uqc: 'KGS', gstRatePct: 5, source: 'model', confidence: 0.8 } });
    expect(await usage.countDocuments({ orgId: o })).toBe(1);

    // A code that cannot be right is not passed on.
    const bad = await items.suggestHsn(o, ACTOR, { name: 'Mystery widget', kind: 'goods' });
    model.ask.mockResolvedValueOnce({ raw: { hsnSac: '99', kind: 'goods' }, tokensIn: 1, tokensOut: 1 });
    await items.runModel(o, bad.id!);
    expect(await items.suggestion(o, bad.id!)).toMatchObject({ status: 'none', suggestion: null });

    // Another org cannot read it.
    await expect(items.suggestion(org(), queued.id!)).rejects.toThrow(/not found/);
  });

  it('says so when there is no rule and no AI', async () => {
    model.available = false;
    try {
      expect(await items.suggestHsn(org(), ACTOR, { name: 'Saffron threads' })).toMatchObject({ status: 'none', message: expect.stringMatching(/not set up/) });
    } finally {
      model.available = true;
    }
  });
});
