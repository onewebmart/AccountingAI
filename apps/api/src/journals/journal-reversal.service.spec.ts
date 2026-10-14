/**
 * Integration tests — reversing a voucher keeps the sub-ledgers and bank
 * reconciliation in step with the ledger.
 *
 *  ✓ Reversing an unpaid invoice's sale returns the invoice to draft
 *  ✓ Reversing a paid invoice's sale is refused until its receipt is reversed
 *  ✓ Reversing a receipt makes the invoice unpaid again
 *  ✓ Reversing a bill's payment makes the bill unpaid again
 *  ✓ A bank line confirmed against a reversed voucher goes back to unmatched
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { BillStatus, InvoiceStatus, MatchStatus } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { JournalReversalService } from './journal-reversal.service';
import { TdsDeposit, TdsDepositSchema } from '../tds/schemas/tds-deposit.schema';
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
import {
  BankStatementLine,
  BankStatementLineSchema,
  BankStatementLineDocument,
} from '../banking/schemas/bank-statement-line.schema';
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';

const ACTOR_ID = new Types.ObjectId().toString();
const amounts = { taxableValue: 847458, cgst: 76271, sgst: 76271, igst: 0, cess: 0, total: 1000000 };

let moduleRef: TestingModule;
let reversals: JournalReversalService;
let invoices: SalesInvoicesService;
let customers: CustomersService;
let bills: PurchaseBillsService;
let vendors: VendorsService;
let journalModel: Model<JournalDocument>;
let invoiceModel: Model<SalesInvoiceDocument>;
let billModel: Model<PurchaseBillDocument>;
let lineModel: Model<BankStatementLineDocument>;

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
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
        { name: TdsDeposit.name, schema: TdsDepositSchema },
        { name: CreditNote.name, schema: CreditNoteSchema },
        { name: DebitNote.name, schema: DebitNoteSchema },
      ]),
    ],
    providers: [
      JournalReversalService,
      PostingService,
      AccountsService,
      AuditService,
      SalesInvoicesService,
      CustomersService,
      PurchaseBillsService,
      VendorsService,
    ],
  }).compile();

  reversals = moduleRef.get(JournalReversalService);
  invoices = moduleRef.get(SalesInvoicesService);
  customers = moduleRef.get(CustomersService);
  bills = moduleRef.get(PurchaseBillsService);
  vendors = moduleRef.get(VendorsService);
  journalModel = moduleRef.get(getModelToken(Journal.name));
  invoiceModel = moduleRef.get(getModelToken(SalesInvoice.name));
  billModel = moduleRef.get(getModelToken(PurchaseBill.name));
  lineModel = moduleRef.get(getModelToken(BankStatementLine.name));
  await journalModel.init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

async function postedInvoice(orgId: string, invoiceNumber: string) {
  const customer = await customers.create({ orgId, name: `Customer ${invoiceNumber}` });
  const invoice = await invoices.create({
    orgId, customerId: customer._id.toString(), invoiceNumber, invoiceDate: '2026-10-08', amountsPaise: amounts,
  });
  return invoices.post(invoice._id.toString(), orgId, ACTOR_ID);
}

/** Net debit − credit on accounts whose name matches, across posted journals. */
async function net(orgId: string, account: RegExp) {
  const posted = await journalModel.find({ orgId, status: 'posted' }).exec();
  return posted
    .flatMap((j) => j.lines)
    .filter((l) => account.test(l.description))
    .reduce((s, l) => s + l.debitPaise - l.creditPaise, 0);
}

