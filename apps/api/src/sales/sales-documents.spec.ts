/**
 * Integration tests — the full sales document: discount, adjustment, typed
 * numbers and payment terms on invoices, and the itemised credit note.
 *
 *  ✓ A 10% discount on ₹1,000 + ₹500 at 18% is taxable ₹1,350 with GST ₹243; GSTR-1 files those figures
 *  ✓ An adjustment posts to Round Off: the voucher balances and the receivable is the total
 *  ✓ An adjustment beyond ₹99.99, or a discount beyond the lines, is refused
 *  ✓ A typed invoice number is unique in its financial year; the series skips it
 *  ✓ Payment terms set the due date when none is given
 *  ✓ An itemised credit note balances, posts each line to its income account, and GSTR-1 files it under its invoice
 *  ✓ A credit note beyond what the invoice still owes becomes the customer's credit
 *  ✓ An itemised note never takes back more value or tax than the invoice has left, nor off another customer's invoice
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { AccountType, InvoiceStatus } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { InvoiceFromLinesService } from './invoice-from-lines.service';
import { SalesInvoicesService } from './sales-invoices.service';
import { CreditNotesService } from './credit-notes.service';
import { SalesInvoice, SalesInvoiceSchema, SalesInvoiceDocument } from './schemas/sales-invoice.schema';
import { Customer, CustomerSchema, CustomerDocument } from './schemas/customer.schema';
import { CreditNote, CreditNoteSchema } from './schemas/credit-note.schema';
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
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { PartyPaymentsService } from '../payments/party-payments.service';
import { PartyPayment, PartyPaymentSchema } from '../payments/schemas/party-payment.schema';
import { GstReturnsService } from '../gst/gst-returns.service';
import { Gstr2bLine, Gstr2bLineSchema } from '../gst/schemas/gstr2b-line.schema';
import { DirectExpense, DirectExpenseSchema } from '../direct-expenses/schemas/direct-expense.schema';
import { ExpenseClaim, ExpenseClaimSchema } from '../expenses/schemas/expense-claim.schema';

const ACTOR = new Types.ObjectId().toString();

let moduleRef: TestingModule;
let fromLines: InvoiceFromLinesService;
let invoicesSvc: SalesInvoicesService;
let notes: CreditNotesService;
let accounts: AccountsService;
let gst: GstReturnsService;
let invoices: Model<SalesInvoiceDocument>;
let customers: Model<CustomerDocument>;
let settings: Model<unknown>;
let journals: Model<JournalDocument>;
let credits: Model<{ partyId: Types.ObjectId; source: string; unappliedPaise: number; reference: string }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: CreditNote.name, schema: CreditNoteSchema },
        { name: Item.name, schema: ItemSchema },
        { name: Project.name, schema: ProjectSchema },
        { name: AiSuggestion.name, schema: AiSuggestionSchema },
        { name: UsageMeter.name, schema: UsageMeterSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: DebitNote.name, schema: DebitNoteSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
        { name: PartyPayment.name, schema: PartyPaymentSchema },
        { name: Gstr2bLine.name, schema: Gstr2bLineSchema },
        { name: DirectExpense.name, schema: DirectExpenseSchema },
        { name: ExpenseClaim.name, schema: ExpenseClaimSchema },
      ]),
    ],
    providers: [
      InvoiceFromLinesService, SalesInvoicesService, CreditNotesService, PartyPaymentsService, GstReturnsService,
      ItemsService, UsageMeterService, PostingService, AccountsService, AuditService,
      { provide: getQueueToken(HSN_QUEUE), useValue: { add: jest.fn() } },
      { provide: HSN_MODEL, useValue: { available: false, ask: jest.fn() } },
    ],
  }).compile();
  fromLines = moduleRef.get(InvoiceFromLinesService);
  invoicesSvc = moduleRef.get(SalesInvoicesService);
  notes = moduleRef.get(CreditNotesService);
  accounts = moduleRef.get(AccountsService);
  gst = moduleRef.get(GstReturnsService);
  invoices = moduleRef.get(getModelToken(SalesInvoice.name));
  customers = moduleRef.get(getModelToken(Customer.name));
  settings = moduleRef.get(getModelToken(OrgSettings.name));
  journals = moduleRef.get(getModelToken(Journal.name));
  credits = moduleRef.get(getModelToken(PartyPayment.name));
  // Notes and credits are written inside a transaction: the collections exist first.
  for (const name of [CreditNote.name, PartyPayment.name, Journal.name, Counter.name, AuditLog.name]) await moduleRef.get<Model<unknown>>(getModelToken(name)).init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

/** An org in Maharashtra with its chart, and a registered customer in the state. */
async function org() {
  const orgId = new Types.ObjectId().toString();
  await settings.create({ orgId, gstin: '27AAPFU0939F1ZV', stateCode: '27', displayName: 'Kumar Stationers' });
  await accounts.seedDefaults(orgId);
  const [rao] = await customers.create([{ orgId, name: 'Rao Traders', gstin: '27AAACR5055K1Z7', stateCode: '27' }]);
  const [other] = await customers.create([{ orgId, name: 'Mehta & Sons', gstin: '27AAACM1234K1Z1', stateCode: '27' }]);
  return { orgId, rao: String(rao._id), other: String(other._id) };
}

