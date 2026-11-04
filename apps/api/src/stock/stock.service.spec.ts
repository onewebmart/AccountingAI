/**
 * Tests — stock (periodic inventory).
 *
 *  ✓ Posted bills bring stock in at their line cost, posted invoices take it out at the average;
 *    a document taken back to draft stops counting; services and uncounted goods are left out
 *  ✓ A purchase price up 10% or more is flagged; at the reorder level, a PO goes to the last vendor at their last rate
 *  ✓ A count adjusts to what was counted; more than is on hand cannot go out; a locked month stays as it was;
 *    a voided move stays listed; entering opening stock again replaces the last one
 *  ✓ Lines link by this vendor's history, by shared words, to a new item made from the line, or are marked not stock;
 *    a scanned bill keeps the lines read off it, unlinked
 *  ✓ The opening stock entry comes first; then each month's closing entry books only that month's change
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { InvoiceStatus } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { StockService } from './stock.service';
import { StockMove, StockMoveSchema } from './schemas/stock-move.schema';
import { AdjustmentsService } from '../month-end/adjustments.service';
import { HSN_QUEUE, ItemsService } from '../items/items.service';
import { HSN_MODEL } from '../items/hsn-model';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { AiSuggestion, AiSuggestionSchema } from '../ai-suggestions/schemas/ai-suggestion.schema';
import { UsageMeterService } from '../ocr/usage-meter.service';
import { UsageMeter, UsageMeterSchema } from '../ocr/schemas/usage-meter.schema';
import { ProposalsService } from '../proposals/proposals.service';
import { LearningService } from '../proposals/learning.service';
import { SubledgerSyncService } from '../proposals/subledger-sync.service';
import { BillChecksService } from '../proposals/checks/bill-checks.service';
import { ExpenseCategorizerService } from '../proposals/categorisation/expense-categorizer.service';
import { CATEGORY_MODEL } from '../proposals/categorisation/category-model';
import { ProposedEntry, ProposedEntrySchema, ProposedEntryDocument } from '../proposals/schemas/proposed-entry.schema';
import { VendorLedgerMap, VendorLedgerMapSchema } from '../proposals/schemas/vendor-ledger-map.schema';
import { ExtractedDocument, ExtractedDocumentSchema, ExtractedDocumentDocument } from '../extraction/schemas/extracted-document.schema';
import { Document as UploadedDocument, DocumentSchema } from '../documents/schemas/document.schema';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { PeriodLock, PeriodLockSchema } from '../gl/schemas/period-lock.schema';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { VendorsService } from '../purchase/vendors.service';
import { PurchaseBill, PurchaseBillSchema, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { SalesInvoice, SalesInvoiceSchema, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { GoodsReceipt, GoodsReceiptSchema, PurchaseOrder, PurchaseOrderSchema } from '../orders/schemas/purchase-docs.schema';
import { PurchaseDocsService } from '../orders/purchase-docs.service';

const ACTOR = new Types.ObjectId().toString();
const createPo = jest.fn(async (_orgId: string, _actorId: string, input: unknown) => ({ number: 'PO/2026-27/0001', input }));

let moduleRef: TestingModule;
let stock: StockService;
let items: ItemsService;
let accounts: AccountsService;
let bills: PurchaseBillsService;
let vendors: VendorsService;
let invoices: SalesInvoicesService;
let proposals: ProposalsService;
let journals: Model<JournalDocument>;
let proposalModel: Model<ProposedEntryDocument>;
let billModel: Model<PurchaseBillDocument>;
let invoiceModel: Model<SalesInvoiceDocument>;
let customerModel: Model<{ orgId: string; name: string }>;
let extractedModel: Model<ExtractedDocumentDocument>;
let lockModel: Model<{ orgId: string; lockedThrough: string | null }>;
let auditModel: Model<{ orgId: string; entityType: string; action: string; after: Record<string, unknown> }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: StockMove.name, schema: StockMoveSchema },
        { name: Item.name, schema: ItemSchema },
        { name: AiSuggestion.name, schema: AiSuggestionSchema },
        { name: UsageMeter.name, schema: UsageMeterSchema },
        { name: ProposedEntry.name, schema: ProposedEntrySchema },
        { name: VendorLedgerMap.name, schema: VendorLedgerMapSchema },
        { name: ExtractedDocument.name, schema: ExtractedDocumentSchema },
        { name: UploadedDocument.name, schema: DocumentSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: PeriodLock.name, schema: PeriodLockSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
        { name: PurchaseOrder.name, schema: PurchaseOrderSchema },
        { name: GoodsReceipt.name, schema: GoodsReceiptSchema },
      ]),
    ],
    providers: [
      StockService, AdjustmentsService, ItemsService, UsageMeterService,
      { provide: getQueueToken(HSN_QUEUE), useValue: { add: jest.fn() } },
      { provide: HSN_MODEL, useValue: { available: false, ask: jest.fn() } },
      // Its own spec covers the PO against the database; here, only what stock asks it for.
      { provide: PurchaseDocsService, useValue: { createPo } },
      ProposalsService, LearningService, SubledgerSyncService, BillChecksService, ExpenseCategorizerService,
      { provide: CATEGORY_MODEL, useValue: { available: false, choose: jest.fn() } },
      { provide: REDIS_CLIENT, useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') } },
      PostingService, AccountsService, AuditService, PurchaseBillsService, VendorsService, SalesInvoicesService,
    ],
  }).compile();
  stock = moduleRef.get(StockService);
  items = moduleRef.get(ItemsService);
  accounts = moduleRef.get(AccountsService);
  bills = moduleRef.get(PurchaseBillsService);
  vendors = moduleRef.get(VendorsService);
  invoices = moduleRef.get(SalesInvoicesService);
  proposals = moduleRef.get(ProposalsService);
  journals = moduleRef.get(getModelToken(Journal.name));
  proposalModel = moduleRef.get(getModelToken(ProposedEntry.name));
  billModel = moduleRef.get(getModelToken(PurchaseBill.name));
  invoiceModel = moduleRef.get(getModelToken(SalesInvoice.name));
  customerModel = moduleRef.get(getModelToken(Customer.name));
  extractedModel = moduleRef.get(getModelToken(ExtractedDocument.name));
  lockModel = moduleRef.get(getModelToken(PeriodLock.name));
  auditModel = moduleRef.get(getModelToken(AuditLog.name));
  await journals.init();
  await proposalModel.init();
  await moduleRef.get<Model<unknown>>(getModelToken(StockMove.name)).init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

async function org() {
  const orgId = new Types.ObjectId().toString();
  await accounts.seedDefaults(orgId);
  const rice = await items.create(orgId, ACTOR, { name: 'Basmati Rice 25kg', kind: 'goods', hsnSac: '1006', uqc: 'BAG', gstRatePct: 5 });
  const vendor = await vendors.create({ orgId, name: 'Punjab Grains' });
  const customer = await customerModel.create({ orgId, name: 'Hotel Saffron' });
  return { orgId, rice, riceId: String(rice._id), vendorId: String(vendor._id), customerId: String(customer._id) };
}

type Line = { description: string; itemId?: string; hsnSac?: string; qty: number; amountPaise: number };
const gst5 = (taxable: number) => ({ taxableValue: taxable, cgst: Math.round(taxable * 0.025), sgst: Math.round(taxable * 0.025), igst: 0, cess: 0, total: taxable + 2 * Math.round(taxable * 0.025) });

async function postBill(orgId: string, vendorId: string, number: string, date: string, lines: Line[]) {
  const lineItems = await items.resolveLines(orgId, lines.map((l) => ({ ...l, taxRatePct: 5, ratePaise: Math.round(l.amountPaise / l.qty) })), 'purchase');
  const draft = await bills.create({ orgId, vendorId, billNumber: number, billDate: date, lineItems, amountsPaise: gst5(lines.reduce((s, l) => s + l.amountPaise, 0)) });
  return bills.post(String(draft._id), orgId, ACTOR);
}

async function postInvoice(orgId: string, customerId: string, number: string, date: string, lines: Line[]) {
  const lineItems = await items.resolveLines(orgId, lines.map((l) => ({ ...l, taxRatePct: 5, ratePaise: Math.round(l.amountPaise / l.qty) })), 'sale');
  const draft = await invoices.create({ orgId, customerId, invoiceNumber: number, invoiceDate: date, lineItems, amountsPaise: gst5(lines.reduce((s, l) => s + l.amountPaise, 0)) });
  return invoices.post(String(draft._id), orgId, ACTOR);
}

const approve = (orgId: string, p: { _id: unknown }) => proposals.approve({ proposalId: String(p._id), orgId, actorId: ACTOR });

describe('stock from documents', () => {
  it('counts posted bills in at cost and invoices out at the average, and nothing else', async () => {
    const { orgId, riceId, vendorId, customerId } = await org();
    await items.create(orgId, ACTOR, { name: 'Carton boxes', kind: 'goods', hsnSac: '4819', trackStock: false });
    const delivery = await items.create(orgId, ACTOR, { name: 'Delivery', kind: 'service', hsnSac: '996511' });
    await stock.setOpening(orgId, ACTOR, { itemId: riceId, qty: 100, ratePaise: 4000_00, date: '2026-04-01' });

    await postBill(orgId, vendorId, 'PG/41', '2026-10-05', [{ description: 'Basmati Rice 25kg', itemId: riceId, qty: 50, amountPaise: 2_25_000_00 }]);
    const sold = await postInvoice(orgId, customerId, 'INV/1', '2026-10-10', [
      { description: 'Basmati Rice 25kg', itemId: riceId, qty: 30, amountPaise: 1_80_000_00 },
      { description: 'Delivery', itemId: String(delivery._id), qty: 1, amountPaise: 500_00 },
    ]);

    const s = await stock.summary(orgId, '2026-10-31');
    expect(s.rows.map((r) => r.name)).toEqual(['Basmati Rice 25kg']);
    // 100 at ₹4,000 and 50 at ₹4,500: ₹6,25,000 for 150; 30 out at the average leaves ₹5,00,000.
    expect(s.rows[0]).toMatchObject({ qty: 120, valuePaise: 5_00_000_00, out90: 30 });
    expect(s.totals.valuePaise).toBe(5_00_000_00);

    const ledger = await stock.ledger(orgId, riceId, '2026-10-01', '2026-10-31');
    expect(ledger.opening).toEqual({ qty: 100, valuePaise: 4_00_000_00 });
    expect(ledger.rows.map((r) => [r.source.kind, r.source.number, r.qty, r.valuePaise])).toEqual([['bill', 'PG/41', 50, 2_25_000_00], ['invoice', 'INV/1', -30, -1_25_000_00]]);
    expect(ledger.closing).toEqual({ qty: 120, valuePaise: 5_00_000_00 });

    // Reversing an invoice takes it back to draft, as the reversal service does: it stops counting.
    await invoiceModel.updateOne({ _id: sold._id }, { $set: { status: InvoiceStatus.DRAFT, journalId: null } }).exec();
    expect((await stock.summary(orgId, '2026-10-31')).rows[0]).toMatchObject({ qty: 150, valuePaise: 6_25_000_00 });
  });

  it('flags a purchase price that moved, and orders what is short from the last vendor at their rate', async () => {
    const { orgId, riceId, vendorId, customerId } = await org();
    await items.update(orgId, ACTOR, riceId, { reorderLevel: 20, reorderQty: 40 });
    await postBill(orgId, vendorId, 'PG/1', '2026-09-01', [{ description: 'Basmati Rice 25kg', itemId: riceId, qty: 40, amountPaise: 1_80_000_00 }]);
    await postBill(orgId, vendorId, 'PG/2', '2026-10-01', [{ description: 'Basmati Rice 25kg', itemId: riceId, qty: 10, amountPaise: 50_000_00 }]);
    await postInvoice(orgId, customerId, 'INV/9', '2026-10-15', [{ description: 'Basmati Rice 25kg', itemId: riceId, qty: 35, amountPaise: 2_10_000_00 }]);

    const [row] = (await stock.summary(orgId, '2026-10-31')).rows;
    expect(row.priceChange).toMatchObject({ pct: 11.1, lastPaise: 5000_00, prevPaise: 4500_00 });
    expect(row.reorder).toMatchObject({ suggestQty: 40, reason: '15 in stock, at or under the reorder level of 20.' });
    expect(row.reorder!.vendors[0]).toMatchObject({ vendorId, vendorName: 'Punjab Grains', ratePaise: 5000_00, billNumber: 'PG/2' });

    await stock.orderReorders(orgId, ACTOR, { vendorId, lines: [{ itemId: riceId, qty: row.reorder!.suggestQty }] });
    expect(createPo).toHaveBeenCalledWith(orgId, ACTOR, expect.objectContaining({
      vendorId, lines: [expect.objectContaining({ itemId: riceId, description: 'Basmati Rice 25kg', qty: 40, ratePaise: 5000_00, taxRatePct: 5, uqc: 'BAG' })],
    }));
  });
});

describe('opening stock and adjustments', () => {
  it('adjusts to a count, refuses what is not there, keeps voided moves and a locked month as it was', async () => {
    const { orgId, riceId } = await org();
    await stock.setOpening(orgId, ACTOR, { itemId: riceId, qty: 100, ratePaise: 4000_00, date: '2026-04-01' });

    const counted = await stock.adjust(orgId, ACTOR, { itemId: riceId, date: '2026-10-31', reason: 'count', countedQty: 97, note: 'October count' });
    expect(counted).toMatchObject({ qty: -3, ratePaise: null });
    await expect(stock.adjust(orgId, ACTOR, { itemId: riceId, date: '2026-10-31', reason: 'damaged', qty: -200 })).rejects.toThrow(/Only 97 on hand/);
    await expect(stock.adjust(orgId, ACTOR, { itemId: riceId, date: '2026-10-31', reason: 'count', countedQty: 97 })).rejects.toThrow(/matches the books/);
    expect((await stock.summary(orgId, '2026-10-31')).rows[0]).toMatchObject({ qty: 97, valuePaise: 3_88_000_00 });

    await stock.voidMove(orgId, ACTOR, String(counted._id));
    expect((await stock.summary(orgId, '2026-10-31')).rows[0].qty).toBe(100);

    // Entered again, the opening replaces the last one, which stays voided.
    await stock.setOpening(orgId, ACTOR, { itemId: riceId, qty: 90, ratePaise: 4000_00, date: '2026-04-01' });
    const listed = await stock.listMoves(orgId, riceId);
    expect(listed.map((m) => [m.reason, m.qty, m.voided])).toEqual([['count', -3, true], ['opening', 90, false], ['opening', 100, true]]);
    expect((await stock.summary(orgId, '2026-10-31')).rows[0].qty).toBe(90);

    await lockModel.create({ orgId, lockedThrough: '2026-09-30' });
    await expect(stock.adjust(orgId, ACTOR, { itemId: riceId, date: '2026-09-15', reason: 'damaged', qty: -1 })).rejects.toThrow(/locked through 2026-09-30/);
  });
});

describe('linking lines to items', () => {
  it("suggests by this vendor's history and shared words, makes new items, and stops asking about what is not stock", async () => {
    const { orgId, riceId, vendorId } = await org();
    await postBill(orgId, vendorId, 'PG/7', '2026-10-02', [
      { description: 'RICE BASMATI 25KG BAG', hsnSac: '1006', qty: 20, amountPaise: 90_000_00 },
      { description: 'Jaggery blocks 1kg', hsnSac: '1701', qty: 50, amountPaise: 3_000_00 },
      { description: 'Packing material', qty: 1, amountPaise: 400_00 },
      { description: 'Freight', hsnSac: '996511', qty: 1, amountPaise: 1_500_00 },
    ]);

    let lines = await stock.unlinkedLines(orgId);
    expect(lines.map((l) => l.description)).toEqual(['RICE BASMATI 25KG BAG', 'Jaggery blocks 1kg', 'Packing material']);
    expect(lines[0].suggestion).toMatchObject({ by: 'name', itemId: riceId });
    expect(lines[1].suggestion).toMatchObject({ by: 'new', newItem: { name: 'Jaggery blocks 1kg', hsnSac: '1701', gstRatePct: 5 } });

    await stock.linkLine(orgId, ACTOR, { docKind: 'bill', docId: lines[0].docId, line: 0, itemId: riceId });
    const made = await stock.linkLine(orgId, ACTOR, { docKind: 'bill', docId: lines[1].docId, line: 1, newItem: { name: 'Jaggery blocks 1kg', hsnSac: '1701', uqc: 'PCS', gstRatePct: 5 } });
    await stock.linkLine(orgId, ACTOR, { docKind: 'bill', docId: lines[2].docId, line: 2, notStock: true });
    expect(await stock.unlinkedLines(orgId)).toEqual([]);

    const bill = (await billModel.findOne({ orgId, billNumber: 'PG/7' }).lean().exec())!;
    expect(bill.lineItems.map((l) => [l.itemId ? String(l.itemId) : null, l.uqc, l.notStock])).toEqual([[riceId, 'BAG', false], [made.itemId, 'PCS', false], [null, null, true], [null, null, false]]);
    expect(bill.amountsPaise.total).toBe(gst5(94_900_00).total);
    expect((await items.findById(orgId, made.itemId!)).purchasePricePaise).toBe(60_00);
    expect(await auditModel.countDocuments({ orgId, entityType: 'PurchaseBill', action: { $in: ['LINK_ITEM', 'MARK_NOT_STOCK'] } })).toBe(3);
    const s = await stock.summary(orgId, '2026-10-31');
    expect(s.rows.map((r) => [r.name, r.qty])).toEqual([['Basmati Rice 25kg', 20], ['Jaggery blocks 1kg', 50]]);

    // The vendor's next bill with the same words: linked from history at one press.
    await postBill(orgId, vendorId, 'PG/8', '2026-10-20', [{ description: 'RICE BASMATI 25KG BAG', hsnSac: '1006', qty: 10, amountPaise: 45_000_00 }]);
    lines = await stock.unlinkedLines(orgId);
    expect(lines[0].suggestion).toMatchObject({ by: 'vendor_history', itemId: riceId });
    expect(lines[0].suggestion.reason).toMatch(/This vendor's "RICE BASMATI 25KG BAG" was linked to Basmati Rice 25kg on PG\/7/);
    expect(await stock.linkFromHistory(orgId, ACTOR)).toEqual({ linked: 1 });
    expect((await stock.summary(orgId, '2026-10-31')).rows.find((r) => r.itemId === riceId)!.qty).toBe(30);
  });

  it('keeps the lines read off a scanned bill, unlinked, on the bill its approval makes', async () => {
    const { orgId } = await org();
    const extracted = await extractedModel.create({
      orgId, documentId: new Types.ObjectId(), ocrResultId: new Types.ObjectId(), status: 'extracted', retryCount: 0, documentType: 'purchase_invoice', confidenceOverall: 0.92,
      vendor: { name: 'Kisan Traders', gstin: null, confidence: 0.9 }, invoiceNumber: { value: 'KT/301', confidence: 0.95 }, invoiceDate: { value: '2026-10-12', confidence: 0.95 },
      placeOfSupply: 'Maharashtra', currency: 'INR',
      amountsPaise: { taxableValue: 40_000_00, cgst: 1_000_00, sgst: 1_000_00, igst: 0, cess: 0, total: 42_000_00, confidence: 0.93 },
      lineItems: [{ description: 'Basmati rice 25kg', hsnSac: '1006', qty: 10, ratePaise: 4000_00, amountPaise: 40_000_00, taxRatePct: 5 }],
      isReverseCharge: false, rawWarnings: [],
    });
    const proposal = await proposals.createFromExtracted(String(extracted._id), orgId);
    await approve(orgId, proposal);

    const bill = (await billModel.findOne({ orgId, billNumber: 'KT/301' }).lean().exec())!;
    expect(bill.lineItems).toEqual([expect.objectContaining({ description: 'Basmati rice 25kg', hsnSac: '1006', qty: 10, amountPaise: 40_000_00, itemId: null })]);
    expect((await stock.unlinkedLines(orgId))[0]).toMatchObject({ number: 'KT/301', partyName: 'Kisan Traders', suggestion: { by: 'name' } });
  });
});

describe('the stock entries', () => {
  it('books the opening stock first, then only each month’s change', async () => {
    const { orgId, riceId, vendorId, customerId } = await org();
    await stock.setOpening(orgId, ACTOR, { itemId: riceId, qty: 100, ratePaise: 4000_00, date: '2026-04-01' });
    expect(await stock.opening(orgId)).toMatchObject({ date: '2026-04-01', itemsPaise: 4_00_000_00, booksPaise: 0, differencePaise: 4_00_000_00 });
    expect((await stock.closing(orgId, '2026-10')).blockers[0]).toMatch(/opening stock/);
    await expect(stock.proposeClosing(orgId, ACTOR, '2026-10')).rejects.toThrow(/opening stock/);

    const opening = await stock.proposeOpening(orgId, ACTOR);
    expect(opening.suggestedLines.map((l) => [l.accountName, l.debitPaise, l.creditPaise])).toEqual([['Stock in Hand', 4_00_000_00, 0], ['Retained Earnings', 0, 4_00_000_00]]);
    await expect(stock.proposeOpening(orgId, ACTOR)).rejects.toThrow(/waiting in the review queue/);
    await approve(orgId, opening);
    expect((await stock.opening(orgId)).differencePaise).toBe(0);

    await postBill(orgId, vendorId, 'PG/41', '2026-10-05', [{ description: 'Basmati Rice 25kg', itemId: riceId, qty: 50, amountPaise: 2_25_000_00 }]);
    await postInvoice(orgId, customerId, 'INV/1', '2026-10-10', [{ description: 'Basmati Rice 25kg', itemId: riceId, qty: 30, amountPaise: 1_80_000_00 }]);

    const october = await stock.closing(orgId, '2026-10');
    expect(october).toMatchObject({ date: '2026-10-31', stockPaise: 5_00_000_00, booksPaise: 4_00_000_00, differencePaise: 1_00_000_00, blockers: [] });
    const oct = await stock.proposeClosing(orgId, ACTOR, '2026-10');
    expect(oct).toMatchObject({ sourceType: 'adjustment', invoiceDate: '2026-10-31', narration: 'Closing stock as at 2026-10-31', adjustment: { kind: 'closing_stock', period: '2026-10' } });
    expect(oct.suggestedLines.map((l) => [l.accountName, l.debitPaise, l.creditPaise])).toEqual([['Stock in Hand', 1_00_000_00, 0], ['Changes in Inventories', 0, 1_00_000_00]]);
    expect(oct.adjustment!.reason).toMatch(/₹5,00,000\.00 at weighted-average cost/);
    // Nothing reaches the ledger until a person approves it.
    expect(await journals.countDocuments({ orgId, narration: /Closing stock/ })).toBe(0);
    await expect(stock.proposeClosing(orgId, ACTOR, '2026-10')).rejects.toThrow(/waiting in the review queue/);
    await approve(orgId, oct);
    await expect(stock.proposeClosing(orgId, ACTOR, '2026-10')).rejects.toThrow(/already carry the stock/);

    // November sells 60 more: ₹2,50,000 of the ₹5,00,000 goes, and only that is booked.
    await postInvoice(orgId, customerId, 'INV/2', '2026-11-10', [{ description: 'Basmati Rice 25kg', itemId: riceId, qty: 60, amountPaise: 3_60_000_00 }]);
    const nov = await stock.proposeClosing(orgId, ACTOR, '2026-11');
    expect(nov.suggestedLines.map((l) => [l.accountName, l.debitPaise, l.creditPaise])).toEqual([['Changes in Inventories', 2_50_000_00, 0], ['Stock in Hand', 0, 2_50_000_00]]);
    await approve(orgId, nov);
    expect(await stock.closing(orgId, '2026-11')).toMatchObject({ stockPaise: 2_50_000_00, booksPaise: 2_50_000_00, differencePaise: 0 });
  });
});