describe('reversing a sale', () => {
  it('returns an unpaid invoice to draft and clears the receivable', async () => {
    const orgId = new Types.ObjectId().toString();
    const invoice = await postedInvoice(orgId, 'R-001');

    await reversals.reverse(String(invoice.journalId), orgId, ACTOR_ID);

    const stored = await invoiceModel.findById(invoice._id).exec();
    expect(stored?.status).toBe(InvoiceStatus.DRAFT);
    expect(stored?.journalId).toBeNull();
    expect(await net(orgId, /receivable/i)).toBe(0);
  });

  it('refuses while the invoice is paid, and allows it once the receipt is reversed', async () => {
    const orgId = new Types.ObjectId().toString();
    const invoice = await postedInvoice(orgId, 'R-002');
    const paid = await invoices.markPaid(invoice._id.toString(), orgId, ACTOR_ID, '2026-10-10');

    await expect(reversals.reverse(String(invoice.journalId), orgId, ACTOR_ID)).rejects.toThrow(
      /has receipts or credit notes against it — reverse those first/,
    );
    expect(await journalModel.countDocuments({ orgId, reversalOf: { $exists: true } })).toBe(0);

    // Reversing the receipt makes the invoice unpaid again…
    await reversals.reverse(String(paid.payments[0].journalId), orgId, ACTOR_ID);
    let stored = await invoiceModel.findById(invoice._id).exec();
    expect(stored?.status).toBe(InvoiceStatus.POSTED);
    expect(stored?.payments).toHaveLength(0);
    expect(stored?.amountPaidPaise).toBe(0);

    // …and then the sale itself can go.
    await reversals.reverse(String(invoice.journalId), orgId, ACTOR_ID);
    stored = await invoiceModel.findById(invoice._id).exec();
    expect(stored?.status).toBe(InvoiceStatus.DRAFT);
    expect(await net(orgId, /receivable/i)).toBe(0);
    expect(await net(orgId, /bank/i)).toBe(0);
  });
});

describe('reversing a payment', () => {
  it("makes the bill unpaid again", async () => {
    const orgId = new Types.ObjectId().toString();
    const vendor = await vendors.create({ orgId, name: 'Sterling' });
    const draft = await bills.create({ orgId, vendorId: vendor._id.toString(), billNumber: 'B-1', billDate: '2026-10-05', amountsPaise: amounts });
    await bills.post(draft._id.toString(), orgId, ACTOR_ID);
    const paid = await bills.markPaid(draft._id.toString(), orgId, ACTOR_ID);

    await reversals.reverse(String(paid.payments[0].journalId), orgId, ACTOR_ID);

    expect((await billModel.findById(draft._id).exec())?.status).toBe(BillStatus.POSTED);
    expect(await net(orgId, /payable/i)).toBe(-1000000);
  });

  it('sends a bank line confirmed against it back to unmatched', async () => {
    const orgId = new Types.ObjectId().toString();
    const invoice = await postedInvoice(orgId, 'R-003');
    const paid = await invoices.markPaid(invoice._id.toString(), orgId, ACTOR_ID, '2026-10-10');
    const line = await lineModel.create({
      orgId,
      statementId: new Types.ObjectId(),
      bankAccountId: new Types.ObjectId(),
      date: '2026-10-10',
      description: 'NEFT CR R-003',
      debitPaise: 0,
      creditPaise: 1000000,
      matchStatus: MatchStatus.CONFIRMED,
      matchedJournalId: paid.payments[0].journalId,
    });

    await reversals.reverse(String(paid.payments[0].journalId), orgId, ACTOR_ID);

    const stored = await lineModel.findById(line._id).exec();
    expect(stored?.matchStatus).toBe(MatchStatus.UNMATCHED);
    expect(stored?.matchedJournalId).toBeNull();
  });
});

describe('reversing one of several part payments', () => {
  it('takes back only that payment', async () => {
    const orgId = new Types.ObjectId().toString();
    const invoice = await postedInvoice(orgId, 'R-004');
    await invoices.markPaid(invoice._id.toString(), orgId, ACTOR_ID, '2026-10-10', 400000);
    const both = await invoices.markPaid(invoice._id.toString(), orgId, ACTOR_ID, '2026-10-12', 600000);
    expect(both.status).toBe(InvoiceStatus.PAID);

    await reversals.reverse(String(both.payments[1].journalId), orgId, ACTOR_ID);

    const stored = await invoiceModel.findById(invoice._id).exec();
    expect(stored?.status).toBe(InvoiceStatus.POSTED);
    expect(stored?.amountPaidPaise).toBe(400000);
    expect(stored?.payments.map((p) => p.amountPaise)).toEqual([400000]);
    expect(await net(orgId, /receivable/i)).toBe(600000);
  });
});
