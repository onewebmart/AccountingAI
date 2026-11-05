/**
 * Integration tests — quotes, sales orders and delivery challans.
 *
 *  ✓ A quote is numbered, taxed for the customer's state, changed only as a draft, sent, accepted
 *  ✓ An accepted quote becomes one order, once; the order is invoiced in parts, never beyond what was ordered
 *  ✓ A challan delivers against the order, never beyond it; the order shows invoiced and delivered
 *  ✓ A customer's message becomes a draft quote at their last prices; what the rules cannot read goes to the model
 *  ✓ Sent quotes with no answer after a week come back with a follow-up; another org sees none of it
 *  ✓ A quote's discount and adjustment are priced on the server and carried to its order and invoice
 *  ✓ Invoicing an order in parts carries its discounted values, the last part taking what is left
 *  ✓ A typed number is kept unless used; the series skips it. A challan says why goods move, liquid gas included
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
    // One quote by id, as the list shows it; not another org's, and not a non-id.
    expect(await docs.getQuote(orgId, String(q2._id))).toMatchObject({ number: 'QT/2026-27/0002', customerName: expect.any(String), expired: false });
    await expect(docs.getQuote(new Types.ObjectId().toString(), String(q2._id))).rejects.toThrow(/Quote not found/);
    await expect(docs.getQuote(orgId, 'not-an-id')).rejects.toThrow(/not found/i);
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
    // By id, the same progress the list shows.
    const one = (await docs.getOrder(orgId, made.id)) as { lines: Array<{ invoicedQty: number; deliveredQty: number }> };
    expect(one.lines.map((l) => [l.invoicedQty, l.deliveredQty])).toEqual([[60, 0], [0, 5]]);
    await expect(docs.getOrder(new Types.ObjectId().toString(), made.id)).rejects.toThrow(/Sales order not found/);

    // The rest of both lines invoiced: the order closes.
    await docs.invoiceOrder(orgId, ACTOR, made.id, [{ orderLine: 0, qty: 40 }, { orderLine: 1, qty: 5 }]);
    expect(((await docs.listOrders(orgId))[0] as { status: string }).status).toBe('closed');
    const challanId = String((await docs.listChallans(orgId) as Array<{ _id: Types.ObjectId }>)[0]._id);
    expect(await docs.getChallan(orgId, challanId)).toMatchObject({ reason: 'supply', customerName: expect.any(String) });
    await expect(docs.getChallan(new Types.ObjectId().toString(), challanId)).rejects.toThrow(/Challan not found/);
    const pdf = await docs.pdf(orgId, 'challan', challanId);
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

describe('the full sales document', () => {
  const desk = { description: 'Desk', qty: 1, ratePaise: 100000, taxRatePct: 18 };
  const chair = { description: 'Chair', qty: 3, ratePaise: 50000, taxRatePct: 18 };

  it("prices a quote's discount and adjustment, and carries them to its order and invoice", async () => {
    const { orgId, local } = await org();
    const q = await docs.createQuote(orgId, ACTOR, {
      customerId: local, date: '2026-11-04', lines: [desk, { ...chair, qty: 1 }], discount: { percent: 10 }, adjustment: { label: 'Round off', paise: 70 },
      referenceNumber: 'ENQ-12', subject: 'Furniture for the new office', salespersonName: 'Asha', termsAndConditions: 'Prices valid for 15 days.', notes: 'Looking forward to your business.',
    });
    expect(q.toObject()).toMatchObject({
      amountsPaise: { taxableValue: 135000, cgst: 12150, sgst: 12150, total: 159370 },
      discount: { percent: 10, amountPaise: 15000 }, adjustment: { label: 'Round off', paise: 70 },
      referenceNumber: 'ENQ-12', subject: 'Furniture for the new office', salespersonName: 'Asha', termsAndConditions: 'Prices valid for 15 days.',
    });
    expect(q.lines.map((l) => l.discountPaise)).toEqual([10000, 5000]);
    await expect(docs.createQuote(orgId, ACTOR, { customerId: local, lines: [desk], adjustment: { paise: 10000 } })).rejects.toThrow(/at most ₹99.99/);

    // The PDF shows the discount, the adjustment and the terms.
    const pdf = (await docs.pdf(orgId, 'quote', String(q._id))).content.toString('latin1');
    expect(pdf).toContain('Less: Discount \\(10%\\)'); // PDF strings escape brackets
    expect(pdf).toContain('Round off');
    expect(pdf).toContain('Furniture for the new office');
    expect(pdf).toContain('Terms and conditions');

    // Changing a draft re-prices it with the discount it has.
    const changed = await docs.updateQuote(orgId, ACTOR, String(q._id), { lines: [desk, { ...chair, qty: 2 }] });
    expect(changed.amountsPaise.taxableValue).toBe(180000);
    await docs.updateQuote(orgId, ACTOR, String(q._id), { lines: [desk, { ...chair, qty: 1 }], subject: 'Office furniture' });

    await docs.answerQuote(orgId, ACTOR, String(q._id), 'accepted');
    const made = await docs.convertQuote(orgId, ACTOR, String(q._id), 'sales_order');
    const order = await docs.getOrder(orgId, made.id);
    expect(order).toMatchObject({ amountsPaise: { total: 159370 }, discount: { percent: 10, amountPaise: 15000 }, customerPoNumber: 'ENQ-12', subject: 'Office furniture' });

    // All of it in one go: the invoice charges exactly what was quoted, rounding and all.
    const invoice = await docs.invoiceOrder(orgId, ACTOR, made.id, [{ orderLine: 0, qty: 1 }, { orderLine: 1, qty: 1 }]);
    expect(invoice.toObject()).toMatchObject({ amountsPaise: { taxableValue: 135000, total: 159370 }, adjustment: { paise: 70 }, referenceNumber: 'ENQ-12', subject: 'Office furniture', termsAndConditions: 'Prices valid for 15 days.' });
    expect(invoice.lineItems.map((l) => l.discountPaise)).toEqual([10000, 5000]);

    // A quote made straight into an invoice carries the same.
    const q2 = await docs.createQuote(orgId, ACTOR, { customerId: local, lines: [desk], discount: { amountPaise: 2500 } });
    const inv2 = await docs.convertQuote(orgId, ACTOR, String(q2._id), 'invoice');
    const stored = await invoices.findById(inv2.id).lean().exec();
    expect(stored).toMatchObject({ amountsPaise: { taxableValue: 97500 }, discount: { percent: null, amountPaise: 2500 } });
  });

  it('invoices an order in parts at its discounted values, the last part taking what is left of the discount', async () => {
    const { orgId, local } = await org();
    const order = await docs.createOrder(orgId, ACTOR, {
      customerId: local, lines: [chair], discount: { amountPaise: 1000 }, expectedBy: '2099-12-01', deliveryMethod: 'Courier', paymentTermsDays: 30, customerPoNumber: 'PO-5',
    });
    expect(order.toObject()).toMatchObject({ deliveryMethod: 'Courier', paymentTermsDays: 30, expectedBy: '2099-12-01', amountsPaise: { taxableValue: 149000 } });
    const first = await docs.invoiceOrder(orgId, ACTOR, String(order._id), [{ orderLine: 0, qty: 1 }]);
    const second = await docs.invoiceOrder(orgId, ACTOR, String(order._id), [{ orderLine: 0, qty: 1 }]);
    const third = await docs.invoiceOrder(orgId, ACTOR, String(order._id), [{ orderLine: 0, qty: 1 }]);
    expect([first, second, third].map((i) => i.lineItems[0].discountPaise)).toEqual([333, 333, 334]);
    expect([first, second, third].reduce((s, i) => s + i.amountsPaise.taxableValue, 0)).toBe(149000);
    // Due by the order's payment terms.
    expect(first.dueDate).toBe(new Date(Date.parse(`${first.invoiceDate}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10));
    expect(first.paymentTermsDays).toBe(30);
    await expect(docs.createOrder(orgId, ACTOR, { customerId: local, date: '2026-11-04', expectedBy: '2026-11-01', lines: [chair] })).rejects.toThrow(/on or after/);
  });

  it('keeps a typed number unless it is used, and says why goods move on a challan', async () => {
    const { orgId, local } = await org();
    const typed = await docs.createQuote(orgId, ACTOR, { customerId: local, date: '2026-11-04', number: 'QT/2026-27/0001', lines: [desk] });
    expect(typed.number).toBe('QT/2026-27/0001');
    await expect(docs.createQuote(orgId, ACTOR, { customerId: local, number: 'QT/2026-27/0001', lines: [desk] })).rejects.toThrow(/already used/);
    await expect(docs.createQuote(orgId, ACTOR, { customerId: local, number: 'QT #1', lines: [desk] })).rejects.toThrow(/16 letters/);
    // The series skips the number typed by hand.
    expect((await docs.createQuote(orgId, ACTOR, { customerId: local, date: '2026-11-04', lines: [desk] })).number).toBe('QT/2026-27/0002');

    const gas = await docs.createChallan(orgId, ACTOR, {
      customerId: local, date: '2026-11-04', reason: 'liquid_gas', number: 'DC-77', lines: [{ description: 'LPG 19 kg', qty: 10, ratePaise: 180000, taxRatePct: 18 }],
      referenceNumber: 'Tanker 4', notes: 'Quantity measured at delivery.', termsAndConditions: 'Return the cylinders within 30 days.',
    });
    expect(gas.toObject()).toMatchObject({ number: 'DC-77', reason: 'liquid_gas', referenceNumber: 'Tanker 4', notes: 'Quantity measured at delivery.', termsAndConditions: 'Return the cylinders within 30 days.' });
    const pdf = (await docs.pdf(orgId, 'challan', String(gas._id))).content.toString('latin1');
    expect(pdf).toContain('Supply of liquid gas');
    expect(pdf).toContain('Return the cylinders');
    await expect(docs.createChallan(orgId, ACTOR, { customerId: local, reason: 'gift' as never, lines: [desk] })).rejects.toThrow(/Say why the goods move/);
  });
});
