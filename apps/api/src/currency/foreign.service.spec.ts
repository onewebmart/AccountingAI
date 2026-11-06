/**
 * Tests — foreign-currency documents, against the books.
 *
 *  ✓ Rates: the latest on or before a date; entered again, replaced
 *  ✓ An export invoice in USD at the day's rate: INR lines and journal, no GST, LUT, the dollars kept beside
 *  ✓ Paid in part at a better rate (a gain) and the rest at a worse one (a loss): the receivable clears
 *    exactly, the bank gets what moved, and an INR payment route refuses it
 *  ✓ An import of services in USD under reverse charge: IGST on the rupee value, the vendor owed dollars only;
 *    paid at a dearer rate, a loss
 *  ✓ Month-end revaluation of what is open: a proposal that reverses on the 1st; no rate, no proposal
 *  ✓ Base currency adjustment: one currency at a date and rate, previewed without a write, proposed to Review
 *    with the rate saved as that day's; approved it posts, and reverses on the 1st; listed in Review, posted,
 *    reversed; the month-end revaluation leaves that currency out
 *  ✓ Refused: a later date, a locked period, a month revalued for every currency, a second one that month,
 *    nothing open, no note
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
import { ForeignService } from './foreign.service';
import { ExchangeRate, ExchangeRateSchema } from './schemas/exchange-rate.schema';
import { AdjustmentsService } from '../month-end/adjustments.service';
import { HSN_QUEUE, ItemsService } from '../items/items.service';
import { HSN_MODEL } from '../items/hsn-model';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { AiSuggestion, AiSuggestionSchema } from '../ai-suggestions/schemas/ai-suggestion.schema';
import { UsageMeterService } from '../ocr/usage-meter.service';
import { UsageMeter, UsageMeterSchema } from '../ocr/schemas/usage-meter.schema';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { CustomersService } from '../sales/customers.service';
import { SalesInvoice, SalesInvoiceSchema, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { VendorsService } from '../purchase/vendors.service';
import { PurchaseBill, PurchaseBillSchema, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { TdsDeposit, TdsDepositSchema } from '../tds/schemas/tds-deposit.schema';
import { PeriodLock, PeriodLockSchema } from '../gl/schemas/period-lock.schema';
import { ProposalsService } from '../proposals/proposals.service';
import { LearningService } from '../proposals/learning.service';
import { SubledgerSyncService } from '../proposals/subledger-sync.service';
import { BillChecksService } from '../proposals/checks/bill-checks.service';
import { ExpenseCategorizerService } from '../proposals/categorisation/expense-categorizer.service';
import { CATEGORY_MODEL } from '../proposals/categorisation/category-model';
import { VendorLedgerMap, VendorLedgerMapSchema } from '../proposals/schemas/vendor-ledger-map.schema';
import { ExtractedDocument, ExtractedDocumentSchema } from '../extraction/schemas/extracted-document.schema';
import { Document as UploadedDocument, DocumentSchema } from '../documents/schemas/document.schema';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ProposedEntryStatus } from '@ai-accounting/shared';

const ACTOR = new Types.ObjectId().toString();

let moduleRef: TestingModule;
let foreign: ForeignService;
let accounts: AccountsService;
let invoices: SalesInvoicesService;
let customers: CustomersService;
let bills: PurchaseBillsService;
let vendors: VendorsService;
let journals: Model<JournalDocument>;
let invoiceModel: Model<SalesInvoiceDocument>;
let billModel: Model<PurchaseBillDocument>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: ExchangeRate.name, schema: ExchangeRateSchema },
        { name: Item.name, schema: ItemSchema },
        { name: AiSuggestion.name, schema: AiSuggestionSchema },
        { name: UsageMeter.name, schema: UsageMeterSchema },
        { name: ProposedEntry.name, schema: ProposedEntrySchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
        { name: TdsDeposit.name, schema: TdsDepositSchema },
        { name: PeriodLock.name, schema: PeriodLockSchema },
        { name: VendorLedgerMap.name, schema: VendorLedgerMapSchema },
        { name: ExtractedDocument.name, schema: ExtractedDocumentSchema },
        { name: UploadedDocument.name, schema: DocumentSchema },
      ]),
    ],
    providers: [
      ForeignService, AdjustmentsService, ItemsService, UsageMeterService,
      // Review: a person approves the adjustment there.
      ProposalsService, LearningService, SubledgerSyncService, BillChecksService, ExpenseCategorizerService,
      { provide: CATEGORY_MODEL, useValue: { available: false, choose: jest.fn() } },
      { provide: REDIS_CLIENT, useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') } },
      { provide: getQueueToken(HSN_QUEUE), useValue: { add: jest.fn() } },
      { provide: HSN_MODEL, useValue: { available: false, ask: jest.fn() } },
      PostingService, AccountsService, AuditService, SalesInvoicesService, CustomersService, PurchaseBillsService, VendorsService,
    ],
  }).compile();
  foreign = moduleRef.get(ForeignService);
  accounts = moduleRef.get(AccountsService);
  invoices = moduleRef.get(SalesInvoicesService);
  customers = moduleRef.get(CustomersService);
  bills = moduleRef.get(PurchaseBillsService);
  vendors = moduleRef.get(VendorsService);
  journals = moduleRef.get(getModelToken(Journal.name));
  invoiceModel = moduleRef.get(getModelToken(SalesInvoice.name));
  billModel = moduleRef.get(getModelToken(PurchaseBill.name));
  await journals.init();
  await moduleRef.get<Model<unknown>>(getModelToken(ExchangeRate.name)).init();
  await moduleRef.get<Model<unknown>>(getModelToken(ProposedEntry.name)).init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

async function org() {
  const orgId = new Types.ObjectId().toString();
  await accounts.seedDefaults(orgId);
  const customer = await customers.create({ orgId, name: 'Acme Inc' });
  await moduleRef.get<Model<unknown>>(getModelToken(Customer.name)).updateOne({ _id: customer._id }, { $set: { currency: 'USD' } }).exec();
  return { orgId, customerId: String(customer._id) };
}

const byAccount = async (journalId: unknown) => {
  const j = (await journals.findById(journalId).lean().exec())!;
  return Object.fromEntries(j.lines.map((l) => [l.description, l.debitPaise - l.creditPaise]));
};

describe('rates', () => {
  it('takes the latest rate on or before a date, and a second entry replaces the first', async () => {
    const { orgId } = await org();
    await foreign.setRate(orgId, ACTOR, { currency: 'usd', date: '2026-10-01', rate: 83.1 });
    await foreign.setRate(orgId, ACTOR, { currency: 'USD', date: '2026-10-05', rate: 83.25 });
    expect(await foreign.rateOn(orgId, 'USD', '2026-10-04')).toEqual({ rate: 83.1, date: '2026-10-01' });
    expect(await foreign.rateOn(orgId, 'USD', '2026-10-31')).toEqual({ rate: 83.25, date: '2026-10-05' });
    await foreign.setRate(orgId, ACTOR, { currency: 'USD', date: '2026-10-05', rate: 83.3 });
    expect((await foreign.rates(orgId, 'USD')).map((r) => r.rate)).toEqual([83.3, 83.1]);
    await expect(foreign.setRate(orgId, ACTOR, { currency: 'XYZ', date: '2026-10-05', rate: 1 })).rejects.toThrow(/not a currency we keep/);
    await expect(foreign.rateOn(orgId, 'EUR', '2026-10-31')).resolves.toBeNull();
  });
});

describe('foreign documents and their payments', () => {
  it('books an export at the day’s rate and clears it exactly through a gain and a loss', async () => {
    const { orgId, customerId } = await org();
    await expect(foreign.createInvoice(orgId, ACTOR, { customerId, invoiceDate: '2026-10-05', lines: [{ description: 'Design', qty: 1, rateMinor: 100000 }] })).rejects.toThrow(/No USD rate on or before 2026-10-05/);
    await foreign.setRate(orgId, ACTOR, { currency: 'USD', date: '2026-10-05', rate: 83.25 });

    const draft = await foreign.createInvoice(orgId, ACTOR, {
      customerId, invoiceNumber: 'EXP/1', invoiceDate: '2026-10-05',
      lines: [{ description: 'Design', qty: 1, rateMinor: 70000 }, { description: 'Development', qty: 6, rateMinor: 5000 }],
      shippingBill: null,
    });
    // $700 + 6 × $50 = $1,000 at 83.25 = ₹83,250, no GST.
    expect(draft).toMatchObject({ exportType: 'lut', amountsPaise: { taxableValue: 83_25_000, igst: 0, total: 83_25_000 }, foreign: { currency: 'USD', rate: 83.25, totalMinor: 100000, paidMinor: 0, linesMinor: [70000, 30000] } });
    expect(draft.lineItems.map((l) => [l.amountPaise, l.ratePaise, l.taxRatePct])).toEqual([[58_27_500, 58_27_500, 0], [24_97_500, 4_16_250, 0]]);

    const posted = await invoices.post(String(draft._id), orgId, ACTOR);
    expect(await byAccount(posted.journalId)).toEqual({ 'Accounts Receivable': 83_25_000, 'Sales Revenue': -83_25_000 });
    await expect(invoices.markPaid(String(posted._id), orgId, ACTOR, '2026-10-20')).rejects.toThrow(/record its payment in USD/);

    // $600 at 84.00: ₹50,400 in, ₹49,950 off the receivable, ₹450 gained.
    const part = await foreign.settle(orgId, ACTOR, 'invoice', String(posted._id), { paidOn: '2026-10-20', amountMinor: 60000, rate: 84 });
    expect(part).toMatchObject({ bookedPaise: 49_95_000, movedPaise: 50_40_000, exchangePaise: 45_000, paidInFull: false });
    expect(await byAccount(part.journalId)).toEqual({ 'Bank Accounts': 50_40_000, 'Accounts Receivable': -49_95_000, 'Foreign Exchange Gain': -45_000 });

    // $400 at 82.50: ₹33,000 in against the ₹33,300 left, ₹300 lost; paid in full.
    const rest = await foreign.settle(orgId, ACTOR, 'invoice', String(posted._id), { paidOn: '2026-11-02', amountMinor: 40000, rate: 82.5 });
    expect(rest).toMatchObject({ bookedPaise: 33_30_000, movedPaise: 33_00_000, exchangePaise: -30_000, paidInFull: true });
    expect(await byAccount(rest.journalId)).toEqual({ 'Bank Accounts': 33_00_000, 'Accounts Receivable': -33_30_000, 'Foreign Exchange Loss': 30_000 });
    expect(await invoiceModel.findById(posted._id).lean().exec()).toMatchObject({ status: InvoiceStatus.PAID, amountPaidPaise: 83_25_000, foreign: { paidMinor: 100000 } });
    await expect(foreign.settle(orgId, ACTOR, 'invoice', String(posted._id), { paidOn: '2026-11-03', amountMinor: 1, rate: 84 })).rejects.toThrow(/Only a posted, unpaid invoice/);
  });

  it('books an import of services under reverse charge and pays it in dollars', async () => {
    const { orgId } = await org();
    const vendor = await vendors.create({ orgId, name: 'Cloud Host LLC' });
    const bill = await foreign.createBill(orgId, ACTOR, { vendorId: String(vendor._id), currency: 'USD', rate: 83, billNumber: 'CH-77', billDate: '2026-10-08', lines: [{ description: 'Hosting', qty: 1, rateMinor: 50000 }], reverseChargeIgstPct: 18 });
    // $500 at 83 = ₹41,500; IGST ₹7,470 ours to pay; the vendor is owed the $500 only.
    expect(bill).toMatchObject({ isReverseCharge: true, amountsPaise: { taxableValue: 41_50_000, igst: 7_47_000, total: 48_97_000 }, foreign: { totalMinor: 50000 } });
    const posted = await bills.post(String(bill._id), orgId, ACTOR);
    const paid = await foreign.settle(orgId, ACTOR, 'bill', String(posted._id), { paidOn: '2026-10-25', amountMinor: 50000, rate: 84 });
    expect(paid).toMatchObject({ bookedPaise: 41_50_000, movedPaise: 42_00_000, exchangePaise: -50_000, paidInFull: true });
    expect(await byAccount(paid.journalId)).toEqual({ 'Accounts Payable': 41_50_000, 'Bank Accounts': -42_00_000, 'Foreign Exchange Loss': 50_000 });
    expect((await billModel.findById(bill._id).lean().exec())!.status).toBe('paid');
  });
});

describe('month-end revaluation', () => {
  it('revalues what is open to the month-end rate, as a proposal that reverses on the 1st', async () => {
    const { orgId, customerId } = await org();
    const vendor = await vendors.create({ orgId, name: 'Cloud Host LLC' });
    const inv = await foreign.createInvoice(orgId, ACTOR, { customerId, currency: 'USD', rate: 83.25, invoiceNumber: 'EXP/9', invoiceDate: '2026-10-05', lines: [{ description: 'Design', qty: 1, rateMinor: 100000 }] });
    await invoices.post(String(inv._id), orgId, ACTOR);
    const bill = await foreign.createBill(orgId, ACTOR, { vendorId: String(vendor._id), currency: 'USD', rate: 83, billNumber: 'CH-1', billDate: '2026-10-08', lines: [{ description: 'Hosting', qty: 1, rateMinor: 20000 }] });
    await bills.post(String(bill._id), orgId, ACTOR);

    await expect(foreign.proposeRevaluation(orgId, ACTOR, '2026-10')).rejects.toThrow(/Enter the USD rate for 2026-10-31/);
    await foreign.setRate(orgId, ACTOR, { currency: 'USD', date: '2026-10-31', rate: 84 });
    const r = await foreign.revaluation(orgId, '2026-10');
    // Receivable $1,000: ₹83,250 → ₹84,000, up ₹750. Payable $200: ₹16,600 → ₹16,800, up ₹200.
    expect(r).toMatchObject({ receivablesPaise: 75_000, payablesPaise: 20_000, missingRates: [] });

    const p = await foreign.proposeRevaluation(orgId, ACTOR, '2026-10');
    expect(p).toMatchObject({ invoiceDate: '2026-10-31', adjustment: { kind: 'fx_revaluation', period: '2026-10', reverseOn: '2026-11-01' } });
    expect(p.suggestedLines.map((l) => [l.accountName, l.debitPaise, l.creditPaise]).sort()).toEqual([
      ['Accounts Payable', 0, 20_000],
      ['Accounts Receivable', 75_000, 0],
      ['Foreign Exchange Gain', 0, 75_000],
      ['Foreign Exchange Loss', 20_000, 0],
    ]);
    await expect(foreign.proposeRevaluation(orgId, ACTOR, '2026-10')).rejects.toThrow(/waiting in the review queue/);
  });
});

describe('base currency adjustments', () => {
  const proposalCount = (orgId: string) => moduleRef.get<Model<unknown>>(getModelToken(ProposedEntry.name)).countDocuments({ orgId });

  /** AED 10,000 owed to us at 22.50 (₹2,25,000) and AED 4,000 we owe at 22.60 (₹90,400), both October; and $1,000 at 83.25. */
  async function books() {
    const { orgId, customerId } = await org();
    const gulf = await customers.create({ orgId, name: 'Gulf Foods LLC' });
    const vendor = await vendors.create({ orgId, name: 'Dubai Freight FZE' });
    const inv = await foreign.createInvoice(orgId, ACTOR, { customerId: String(gulf._id), currency: 'AED', rate: 22.5, invoiceNumber: 'EXP/21', invoiceDate: '2026-10-03', lines: [{ description: 'Spices', qty: 1, rateMinor: 1_000_000 }] });
    await invoices.post(String(inv._id), orgId, ACTOR);
    const bill = await foreign.createBill(orgId, ACTOR, { vendorId: String(vendor._id), currency: 'AED', rate: 22.6, billNumber: 'DF-9', billDate: '2026-10-08', lines: [{ description: 'Freight', qty: 1, rateMinor: 400_000 }] });
    await bills.post(String(bill._id), orgId, ACTOR);
    const usd = await foreign.createInvoice(orgId, ACTOR, { customerId, currency: 'USD', rate: 83.25, invoiceNumber: 'EXP/22', invoiceDate: '2026-10-05', lines: [{ description: 'Design', qty: 1, rateMinor: 100_000 }] });
    await invoices.post(String(usd._id), orgId, ACTOR);
    return { orgId, invoiceId: String(inv._id), billId: String(bill._id) };
  }

  it('previews one currency without a write, proposes it with the rate saved, posts on approval and reverses on the 1st', async () => {
    const { orgId, invoiceId, billId } = await books();

    // 1 AED = ₹25.58 on 20 October. Receivable: ₹2,25,000 → ₹2,55,800, up ₹30,800, a gain.
    // Payable: ₹90,400 → ₹1,02,320, up ₹11,920, a loss. Net, an unrealised gain of ₹18,880.
    const preview = await foreign.adjustmentPreview(orgId, { currency: 'aed', date: '2026-10-20', rate: 25.58 });
    expect(preview).toMatchObject({ currency: 'AED', date: '2026-10-20', rate: 25.58, period: '2026-10', reverseOn: '2026-11-01', receivablesPaise: 30_800_00, payablesPaise: 11_920_00, gainPaise: 18_880_00, blocked: null });
    expect(preview.rows.map((r) => [r.kind, r.id, r.party, r.openMinor, r.bookedRate, r.bookedPaise, r.revaluedPaise, r.gainPaise])).toEqual([
      ['invoice', invoiceId, 'Gulf Foods LLC', 1_000_000, 22.5, 2_25_000_00, 2_55_800_00, 30_800_00],
      ['bill', billId, 'Dubai Freight FZE', 400_000, 22.6, 90_400_00, 1_02_320_00, -11_920_00],
    ]);
    // A preview writes nothing: no proposal, no rate.
    expect(await proposalCount(orgId)).toBe(0);
    expect(await foreign.rateOn(orgId, 'AED', '2026-10-31')).toBeNull();

    const made = await foreign.proposeAdjustment(orgId, ACTOR, { currency: 'AED', date: '2026-10-20', rate: 25.58, notes: 'Dirham firmed after the RBI move' });
    expect(made).toMatchObject({ currency: 'AED', date: '2026-10-20', rate: 25.58, gainPaise: 18_880_00, documents: 2, reverseOn: '2026-11-01' });
    expect(await foreign.rateOn(orgId, 'AED', '2026-10-20')).toEqual({ rate: 25.58, date: '2026-10-20' });
    expect((await foreign.rates(orgId, 'AED'))[0]).toMatchObject({ source: 'Base currency adjustment' });

    const proposals = moduleRef.get(ProposalsService);
    const p = (await moduleRef.get<Model<{ _id: unknown; status: string; invoiceDate: string; adjustment: Record<string, unknown>; suggestedLines: Array<{ accountName: string; debitPaise: number; creditPaise: number }> }>>(getModelToken(ProposedEntry.name)).findById(made.proposalId).lean().exec())!;
    // The month-end revaluation's own path: an unrealised fx_revaluation, reversing on the 1st, waiting for a person.
    expect(p).toMatchObject({ status: ProposedEntryStatus.PROPOSED, invoiceDate: '2026-10-20', adjustment: { kind: 'fx_revaluation', refId: 'fx:AED', period: '2026-10', reverseOn: '2026-11-01', fx: { currency: 'AED', rate: 25.58, gainPaise: 18_880_00, notes: 'Dirham firmed after the RBI move' } } });
    expect(String(p.adjustment.reason)).toMatch(/^Dirham firmed after the RBI move\. 2 open AED documents at 1 AED = ₹25\.58/);
    expect(p.suggestedLines.map((l) => [l.accountName, l.debitPaise, l.creditPaise]).sort()).toEqual([
      ['Accounts Payable', 0, 11_920_00],
      ['Accounts Receivable', 30_800_00, 0],
      ['Foreign Exchange Gain', 0, 30_800_00],
      ['Foreign Exchange Loss', 11_920_00, 0],
    ]);
    expect(await journals.countDocuments({ orgId, date: '2026-10-20' })).toBe(0);
    expect(await foreign.adjustmentsList(orgId)).toEqual([expect.objectContaining({ proposalId: made.proposalId, kind: 'currency', date: '2026-10-20', currency: 'AED', rate: 25.58, gainPaise: 18_880_00, status: 'in_review', journalId: null })]);

    // A second AED adjustment in October would count the difference twice.
    await expect(foreign.proposeAdjustment(orgId, ACTOR, { currency: 'AED', date: '2026-10-31', rate: 26, notes: 'Month end' })).rejects.toThrow(/AED already has an adjustment for October 2026, dated 2026-10-20 \(waiting in Review\)/);
    // The month-end revaluation of October leaves AED out and revalues the rest.
    await foreign.setRate(orgId, ACTOR, { currency: 'USD', date: '2026-10-31', rate: 84 });
    const monthEnd = await foreign.revaluation(orgId, '2026-10');
    expect(monthEnd.adjustedCurrencies).toEqual(['AED']);
    expect(monthEnd.rows.map((r) => r.currency)).toEqual(['USD']);
    expect(monthEnd).toMatchObject({ receivablesPaise: 750_00, payablesPaise: 0, inReview: false, approved: 0 });

    await proposals.approve({ proposalId: made.proposalId, orgId, actorId: ACTOR });
    const [posted] = await foreign.adjustmentsList(orgId, { currency: 'AED' });
    expect(posted).toMatchObject({ status: 'posted', date: '2026-10-20' });
    const journal = (await journals.findById(posted.journalId).lean().exec())!;
    expect(journal.date).toBe('2026-10-20');
    // The documents stay at their booked rate; only the balance sheet moves until the 1st.
    expect((await invoiceModel.findById(invoiceId).lean().exec())!.amountsPaise.total).toBe(2_25_000_00);

    expect(await moduleRef.get(AdjustmentsService).reverseDueAccruals(orgId, '2026-11-01')).toBe(1);
    const [reversed] = await foreign.adjustmentsList(orgId, { from: '2026-10-01', to: '2026-10-31' });
    expect(reversed).toMatchObject({ status: 'reversed' });
    const reversal = (await journals.findById(reversed.reversalJournalId).lean().exec())!;
    expect(reversal).toMatchObject({ date: '2026-11-01', reversalOf: journal._id });
    expect(await foreign.adjustmentsList(orgId, { from: '2026-11-01' })).toEqual([]);
  });

  it('refuses a later date, a locked period, a month revalued for every currency, nothing open and no note', async () => {
    const { orgId } = await books();
    await expect(foreign.adjustmentPreview(orgId, { currency: 'AED', date: '2099-01-31', rate: 25 })).rejects.toThrow(/today or earlier/);
    await expect(foreign.adjustmentPreview(orgId, { currency: 'XYZ', date: '2026-10-20', rate: 25 })).rejects.toThrow(/not a currency we keep/);
    await expect(foreign.proposeAdjustment(orgId, ACTOR, { currency: 'AED', date: '2026-10-20', rate: 25, notes: '  ' })).rejects.toThrow(/Add a note/);
    // Nothing open in euros, or in dirhams before the documents' dates.
    await expect(foreign.proposeAdjustment(orgId, ACTOR, { currency: 'EUR', date: '2026-10-20', rate: 90, notes: 'Check' })).rejects.toThrow(/Nothing is open in EUR/);
    // Before the documents were dated, nothing was open.
    await expect(foreign.proposeAdjustment(orgId, ACTOR, { currency: 'AED', date: '2026-10-01', rate: 25, notes: 'Early' })).rejects.toThrow(/Nothing is open in AED on 2026-10-01/);

    // October revalued at month-end, for every currency: no AED adjustment in October.
    await foreign.setRate(orgId, ACTOR, { currency: 'USD', date: '2026-10-31', rate: 84 });
    await foreign.setRate(orgId, ACTOR, { currency: 'AED', date: '2026-10-31', rate: 23 });
    await foreign.proposeRevaluation(orgId, ACTOR, '2026-10');
    const blocked = await foreign.adjustmentPreview(orgId, { currency: 'AED', date: '2026-10-25', rate: 24 });
    expect(blocked.blocked).toMatch(/October 2026 is already revalued at month-end for every currency/);
    await expect(foreign.proposeAdjustment(orgId, ACTOR, { currency: 'AED', date: '2026-10-25', rate: 24, notes: 'Mid month' })).rejects.toThrow(/already revalued at month-end/);
    // A locked period: the adjustment is dated after the lock.
    await moduleRef.get<Model<unknown>>(getModelToken(PeriodLock.name)).create({ orgId, lockedThrough: '2026-10-31', history: [] });
    expect((await foreign.adjustmentPreview(orgId, { currency: 'AED', date: '2026-10-31', rate: 24 })).blocked).toMatch(/locked through 2026-10-31/);
    // The refusals saved no rate; November is open.
    expect(await foreign.rateOn(orgId, 'AED', '2026-10-25')).toBeNull();
    const nov = await foreign.adjustmentPreview(orgId, { currency: 'AED', date: '2026-11-02', rate: 24 });
    expect(nov.blocked).toBeNull();
  });
});
