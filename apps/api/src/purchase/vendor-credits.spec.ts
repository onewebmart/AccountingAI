/**
 * Integration tests — vendor credits typed line by line (itemised debit notes).
 *
 *  ✓ A vendor credit against a posted bill is taxed as the bill was, posts one balanced DEBIT_NOTE voucher off each
 *    line's account, numbered in the series, and GSTR-3B's input credit drops by its tax
 *  ✓ It takes back no more value, nor any head of tax, than the bill has left; another vendor's bill, a control
 *    account or a bill not posted is refused
 *  ✓ TDS taken on the bill comes back in proportion; under reverse charge the liability falls away instead of payables
 *  ✓ Beyond what the bill still owes, it becomes the vendor's credit; the value-only note still works
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { DebitNotesService } from './debit-notes.service';
import { BillsFromLinesService } from './bills-from-lines.service';
import { PurchaseBillsService } from './purchase-bills.service';
import { PurchaseBill, PurchaseBillDocument, PurchaseBillSchema } from './schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from './schemas/vendor.schema';
import { DebitNote, DebitNoteSchema } from './schemas/debit-note.schema';
import { PartyPaymentsService } from '../payments/party-payments.service';
import { PartyPayment, PartyPaymentSchema } from '../payments/schemas/party-payment.schema';
import { ItemsService, HSN_QUEUE } from '../items/items.service';
import { HSN_MODEL } from '../items/hsn-model';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { AiSuggestion, AiSuggestionSchema } from '../ai-suggestions/schemas/ai-suggestion.schema';
import { UsageMeterService } from '../ocr/usage-meter.service';
import { UsageMeter, UsageMeterSchema } from '../ocr/schemas/usage-meter.schema';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { Journal, JournalDocument, JournalSchema } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { Gstr2bLine, Gstr2bLineSchema } from '../gst/schemas/gstr2b-line.schema';
import { DirectExpense, DirectExpenseSchema } from '../direct-expenses/schemas/direct-expense.schema';
import { ExpenseClaim, ExpenseClaimSchema } from '../expenses/schemas/expense-claim.schema';
import { GstReturnsService } from '../gst/gst-returns.service';

const ACTOR = new Types.ObjectId().toString();
let moduleRef: TestingModule;
let notes: DebitNotesService;
let fromLines: BillsFromLinesService;
let bills: PurchaseBillsService;
let accounts: AccountsService;
let returns: GstReturnsService;
let vendors: Model<{ _id: Types.ObjectId }>;
let settings: Model<unknown>;
let journals: Model<JournalDocument>;
let billModel: Model<PurchaseBillDocument>;
let partyPayments: Model<{ kind: string; unappliedPaise: number }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: DebitNote.name, schema: DebitNoteSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: PartyPayment.name, schema: PartyPaymentSchema },
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
        { name: OrgSettings.name, schema: OrgSettingsSchema },
        { name: Project.name, schema: ProjectSchema },
        { name: Gstr2bLine.name, schema: Gstr2bLineSchema },
        { name: DirectExpense.name, schema: DirectExpenseSchema },
        { name: ExpenseClaim.name, schema: ExpenseClaimSchema },
      ]),
    ],
    providers: [
      DebitNotesService, BillsFromLinesService, PurchaseBillsService, PartyPaymentsService, GstReturnsService, ItemsService, UsageMeterService, PostingService, AccountsService, AuditService,
      { provide: getQueueToken(HSN_QUEUE), useValue: { add: jest.fn() } },
      { provide: HSN_MODEL, useValue: { available: false, ask: jest.fn() } },
    ],
  }).compile();
  notes = moduleRef.get(DebitNotesService);
  fromLines = moduleRef.get(BillsFromLinesService);
  bills = moduleRef.get(PurchaseBillsService);
  accounts = moduleRef.get(AccountsService);
  returns = moduleRef.get(GstReturnsService);
  vendors = moduleRef.get(getModelToken(Vendor.name));
  settings = moduleRef.get(getModelToken(OrgSettings.name));
  journals = moduleRef.get(getModelToken(Journal.name));
  billModel = moduleRef.get(getModelToken(PurchaseBill.name));
  partyPayments = moduleRef.get(getModelToken(PartyPayment.name));
  await journals.init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

async function org() {
  const orgId = new Types.ObjectId().toString();
  await settings.create({ orgId, gstin: '27AAPFU0939F1ZV', stateCode: '27', displayName: 'Kumar Stationers' });
  await accounts.seedDefaults(orgId);
  const all = await accounts.list(orgId);
  const id = (name: string) => String(all.find((a) => a.name === name)!._id);
  const [sigma, kaveri] = await vendors.create([
    { orgId, name: 'Sigma Supplies', gstin: '27AAACS1234A1Z1' },
    { orgId, name: 'Kaveri Contractors', gstin: '27AAACK1234A1Z2', tdsSection: '194C', tdsRateBps: 100 },
  ]);
  return { orgId, id, sigmaId: String(sigma._id), kaveriId: String(kaveri._id) };
}

/** The voucher's lines as [account, debit, credit], and whether it balances. */
async function voucher(journalId: unknown) {
  const j = (await journals.findById(journalId).lean().exec())!;
  const debit = j.lines.reduce((s, l) => s + l.debitPaise, 0);
  const credit = j.lines.reduce((s, l) => s + l.creditPaise, 0);
  return { journal: j, balanced: debit === credit && debit > 0, lines: j.lines.map((l) => [l.description, l.debitPaise, l.creditPaise]) };
}

