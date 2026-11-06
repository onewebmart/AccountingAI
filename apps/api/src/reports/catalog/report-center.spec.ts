/**
 * Tests — the Reports Center's reports and custom reports, against the books.
 *
 *  ✓ Schedule III P&L and balance sheet: heads, MSME dues apart, ties out; horizontal P&L and BS agree side to side
 *  ✓ Cash flow statement (indirect) ends at the bank balance; opening-balance imports count as the start
 *  ✓ Ratios and movement of equity from the same books
 *  ✓ Sales by salesperson, AR ageing and customer balances as at a past date, payments received without double counting, time to get paid
 *  ✓ MSME 43B(h) dues; general ledger and account type summary; GSTR-1 summary read through the GST service; activity log
 *  ✓ Custom reports: from an existing report (columns, conditions, sort) and from a module (group totals);
 *    private until shared; only the creator changes it; audited; favourites per person; a custom report can be scheduled
 *  ✓ The query layer refuses fields, operators and values it does not list, and never reads another org
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { AccountType, VoucherType } from '@ai-accounting/shared';
import configuration from '../../config/configuration';
import { testMongoUri } from '../../test-utils/mongo';
import { PostingService } from '../../gl/posting.service';
import { AccountsService } from '../../gl/accounts.service';
import { AuditService } from '../../gl/audit.service';
import { Journal, JournalSchema, JournalDocument } from '../../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../../gl/schemas/ledger-account.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../../sales/schemas/customer.schema';
import { CreditNote, CreditNoteSchema } from '../../sales/schemas/credit-note.schema';
import { PurchaseBill, PurchaseBillSchema } from '../../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../../purchase/schemas/vendor.schema';
import { DebitNote, DebitNoteSchema } from '../../purchase/schemas/debit-note.schema';
import { Item, ItemSchema } from '../../items/schemas/item.schema';
import { OrgSettings, OrgSettingsSchema } from '../../org-settings/schemas/org-settings.schema';
import { PartyPayment, PartyPaymentSchema } from '../../payments/schemas/party-payment.schema';
import { DirectExpense, DirectExpenseSchema } from '../../direct-expenses/schemas/direct-expense.schema';
import { Gstr2bLine, Gstr2bLineSchema } from '../../gst/schemas/gstr2b-line.schema';
import { ImportBatch, ImportBatchSchema } from '../../migration/schemas/import-batch.schema';
import { User, UserSchema } from '../../tenancy/schemas/user.schema';
import { GstReturnsService } from '../../gst/gst-returns.service';
import { MailerService } from '../../mail/mailer.service';
import { ReportsService } from '../reports.service';
import { ManagementReportsService } from '../management.service';
import { ReportCatalogService } from '../report-catalog.service';
import { ReportSchedulesService } from '../report-schedules.service';
import { Budget, BudgetSchema } from '../schemas/budget.schema';
import { ReportSchedule, ReportScheduleSchema } from '../schemas/report-schedule.schema';
import { CustomReport, CustomReportSchema } from '../schemas/custom-report.schema';
import { ReportPreference, ReportPreferenceSchema } from '../schemas/report-preference.schema';
import { ReportDataService } from './report-data.service';
import { ReportCenterService, customKey } from './center.service';
import { checkModuleSpec } from './modules';
import { customize } from './customize';
import { bsHead, isCostOfSales, plHead } from './schedule-iii';
import { timeToGetPaid } from './payments';
import { msmeStanding } from './payables';
import type { ReportTable } from '../report-table';

const USER_A = new Types.ObjectId().toString();
const USER_B = new Types.ObjectId().toString();
const mailer = { configured: true, send: jest.fn(async (_mail: unknown) => ({ messageId: 'm1' })) };

let moduleRef: TestingModule;
let posting: PostingService;
let accounts: AccountsService;
let catalog: ReportCatalogService;
let center: ReportCenterService;
let schedules: ReportSchedulesService;
let gstReturns: GstReturnsService;
const model = <T = Record<string, unknown>>(name: string) => moduleRef.get<Model<T>>(getModelToken(name));

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: CreditNote.name, schema: CreditNoteSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: DebitNote.name, schema: DebitNoteSchema },
        { name: Item.name, schema: ItemSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
        { name: Budget.name, schema: BudgetSchema },
        { name: ReportSchedule.name, schema: ReportScheduleSchema },
        { name: CustomReport.name, schema: CustomReportSchema },
        { name: ReportPreference.name, schema: ReportPreferenceSchema },
        { name: PartyPayment.name, schema: PartyPaymentSchema },
        { name: DirectExpense.name, schema: DirectExpenseSchema },
        { name: Gstr2bLine.name, schema: Gstr2bLineSchema },
        { name: ImportBatch.name, schema: ImportBatchSchema },
        { name: User.name, schema: UserSchema },
      ]),
    ],
    providers: [
      PostingService, AccountsService, AuditService, ReportsService, ManagementReportsService, ReportCatalogService, ReportSchedulesService,
      ReportDataService, ReportCenterService, GstReturnsService,
      { provide: MailerService, useValue: mailer },
    ],
  }).compile();
  posting = moduleRef.get(PostingService);
  accounts = moduleRef.get(AccountsService);
  catalog = moduleRef.get(ReportCatalogService);
  center = moduleRef.get(ReportCenterService);
  schedules = moduleRef.get(ReportSchedulesService);
  gstReturns = moduleRef.get(GstReturnsService);
  await model<JournalDocument>(Journal.name).init();
  await model(ReportPreference.name).init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

const fyOf = (date: string) => (Number(date.slice(5, 7)) >= 4 ? `${date.slice(0, 4)}-${String((Number(date.slice(0, 4)) + 1) % 100).padStart(2, '0')}` : `${Number(date.slice(0, 4)) - 1}-${date.slice(2, 4)}`);

async function org() {
  const orgId = new Types.ObjectId().toString();
  await accounts.seedDefaults(orgId);
  await model(OrgSettings.name).create({ orgId, displayName: 'Saffron Foods', gstin: '27AAPFU0939F1ZV', stateCode: '27' });
  const id = async (name: string) => String((await accounts.list(orgId)).find((a) => a.name === name)!._id);
  const journal = (date: string, dr: string, cr: string, rupees: number) =>
    posting.post({ orgId, voucherType: VoucherType.JOURNAL, financialYear: fyOf(date), date, narration: 'test', postedBy: USER_A, lines: [{ accountId: dr, debitPaise: rupees * 100, creditPaise: 0 }, { accountId: cr, debitPaise: 0, creditPaise: rupees * 100 }] });
  return { orgId, id, journal };
}

const run = (orgId: string, key: string, p: Record<string, string> = {}, viewer?: string) => catalog.run(orgId, key, p, viewer);
const line = (t: ReportTable, label: string) => t.rows.find((r) => r.cells[0] === label)?.cells;
const R = (rupees: number) => rupees * 100;

describe('business overview from the books', () => {
  it('lays out Schedule III, the horizontal statements, the cash flow, ratios and equity, all tying out', async () => {
    const { orgId, id, journal } = await org();
    const [bank, capital, computers, accDep, ar, sales, purchases, ap, salaries, depreciation] = await Promise.all(
      ['Bank Accounts', "Owner's Capital", 'Computers & IT Equipment', 'Accumulated Depreciation', 'Accounts Receivable', 'Sales Revenue', 'Purchases', 'Accounts Payable', 'Salaries & Wages', 'Depreciation'].map(id),
    );
    const ledger = model(LedgerAccount.name);
    const loan = String((await ledger.create({ orgId, name: 'Term Loan from HDFC', code: '2500', type: AccountType.LIABILITIES, parentId: null, isGroup: false }))._id);
    const interest = String((await ledger.create({ orgId, name: 'Interest on Loan', code: '6500', type: AccountType.EXPENSE, parentId: null, isGroup: false }))._id);
    const opening = await journal('2026-04-01', bank, capital, 5_00_000);
    await journal('2026-04-10', computers, bank, 1_20_000);
    await journal('2026-05-05', ar, sales, 3_00_000);
    await journal('2026-05-20', purchases, ap, 1_00_000);
    await journal('2026-06-01', salaries, bank, 50_000);
    await journal('2026-06-10', bank, ar, 2_00_000);
    await journal('2026-06-15', bank, loan, 1_00_000);
    await journal('2026-06-25', interest, bank, 5_000);
    await journal('2026-06-28', capital, bank, 20_000);
    await journal('2026-06-30', depreciation, accDep, 10_000);
    // A micro enterprise's bill, unpaid: ₹60,000 of the ₹1,00,000 payable is MSME dues.
    const vendor = await model(Vendor.name).create({ orgId, name: 'Kiran Packaging', msme: { udyamNumber: 'UDYAM-MH-26-0012345', category: 'micro', activity: 'manufacturing', writtenAgreement: false } });
    await model(PurchaseBill.name).create({ orgId, vendorId: vendor._id, billNumber: 'KP/77', billDate: '2026-05-20', dueDate: '2026-06-19', status: 'posted', amountsPaise: { taxableValue: R(60_000), cgst: 0, sgst: 0, igst: 0, cess: 0, total: R(60_000) } });

    const range = { from: '2026-04', to: '2026-06' };
    const pl = await run(orgId, 'pl_schedule_iii', range);
    expect(line(pl, 'I. Revenue from operations')).toEqual(['I. Revenue from operations', R(3_00_000), 0]);
    expect(line(pl, 'Purchases of stock-in-trade')?.[1]).toBe(R(1_00_000));
    expect(line(pl, 'Employee benefits expense')?.[1]).toBe(R(50_000));
    expect(line(pl, 'Finance costs')?.[1]).toBe(R(5_000));
    expect(line(pl, 'Depreciation and amortisation expense')?.[1]).toBe(R(10_000));
    expect(line(pl, 'Total expenses (IV)')?.[1]).toBe(R(1_65_000));
    expect(line(pl, 'VII. Profit (loss) for the period (V − VI)')?.[1]).toBe(R(1_35_000));
    const withAccounts = await run(orgId, 'pl_schedule_iii', { ...range, detail: 'accounts' });
    expect(line(withAccounts, 'Interest on Loan')?.[1]).toBe(R(5_000));

    const bs = await run(orgId, 'bs_schedule_iii', { asOf: '2026-06-30' });
    expect(line(bs, '(a) Share capital')?.[1]).toBe(R(4_80_000));
    expect(line(bs, '(b) Reserves and surplus')?.[1]).toBe(R(1_35_000));
    expect(line(bs, '(a) Long-term borrowings')?.[1]).toBe(R(1_00_000));
    expect(line(bs, '(b) Trade payables')?.[1]).toBe(R(1_00_000));
    expect(line(bs, '(A) Total outstanding dues of micro and small enterprises')?.[1]).toBe(R(60_000));
    expect(line(bs, '(B) Total outstanding dues of creditors other than micro and small enterprises')?.[1]).toBe(R(40_000));
    expect(line(bs, '(i) Property, plant and equipment')?.[1]).toBe(R(1_10_000));
    expect(line(bs, '(c) Trade receivables')?.[1]).toBe(R(1_00_000));
    expect(line(bs, '(d) Cash and cash equivalents')?.[1]).toBe(R(6_05_000));
    const totals = bs.rows.filter((r) => r.cells[0] === 'TOTAL').map((r) => r.cells[1]);
    expect(totals).toEqual([R(8_15_000), R(8_15_000)]);
    expect(bs.notes).toContain('Total assets equal total equity and liabilities.');

    const hpl = await run(orgId, 'pl_horizontal', range);
    const sides = hpl.rows.filter((r) => r.style === 'total').map((r) => [r.cells[1], r.cells[3]]);
    expect(sides).toEqual([[R(3_00_000), R(3_00_000)], [R(2_00_000), R(2_00_000)]]);
    expect(hpl.rows.some((r) => r.cells[0] === 'Net profit' && r.cells[1] === R(1_35_000))).toBe(true);
    const hbs = await run(orgId, 'bs_horizontal', { asOf: '2026-06-30' });
    expect(hbs.rows[hbs.rows.length - 1].cells).toEqual(['Total', R(8_15_000), 'Total', R(8_15_000)]);

    const cf = await run(orgId, 'cash_flow_statement', range);
    expect(line(cf, 'Net profit')?.[1]).toBe(R(1_35_000));
    expect(line(cf, 'Net cash from operating activities (A)')?.[1]).toBe(R(1_45_000));
    expect(line(cf, 'Net cash from investing activities (B)')?.[1]).toBe(R(-1_20_000));
    expect(line(cf, 'Net cash from financing activities (C)')?.[1]).toBe(R(5_80_000));
    expect(line(cf, 'Cash and cash equivalents at the end')?.[1]).toBe(R(6_05_000));
    expect(cf.notes[1]).toBe('The closing figure equals the bank and cash balances in the ledger.');

    const ratios = await run(orgId, 'business_ratios', range);
    const ratio = (name: string) => line(ratios, name)?.[1];
    expect(ratio('Current ratio')).toBe(7.05);
    expect(ratio('Debt-equity ratio')).toBe(0.16);
    expect(ratio('Gross profit margin')).toBe(66.67);
    expect(ratio('Net profit margin')).toBe(45);
    expect(ratio('Debtor days')).toBe(30.33);
    expect(ratio('Creditor days')).toBe(91);
    expect(ratio('Interest coverage')).toBe(28);

    const equity = await run(orgId, 'movement_of_equity', range);
    expect(line(equity, "Owner's Capital")).toEqual(["Owner's Capital", 0, R(5_00_000), R(20_000), 0, 0, R(4_80_000)]);
    expect(line(equity, 'Surplus in profit and loss')).toEqual(['Surplus in profit and loss', 0, 0, 0, R(1_35_000), 0, R(1_35_000)]);
    expect(line(equity, 'Total equity')?.[6]).toBe(R(6_15_000));

    // The same as the operating-format P&L's bottom line.
    expect(line(await run(orgId, 'profit_and_loss', range), 'Net profit')?.[1]).toBe(R(1_35_000));

    // MSME 43B(h): 15 days without a written agreement, so due 4 June; unpaid at 30 June.
    const msme = await run(orgId, 'msme_43bh', { asOf: '2026-06-30' });
    expect(msme.rows[0].cells.slice(3, 12)).toEqual(['KP/77', '2026-05-20', '2026-06-04', '', 'Overdue: pay before the year ends to keep the deduction', 26, R(60_000), R(60_000), R(60_000)]);

    // General ledger: the bank from May, carried forward from April.
    const gl = await run(orgId, 'general_ledger', { from: '2026-05', to: '2026-06' });
    expect(line(gl, '1100')).toEqual(['1100', 'Bank Accounts', 'Assets', R(3_80_000), R(3_00_000), R(75_000), R(6_05_000)]);
    const types = await run(orgId, 'account_type_summary', range);
    expect(types.rows[types.rows.length - 1].cells[3]).toBe(0);

    // The owner's money brought in by an import is where the books start, not cash that came in.
    await model(ImportBatch.name).create({ orgId, source: 'manual', status: 'committed', journalId: opening._id, createdBy: USER_A });
    const cf2 = await run(orgId, 'cash_flow_statement', range);
    expect(line(cf2, 'Cash and cash equivalents at the beginning')?.[1]).toBe(R(5_00_000));
    expect(line(cf2, 'Capital introduced less drawings')?.[1]).toBe(R(-20_000));
    expect(line(cf2, 'Cash and cash equivalents at the end')?.[1]).toBe(R(6_05_000));
  });
});

async function salesOrg() {
  const o = await org();
  const customers = model(Customer.name);
  const asha = await customers.create({ orgId: o.orgId, name: 'Asha Traders' });
  const bharat = await customers.create({ orgId: o.orgId, name: 'Bharat Stores' });
  const j = () => new Types.ObjectId();
  const [j1, j2, j3, jNote] = [j(), j(), j(), j()];
  const invoices = model(SalesInvoice.name);
  const amounts = (taxable: number) => ({ taxableValue: R(taxable), cgst: R(taxable * 0.09), sgst: R(taxable * 0.09), igst: 0, cess: 0, total: R(taxable * 1.18) });
  const i1 = await invoices.create({
    orgId: o.orgId, customerId: asha._id, invoiceNumber: 'INV-1', invoiceDate: '2026-09-05', dueDate: '2026-09-20', status: 'posted', salespersonName: 'Ravi', amountsPaise: amounts(1_00_000),
    lineItems: [{ description: 'Basmati rice', qty: 10, ratePaise: R(10_000), amountPaise: R(1_00_000), taxRatePct: 18 }],
    payments: [{ journalId: j1, amountPaise: R(50_000), tdsPaise: 0, paidOn: '2026-10-15' }], amountPaidPaise: R(50_000),
    adjustments: [{ noteId: new Types.ObjectId(), journalId: jNote, amountPaise: R(11_800), noteDate: '2026-09-25' }], adjustedPaise: R(11_800),
  });
  await invoices.create({
    orgId: o.orgId, customerId: bharat._id, invoiceNumber: 'INV-2', invoiceDate: '2026-10-01', dueDate: '2026-10-31', status: 'paid', salespersonName: 'Meera', amountsPaise: amounts(50_000),
    lineItems: [{ description: 'Delivery', qty: 1, ratePaise: R(50_000), amountPaise: R(50_000), taxRatePct: 18 }],
    payments: [{ journalId: j2, amountPaise: R(58_000), tdsPaise: R(1_000), paidOn: '2026-10-20' }], amountPaidPaise: R(59_000),
  });
  await model(CreditNote.name).create({ orgId: o.orgId, invoiceId: i1._id, customerId: asha._id, noteNumber: 'CRN/2026-27/0001', noteDate: '2026-09-25', financialYear: '2026-27', reason: 'Damaged', amountsPaise: amounts(10_000), journalId: jNote, createdBy: USER_A });
  const payments = model(PartyPayment.name);
  await payments.create({ orgId: o.orgId, kind: 'receipt', number: 'RCT/1', partyId: asha._id, partyName: 'Asha Traders', date: '2026-10-15', amountPaise: R(50_000), mode: 'upi', journalId: j1, allocations: [{ documentId: i1._id, documentNumber: 'INV-1', amountPaise: R(50_000), journalId: j1, appliedOn: '2026-10-15' }], unappliedPaise: 0, createdBy: USER_A });
  await payments.create({ orgId: o.orgId, kind: 'receipt', number: 'RCT/2', partyId: bharat._id, partyName: 'Bharat Stores', date: '2026-09-01', amountPaise: R(20_000), mode: 'cash', journalId: j3, allocations: [], unappliedPaise: R(20_000), createdBy: USER_A });
  return { ...o, asha, bharat };
}

describe('sales, receivables and payments from documents', () => {
  it('reads salespeople, ageing and balances at a past date, receipts once each, and how fast customers pay', async () => {
    const { orgId } = await salesOrg();
    const range = { from: '2026-09', to: '2026-10' };

    const sp = await run(orgId, 'sales_by_salesperson', range);
    expect(sp.rows.map((r) => r.cells)).toEqual([
      ['Ravi', 1, R(1_00_000), R(10_000), R(90_000), R(1_06_200)],
      ['Meera', 1, R(50_000), 0, R(50_000), R(59_000)],
      ['Total', 2, R(1_50_000), R(10_000), R(1_40_000), R(1_65_200)],
    ]);

    // On 10 October the ₹50,000 of the 15th and Bharat's payment of the 20th had not come in.
    const balances = await run(orgId, 'customer_balance_summary', { asOf: '2026-10-10' });
    expect(balances.rows.map((r) => r.cells)).toEqual([
      ['Asha Traders', R(1_18_000), R(11_800), 0, R(1_06_200)],
      ['Bharat Stores', R(59_000), 0, 0, R(59_000)],
      ['Total', R(1_77_000), R(11_800), 0, R(1_65_200)],
    ]);
    const ageing = await run(orgId, 'ar_ageing_details', { asOf: '2026-10-10' });
    expect(ageing.rows.map((r) => [r.cells[1], r.cells[4], r.cells[5], r.cells[7]])).toEqual([['INV-1', 20, '1–30 days', R(1_06_200)], ['INV-2', 0, 'Not yet due', R(59_000)], [null, null, null, R(1_65_200)]]);
    // Today, only what is still owed.
    expect((await run(orgId, 'receivable_summary')).rows.map((r) => [r.cells[1], r.cells[6]])).toEqual([['INV-1', R(56_200)], [null, R(56_200)]]);

    const received = await run(orgId, 'payments_received', range);
    expect(received.rows.map((r) => [r.cells[1], r.cells[2], r.cells[3], r.cells[5], r.cells[6], r.cells[7], r.cells[8]])).toEqual([
      ['RCT/2', 'Bharat Stores', 'Cash', '', R(20_000), 0, R(20_000)],
      ['RCT/1', 'Asha Traders', 'UPI', 'INV-1', R(50_000), 0, 0],
      ['', 'Bharat Stores', 'Recorded on the document', 'INV-2', R(58_000), R(1_000), 0],
      [null, null, null, null, R(1_28_000), R(1_000), R(20_000)],
    ]);

    const paid = await run(orgId, 'time_to_get_paid', { from: '2026-10', to: '2026-10' });
    expect(paid.rows[0].cells).toEqual(['Bharat Stores', 1, 0, 100, 0, 0, 19]);
    expect((await run(orgId, 'invoice_details', { ...range, status: 'paid' })).rows.map((r) => r.cells[1])).toEqual(['INV-2', null]);
    await expect(run(orgId, 'invoice_details', { ...range, status: 'nonsense' })).rejects.toThrow(/pick one of the choices/);

    // GSTR-1, read through the GST service: the very figures of the GST page.
    const g = await run(orgId, 'gstr1_summary', { from: '2026-10', to: '2026-10' });
    const direct = await gstReturns.gstr1(orgId, '2026-10');
    expect(g.rows.filter((r) => !r.style).map((r) => r.cells[3])).toEqual(direct.summary.map((s) => s.txval));
    expect(g.rows[g.rows.length - 1].cells[3]).toBe(R(50_000));
  });
});

describe('custom reports and the query layer', () => {
  it('makes a report from an existing one and from a module, private until shared, audited, scheduled', async () => {
    const { orgId } = await salesOrg();
    const base = catalog.base(orgId, USER_A);
    const range = { from: '2026-09', to: '2026-10' };

    // From Sales by customer: three columns, a condition, sorted.
    const made = await center.createCustom(orgId, USER_A, {
      name: 'Big customers', kind: 'derived', baseKey: 'sales_by_customer', params: range, columns: ['party', 'net', 'count'],
      conditions: [{ field: 'net', op: 'gte', value: R(60_000) }], sortBy: 'net', sortDir: 'desc',
    }, base);
    const table = await run(orgId, made.key, {}, USER_A);
    expect(table.title).toBe('Big customers');
    expect(table.columns.map((c) => c.key)).toEqual(['party', 'net', 'count']);
    expect(table.rows.map((r) => r.cells)).toEqual([['Asha Traders', R(90_000), 1], ['Total', R(90_000), 1]]);
    expect(await model(AuditLog.name).countDocuments({ orgId, entityType: 'CustomReport', action: 'CREATE' })).toBe(1);

    // Private: another person in the org does not see it, cannot run it, cannot schedule it.
    await expect(run(orgId, made.key, {}, USER_B)).rejects.toThrow(/No such report/);
    expect((await center.center(orgId, USER_B, catalog.base(orgId, USER_B))).reports.some((r) => r.key === made.key)).toBe(false);
    await expect(schedules.create(orgId, USER_B, { report: made.key, frequency: 'monthly', day: 2, recipients: ['b@shop.in'] })).rejects.toThrow(/Pick a report/);
    // Shared, they see it under Shared Reports and may run it, but only its maker changes it.
    await center.updateCustom(orgId, USER_A, made.id, { ...made, shared: true }, base);
    const seenByB = (await center.center(orgId, USER_B, catalog.base(orgId, USER_B))).reports.find((r) => r.key === made.key)!;
    expect(seenByB).toMatchObject({ custom: true, shared: true, mine: false, category: 'sales' });
    expect((await run(orgId, made.key, {}, USER_B)).rows).toHaveLength(2);
    await expect(center.updateCustom(orgId, USER_B, made.id, { ...made, name: 'Mine now' }, base)).rejects.toThrow(/Only the person who made/);
    expect(await model(AuditLog.name).countDocuments({ orgId, entityType: 'CustomReport', action: 'SHARE' })).toBe(1);

    // A statement keeps its rows: no conditions on a balance sheet.
    await expect(center.createCustom(orgId, USER_A, { name: 'Odd', kind: 'derived', baseKey: 'bs_schedule_iii', conditions: [{ field: 'current', op: 'gt', value: 0 }] }, base)).rejects.toThrow(/only its columns/);

    // From the invoices module: customer, total and balance, totals by customer.
    const mod = await center.createCustom(orgId, USER_A, {
      name: 'Invoices by customer', kind: 'module', module: 'invoices', params: range, columns: ['customer', 'total', 'balance'], groupBy: 'customer', groupTotalsOnly: true,
    }, base);
    const byCustomer = await run(orgId, mod.key, {}, USER_A);
    expect(byCustomer.rows.map((r) => r.cells)).toEqual([
      ['Asha Traders (1)', R(1_18_000), R(56_200)],
      ['Bharat Stores (1)', R(59_000), 0],
      ['Total (2)', R(1_77_000), R(56_200)],
    ]);

    // Another org's invoices are never read, whatever the conditions.
    const other = await salesOrg();
    expect((await run(orgId, mod.key, {}, USER_A)).rows).toEqual(byCustomer.rows);
    expect((await center.preview(other.orgId, { name: 'x', kind: 'module', module: 'invoices', params: range, columns: ['number'] }, {}, catalog.base(other.orgId, USER_A))).rows).toHaveLength(2);

    // Favourites and visits are each person's own.
    await center.setFavourite(orgId, USER_A, 'sales_by_salesperson', true, base);
    await center.visit(orgId, USER_A, made.key, base);
    const mine = await center.center(orgId, USER_A, base);
    expect(mine.counts.favourites).toBe(1);
    expect(mine.reports.find((r) => r.key === made.key)!.lastVisitedAt).not.toBeNull();
    expect((await center.center(orgId, USER_B, catalog.base(orgId, USER_B))).counts.favourites).toBe(0);
    expect(await model(AuditLog.name).countDocuments({ orgId, entityType: 'ReportFavourite', action: 'STAR' })).toBe(1);

    // A custom report goes out on a schedule like any other.
    const s = await schedules.create(orgId, USER_A, { report: mod.key, period: 'last_month', frequency: 'monthly', day: 2, recipients: ['owner@shop.in'] });
    expect((await schedules.list(orgId))[0]).toMatchObject({ title: 'Invoices by customer' });
    expect(await schedules.runDue(s.nextRunOn)).toEqual({ sent: 1, failed: 0 });
    expect((mailer.send.mock.calls[0][0] as unknown as { subject: string }).subject).toMatch(/^Invoices by customer: /);

    await center.deleteCustom(orgId, USER_A, mod.id);
    await expect(run(orgId, mod.key, {}, USER_A)).rejects.toThrow(/No such report/);
  });

  it('refuses fields, operators and values it does not list', () => {
    const spec = { module: 'invoices', columns: ['number'], conditions: [], groupBy: null, groupTotalsOnly: false, sortBy: null, sortDir: 'asc' as const };
    expect(() => checkModuleSpec({ ...spec, module: 'users' })).toThrow(/Pick a module/);
    expect(() => checkModuleSpec({ ...spec, columns: ['customerId'] })).toThrow(/no field customerId/);
    expect(() => checkModuleSpec({ ...spec, columns: ['$where'] })).toThrow(/no field/);
    expect(() => checkModuleSpec({ ...spec, conditions: [{ field: 'total', op: '$gt' as 'gt', value: 1 }] })).toThrow(/does not apply/);
    expect(() => checkModuleSpec({ ...spec, conditions: [{ field: 'number', op: 'equals', value: { $ne: null } as unknown as string }] })).toThrow(/text up to 100/);
    expect(() => checkModuleSpec({ ...spec, conditions: [{ field: 'total', op: 'gt', value: 10.5 }] })).toThrow(/whole paise/);
    expect(() => checkModuleSpec({ ...spec, conditions: [{ field: 'date', op: 'gt', value: '2026-13-99; drop' }] })).toThrow(/a date like/);
    expect(() => checkModuleSpec({ ...spec, groupBy: 'total' })).toThrow(/Group by/);
  });

  it('reads a regular-expression-looking value as plain text', async () => {
    const { orgId } = await salesOrg();
    const t = await center.preview(orgId, { name: 'x', kind: 'module', module: 'invoices', params: { from: '2026-09', to: '2026-10' }, columns: ['number'], conditions: [{ field: 'number', op: 'contains', value: '.*' }] }, {}, catalog.base(orgId, USER_A));
    expect(t.rows).toHaveLength(0);
  });
});

describe('pure pieces', () => {
  it('groups, subtotals and sorts a list, and leaves a statement alone', () => {
    const t: ReportTable = {
      key: 'x', title: 'X', subtitle: '', notes: [],
      columns: [{ key: 'party', label: 'Party', kind: 'text' }, { key: 'city', label: 'City', kind: 'text' }, { key: 'amount', label: 'Amount', kind: 'money' }, { key: 'share', label: 'Share', kind: 'number' }],
      rows: [{ cells: ['A', 'Pune', 300, 50] }, { cells: ['B', 'Pune', 200, 33.3] }, { cells: ['C', 'Agra', 100, 16.7] }, { cells: ['Total', null, 600, 100], style: 'grand' }],
    };
    const g = customize(t, 'list', { columns: ['party', 'amount'], conditions: [], groupBy: 'city', groupTotalsOnly: false, sortBy: 'amount', sortDir: 'asc' }, { key: 'k', title: 'K' });
    expect(g.rows.map((r) => [r.cells, r.style ?? ''])).toEqual([
      [['Agra', null], 'group'], [['C', 100], ''], [['Total Agra', 100], 'total'],
      [['Pune', null], 'group'], [['B', 200], ''], [['A', 300], ''], [['Total Pune', 500], 'total'],
      [['Total', 600], 'grand'],
    ]);
    const statement = { ...t, rows: t.rows.slice(0, 2) };
    expect(customize(statement, 'statement', { columns: ['amount'], conditions: [], groupBy: null, groupTotalsOnly: false, sortBy: null, sortDir: 'asc' }, { key: 'k', title: 'K' }).rows.map((r) => r.cells)).toEqual([['A', 300], ['B', 200]]);
  });

  it('places accounts under Schedule III heads, an overdraft as a borrowing', () => {
    const a = (name: string, type: AccountType, extra: Record<string, unknown> = {}) => ({ id: '1', name, code: '9', type, systemKey: null, isGroup: false, parentId: null, group: null, ...extra });
    expect(bsHead(a('HDFC Current A/c', AccountType.ASSETS, { systemKey: 'BANK' }), -5)).toBe('st_borrowings');
    expect(bsHead(a('HDFC Current A/c', AccountType.ASSETS, { systemKey: 'BANK' }), 5)).toBe('cash');
    expect(bsHead(a('Security Deposit - Landlord', AccountType.ASSETS))).toBe('lt_loans_advances');
    expect(bsHead(a('Cash Credit - SBI', AccountType.LIABILITIES))).toBe('st_borrowings');
    expect(bsHead(a('Provision for Gratuity', AccountType.LIABILITIES))).toBe('lt_provisions');
    expect(bsHead(a('Input IGST', AccountType.ASSETS, { systemKey: 'GST_INPUT_IGST' }))).toBe('st_loans_advances');
    expect(bsHead(a('Office Equipment', AccountType.ASSETS, { group: 'Fixed Assets' }))).toBe('ppe');
    // Direct expenses are a cost of sales; indirect ones (the word contains "direct") are not.
    expect(isCostOfSales(a('Freight & Carriage', AccountType.EXPENSE, { group: 'Direct Expenses' }))).toBe(true);
    expect(isCostOfSales(a('Rent', AccountType.EXPENSE, { group: 'Indirect Expenses' }))).toBe(false);
    expect(plHead(a('Salaries & Wages', AccountType.EXPENSE, { group: 'Indirect Expenses' }))).toBe('employee');
    expect(plHead(a('Bank Charges', AccountType.EXPENSE))).toBe('other_expenses');
    expect(plHead(a('Interest on Loan', AccountType.EXPENSE))).toBe('finance');
  });

  it('buckets days to pay and stands a bill under 43B(h)', () => {
    const t = timeToGetPaid([{ customer: 'A', days: 10, amountPaise: 100 }, { customer: 'A', days: 40, amountPaise: 300 }]);
    expect(t.rows[0]).toEqual(['A', 2, 50, 0, 50, 0, 33]);
    expect(msmeStanding({ payBy: '2026-06-04', owed: 0, paidOffOn: '2026-06-10' }, '2026-06-30')).toEqual({ status: 'Paid late', daysLate: 6, atRisk: 0 });
    expect(msmeStanding({ payBy: '2026-07-04', owed: 500, paidOffOn: null }, '2026-06-30').status).toBe('Due by 2026-07-04');
  });
});
