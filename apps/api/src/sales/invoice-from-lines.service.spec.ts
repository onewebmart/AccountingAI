/**
 * Integration tests — an invoice typed line by line (POST /sales/invoices/from-lines).
 *
 *  ✓ Two lines at different GST slabs are priced on the server: CGST and SGST within the state
 *  ✓ The same lines to a customer in another state carry IGST
 *  ✓ Each line keeps its project, HSN/SAC and item; the invoice is a draft, audited
 *  ✓ A bad line is refused, and nothing is saved
 *  ✓ Another org's project, or customer, is refused
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
import { InvoiceFromLinesService } from './invoice-from-lines.service';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesInvoice, SalesInvoiceSchema, SalesInvoiceDocument } from './schemas/sales-invoice.schema';
import { Customer, CustomerSchema, CustomerDocument } from './schemas/customer.schema';
import { ItemsService, HSN_QUEUE } from '../items/items.service';
import { HSN_MODEL } from '../items/hsn-model';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { AiSuggestion, AiSuggestionSchema } from '../ai-suggestions/schemas/ai-suggestion.schema';
import { UsageMeterService } from '../ocr/usage-meter.service';
import { UsageMeter, UsageMeterSchema } from '../ocr/schemas/usage-meter.schema';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema, AuditLogDocument } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';

const ACTOR = new Types.ObjectId().toString();

let moduleRef: TestingModule;
let fromLines: InvoiceFromLinesService;
let invoiceList: SalesInvoicesService;
let invoices: Model<SalesInvoiceDocument>;
let customers: Model<CustomerDocument>;
let settings: Model<unknown>;
let projects: Model<unknown>;
let itemModel: Model<unknown>;
let audit: Model<AuditLogDocument>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: Item.name, schema: ItemSchema },
        { name: Project.name, schema: ProjectSchema },
        { name: AiSuggestion.name, schema: AiSuggestionSchema },
        { name: UsageMeter.name, schema: UsageMeterSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
      ]),
    ],
    providers: [
      InvoiceFromLinesService, SalesInvoicesService, ItemsService, UsageMeterService, PostingService, AccountsService, AuditService,
      { provide: getQueueToken(HSN_QUEUE), useValue: { add: jest.fn() } },
      { provide: HSN_MODEL, useValue: { available: false, ask: jest.fn() } },
    ],
  }).compile();
  fromLines = moduleRef.get(InvoiceFromLinesService);
  invoiceList = moduleRef.get(SalesInvoicesService);
  invoices = moduleRef.get(getModelToken(SalesInvoice.name));
  customers = moduleRef.get(getModelToken(Customer.name));
  settings = moduleRef.get(getModelToken(OrgSettings.name));
  projects = moduleRef.get(getModelToken(Project.name));
  itemModel = moduleRef.get(getModelToken(Item.name));
  audit = moduleRef.get(getModelToken(AuditLog.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

/** An org in Maharashtra, a customer there and one in Karnataka, a project and an item. */
async function org() {
  const orgId = new Types.ObjectId().toString();
  await settings.create({ orgId, gstin: '27AAPFU0939F1ZV', stateCode: '27', displayName: 'Kumar Stationers' });
  const [local] = await customers.create([{ orgId, name: 'Rao Traders', gstin: '27AAACR5055K1Z7', stateCode: '27' }]);
  const [away] = await customers.create([{ orgId, name: 'Bengaluru Books', stateCode: '29' }]);
  const [project] = await projects.create([{ orgId, name: 'School order', nameKey: 'school order', billing: 'fixed', createdBy: ACTOR }]);
  const [item] = await itemModel.create([{ orgId, name: 'Notebook A5', nameKey: 'notebook a5', kind: 'goods', hsnSac: '4820', uqc: 'NOS', gstRatePct: 12, salePricePaise: 4000, createdBy: ACTOR }]);
  return {
    orgId,
    local: String(local._id),
    away: String(away._id),
    project: String((project as { _id: Types.ObjectId })._id),
    item: String((item as { _id: Types.ObjectId })._id),
  };
}

// ₹10 × 100 at 18% and ₹40 × 50 at 12%: taxable ₹3,000, tax ₹180 + ₹240.
const lines = (project: string, item: string) => [
  { description: 'Ball pen blue', hsnSac: '9608', qty: 100, ratePaise: 1000, taxRatePct: 18, projectId: project },
  { description: 'Notebook A5', itemId: item, qty: 50, ratePaise: 4000, taxRatePct: 12 },
];