const lines = [
  { description: 'Desk', hsnSac: '9403', qty: 1, ratePaise: 100000, taxRatePct: 18 },
  { description: 'Chair', hsnSac: '9401', qty: 1, ratePaise: 50000, taxRatePct: 18 },
];

/** Debits and credits of a journal, and what it put on each account, by system key. */
async function voucher(orgId: string, journalId: Types.ObjectId | string) {
  const j = (await journals.findOne({ _id: journalId, orgId }).lean().exec())!;
  const keyed = await accounts.resolveSystemAccounts(orgId, [SystemAccountKey.ACCOUNTS_RECEIVABLE, SystemAccountKey.ROUND_OFF, SystemAccountKey.SALES_REVENUE, SystemAccountKey.CUSTOMER_ADVANCES, SystemAccountKey.GST_OUTPUT_CGST, SystemAccountKey.GST_OUTPUT_SGST]);
  const on = (key: SystemAccountKey) => j.lines.filter((l) => String(l.accountId) === String(keyed.get(key)!._id)).reduce((s, l) => s + l.debitPaise - l.creditPaise, 0);
  return {
    debit: j.lines.reduce((s, l) => s + l.debitPaise, 0),
    credit: j.lines.reduce((s, l) => s + l.creditPaise, 0),
    on,
    lines: j.lines,
  };
}

describe('discount on an invoice', () => {
  it('takes 10% off ₹1,000 + ₹500 before tax: taxable ₹1,350, GST ₹243, filed as such', async () => {
    const { orgId, rao } = await org();
    const draft = await fromLines.create(orgId, ACTOR, { customerId: rao, invoiceDate: '2026-11-04', lines, discount: { percent: 10 } });
    expect(draft.amountsPaise).toMatchObject({ taxableValue: 135000, cgst: 12150, sgst: 12150, igst: 0, total: 159300 });
    expect(draft.amountsPaise.cgst + draft.amountsPaise.sgst).toBe(24300);
    // Spread in proportion to the lines, to the paisa: ₹100 and ₹50.
    expect(draft.lineItems.map((l) => [l.amountPaise, l.discountPaise])).toEqual([[100000, 10000], [50000, 5000]]);
    expect(draft.discount).toMatchObject({ percent: 10, amountPaise: 15000 });

    const posted = await invoicesSvc.post(String(draft._id), orgId, ACTOR);
    const v = await voucher(orgId, posted.journalId!);
    expect(v.debit).toBe(v.credit);
    expect(v.on(SystemAccountKey.SALES_REVENUE)).toBe(-135000);
    expect(v.on(SystemAccountKey.ACCOUNTS_RECEIVABLE)).toBe(159300);

    const r = await gst.gstr1(orgId, '2026-11');
    const [doc] = r.b2b.flatMap((p) => p.invoices);
    expect(doc.items).toEqual([{ rate: 18, txval: 135000, iamt: 0, camt: 12150, samt: 12150, csamt: 0 }]);
    expect(r.hsn.b2b.map((h) => [h.hsn, h.txval])).toEqual([['9403', 90000], ['9401', 45000]]);
  });

  it('takes an amount off, spread to the paisa, and refuses one larger than the lines', async () => {
    const { orgId, rao } = await org();
    const three = [1, 2, 3].map((n) => ({ description: `Line ${n}`, qty: 1, ratePaise: 10000, taxRatePct: 0 }));
    const draft = await fromLines.create(orgId, ACTOR, { customerId: rao, invoiceDate: '2026-11-04', lines: three, discount: { amountPaise: 100 } });
    expect(draft.lineItems.map((l) => l.discountPaise)).toEqual([33, 33, 34]);
    expect(draft.amountsPaise.taxableValue).toBe(29900);
    await expect(fromLines.create(orgId, ACTOR, { customerId: rao, invoiceDate: '2026-11-04', lines: three, discount: { amountPaise: 30001 } })).rejects.toThrow(/more than/);
    await expect(fromLines.create(orgId, ACTOR, { customerId: rao, invoiceDate: '2026-11-04', lines: three, discount: { percent: 10.555 } })).rejects.toThrow(/two decimals/);
  });
});

