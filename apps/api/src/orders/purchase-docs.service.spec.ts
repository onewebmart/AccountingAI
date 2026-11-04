/**
 * Tests — purchase orders, goods received, and the 3-way match.
 *
 *  ✓ The match says each difference in words: billed beyond received, above the PO rate, not on the PO
 *  ✓ Goods are received against a PO, never beyond what is still to come
 *  ✓ A bill drafted from the PO bills what was received and not billed; the PO closes when all is billed
 *  ✓ A typed bill linked to its PO is matched line by line; a goods note behind a bill cannot be cancelled
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