describe('an invoice from its lines', () => {
  it('prices two slabs as CGST and SGST within the state, and keeps each line', async () => {
    const o = await org();
    const invoice = await fromLines.create(o.orgId, ACTOR, {
      customerId: o.local,
      invoiceDate: '2026-11-05',
      dueDate: '2026-11-20',
      notes: '  For the school term  ',
      lines: lines(o.project, o.item),
    });

    expect(invoice.status).toBe(InvoiceStatus.DRAFT);
    expect(invoice.invoiceNumber).toBeNull();
    expect(invoice.notes).toBe('For the school term');
    expect(invoice.amountsPaise).toMatchObject({ taxableValue: 300000, cgst: 21000, sgst: 21000, igst: 0, cess: 0, total: 342000 });

    const [pen, book] = invoice.lineItems;
    expect(pen).toMatchObject({ description: 'Ball pen blue', hsnSac: '9608', qty: 100, ratePaise: 1000, amountPaise: 100000, taxRatePct: 18 });
    expect(String(pen.projectId)).toBe(o.project);
    // The item fills the HSN/SAC and unit the line left out; the line's own rate and slab stand.
    expect(book).toMatchObject({ description: 'Notebook A5', hsnSac: '4820', uqc: 'NOS', qty: 50, ratePaise: 4000, amountPaise: 200000, taxRatePct: 12 });
    expect(String(book.itemId)).toBe(o.item);
    expect(book.projectId).toBeNull();

    const stored = await invoices.findOne({ _id: invoice._id, orgId: o.orgId }).lean().exec();
    expect(stored?.amountsPaise.total).toBe(342000);
    const logged = await audit.findOne({ orgId: o.orgId, entityType: 'SalesInvoice', entityId: String(invoice._id), action: 'CREATE' }).lean().exec();
    expect(logged).toBeTruthy();
  });

  it('carries IGST to a customer in another state, and says so beforehand', async () => {
    const o = await org();
    expect(await fromLines.placeOfSupply(o.orgId, o.away)).toEqual({ ourStateCode: '27', customerStateCode: '29', interState: true });
    expect(await fromLines.placeOfSupply(o.orgId, o.local)).toMatchObject({ interState: false });

    const invoice = await fromLines.create(o.orgId, ACTOR, { customerId: o.away, invoiceNumber: ' KS/101 ', invoiceDate: '2026-11-05', lines: lines(o.project, o.item) });
    expect(invoice.invoiceNumber).toBe('KS/101');
    expect(invoice.amountsPaise).toMatchObject({ taxableValue: 300000, cgst: 0, sgst: 0, igst: 42000, total: 342000 });
    expect(invoice.lineItems.map((l) => l.taxRatePct)).toEqual([18, 12]);
  });

  it("lists one customer's invoices, and none for a customer that is not one", async () => {
    const o = await org();
    const mine = await fromLines.create(o.orgId, ACTOR, { customerId: o.local, invoiceDate: '2026-11-05', lines: lines(o.project, o.item) });
    await fromLines.create(o.orgId, ACTOR, { customerId: o.away, invoiceDate: '2026-11-05', lines: lines(o.project, o.item) });
    expect((await invoiceList.list(o.orgId)).length).toBe(2);
    expect((await invoiceList.list(o.orgId, undefined, o.local)).map((i) => String(i._id))).toEqual([String(mine._id)]);
    expect(await invoiceList.list(o.orgId, InvoiceStatus.POSTED, o.local)).toEqual([]);
    expect(await invoiceList.list(o.orgId, undefined, 'not-an-id')).toEqual([]);
  });

  it('refuses a bad line and saves nothing', async () => {
    const o = await org();
    const good = lines(o.project, o.item);
    const before = await invoices.countDocuments({ orgId: o.orgId });

    await expect(fromLines.create(o.orgId, ACTOR, { customerId: o.local, invoiceDate: '2026-11-05', lines: [good[0], { ...good[1], taxRatePct: 17 }] })).rejects.toThrow(/Line 2: 17% is not a GST slab/);
    await expect(fromLines.create(o.orgId, ACTOR, { customerId: o.local, invoiceDate: '2026-11-05', lines: [{ ...good[0], qty: 0 }] })).rejects.toThrow(/Line 1: the quantity/);
    await expect(fromLines.create(o.orgId, ACTOR, { customerId: o.local, invoiceDate: '2026-11-05', lines: [{ ...good[0], ratePaise: 10.5 }] })).rejects.toThrow(/whole paise/);
    await expect(fromLines.create(o.orgId, ACTOR, { customerId: o.local, invoiceDate: '2026-11-05', lines: [{ ...good[0], description: '  ' }] })).rejects.toThrow(/needs a description/);
    await expect(fromLines.create(o.orgId, ACTOR, { customerId: o.local, invoiceDate: '2026-11-05', lines: [] })).rejects.toThrow(/at least one line/);
    await expect(fromLines.create(o.orgId, ACTOR, { customerId: o.local, invoiceDate: '2026-11-05', dueDate: '2026-11-01', lines: good })).rejects.toThrow(/due date/);

    expect(await invoices.countDocuments({ orgId: o.orgId })).toBe(before);
  });

  it("refuses another org's project or customer", async () => {
    const mine = await org();
    const theirs = await org();
    await expect(
      fromLines.create(mine.orgId, ACTOR, { customerId: mine.local, invoiceDate: '2026-11-05', lines: [{ ...lines(theirs.project, mine.item)[0] }] }),
    ).rejects.toThrow(/No such project/);
    await expect(fromLines.create(mine.orgId, ACTOR, { customerId: theirs.local, invoiceDate: '2026-11-05', lines: lines(mine.project, mine.item) })).rejects.toThrow(/Customer not found/);
    expect(await invoices.countDocuments({ orgId: mine.orgId })).toBe(0);
  });
});