describe('adjustment on an invoice', () => {
  it('posts to Round Off, so the voucher balances and the receivable is the total', async () => {
    const { orgId, rao } = await org();
    // ₹1,180.60 rounded down to ₹1,180: an adjustment of −60 paise.
    const down = await fromLines.create(orgId, ACTOR, { customerId: rao, invoiceDate: '2026-11-04', lines: [{ description: 'Repair', qty: 1, ratePaise: 100051, taxRatePct: 18 }], adjustment: { label: 'Round off', paise: -60 } });
    expect(down.amountsPaise).toMatchObject({ taxableValue: 100051, cgst: 9005, sgst: 9004, total: 118000 });
    const posted = await invoicesSvc.post(String(down._id), orgId, ACTOR);
    const v = await voucher(orgId, posted.journalId!);
    expect(v.debit).toBe(v.credit);
    expect(v.on(SystemAccountKey.ACCOUNTS_RECEIVABLE)).toBe(118000);
    expect(v.on(SystemAccountKey.ROUND_OFF)).toBe(60); // a debit: the total was rounded down

    const up = await fromLines.create(orgId, ACTOR, { customerId: rao, invoiceDate: '2026-11-04', lines: [{ description: 'Repair', qty: 1, ratePaise: 100000, taxRatePct: 18 }], adjustment: { paise: 40 } });
    const upPosted = await invoicesSvc.post(String(up._id), orgId, ACTOR);
    const w = await voucher(orgId, upPosted.journalId!);
    expect([w.debit === w.credit, w.on(SystemAccountKey.ACCOUNTS_RECEIVABLE), w.on(SystemAccountKey.ROUND_OFF)]).toEqual([true, 118040, -40]);
    // The GST return files value and tax; the adjustment is neither.
    const [doc] = (await gst.gstr1(orgId, '2026-11')).b2b.flatMap((p) => p.invoices).filter((d) => d.id === String(up._id));
    expect(doc.items[0]).toMatchObject({ txval: 100000, camt: 9000, samt: 9000 });
  });

  it('is at most ₹99.99 either way', async () => {
    const { orgId, rao } = await org();
    await expect(fromLines.create(orgId, ACTOR, { customerId: rao, invoiceDate: '2026-11-04', lines, adjustment: { paise: 10000 } })).rejects.toThrow(/at most ₹99.99/);
    await expect(fromLines.create(orgId, ACTOR, { customerId: rao, invoiceDate: '2026-11-04', lines, adjustment: { paise: -10000 } })).rejects.toThrow(/at most ₹99.99/);
    // A draft saved some other way with a larger gap does not post.
    const bad = await invoicesSvc.create({ orgId, customerId: rao, invoiceDate: '2026-11-04', amountsPaise: { taxableValue: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0, total: 128000 } });
    await expect(invoicesSvc.post(String(bad._id), orgId, ACTOR)).rejects.toThrow(/an adjustment is at most/);
  });
});

