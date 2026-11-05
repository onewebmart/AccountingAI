/**
 * Integration tests — POST /purchase/bills/from-lines.
 *
 *  ✓ A bill typed line by line is a draft, priced on the server: CGST and SGST from a vendor in our state
 *  ✓ IGST from a vendor in another state; an item fills HSN/SAC and its expense account; projects stay on lines
 *  ✓ Posting it is a balanced purchase voucher, the cost on each line's project
 *  ✓ A line that cannot be read is refused, naming the line; another org's vendor is not found
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { BillStatus } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { BillsFromLinesService } from './bills-from-lines.service';
import { PurchaseBillsService } from './purchase-bills.service';
import { PurchaseBill, PurchaseBillSchema } from './schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from './schemas/vendor.schema';
import { ItemsService, HSN_QUEUE } from '../items/items.service';
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
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';

const ACTOR = new Types.ObjectId().toString();
let moduleRef: TestingModule;
let fromLines: BillsFromLinesService;
let bills: PurchaseBillsService;
let accounts: AccountsService;
let vendors: Model<unknown>;
let settings: Model<unknown>;
let items: Model<unknown>;
let projects: Model<unknown>;
let journals: Model<JournalDocument>;

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
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
        { name: Project.name, schema: ProjectSchema },
      ]),
    ],
    providers: [
      BillsFromLinesService, PurchaseBillsService, ItemsService, UsageMeterService, PostingService, AccountsService, AuditService,
      { provide: getQueueToken(HSN_QUEUE), useValue: { add: jest.fn() } },
      { provide: HSN_MODEL, useValue: { available: false, ask: jest.fn() } },
    ],
  }).compile();
  fromLines = moduleRef.get(BillsFromLinesService);
  bills = moduleRef.get(PurchaseBillsService);
  accounts = moduleRef.get(AccountsService);
  vendors = moduleRef.get(getModelToken(Vendor.name));
  settings = moduleRef.get(getModelToken(OrgSettings.name));
  items = moduleRef.get(getModelToken(Item.name));
  projects = moduleRef.get(getModelToken(Project.name));
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
  const [local, away] = (await vendors.create([
    { orgId, name: 'Sigma Supplies', gstin: '27AAACS1234A1Z1' },
    { orgId, name: 'Bengaluru Prints', gstin: '29AAACB1234A1Z5' },
  ])) as Array<{ _id: Types.ObjectId }>;
  return { orgId, localId: String(local._id), awayId: String(away._id) };
}

describe('bills from lines', () => {
  it('prices a draft on the server, CGST and SGST from a vendor in our state', async () => {
    const { orgId, localId } = await org();
    const bill = await fromLines.create(orgId, ACTOR, {
      vendorId: localId, billNumber: ' SG/101 ', billDate: '2026-11-03', dueDate: '2026-11-18',
      lines: [
        { description: 'Copier paper A4', hsnSac: '4802', qty: 2.5, ratePaise: 25050, taxRatePct: 12 },
        { description: 'Toner cartridge', qty: 1, ratePaise: 300000, taxRatePct: 18 },
        { description: '   ', qty: 1, ratePaise: 1, taxRatePct: 0 }, // a blank row the form left behind
      ],
      notes: 'October stock',
    });
    // 2.5 × 250.50 = 626.25; GST 12% = 75.15 → 37.58 + 37.57. Toner 3,000 at 18% = 540 → 270 + 270.
    expect(bill.toObject()).toMatchObject({
      status: BillStatus.DRAFT, billNumber: 'SG/101', billDate: '2026-11-03', dueDate: '2026-11-18', notes: 'October stock',
      amountsPaise: { taxableValue: 362625, cgst: 3758 + 27000, sgst: 3757 + 27000, igst: 0, cess: 0, total: 362625 + 7515 + 54000 },
    });
    expect(bill.lineItems.map((l) => [l.description, l.hsnSac, l.qty, l.ratePaise, l.amountPaise, l.taxRatePct])).toEqual([
      ['Copier paper A4', '4802', 2.5, 25050, 62625, 12],
      ['Toner cartridge', null, 1, 300000, 300000, 18],
    ]);
  });

  it('charges IGST from another state; an item fills the line, a project stays on it, and it posts balanced', async () => {
    const { orgId, awayId } = await org();
    await accounts.seedDefaults(orgId);
    const all = await accounts.list(orgId);
    const advertising = String(all.find((a) => a.name === 'Advertising & Marketing')!._id);
    const [item] = (await items.create([
      { orgId, name: 'Flyer printing', nameKey: 'flyer printing', kind: 'service', hsnSac: '998912', uqc: 'NOS', gstRatePct: 18, expenseAccountId: advertising, isActive: true },
    ])) as Array<{ _id: Types.ObjectId }>;
    const [project] = (await projects.create([{ orgId, name: 'Diwali launch', nameKey: 'diwali launch', billing: 'fixed', createdBy: ACTOR }])) as Array<{ _id: Types.ObjectId }>;

    const bill = await fromLines.create(orgId, ACTOR, {
      vendorId: awayId, billDate: '2026-11-04',
      lines: [
        { itemId: String(item._id), description: 'Flyers, 5,000', qty: 1, ratePaise: 1200000, taxRatePct: 18, projectId: String(project._id) },
        { description: 'Courier', qty: 1, ratePaise: 50000, taxRatePct: 18 },
      ],
    });
    expect(bill.amountsPaise).toMatchObject({ taxableValue: 1250000, cgst: 0, sgst: 0, igst: 225000, total: 1475000 });
    expect(bill.lineItems[0]).toMatchObject({ hsnSac: '998912', uqc: 'NOS' });
    expect(String(bill.lineItems[0].itemId)).toBe(String(item._id));
    expect(String(bill.lineItems[0].accountId)).toBe(advertising);
    expect(String(bill.lineItems[0].projectId)).toBe(String(project._id));

    const posted = await bills.post(String(bill._id), orgId, ACTOR);
    const journal = (await journals.findById(posted.journalId).exec())!;
    expect(journal.lines.reduce((s, l) => s + l.debitPaise, 0)).toBe(journal.lines.reduce((s, l) => s + l.creditPaise, 0));
    const ad = journal.lines.find((l) => String(l.accountId) === advertising)!;
    expect(ad.debitPaise).toBe(1200000);
    expect(String(ad.projectId)).toBe(String(project._id));
    expect(journal.lines.find((l) => l.description === 'Input IGST')!.debitPaise).toBe(225000);
  });

  it('books a line to the account chosen on it, over the item; never to a control, tax or bank account', async () => {
    const { orgId, localId } = await org();
    const other = await org();
    await accounts.seedDefaults(orgId);
    await accounts.seedDefaults(other.orgId);
    const id = async (o: string, name: string) => String((await accounts.list(o)).find((a) => a.name === name)!._id);
    const rent = await id(orgId, 'Rent');
    const computers = await id(orgId, 'Computers & IT Equipment');

    const bill = await fromLines.create(orgId, ACTOR, {
      vendorId: localId, billDate: '2026-11-01',
      lines: [
        { description: 'Office rent, November', hsnSac: '997212', qty: 1, ratePaise: 4000000, taxRatePct: 18, accountId: rent },
        { description: 'Laptop for the office', hsnSac: '8471', qty: 1, ratePaise: 6000000, taxRatePct: 18, accountId: computers },
        { description: 'Paper', qty: 1, ratePaise: 100000, taxRatePct: 12 },
      ],
    });
    const posted = await bills.post(String(bill._id), orgId, ACTOR);
    const journal = (await journals.findById(posted.journalId).exec())!;
    const debit = (account: string) => journal.lines.filter((l) => String(l.accountId) === account).reduce((s, l) => s + l.debitPaise, 0);
    expect(debit(rent)).toBe(4000000);
    expect(debit(computers)).toBe(6000000);
    expect(debit(await id(orgId, 'Purchases'))).toBe(100000);
    // The voucher reads as words: the bill and the vendor by name.
    expect(journal.narration).toBe('Purchase bill without a number — Sigma Supplies');

    const line = { description: 'Rent', qty: 1, ratePaise: 100000, taxRatePct: 0 };
    for (const name of ['Accounts Payable', 'Bank Accounts', 'Input CGST', 'Sales Revenue', 'Indirect Expenses']) {
      await expect(fromLines.create(orgId, ACTOR, { vendorId: localId, billDate: '2026-11-01', lines: [{ ...line, accountId: await id(orgId, name) }] })).rejects.toThrow(/Line 1: a bill line cannot be booked to/);
    }
    await expect(fromLines.create(orgId, ACTOR, { vendorId: localId, billDate: '2026-11-01', lines: [{ ...line, accountId: await id(other.orgId, 'Rent') }] })).rejects.toThrow(/Line 1: that account is not one of yours/);
  });

  it('refuses a line it cannot read, and a vendor from another org', async () => {
    const { orgId, localId } = await org();
    const other = await org();
    const line = { description: 'Paper', qty: 1, ratePaise: 1000, taxRatePct: 18 };
    await expect(fromLines.create(orgId, ACTOR, { vendorId: localId, billDate: '2026-11-04', lines: [line, { ...line, taxRatePct: 7 }] })).rejects.toThrow(/Line 2: 7% is not a GST slab/);
    await expect(fromLines.create(orgId, ACTOR, { vendorId: localId, billDate: '2026-11-04', lines: [{ ...line, qty: 0 }] })).rejects.toThrow(/Line 1: the quantity/);
    await expect(fromLines.create(orgId, ACTOR, { vendorId: localId, billDate: '2026-11-04', lines: [] })).rejects.toThrow(/at least one line/);
    await expect(fromLines.create(orgId, ACTOR, { vendorId: localId, billDate: '2026-11-04', dueDate: '2026-11-01', lines: [line] })).rejects.toThrow(/due date/);
    await expect(fromLines.create(other.orgId, ACTOR, { vendorId: localId, billDate: '2026-11-04', lines: [line] })).rejects.toThrow(/Vendor not found/);
  });
});
