/**
 * Tests — every built-in report of the Reports Center runs against a small
 * set of books, every money cell is whole paise, and a report whose service
 * this deployment lacks says so instead of failing.
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { VoucherType } from '@ai-accounting/shared';
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
import { ExpenseClaim, ExpenseClaimSchema } from '../../expenses/schemas/expense-claim.schema';
import { Gstr2bLine, Gstr2bLineSchema } from '../../gst/schemas/gstr2b-line.schema';
import { DeliveryChallan, DeliveryChallanSchema, Quote, QuoteSchema, SalesOrder, SalesOrderSchema } from '../../orders/schemas/sales-docs.schema';
import { PurchaseOrder, PurchaseOrderSchema } from '../../orders/schemas/purchase-docs.schema';
import { Project, ProjectSchema } from '../../projects/schemas/project.schema';
import { TimeEntry, TimeEntrySchema } from '../../projects/schemas/time-entry.schema';
import { RecurringTemplate, RecurringTemplateSchema } from '../../automation/schemas/recurring-template.schema';
import { PaymentReminder, PaymentReminderSchema } from '../../automation/schemas/payment-reminder.schema';
import { BankAccount, BankAccountSchema } from '../../banking/schemas/bank-account.schema';
import { BankStatement, BankStatementSchema } from '../../banking/schemas/bank-statement.schema';
import { BankStatementLine, BankStatementLineSchema } from '../../banking/schemas/bank-statement-line.schema';
import { TdsDeposit, TdsDepositSchema } from '../../tds/schemas/tds-deposit.schema';
import { User, UserSchema } from '../../tenancy/schemas/user.schema';
import { OrgMembership, OrgMembershipSchema } from '../../tenancy/schemas/org-membership.schema';
import { GstReturnsService } from '../../gst/gst-returns.service';
import { TdsService } from '../../tds/tds.service';
import { ForecastService } from '../../insights/forecast.service';
import { ReportsService } from '../reports.service';
import { ManagementReportsService } from '../management.service';
import { ReportCatalogService } from '../report-catalog.service';
import { Budget, BudgetSchema } from '../schemas/budget.schema';
import { CustomReport, CustomReportSchema } from '../schemas/custom-report.schema';
import { ReportPreference, ReportPreferenceSchema } from '../schemas/report-preference.schema';
import { ReportDataService } from './report-data.service';
import { ReportCenterService } from './center.service';
import { EXTRA_REPORTS } from './index';

const ACTOR = new Types.ObjectId().toString();
let moduleRef: TestingModule;
const model = <T = Record<string, unknown>>(name: string) => moduleRef.get<Model<T>>(getModelToken(name));

beforeAll(async () => {
  const schemas: Array<[string, mongoose.Schema]> = [
    [Journal.name, JournalSchema], [Counter.name, CounterSchema], [AuditLog.name, AuditLogSchema], [LedgerAccount.name, LedgerAccountSchema],
    [SalesInvoice.name, SalesInvoiceSchema], [Customer.name, CustomerSchema], [CreditNote.name, CreditNoteSchema], [PurchaseBill.name, PurchaseBillSchema],
    [Vendor.name, VendorSchema], [DebitNote.name, DebitNoteSchema], [Item.name, ItemSchema], [OrgSettings.name, OrgSettingsSchema], [Budget.name, BudgetSchema],
    [CustomReport.name, CustomReportSchema], [ReportPreference.name, ReportPreferenceSchema], [PartyPayment.name, PartyPaymentSchema], [DirectExpense.name, DirectExpenseSchema],
    [ExpenseClaim.name, ExpenseClaimSchema], [Gstr2bLine.name, Gstr2bLineSchema], [Quote.name, QuoteSchema], [SalesOrder.name, SalesOrderSchema], [DeliveryChallan.name, DeliveryChallanSchema],
    [PurchaseOrder.name, PurchaseOrderSchema], [Project.name, ProjectSchema], [TimeEntry.name, TimeEntrySchema], [RecurringTemplate.name, RecurringTemplateSchema],
    [PaymentReminder.name, PaymentReminderSchema], [BankAccount.name, BankAccountSchema], [BankStatement.name, BankStatementSchema], [BankStatementLine.name, BankStatementLineSchema],
    [TdsDeposit.name, TdsDepositSchema], [User.name, UserSchema], [OrgMembership.name, OrgMembershipSchema],
  ];
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature(schemas.map(([name, schema]) => ({ name, schema }))),
    ],
    providers: [PostingService, AccountsService, AuditService, ReportsService, ManagementReportsService, ReportCatalogService, ReportDataService, ReportCenterService, GstReturnsService, TdsService, ForecastService],
  }).compile();
  await model<JournalDocument>(Journal.name).init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

const PARAMS: Record<string, Record<string, string>> = {
  range: { from: '2026-04', to: '2026-10' },
  today: {},
  year: { financialYear: '2026-27' },
  asof: { asOf: '2026-10-31' },
  month: { from: '2026-10', to: '2026-10' },
  quarter: { financialYear: '2026-27', quarter: 'Q2' },
};

describe('every report', () => {
  it('runs on real books and keeps money in whole paise', async () => {
    const orgId = new Types.ObjectId().toString();
    const accounts = moduleRef.get(AccountsService);
    const posting = moduleRef.get(PostingService);
    await accounts.seedDefaults(orgId);
    await model(OrgSettings.name).create({ orgId, displayName: 'Saffron Foods', gstin: '27AAPFU0939F1ZV', stateCode: '27' });
    const all = await accounts.list(orgId);
    const id = (name: string) => String(all.find((a) => a.name === name)!._id);
    const post = (date: string, dr: string, cr: string, paise: number) => posting.post({ orgId, voucherType: VoucherType.JOURNAL, financialYear: '2026-27', date, narration: 'seed', postedBy: ACTOR, lines: [{ accountId: id(dr), debitPaise: paise, creditPaise: 0 }, { accountId: id(cr), debitPaise: 0, creditPaise: paise }] });
    await post('2026-04-01', 'Bank Accounts', "Owner's Capital", 10_00_000_00);
    await post('2026-05-10', 'Accounts Receivable', 'Sales Revenue', 2_33_333_33);
    await post('2026-06-10', 'Rent', 'Bank Accounts', 33_333_33);
    await post('2026-07-10', 'Bank Accounts', 'Accounts Receivable', 1_00_000_01);

    const customer = await model(Customer.name).create({ orgId, name: 'Asha Traders' });
    const vendor = await model(Vendor.name).create({ orgId, name: 'Kiran Packaging', pan: 'ABCDE1234F' });
    const amounts = { taxableValue: 1_00_000_01, cgst: 9_000_00, sgst: 9_000_00, igst: 0, cess: 0, total: 1_18_000_01 };
    await model(SalesInvoice.name).create({ orgId, customerId: customer._id, invoiceNumber: 'INV-1', invoiceDate: '2026-10-05', dueDate: '2026-10-20', status: 'posted', salespersonName: 'Ravi', amountsPaise: amounts, lineItems: [{ description: 'Rice', qty: 3, ratePaise: 33_333_34, amountPaise: 1_00_000_01, taxRatePct: 18 }] });
    await model(PurchaseBill.name).create({ orgId, vendorId: vendor._id, billNumber: 'B-9', billDate: '2026-08-05', status: 'posted', amountsPaise: amounts, lineItems: [{ description: 'Boxes', qty: 1, ratePaise: 1_00_000_01, amountPaise: 1_00_000_01, taxRatePct: 18 }], tds: { section: '194C', rateBps: 100, amountPaise: 1_00_000, depositId: null } });
    const project = await model(Project.name).create({ orgId, name: 'Website', nameKey: 'website', customerId: customer._id, billing: 'project_hours', ratePaise: 1_500_00, createdBy: ACTOR });
    await model(TimeEntry.name).create({ orgId, projectId: project._id, userId: ACTOR, userName: 'Meera', date: '2026-09-02', hours: 2.5, task: 'Design', billable: true, status: 'unbilled' });
    await model(Quote.name).create({ orgId, customerId: customer._id, number: 'QT-1', date: '2026-09-01', validUntil: '2026-09-15', status: 'sent', lines: [{ description: 'Rice', qty: 2, ratePaise: 1_000_00, amountPaise: 2_000_00 }], amountsPaise: { ...amounts, total: 2_360_00, taxableValue: 2_000_00 }, createdBy: ACTOR });
    await model(PurchaseOrder.name).create({ orgId, vendorId: vendor._id, number: 'PO-1', date: '2026-09-03', lines: [{ description: 'Boxes', qty: 10, ratePaise: 100_00, amountPaise: 1_000_00 }], amountsPaise: { ...amounts, total: 1_180_00, taxableValue: 1_000_00 }, createdBy: ACTOR });
    await model(DirectExpense.name).create({ orgId, number: 'EXP-1', date: '2026-09-09', status: 'posted', expenseAccountId: id('Rent'), paidThroughAccountId: id('Bank Accounts'), taxablePaise: 10_000_00, cgstPaise: 900_00, sgstPaise: 900_00, igstPaise: 0, totalPaise: 11_800_00, projectId: project._id, customerId: customer._id, billable: true, createdBy: ACTOR });
    await model(RecurringTemplate.name).create({ orgId, kind: 'invoice', name: 'Monthly retainer', partyId: customer._id, frequency: 'monthly', dayOfMonth: 1, startDate: '2026-04-01', nextRunDate: '2026-11-01', amountsPaise: amounts, generated: [{ documentId: new Types.ObjectId(), documentDate: '2026-10-01', createdAt: new Date() }], createdBy: ACTOR });

    const catalog = moduleRef.get(ReportCatalogService);
    const failures: string[] = [];
    const unavailable: string[] = [];
    for (const r of EXTRA_REPORTS) {
      const p = { ...PARAMS[r.params], ...(r.key === 'account_ledger' ? { accountId: id('Bank Accounts') } : {}) };
      try {
        const t = await catalog.run(orgId, r.key, p);
        expect(t.columns.length).toBeGreaterThan(0);
        t.columns.forEach((c, i) => {
          if (c.kind !== 'money') return;
          for (const row of t.rows) if (typeof row.cells[i] === 'number' && !Number.isInteger(row.cells[i])) failures.push(`${r.key}.${c.key}: ${row.cells[i]}`);
        });
        for (const row of t.rows) if (row.cells.length !== t.columns.length) failures.push(`${r.key}: a row of ${row.cells.length} cells under ${t.columns.length} columns`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/not available in this deployment/.test(msg)) unavailable.push(r.key);
        else failures.push(`${r.key}: ${msg}`);
      }
    }
    expect(failures).toEqual([]);
    // Stock and foreign currency are services this test does not build; the reports say so.
    expect(unavailable.sort()).toEqual(['inventory_summary', 'inventory_valuation', 'unrealised_fx']);
    // A report key is unique, and none clashes with the first sixteen.
    const keys = [...catalog.list().map((l) => l.key), ...EXTRA_REPORTS.map((r) => r.key)];
    expect(new Set(keys).size).toBe(keys.length);
  }, 120_000);
});
