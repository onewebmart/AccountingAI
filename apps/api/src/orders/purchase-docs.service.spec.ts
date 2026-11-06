/**
 * Tests — purchase orders, goods received, and the 3-way match.
 *
 *  ✓ The match says each difference in words: billed beyond received, above the PO rate, not on the PO
 *  ✓ Goods are received against a PO, never beyond what is still to come
 *  ✓ A bill drafted from the PO bills what was received and not billed; the PO closes when all is billed
 *  ✓ A typed bill linked to its PO is matched line by line; a goods note behind a bill cannot be cancelled
 *  ✓ A PO keeps its reference, terms, shipment, delivery address, typed number and line accounts; its discount carries onto its bills to the paisa
 *  ✓ A bill for the whole PO at once carries its adjustment, and posts it to Round Off
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { PurchaseDocsService } from './purchase-docs.service';
import { GoodsReceipt, GoodsReceiptSchema, PurchaseOrder, PurchaseOrderSchema } from './schemas/purchase-docs.schema';
import { threeWayMatch } from './three-way-match';
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
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { Journal as JournalClass } from '../gl/schemas/journal.schema';

describe('the 3-way match', () => {
  const po = [
    { description: 'Copier paper A4', itemId: 'paper', qty: 120, ratePaise: 25000, taxRatePct: 12, receivedQty: 100, billedQty: 0 },
    { description: 'Toner cartridge', itemId: null, qty: 4, ratePaise: 300000, taxRatePct: 18, receivedQty: 4, billedQty: 0 },
  ];
  it('says each difference in words', () => {
    const r = threeWayMatch({
      bill: [
        { description: 'A4 paper', itemId: 'paper', qty: 120, ratePaise: 25500, taxRatePct: 12 },
        { description: 'Courier charges', itemId: null, qty: 1, ratePaise: 15000, taxRatePct: 18 },
      ],
      po,
      lastRates: new Map([[0, 24000]]),
    });
    expect(r.status).toBe('differences');
    expect(r.differences.map((d) => d.message)).toEqual([
      '"A4 paper": billed 120, received 100.',
      '"A4 paper": rate ₹255.00, ₹5.00 above the PO\'s ₹250.00.',
      '"A4 paper": ₹255.00 is up 6% on the last purchase at ₹240.00.',
      '"Courier charges" is billed but not on the purchase order.',
      '"Toner cartridge": 4 received but not on this bill.',
    ]);
  });

  it('is clean when the bill is what was ordered and received', () => {
    const r = threeWayMatch({ bill: [{ description: 'Toner cartridge', itemId: null, qty: 4, ratePaise: 300000, taxRatePct: 18 }], po: [po[1]] });
    expect(r).toMatchObject({ status: 'matched', differences: [] });
  });
});

const ACTOR = new Types.ObjectId().toString();
let moduleRef: TestingModule;
let docs: PurchaseDocsService;
let bills: PurchaseBillsService;
let vendors: Model<{ _id: Types.ObjectId }>;
let settings: Model<unknown>;
let customers: Model<{ _id: Types.ObjectId }>;
let accounts: AccountsService;
let journals: Model<JournalClass>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: PurchaseOrder.name, schema: PurchaseOrderSchema },
        { name: GoodsReceipt.name, schema: GoodsReceiptSchema },
        { name: Item.name, schema: ItemSchema },
        { name: AiSuggestion.name, schema: AiSuggestionSchema },
        { name: UsageMeter.name, schema: UsageMeterSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
        { name: Customer.name, schema: CustomerSchema },
      ]),
    ],
    providers: [
      PurchaseDocsService, PurchaseBillsService, ItemsService, UsageMeterService, PostingService, AccountsService, AuditService,
      { provide: getQueueToken(HSN_QUEUE), useValue: { add: jest.fn() } },
      { provide: HSN_MODEL, useValue: { available: false, ask: jest.fn() } },
      { provide: MailerService, useValue: { configured: false, send: jest.fn() } },
    ],
  }).compile();
  docs = moduleRef.get(PurchaseDocsService);
  bills = moduleRef.get(PurchaseBillsService);
  vendors = moduleRef.get(getModelToken(Vendor.name));
  settings = moduleRef.get(getModelToken(OrgSettings.name));
  customers = moduleRef.get(getModelToken(Customer.name));
  accounts = moduleRef.get(AccountsService);
  journals = moduleRef.get(getModelToken(Journal.name));
  await journals.init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

async function org() {
  const orgId = new Types.ObjectId().toString();
  await settings.create({ orgId, gstin: '27AAPFU0939F1ZV', stateCode: '27', displayName: 'Kumar Stationers' });
  const [vendor] = await vendors.create([{ orgId, name: 'Sigma Supplies', gstin: '27AAACS1234A1Z1' }]);
  return { orgId, vendorId: String(vendor._id) };
}
const lines = [
  { description: 'Copier paper A4', qty: 120, ratePaise: 25000, taxRatePct: 12 },
  { description: 'Toner cartridge', qty: 4, ratePaise: 300000, taxRatePct: 18 },
];

describe('purchase orders', () => {
  it('receives, bills what came, and closes once all is billed', async () => {
    const { orgId, vendorId } = await org();
    const po = await docs.createPo(orgId, ACTOR, { vendorId, date: '2026-11-02', lines });
    expect(po.toObject()).toMatchObject({ number: 'PO/2026-27/0001', status: 'open', amountsPaise: { taxableValue: 4200000, cgst: 288000, sgst: 288000 } });
    expect((await docs.sendPo(orgId, ACTOR, String(po._id))).emailed).toBe(false);

    await docs.receive(orgId, ACTOR, String(po._id), { lines: [{ poLine: 0, qty: 100 }, { poLine: 1, qty: 4 }], vendorChallanNo: 'DC-881' });
    await expect(docs.receive(orgId, ACTOR, String(po._id), { lines: [{ poLine: 0, qty: 21 }] })).rejects.toThrow(/20 still to come/);

    const bill = await docs.billFromPo(orgId, ACTOR, String(po._id), { billNumber: 'SG/771' });
    expect(bill.toObject()).toMatchObject({ status: 'draft', amountsPaise: { taxableValue: 3700000 }, source: { kind: 'purchase_order', lines: [{ poLine: 0, qty: 100 }, { poLine: 1, qty: 4 }] } });
    expect(await docs.match(orgId, String(bill._id))).toMatchObject({ linked: true, status: 'matched' });
    await expect(docs.billFromPo(orgId, ACTOR, String(po._id), { billNumber: 'SG/772' })).rejects.toThrow(/Nothing received/);

    // The last 20 come in and are billed: the PO is done.
    await docs.receive(orgId, ACTOR, String(po._id), { lines: [{ poLine: 0, qty: 20 }] });
    await docs.billFromPo(orgId, ACTOR, String(po._id), { billNumber: 'SG/772' });
    const [listed] = (await docs.listPos(orgId)) as Array<{ status: string; lines: Array<{ receivedQty: number; billedQty: number }> }>;
    expect(listed.status).toBe('closed');
    expect(listed.lines.map((l) => [l.receivedQty, l.billedQty])).toEqual([[120, 120], [4, 4]]);
    // By id, what the list shows; not to another org.
    expect(await docs.getPo(orgId, String(po._id))).toEqual(listed);
    await expect(docs.getPo(new Types.ObjectId().toString(), String(po._id))).rejects.toThrow(/Purchase order not found/);
  });

  it('matches a typed bill to its PO, and keeps a billed goods note', async () => {
    const { orgId, vendorId } = await org();
    const po = await docs.createPo(orgId, ACTOR, { vendorId, lines });
    const grn = await docs.receive(orgId, ACTOR, String(po._id), { lines: [{ poLine: 0, qty: 100 }] });
    const typed = await bills.create({
      orgId, vendorId, billNumber: 'SG/900', billDate: '2026-11-10', amountsPaise: { taxableValue: 3060000, cgst: 183600, sgst: 183600, igst: 0, cess: 0, total: 3427200 },
      lineItems: [{ description: 'Copier paper A4', qty: 120, ratePaise: 25500, amountPaise: 3060000, taxRatePct: 12 }],
    });
    const before = await docs.match(orgId, String(typed._id));
    expect(before).toMatchObject({ linked: false, candidates: [{ number: po.number }] });
    const after = await docs.linkBill(orgId, ACTOR, String(po._id), String(typed._id));
    expect(after).toMatchObject({ linked: true, status: 'differences' });
    expect((after as { differences: Array<{ message: string }> }).differences.map((d) => d.message)).toEqual([
      '"Copier paper A4": billed 120, received 100.',
      '"Copier paper A4": rate ₹255.00, ₹5.00 above the PO\'s ₹250.00.',
    ]);
    await expect(docs.cancelGrn(orgId, ACTOR, String(grn._id))).rejects.toThrow(/billed/);
    await expect(docs.linkBill(orgId, ACTOR, String(po._id), String(typed._id))).rejects.toThrow(/already matched/);
  });
});

describe('a purchase order laid out in full', () => {
  it('keeps its words, number, delivery address and line accounts; its discount carries onto its bills to the paisa', async () => {
    const { orgId, vendorId } = await org();
    await vendors.updateOne({ _id: vendorId }, { $set: { paymentTerms: 'net_45' } }).exec();
    await accounts.seedDefaults(orgId);
    const all = await accounts.list(orgId);
    const advertising = String(all.find((a) => a.name === 'Advertising & Marketing')!._id);
    const [mehta] = await customers.create([
      { orgId, name: 'Mehta Interiors', shippingAddress: { attention: 'Site office', street1: '12 Carter Road', street2: null, city: 'Mumbai', stateCode: '27', pincode: '400050', country: 'India', phone: null, fax: null } },
    ]);

    const po = await docs.createPo(orgId, ACTOR, {
      vendorId, number: 'PO-00001', date: '2026-11-02', expectedBy: '2026-11-12', referenceNumber: ' QT-55 ', shipmentPreference: 'Road',
      deliverTo: { kind: 'customer', customerId: String(mehta._id) }, notes: 'Call before delivery', termsAndConditions: 'Deliver before 10 am.',
      lines: [{ ...lines[0], accountId: advertising }, lines[1]], discount: { percent: 10 }, adjustment: { label: 'Round off', paise: 40 },
    });
    // 42,000 less 10% = 4,200, spread 3,000 and 1,200: 27,000 at 12% and 10,800 at 18%.
    expect(po.toObject()).toMatchObject({
      number: 'PO-00001', referenceNumber: 'QT-55', paymentTerms: 'net_45', shipmentPreference: 'Road', expectedBy: '2026-11-12',
      deliverTo: { kind: 'customer', name: 'Mehta Interiors', address: 'Site office\n12 Carter Road\nMumbai 400050\nMaharashtra' },
      amountsPaise: { taxableValue: 3780000, cgst: 259200, sgst: 259200, total: 4298440 },
      discount: { percent: 10, amountPaise: 420000 }, adjustment: { label: 'Round off', paise: 40 }, termsAndConditions: 'Deliver before 10 am.',
    });
    expect(po.lines.map((l) => [l.discountPaise, l.accountId ? String(l.accountId) : null])).toEqual([[300000, advertising], [120000, null]]);

    // The series goes on as before, and skips a number someone typed; a typed number is used once.
    expect((await docs.createPo(orgId, ACTOR, { vendorId, date: '2026-11-02', lines })).number).toBe('PO/2026-27/0001');
    await docs.createPo(orgId, ACTOR, { vendorId, number: 'PO/2026-27/0002', date: '2026-11-02', lines });
    expect((await docs.createPo(orgId, ACTOR, { vendorId, date: '2026-11-02', lines })).number).toBe('PO/2026-27/0003');
    await expect(docs.createPo(orgId, ACTOR, { vendorId, number: 'PO-00001', lines })).rejects.toThrow(/PO-00001 is already used/);
    await expect(docs.createPo(orgId, ACTOR, { vendorId, lines: [{ ...lines[0], accountId: String(all.find((a) => a.name === 'Accounts Payable')!._id) }] })).rejects.toThrow(/Line 1: a purchase cannot be booked to/);
    await expect(docs.createPo(orgId, ACTOR, { vendorId, deliverTo: { kind: 'customer', customerId: new Types.ObjectId().toString() }, lines })).rejects.toThrow(/Customer not found/);

    // Part of it in and billed: each line takes its share of the discount; the bill that completes a line takes what is left.
    await docs.receive(orgId, ACTOR, String(po._id), { lines: [{ poLine: 0, qty: 100 }, { poLine: 1, qty: 4 }] });
    const first = await docs.billFromPo(orgId, ACTOR, String(po._id), { billNumber: 'SG/801', billDate: '2026-11-10' });
    expect(first.toObject()).toMatchObject({
      orderNumber: 'PO-00001', paymentTerms: 'net_45', dueDate: '2026-12-25', adjustment: null,
      discount: { percent: 10, amountPaise: 250000 + 120000 }, discountLevel: 'transaction',
      amountsPaise: { taxableValue: 2250000 + 1080000, cgst: 135000 + 97200, sgst: 135000 + 97200, total: 3330000 + 464400 },
    });
    expect(first.lineItems.map((l) => [l.discountPaise, l.accountId ? String(l.accountId) : null])).toEqual([[250000, advertising], [120000, null]]);
    expect(await docs.match(orgId, String(first._id))).toMatchObject({ linked: true, status: 'matched' });

    await docs.receive(orgId, ACTOR, String(po._id), { lines: [{ poLine: 0, qty: 20 }] });
    const last = await docs.billFromPo(orgId, ACTOR, String(po._id), { billNumber: 'SG/802', billDate: '2026-11-12' });
    expect(last.lineItems.map((l) => l.discountPaise)).toEqual([300000 - 250000]);
    expect(first.discount!.amountPaise + last.discount!.amountPaise).toBe(po.discount!.amountPaise);

    // Posted, the line is booked to the PO's account at its discounted value.
    const posted = await bills.post(String(first._id), orgId, ACTOR);
    const journal = (await journals.findById(posted.journalId).lean().exec())!;
    expect(journal.lines.filter((l) => String(l.accountId) === advertising).reduce((s, l) => s + l.debitPaise, 0)).toBe(2250000);
  });

  it('carries the adjustment onto a bill for the whole PO, posted to Round Off; delivers to our address by default', async () => {
    const { orgId, vendorId } = await org();
    await settings.updateOne({ orgId }, { $set: { address: 'Plot 4, MIDC Bhosari, Pune 411026' } }).exec();
    await accounts.seedDefaults(orgId);
    const po = await docs.createPo(orgId, ACTOR, { vendorId, lines, adjustment: { label: 'Round off', paise: -40 } });
    expect(po.toObject()).toMatchObject({ deliverTo: { kind: 'organisation', name: 'Kumar Stationers', address: 'Plot 4, MIDC Bhosari, Pune 411026' }, paymentTerms: null, amountsPaise: { total: 4200000 + 576000 - 40 } });

    await docs.receive(orgId, ACTOR, String(po._id), { lines: [{ poLine: 0, qty: 120 }, { poLine: 1, qty: 4 }] });
    const bill = await docs.billFromPo(orgId, ACTOR, String(po._id), { billNumber: 'SG/900' });
    expect(bill.toObject()).toMatchObject({ adjustment: { label: 'Round off', paise: -40 }, discount: null, amountsPaise: po.toObject().amountsPaise });
    const journal = (await journals.findById((await bills.post(String(bill._id), orgId, ACTOR)).journalId).lean().exec())!;
    expect(journal.lines.reduce((s, l) => s + l.debitPaise, 0)).toBe(journal.lines.reduce((s, l) => s + l.creditPaise, 0));
    expect(journal.lines.find((l) => l.description === 'Round Off — Round off' || l.description === 'Round Off')).toMatchObject({ debitPaise: 0, creditPaise: 40 });
  });
});
