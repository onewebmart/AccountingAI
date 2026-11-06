/**
 * Integration tests — POST /purchase/bills/from-lines.
 *
 *  ✓ A bill typed line by line is a draft, priced on the server: CGST and SGST from a vendor in our state
 *  ✓ IGST from a vendor in another state; an item fills HSN/SAC and its expense account; projects stay on lines
 *  ✓ Posting it is a balanced purchase voucher, the cost on each line's project
 *  ✓ A line that cannot be read is refused, naming the line; another org's vendor is not found
 *  ✓ A discount on each line or on the whole bill comes off before tax; the adjustment posts to Round Off, payables are the total less TDS
 *  ✓ GSTR-3B takes the discounted bill's GST as input credit, to the paisa
 *  ✓ Payment terms give the due date when none is typed; the order number, subject and each line's customer are kept
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
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { DebitNote, DebitNoteSchema } from './schemas/debit-note.schema';
import { Gstr2bLine, Gstr2bLineSchema } from '../gst/schemas/gstr2b-line.schema';
import { DirectExpense, DirectExpenseSchema } from '../direct-expenses/schemas/direct-expense.schema';
import { ExpenseClaim, ExpenseClaimSchema } from '../expenses/schemas/expense-claim.schema';
import { GstReturnsService } from '../gst/gst-returns.service';

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
let customers: Model<unknown>;
let returns: GstReturnsService;

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
        { name: Customer.name, schema: CustomerSchema },
        { name: CreditNote.name, schema: CreditNoteSchema },
        { name: DebitNote.name, schema: DebitNoteSchema },
        { name: Gstr2bLine.name, schema: Gstr2bLineSchema },
        { name: DirectExpense.name, schema: DirectExpenseSchema },
        { name: ExpenseClaim.name, schema: ExpenseClaimSchema },
      ]),
    ],
    providers: [
      GstReturnsService, BillsFromLinesService, PurchaseBillsService, ItemsService, UsageMeterService, PostingService, AccountsService, AuditService,
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
  customers = moduleRef.get(getModelToken(Customer.name));
  returns = moduleRef.get(GstReturnsService);
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

describe('discounts, the adjustment, terms and customers on a bill', () => {
  const debitOf = (journal: JournalDocument, accountId: string) => journal.lines.filter((l) => String(l.accountId) === accountId).reduce((s, l) => s + l.debitPaise, 0);
  const creditOf = (journal: JournalDocument, accountId: string) => journal.lines.filter((l) => String(l.accountId) === accountId).reduce((s, l) => s + l.creditPaise, 0);
  const named = async (orgId: string) => {
    await accounts.seedDefaults(orgId);
    const all = await accounts.list(orgId);
    const byName = (name: string) => String(all.find((a) => a.name === name)!._id);
    return { byName, roundOff: byName('Round Off'), payables: byName('Accounts Payable'), tds: byName('TDS Payable'), purchases: byName('Purchases') };
  };
  const brochures = { description: 'Printed brochures', qty: 10, ratePaise: 25000, taxRatePct: 12 };
  const toner = { description: 'Toner cartridge', qty: 1, ratePaise: 300000, taxRatePct: 18 };

  it('takes a discount on each line before tax, posts the adjustment to Round Off, and owes the vendor the total less TDS', async () => {
    const { orgId } = await org();
    const a = await named(orgId);
    const [contractor] = (await vendors.create([{ orgId, name: 'Kaveri Contractors', gstin: '27AAACK1234A1Z2', tdsSection: '194C', tdsRateBps: 100 }])) as Array<{ _id: Types.ObjectId }>;
    const advertising = a.byName('Advertising & Marketing');

    const bill = await fromLines.create(orgId, ACTOR, {
      vendorId: String(contractor._id), billNumber: 'KC/88', billDate: '2026-11-05',
      lines: [
        { ...brochures, discount: { percent: 10 }, accountId: advertising },
        { ...toner, discount: { amountPaise: 50000 } },
      ],
      adjustment: { label: 'Round off', paise: -40 },
    });
    // Brochures 2,500 less 10% = 2,250 at 12% = 270; toner 3,000 less 500 = 2,500 at 18% = 450. 4,750 + 720 − 0.40.
    expect(bill.toObject()).toMatchObject({
      amountsPaise: { taxableValue: 475000, cgst: 36000, sgst: 36000, igst: 0, total: 546960 },
      discount: { percent: null, amountPaise: 75000 }, discountLevel: 'line', adjustment: { label: 'Round off', paise: -40 },
      tds: { section: '194C', amountPaise: 4750 },
    });
    expect(bill.lineItems.map((l) => [l.amountPaise, l.discountPaise, l.discountPercent])).toEqual([[250000, 25000, 10], [300000, 50000, null]]);

    const posted = await bills.post(String(bill._id), orgId, ACTOR);
    const journal = (await journals.findById(posted.journalId).exec())!;
    expect(journal.lines.reduce((s, l) => s + l.debitPaise, 0)).toBe(journal.lines.reduce((s, l) => s + l.creditPaise, 0));
    // Each line booked at its value after its discount.
    expect(debitOf(journal, advertising)).toBe(225000);
    expect(debitOf(journal, a.purchases)).toBe(250000);
    // The vendor is owed the total, adjustment included, less TDS; Round Off takes the 40 paise taken off.
    expect(creditOf(journal, a.payables)).toBe(546960 - 4750);
    expect(creditOf(journal, a.tds)).toBe(4750);
    expect(creditOf(journal, a.roundOff)).toBe(40);
    expect(journal.lines.find((l) => String(l.accountId) === a.roundOff)!.description).toBe('Round Off');
  });

  it('spreads a discount on the whole bill over its lines; an adjustment that adds is a Round Off debit', async () => {
    const { orgId, localId } = await org();
    const a = await named(orgId);
    const bill = await fromLines.create(orgId, ACTOR, {
      vendorId: localId, billDate: '2026-11-05', lines: [brochures, toner], discount: { percent: 10 }, adjustment: { label: 'Rounding', paise: 40 },
    });
    // 5,500 less 10% = 550, spread 250 and 300: 2,250 at 12% and 2,700 at 18%.
    expect(bill.toObject()).toMatchObject({
      amountsPaise: { taxableValue: 495000, cgst: 37800, sgst: 37800, total: 570640 },
      discount: { percent: 10, amountPaise: 55000 }, discountLevel: 'transaction', adjustment: { label: 'Rounding', paise: 40 },
    });
    expect(bill.lineItems.map((l) => [l.discountPaise, l.discountPercent])).toEqual([[25000, null], [30000, null]]);
    const journal = (await journals.findById((await bills.post(String(bill._id), orgId, ACTOR)).journalId).exec())!;
    expect(journal.lines.reduce((s, l) => s + l.debitPaise, 0)).toBe(journal.lines.reduce((s, l) => s + l.creditPaise, 0));
    expect(debitOf(journal, a.purchases)).toBe(495000);
    expect(creditOf(journal, a.payables)).toBe(570640);
    expect(debitOf(journal, a.roundOff)).toBe(40);
    expect(journal.lines.find((l) => String(l.accountId) === a.roundOff)!.description).toBe('Round Off — Rounding');

    // One discount or the other; an adjustment rounds, it is not a discount; a line's discount is at most the line.
    const base = { vendorId: localId, billDate: '2026-11-05' };
    await expect(fromLines.create(orgId, ACTOR, { ...base, lines: [{ ...toner, discount: { percent: 5 } }], discount: { percent: 5 } })).rejects.toThrow(/on the lines or on the whole document, not both/);
    await expect(fromLines.create(orgId, ACTOR, { ...base, lines: [toner], adjustment: { paise: 10000 } })).rejects.toThrow(/at most ₹99.99/);
    await expect(fromLines.create(orgId, ACTOR, { ...base, lines: [{ ...toner, discount: { amountPaise: 400000 } }] })).rejects.toThrow(/Line 1: The discount of ₹4,000.00 is more than the ₹3,000.00 the line comes to/);
  });

  it('files the discounted GST as input credit in GSTR-3B, to the paisa', async () => {
    const { orgId, localId, awayId } = await org();
    await accounts.seedDefaults(orgId);
    const local = await fromLines.create(orgId, ACTOR, { vendorId: localId, billDate: '2026-11-05', lines: [{ ...brochures, discount: { percent: 12.5 } }, { ...toner, discount: { amountPaise: 33333 } }] });
    const away = await fromLines.create(orgId, ACTOR, { vendorId: awayId, billDate: '2026-11-06', lines: [brochures, toner], discount: { amountPaise: 12345 }, adjustment: { paise: 15 } });
    for (const b of [local, away]) await bills.post(String(b._id), orgId, ACTOR);
    // 2,500 less 12.5% = 2,187.50 at 12% = 262.50; 3,000 less 333.33 = 2,666.67 at 18% = 480.00.
    expect(local.amountsPaise).toMatchObject({ taxableValue: 218750 + 266667, cgst: 13125 + 24000, sgst: 13125 + 24000 });
    const r = await returns.gstr3b(orgId, '2026-11');
    expect(r.itcOther).toMatchObject({ iamt: away.amountsPaise.igst, camt: local.amountsPaise.cgst, samt: local.amountsPaise.sgst });
    expect(r.itcNet).toMatchObject({ iamt: away.amountsPaise.igst, camt: local.amountsPaise.cgst, samt: local.amountsPaise.sgst });
  });

  it('dues the bill by its terms when no date is typed, and keeps the order number, subject and each line’s customer', async () => {
    const { orgId, localId } = await org();
    const other = await org();
    const [mehta] = (await customers.create([{ orgId, name: 'Mehta Interiors' }])) as Array<{ _id: Types.ObjectId }>;
    const [theirs] = (await customers.create([{ orgId: other.orgId, name: 'Someone else' }])) as Array<{ _id: Types.ObjectId }>;
    const base = { vendorId: localId, billDate: '2026-11-05' };

    const bill = await fromLines.create(orgId, ACTOR, {
      ...base, paymentTerms: 'net_30', orderNumber: ' PO/2026-27/0007 ', subject: 'Site materials for the Mehta flat',
      lines: [{ ...toner, customerId: String(mehta._id), billable: true }, brochures],
    });
    expect(bill.toObject()).toMatchObject({ dueDate: '2026-12-05', paymentTerms: 'net_30', orderNumber: 'PO/2026-27/0007', subject: 'Site materials for the Mehta flat' });
    expect(bill.lineItems.map((l) => [l.customerId ? String(l.customerId) : null, l.billable])).toEqual([[String(mehta._id), true], [null, false]]);
    expect((await fromLines.create(orgId, ACTOR, { ...base, paymentTerms: 'end_of_month', lines: [toner] })).dueDate).toBe('2026-11-30');
    // A typed due date is the person's, whatever the terms.
    expect((await fromLines.create(orgId, ACTOR, { ...base, paymentTerms: 'net_30', dueDate: '2026-11-20', lines: [toner] })).dueDate).toBe('2026-11-20');

    await expect(fromLines.create(orgId, ACTOR, { ...base, lines: [{ ...toner, billable: true }] })).rejects.toThrow(/Line 1: choose the customer to bill it on to/);
    await expect(fromLines.create(orgId, ACTOR, { ...base, lines: [{ ...toner, customerId: String(theirs._id) }] })).rejects.toThrow(/Line 1: that customer is not one of yours/);
    await expect(fromLines.create(orgId, ACTOR, { ...base, paymentTerms: 'whenever', lines: [toner] })).rejects.toThrow(/Payment terms are/);
  });
});