describe('invoice numbers and terms', () => {
  it('keeps a typed number unique in its financial year, and the series skips it', async () => {
    const { orgId, rao } = await org();
    const typed = await fromLines.create(orgId, ACTOR, { customerId: rao, invoiceNumber: 'INV/2026-27/0001', invoiceDate: '2026-11-04', lines });
    await expect(fromLines.create(orgId, ACTOR, { customerId: rao, invoiceNumber: 'INV/2026-27/0001', invoiceDate: '2027-01-10', lines })).rejects.toThrow(/already used/);
    // Another year may use it again.
    await fromLines.create(orgId, ACTOR, { customerId: rao, invoiceNumber: 'INV/2026-27/0001', invoiceDate: '2027-04-02', lines });
    await expect(fromLines.create(orgId, ACTOR, { customerId: rao, invoiceNumber: 'INV 1?', invoiceDate: '2026-11-04', lines })).rejects.toThrow(/16 letters/);

    const auto = await fromLines.create(orgId, ACTOR, { customerId: rao, invoiceDate: '2026-11-05', lines });
    await invoicesSvc.post(String(typed._id), orgId, ACTOR);
    const posted = await invoicesSvc.post(String(auto._id), orgId, ACTOR);
    expect(posted.invoiceNumber).toBe('INV/2026-27/0002');

    // Two drafts typed alike some other way: the first to post keeps the number, the second is refused.
    const a = await invoicesSvc.create({ orgId, customerId: rao, invoiceNumber: 'X-9', invoiceDate: '2026-11-06', amountsPaise: { taxableValue: 1000, cgst: 90, sgst: 90, igst: 0, cess: 0, total: 1180 } });
    const b = await invoicesSvc.create({ orgId, customerId: rao, invoiceNumber: 'X-9', invoiceDate: '2026-11-07', amountsPaise: { taxableValue: 1000, cgst: 90, sgst: 90, igst: 0, cess: 0, total: 1180 } });
    await invoicesSvc.post(String(a._id), orgId, ACTOR);
    await expect(invoicesSvc.post(String(b._id), orgId, ACTOR)).rejects.toThrow(/X-9 is already used in 2026-27/);
    expect((await invoices.findById(b._id).lean().exec())!.status).toBe(InvoiceStatus.DRAFT);
  });

  it('dates the due date from the payment terms, and keeps the words', async () => {
    const { orgId, rao } = await org();
    const draft = await fromLines.create(orgId, ACTOR, {
      customerId: rao, invoiceDate: '2026-11-04', lines, paymentTermsDays: 30,
      referenceNumber: 'PO-77', subject: 'Office furniture', salespersonName: 'Asha', termsAndConditions: 'Goods once sold are not taken back.',
    });
    expect(draft.toObject()).toMatchObject({ dueDate: '2026-12-04', paymentTermsDays: 30, referenceNumber: 'PO-77', subject: 'Office furniture', salespersonName: 'Asha', termsAndConditions: 'Goods once sold are not taken back.' });
    const given = await fromLines.create(orgId, ACTOR, { customerId: rao, invoiceDate: '2026-11-04', dueDate: '2026-11-10', lines, paymentTermsDays: 30 });
    expect(given.dueDate).toBe('2026-11-10');
  });
});

