/**
 * Integration tests — quotes, sales orders and delivery challans.
 *
 *  ✓ A quote is numbered, taxed for the customer's state, changed only as a draft, sent, accepted
 *  ✓ An accepted quote becomes one order, once; the order is invoiced in parts, never beyond what was ordered
 *  ✓ A challan delivers against the order, never beyond it; the order shows invoiced and delivered
 *  ✓ A customer's message becomes a draft quote at their last prices; what the rules cannot read goes to the model
 *  ✓ Sent quotes with no answer after a week come back with a follow-up; another org sees none of it
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { QUOTE_DRAFT_QUEUE, SalesDocsService } from './sales-docs.service';
import { QUOTE_MODEL } from './quote-model';
import { DeliveryChallan, DeliveryChallanSchema, Quote, QuoteSchema, SalesOrder, SalesOrderSchema } from './schemas/sales-docs.schema';
import { ItemsService, HSN_QUEUE } from '../items/items.service';
import { HSN_MODEL } from '../items/hsn-model';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { AiSuggestion, AiSuggestionSchema } from '../ai-suggestions/schemas/ai-suggestion.schema';
import { UsageMeterService } from '../ocr/usage-meter.service';
import { UsageMeter, UsageMeterSchema } from '../ocr/schemas/usage-meter.schema';
import { MailerService } from '../mail/mailer.service';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { SalesInvoice, SalesInvoiceSchema, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';

const ACTOR = new Types.ObjectId().toString();
const model = { available: true, read: jest.fn() };
const queue = { add: jest.fn().mockResolvedValue({ id: 'job' }) };

let moduleRef: TestingModule;
let docs: SalesDocsService;
let items: ItemsService;
let invoices: Model<SalesInvoiceDocument>;
let customers: Model<{ _id: Types.ObjectId }>;
let settings: Model<unknown>;
let quotes: Model<Quote>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: Quote.name, schema: QuoteSchema },
        { name: SalesOrder.name, schema: SalesOrderSchema },
        { name: DeliveryChallan.name, schema: DeliveryChallanSchema },
        { name: Item.name, schema: ItemSchema },
        { name: AiSuggestion.name, schema: AiSuggestionSchema },
        { name: UsageMeter.name, schema: UsageMeterSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
      ]),
    ],
    providers: [
      SalesDocsService, ItemsService, UsageMeterService, SalesInvoicesService, PostingService, AccountsService, AuditService,
      { provide: QUOTE_MODEL, useValue: model },
      { provide: getQueueToken(QUOTE_DRAFT_QUEUE), useValue: queue },
      { provide: getQueueToken(HSN_QUEUE), useValue: { add: jest.fn() } },
      { provide: HSN_MODEL, useValue: { available: false, ask: jest.fn() } },
      { provide: MailerService, useValue: { configured: false, send: jest.fn() } },
    ],
  }).compile();
  docs = moduleRef.get(SalesDocsService);
  items = moduleRef.get(ItemsService);
  invoices = moduleRef.get(getModelToken(SalesInvoice.name));
  customers = moduleRef.get(getModelToken(Customer.name));
  settings = moduleRef.get(getModelToken(OrgSettings.name));
  quotes = moduleRef.get(getModelToken(Quote.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

async function org() {
  const orgId = new Types.ObjectId().toString();
  await settings.create({ orgId, gstin: '27AAPFU0939F1ZV', stateCode: '27', displayName: 'Kumar Stationers' });
  const [local] = await customers.create([{ orgId, name: 'Rao Traders', gstin: '27AAACR5055K1Z7', stateCode: '27', email: 'buy@rao.in' }]);
  const [away] = await customers.create([{ orgId, name: 'Bengaluru Books', stateCode: '29' }]);
  return { orgId, local: String(local._id), away: String(away._id) };
}

const pen = { description: 'Ball pen blue', qty: 100, ratePaise: 1000, taxRatePct: 18 };

describe('quotes', () => {
  it('is numbered and taxed for the state, changed only while a draft, sent and accepted', async () => {
    const { orgId, local, away } = await org();
    const q1 = await docs.createQuote(orgId, ACTOR, { customerId: local, date: '2026-11-04', lines: [pen] });
    expect(q1.toObject()).toMatchObject({ number: 'QT/2026-27/0001', validUntil: '2026-11-19', status: 'draft', amountsPaise: { taxableValue: 100000, cgst: 9000, sgst: 9000, igst: 0, total: 118000 } });
    const q2 = await docs.createQuote(orgId, ACTOR, { customerId: away, date: '2026-11-04', lines: [pen] });
    expect(q2.number).toBe('QT/2026-27/0002');
    expect(q2.amountsPaise).toMatchObject({ igst: 18000, cgst: 0 });

    await docs.updateQuote(orgId, ACTOR, String(q1._id), { lines: [{ ...pen, qty: 200 }] });
    const { quote, emailed } = await docs.sendQuote(orgId, ACTOR, String(q1._id));
    expect([quote.status, emailed, quote.amountsPaise.total]).toEqual(['sent', false, 236000]);
    await expect(docs.updateQuote(orgId, ACTOR, String(q1._id), { notes: 'x' })).rejects.toThrow(/Only a draft/);
    expect((await docs.answerQuote(orgId, ACTOR, String(q1._id), 'accepted')).status).toBe('accepted');
    await expect(docs.createQuote(orgId, ACTOR, { customerId: local, lines: [{ ...pen, taxRatePct: 17 }] })).rejects.toThrow(/slab/);
    expect(await docs.listQuotes(new Types.ObjectId().toString())).toEqual([]);
  });
});

describe('orders and challans', () => {
  it('becomes one order, invoiced and delivered in parts, never beyond the order', async () => {
    const { orgId, local } = await org();
    const q = await docs.createQuote(orgId, ACTOR, { customerId: local, lines: [pen, { description: 'Stapler', qty: 5, ratePaise: 25000, taxRatePct: 18 }] });
    await docs.answerQuote(orgId, ACTOR, String(q._id), 'accepted');
    const made = await docs.convertQuote(orgId, ACTOR, String(q._id), 'sales_order');
    expect(made.kind).toBe('sales_order');
    await expect(docs.convertQuote(orgId, ACTOR, String(q._id), 'sales_order')).rejects.toThrow(/converted/);

    const draft = await docs.invoiceOrder(orgId, ACTOR, made.id, [{ orderLine: 0, qty: 60 }]);
    expect(draft.toObject()).toMatchObject({ status: 'draft', amountsPaise: { taxableValue: 60000, total: 70800 }, source: { kind: 'sales_order', id: made.id } });
    await expect(docs.invoiceOrder(orgId, ACTOR, made.id, [{ orderLine: 0, qty: 41 }])).rejects.toThrow(/only 40 left/);

    await docs.createChallan(orgId, ACTOR, { customerId: local, reason: 'supply', salesOrderId: made.id, lines: [{ description: 'Stapler', qty: 5, ratePaise: 25000, taxRatePct: 18, orderLine: 1 }], vehicleNo: 'mh12ab1234' });
    await expect(docs.createChallan(orgId, ACTOR, { customerId: local, reason: 'supply', salesOrderId: made.id, lines: [{ description: 'Stapler', qty: 1, ratePaise: 25000, taxRatePct: 18, orderLine: 1 }] })).rejects.toThrow(/only 0 left/);

    const [order] = (await docs.listOrders(orgId)) as Array<{ lines: Array<{ invoicedQty: number; deliveredQty: number }>; status: string }>;
    expect(order.lines.map((l) => [l.invoicedQty, l.deliveredQty])).toEqual([[60, 0], [0, 5]]);

    // The rest of both lines invoiced: the order closes.
    await docs.invoiceOrder(orgId, ACTOR, made.id, [{ orderLine: 0, qty: 40 }, { orderLine: 1, qty: 5 }]);
    expect(((await docs.listOrders(orgId))[0] as { status: string }).status).toBe('closed');
    const pdf = await docs.pdf(orgId, 'challan', String((await docs.listChallans(orgId) as Array<{ _id: Types.ObjectId }>)[0]._id));
    expect(pdf.content.toString('latin1')).toContain('DELIVERY CHALLAN');
  });
});

describe('drafting from a message', () => {
  it("reads the message into a draft quote at the customer's last prices", async () => {
    const { orgId, local } = await org();
    const paper = await items.create(orgId, ACTOR, { name: 'A4 Copier Paper', kind: 'goods', hsnSac: '4802', gstRatePct: 12, salePricePaise: 30000 });
    await items.create(orgId, ACTOR, { name: 'Ball pen blue', kind: 'goods', hsnSac: '9608', gstRatePct: 18, salePricePaise: 1200 });
    // Rao was last charged ₹280 a ream, below list.
    await invoices.create({ orgId, customerId: new Types.ObjectId(local), invoiceNumber: 'INV/1', invoiceDate: '2026-10-01', status: 'posted', amountsPaise: { taxableValue: 28000, cgst: 1680, sgst: 1680, igst: 0, cess: 0, total: 31360 }, lineItems: [{ description: 'A4 Copier Paper', itemId: paper._id, qty: 1, ratePaise: 28000, amountPaise: 28000, taxRatePct: 12 }] });

    const r = await docs.draftFromMessage(orgId, ACTOR, { customerId: local, text: 'Hi, please send 20 reams of A4 paper and 50 blue pens by Friday. Also 3 desk lamps.' });
    expect(r.status).toBe('done');
    const lines = r.quote!.lines.map((l) => [l.description, l.qty, l.ratePaise, l.taxRatePct]);
    expect(lines).toEqual([
      ['A4 Copier Paper', 20, 28000, 12],
      ['Ball pen blue', 50, 1200, 18],
      ['desk lamps', 3, 0, 18],
    ]);
    expect(r.quote!.drafted).toMatchObject({ source: 'rules', unread: ['3 desk lamps'] });
  });

  it('gives the model what the rules cannot read, against real items only', async () => {
    const { orgId, local } = await org();
    await items.create(orgId, ACTOR, { name: 'Ball pen blue', kind: 'goods', gstRatePct: 18, salePricePaise: 1200 });
    const r = await docs.draftFromMessage(orgId, ACTOR, { customerId: local, text: 'Need a box worth of blue ballpoints for the new joiners' });
    expect(r.status).toBe('queued');
    model.read.mockResolvedValueOnce({ raw: { lines: [{ item: 'Ball pen blue', qty: 10 }, { item: 'Gold watch', qty: 1 }] }, tokensIn: 50, tokensOut: 10 });
    await docs.runQuoteModel(orgId, r.suggestionId!);
    const status = await docs.quoteDraftStatus(orgId, r.suggestionId!);
    const quote = await quotes.findById(status.quoteId).lean().exec();
    expect(quote!.lines.map((l) => [l.description, l.qty])).toEqual([['Ball pen blue', 10]]);
    expect(quote!.drafted).toMatchObject({ source: 'model' });
  });

  it('brings back sent quotes nobody answered, with the follow-up', async () => {
    const { orgId, local } = await org();
    const q = await docs.createQuote(orgId, ACTOR, { customerId: local, date: '2026-10-20', validUntil: '2026-11-01', lines: [pen] });
    await docs.sendQuote(orgId, ACTOR, String(q._id));
    await quotes.updateOne({ _id: q._id }, { $set: { sentAt: new Date('2026-10-20T10:00:00Z') } });
    const [f] = await docs.followUps(orgId, '2026-11-04');
    expect(f).toMatchObject({ number: q.number, customerName: 'Rao Traders' });
    expect(f.message).toMatch(/valid until 2026-11-01; we are happy to renew it/);
    expect(await docs.followUps(orgId, '2026-10-24')).toEqual([]);
  });
});