const brochures = { description: 'Printed brochures', qty: 10, ratePaise: 25000, taxRatePct: 12 };
const toner = { description: 'Toner cartridge', qty: 2, ratePaise: 300000, taxRatePct: 18 };

describe('vendor credits by lines', () => {
  it('is taxed as its bill was, posts balanced off each line’s account, and lowers GSTR-3B input credit by its tax', async () => {
    const { orgId, id, sigmaId } = await org();
    const advertising = id('Advertising & Marketing');
    const bill = await fromLines.create(orgId, ACTOR, { vendorId: sigmaId, billNumber: 'SG/41', billDate: '2026-11-03', lines: [{ ...brochures, discount: { percent: 10 }, accountId: advertising }, toner] });
    await bills.post(String(bill._id), orgId, ACTOR);
    expect(bill.amountsPaise).toMatchObject({ taxableValue: 825000, cgst: 67500, sgst: 67500, total: 960000 });

    const note = await notes.createItemised(orgId, ACTOR, {
      vendorId: sigmaId, billId: String(bill._id), noteDate: '2026-11-10', vendorCreditNumber: 'CN-14', orderNumber: 'PO/2026-27/0003', subject: 'Returned: one toner, two brochures', notes: 'Collected by their van',
      lines: [
        { ...toner, qty: 1 },
        { ...brochures, qty: 2, discount: { percent: 10 }, accountId: advertising },
      ],
      adjustment: { label: 'Round off', paise: -40 },
    });
    // Toner 3,000 at 18% = 540; brochures 500 less 10% = 450 at 12% = 54. Less 0.40.
    expect(note.toObject()).toMatchObject({
      noteNumber: 'DBN/2026-27/0001', kind: 'itemised', reason: 'Returned: one toner, two brochures', vendorCreditNumber: 'CN-14', orderNumber: 'PO/2026-27/0003',
      amountsPaise: { taxableValue: 345000, cgst: 29700, sgst: 29700, igst: 0, total: 404400 - 40 }, discountLevel: 'line', adjustment: { label: 'Round off', paise: -40 },
    });
    const v = await voucher(note.journalId);
    expect(v.balanced).toBe(true);
    expect(v.journal.voucherType).toBe('DEBIT_NOTE');
    expect(v.lines).toEqual([
      ['Purchases', 0, 300000],
      ['Advertising & Marketing', 0, 45000],
      ['Input CGST', 0, 29700],
      ['Input SGST', 0, 29700],
      ['Accounts Payable', 404360, 0],
      ['Round Off', 40, 0],
    ]);
    expect((await billModel.findById(bill._id).lean().exec())!.adjustedPaise).toBe(404360);

    const r = await returns.gstr3b(orgId, '2026-11');
    expect(r.itcNet).toMatchObject({ camt: 67500 - 29700, samt: 67500 - 29700 });

    const [listed] = await notes.list(orgId, String(bill._id));
    expect(listed).toMatchObject({ kind: 'itemised', vendorCreditNumber: 'CN-14', subject: 'Returned: one toner, two brochures', notes: 'Collected by their van', vendorName: 'Sigma Supplies' });
    expect(listed.lines.map((l) => [l.accountName, l.amountPaise, l.discountPaise])).toEqual([['Purchases', 300000, 0], ['Advertising & Marketing', 50000, 5000]]);
  });

  it('takes back no more value or tax than the bill has left, and only from a posted bill of that vendor', async () => {
    const { orgId, id, sigmaId, kaveriId } = await org();
    const bill = await fromLines.create(orgId, ACTOR, { vendorId: sigmaId, billDate: '2026-11-03', lines: [{ ...brochures, discount: { percent: 10 } }, toner] });
    const base = { vendorId: sigmaId, billId: String(bill._id), noteDate: '2026-11-10' };
    await expect(notes.createItemised(orgId, ACTOR, { ...base, lines: [toner] })).rejects.toThrow(/Only a posted bill/);
    await bills.post(String(bill._id), orgId, ACTOR);

    await notes.createItemised(orgId, ACTOR, { ...base, lines: [{ ...toner, qty: 1 }] });
    // 8,250 taxable on the bill, 3,000 back: 5,250 left; 4,050 of CGST less 2,700.
    await expect(notes.createItemised(orgId, ACTOR, { ...base, lines: [toner] })).rejects.toThrow(/Only ₹5,250.00 of taxable value is left to take back on bill/);
    await expect(notes.createItemised(orgId, ACTOR, { ...base, lines: [{ ...toner, qty: 1, ratePaise: 250000, taxRatePct: 40 }] })).rejects.toThrow(/takes back ₹500.00 of CGST, more than the ₹405.00 left on bill/);
    await expect(notes.createItemised(orgId, ACTOR, { ...base, vendorId: kaveriId, lines: [{ ...toner, qty: 1 }] })).rejects.toThrow(/another vendor’s/);
    await expect(notes.createItemised(orgId, ACTOR, { ...base, lines: [{ ...toner, qty: 1, accountId: id('Accounts Payable') }] })).rejects.toThrow(/Line 1: a vendor credit cannot come back off Accounts Payable/);
    await expect(notes.createItemised(orgId, ACTOR, { ...base, noteDate: '2026-11-01', lines: [{ ...toner, qty: 1 }] })).rejects.toThrow(/cannot be dated before the bill/);
  });

  it('gives back TDS in proportion, and under reverse charge drops the liability instead of payables', async () => {
    const { orgId, sigmaId, kaveriId } = await org();
    const work = { description: 'Civil work', qty: 1, ratePaise: 100000, taxRatePct: 18 };
    const tdsBill = await fromLines.create(orgId, ACTOR, { vendorId: kaveriId, billDate: '2026-11-03', lines: [work] });
    await bills.post(String(tdsBill._id), orgId, ACTOR);
    const tdsNote = await notes.createItemised(orgId, ACTOR, { vendorId: kaveriId, billId: String(tdsBill._id), noteDate: '2026-11-08', lines: [{ ...work, ratePaise: 50000 }] });
    const t = await voucher(tdsNote.journalId);
    expect(t.balanced).toBe(true);
    expect(t.lines).toEqual([['Purchases', 0, 50000], ['Input CGST', 0, 4500], ['Input SGST', 0, 4500], ['Accounts Payable', 58500, 0], ['TDS Payable', 500, 0]]);
    expect((await billModel.findById(tdsBill._id).lean().exec())!.tds!.amountPaise).toBe(500);

    const rcBill = await fromLines.create(orgId, ACTOR, { vendorId: sigmaId, billDate: '2026-11-03', lines: [work], isReverseCharge: true });
    await bills.post(String(rcBill._id), orgId, ACTOR);
    const rcNote = await notes.createItemised(orgId, ACTOR, { vendorId: sigmaId, billId: String(rcBill._id), noteDate: '2026-11-08', lines: [{ ...work, ratePaise: 20000 }] });
    const rc = await voucher(rcNote.journalId);
    expect(rc.balanced).toBe(true);
    expect(rc.lines).toEqual([['Purchases', 0, 20000], ['Input CGST', 0, 1800], ['Input SGST', 0, 1800], ['Accounts Payable', 20000, 0], ['GST Payable (Reverse Charge)', 3600, 0]]);
  });

  it('turns what the bill no longer owes into the vendor’s credit; the note by value still works', async () => {
    const { orgId, sigmaId } = await org();
    const bill = await fromLines.create(orgId, ACTOR, { vendorId: sigmaId, billDate: '2026-11-03', lines: [toner] });
    await bills.post(String(bill._id), orgId, ACTOR);
    await bills.markPaid(String(bill._id), orgId, ACTOR, '2026-11-05', 500000);
    // 7,080 billed, 5,000 paid: 2,080 owed. A credit of 3,540 takes the 2,080 off the bill; 1,460 is theirs to give back.
    const note = await notes.createItemised(orgId, ACTOR, { vendorId: sigmaId, billId: String(bill._id), noteDate: '2026-11-09', lines: [{ ...toner, qty: 1 }] });
    const v = await voucher(note.journalId);
    expect(v.balanced).toBe(true);
    expect(v.lines).toEqual([['Purchases', 0, 300000], ['Input CGST', 0, 27000], ['Input SGST', 0, 27000], ['Accounts Payable', 208000, 0], ['Advances to Vendors', 146000, 0]]);
    const after = (await billModel.findById(bill._id).lean().exec())!;
    expect(after.status).toBe('paid');
    const credits = await partyPayments.find({ orgId, kind: 'payment' }).lean().exec();
    expect(credits.map((c) => c.unappliedPaise)).toContain(146000);

    // By value, as before: tax in the bill's proportions, off the account it was booked to.
    const other = await fromLines.create(orgId, ACTOR, { vendorId: sigmaId, billDate: '2026-11-03', lines: [toner] });
    await bills.post(String(other._id), orgId, ACTOR);
    const byValue = await notes.create(String(other._id), orgId, ACTOR, { noteDate: '2026-11-09', reason: 'Short supply', taxableValuePaise: 100000 });
    expect(byValue.toObject()).toMatchObject({ kind: 'value', amountsPaise: { taxableValue: 100000, cgst: 9000, sgst: 9000, total: 118000 } });
    expect((await voucher(byValue.journalId)).lines).toEqual([['Purchases', 0, 100000], ['Input CGST', 0, 9000], ['Input SGST', 0, 9000], ['Accounts Payable', 118000, 0]]);
  });
});