describe('itemised credit notes', () => {
  async function postedInvoice(orgId: string, customerId: string) {
    const draft = await fromLines.create(orgId, ACTOR, { customerId, invoiceNumber: `S-${new Types.ObjectId().toString().slice(-6)}`, invoiceDate: '2026-10-10', lines });
    return invoicesSvc.post(String(draft._id), orgId, ACTOR);
  }

  it('balances, posts each line to its income account, and files under its invoice in GSTR-1', async () => {
    const { orgId, rao } = await org();
    const inv = await postedInvoice(orgId, rao);
    const chart = await accounts.list(orgId);
    const other = chart.find((a) => a.type === AccountType.INCOME && !a.isGroup && a.systemKey !== SystemAccountKey.SALES_REVENUE)!;

    const note = await notes.createItemised(orgId, ACTOR, {
      customerId: rao, invoiceId: String(inv._id), noteDate: '2026-11-03', reason: 'One chair returned',
      lines: [
        { description: 'Chair', hsnSac: '9401', qty: 1, ratePaise: 50000, taxRatePct: 18 },
        { description: 'Delivery refunded', qty: 1, ratePaise: 10000, taxRatePct: 18, accountId: String(other._id) },
      ],
      discount: { percent: 10 }, subject: 'Return of 1 chair', notes: 'Credited to your account.',
    });
    expect(note.noteNumber).toMatch(/^CRN\/2026-27\/\d{4}$/);
    expect(note.toObject()).toMatchObject({ kind: 'itemised', amountsPaise: { taxableValue: 54000, cgst: 4860, sgst: 4860, igst: 0, total: 63720 }, subject: 'Return of 1 chair' });

    const v = await voucher(orgId, note.journalId);
    expect(v.debit).toBe(v.credit);
    expect(v.on(SystemAccountKey.SALES_REVENUE)).toBe(45000);
    expect(v.lines.find((l) => String(l.accountId) === String(other._id))?.debitPaise).toBe(9000);
    expect(v.on(SystemAccountKey.GST_OUTPUT_CGST) + v.on(SystemAccountKey.GST_OUTPUT_SGST)).toBe(9720);
    expect(v.on(SystemAccountKey.ACCOUNTS_RECEIVABLE)).toBe(-63720);
    expect((await invoices.findById(inv._id).lean().exec())!.adjustedPaise).toBe(63720);

    const r = await gst.gstr1(orgId, '2026-11');
    expect(r.cdnr).toEqual([expect.objectContaining({ ctin: '27AAACR5055K1Z7', notes: [expect.objectContaining({ number: note.noteNumber, items: [{ rate: 18, txval: 54000, iamt: 0, camt: 4860, samt: 4860, csamt: 0 }] })] })]);
    // Split by its own lines: the chair's HSN comes back off table 12.
    expect(r.hsn.b2b.find((h) => h.hsn === '9401')?.txval).toBe(-45000);

    const [listed] = await notes.list(orgId, String(inv._id));
    expect(listed).toMatchObject({ kind: 'itemised', subject: 'Return of 1 chair', discount: { percent: 10, amountPaise: 6000 } });
    expect(listed.lines.map((l) => [l.description, l.accountName])).toEqual([['Chair', expect.any(String)], ['Delivery refunded', other.name]]);
  });

  it('turns what is beyond the amount still owed into the customer’s credit', async () => {
    const { orgId, rao } = await org();
    const inv = await postedInvoice(orgId, rao); // ₹1,770
    await invoicesSvc.markPaid(String(inv._id), orgId, ACTOR, '2026-10-20', 150000); // ₹270 still owed
    const note = await notes.createItemised(orgId, ACTOR, {
      customerId: rao, invoiceId: String(inv._id), noteDate: '2026-11-03', reason: 'Desk returned',
      lines: [{ description: 'Desk', qty: 1, ratePaise: 100000, taxRatePct: 18 }],
    });
    expect(note.amountsPaise.total).toBe(118000);
    const v = await voucher(orgId, note.journalId);
    expect(v.debit).toBe(v.credit);
    expect(v.on(SystemAccountKey.ACCOUNTS_RECEIVABLE)).toBe(-27000);
    expect(v.on(SystemAccountKey.CUSTOMER_ADVANCES)).toBe(-91000);
    const [credit] = await credits.find({ orgId, source: 'credit_note' }).lean().exec();
    expect(credit).toMatchObject({ unappliedPaise: 91000, reference: note.noteNumber });
    expect(String(credit.partyId)).toBe(rao);
    expect((await invoices.findById(inv._id).lean().exec())!.status).toBe(InvoiceStatus.PAID);
  });

  it('never takes back more than the invoice has left, off another customer’s invoice, or to a non-income account', async () => {
    const { orgId, rao, other } = await org();
    const inv = await postedInvoice(orgId, rao);
    const base = { customerId: rao, invoiceId: String(inv._id), noteDate: '2026-11-03', reason: 'Returned' };
    await expect(notes.createItemised(orgId, ACTOR, { ...base, lines: [{ description: 'Too much', qty: 2, ratePaise: 100000, taxRatePct: 18 }] })).rejects.toThrow(/Only ₹1,500.00 of taxable value is left/);
    // The invoice charged 18%; a line at 28% would take back more CGST than it holds once value runs low.
    await notes.createItemised(orgId, ACTOR, { ...base, lines: [{ description: 'Most of it', qty: 1, ratePaise: 140000, taxRatePct: 18 }] });
    await expect(notes.createItemised(orgId, ACTOR, { ...base, lines: [{ description: 'Rest at 28%', qty: 1, ratePaise: 10000, taxRatePct: 28 }] })).rejects.toThrow(/more than the ₹9.00 left/);
    await expect(notes.createItemised(orgId, ACTOR, { ...base, customerId: other, lines: [{ description: 'x', qty: 1, ratePaise: 100, taxRatePct: 18 }] })).rejects.toThrow(/another customer/);
    const bank = (await accounts.list(orgId)).find((a) => a.systemKey === SystemAccountKey.BANK)!;
    await expect(notes.createItemised(orgId, ACTOR, { ...base, lines: [{ description: 'x', qty: 1, ratePaise: 100, taxRatePct: 18, accountId: String(bank._id) }] })).rejects.toThrow(/not an income account/);
    await expect(notes.createItemised(orgId, ACTOR, { ...base, noteDate: '2026-10-01', lines: [{ description: 'x', qty: 1, ratePaise: 100, taxRatePct: 18 }] })).rejects.toThrow(/before the invoice/);
  });
});
