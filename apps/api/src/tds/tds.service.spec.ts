/**
 * Integration tests — TDS and reverse charge.
 *
 *  ✓ A vendor's TDS section is withheld from their bill: AP less TDS, TDS Payable credited
 *  ✓ 194C deducts 1% from an individual (PAN …P…) and 2% from a company
 *  ✓ Reverse charge: vendor owed the taxable value, the tax booked as our liability
 *  ✓ Debit notes give back their share of TDS, and of the reverse-charge liability
 *  ✓ The register groups TDS by month and section with due dates; a deposit pays it over once
 *  ✓ Reversing a deposit leaves the TDS undeposited again
 *  ✓ TDS a customer deducted settles their invoice through TDS Receivable
 *  ✓ An org seeded before these accounts existed gets them on first use
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { BillStatus, InvoiceStatus } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { VendorsService } from '../purchase/vendors.service';
import { DebitNotesService } from '../purchase/debit-notes.service';
import { PurchaseBill, PurchaseBillSchema, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { CustomersService } from '../sales/customers.service';
import { SalesInvoice, SalesInvoiceSchema, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { JournalReversalService } from '../journals/journal-reversal.service';
import { TdsService } from './tds.service';
import { TdsDeposit, TdsDepositSchema } from './schemas/tds-deposit.schema';

const ACTOR_ID = new Types.ObjectId().toString();
const COMPANY_GSTIN = '27AAPFU0939F1ZV'; // PAN AAPFU0939F — a firm, not an individual
// ₹1,000 + 9% CGST + 9% SGST
const thousand = { taxableValue: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0, total: 118000 };

let moduleRef: TestingModule;
let bills: PurchaseBillsService;
let vendors: VendorsService;
let debitNotes: DebitNotesService;
let invoices: SalesInvoicesService;
let customers: CustomersService;
let reversals: JournalReversalService;
let tds: TdsService;
let accounts: AccountsService;
let journalModel: Model<JournalDocument>;
let billModel: Model<PurchaseBillDocument>;
let invoiceModel: Model<SalesInvoiceDocument>;
let ledgerModel: Model<{ systemKey?: string; code: string; name: string }>;

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
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: DebitNote.name, schema: DebitNoteSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: CreditNote.name, schema: CreditNoteSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
        { name: TdsDeposit.name, schema: TdsDepositSchema },
      ]),
    ],
    providers: [
      PostingService, AccountsService, AuditService,
      PurchaseBillsService, VendorsService, DebitNotesService,
      SalesInvoicesService, CustomersService,
      JournalReversalService, TdsService,
    ],
  }).compile();

  bills = moduleRef.get(PurchaseBillsService);
  vendors = moduleRef.get(VendorsService);
  debitNotes = moduleRef.get(DebitNotesService);
  invoices = moduleRef.get(SalesInvoicesService);
  customers = moduleRef.get(CustomersService);
  reversals = moduleRef.get(JournalReversalService);
  tds = moduleRef.get(TdsService);
  accounts = moduleRef.get(AccountsService);
  journalModel = moduleRef.get(getModelToken(Journal.name));
  billModel = moduleRef.get(getModelToken(PurchaseBill.name));
  invoiceModel = moduleRef.get(getModelToken(SalesInvoice.name));
  ledgerModel = moduleRef.get(getModelToken(LedgerAccount.name));
  await journalModel.init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

const linesOf = async (journalId: unknown) =>
  (await journalModel.findById(journalId).exec())!.lines.map((l) => [l.description, l.debitPaise, l.creditPaise]);

async function postedBill(orgId: string, vendorId: string, number: string, extra: Record<string, unknown> = {}) {
  const draft = await bills.create({ orgId, vendorId, billNumber: number, billDate: '2026-10-05', amountsPaise: thousand, ...extra });
  return bills.post(draft._id.toString(), orgId, ACTOR_ID);
}

describe('TDS on bills', () => {
  it("withholds the vendor's section: AP less TDS, TDS Payable credited", async () => {
    const orgId = new Types.ObjectId().toString();
    const vendor = await vendors.create({ orgId, name: 'Contractor Co', gstin: COMPANY_GSTIN, tdsSection: '194C' });
    expect(vendor.pan).toBe('AAPFU0939F');
    expect(vendor.tdsRateBps).toBe(200);

    const bill = await postedBill(orgId, vendor._id.toString(), 'CC-1');
    expect(bill.tds?.amountPaise).toBe(2000); // 2% of ₹1,000 — never of the GST
    expect(await linesOf(bill.journalId)).toEqual([
      ['Purchases', 100000, 0],
      ['Input CGST', 9000, 0],
      ['Input SGST', 9000, 0],
      ['Accounts Payable', 0, 116000],
      ['TDS Payable', 0, 2000],
    ]);

    const paid = await bills.markPaid(bill._id.toString(), orgId, ACTOR_ID);
    expect(paid.status).toBe(BillStatus.PAID);
    expect(paid.payments[0].amountPaise).toBe(116000);
  });

  it('194C deducts 1% from an individual and nothing when the bill says none', async () => {
    const orgId = new Types.ObjectId().toString();
    const person = await vendors.create({ orgId, name: 'Ravi the plumber', pan: 'ABCPD1234E', tdsSection: '194C' });
    expect(person.tdsRateBps).toBe(100);
    expect((await postedBill(orgId, person._id.toString(), 'RP-1')).tds?.amountPaise).toBe(1000);
    expect((await postedBill(orgId, person._id.toString(), 'RP-2', { tdsSection: 'none' })).tds).toBeNull();
  });

  it('a debit note gives back its share of the TDS', async () => {
    const orgId = new Types.ObjectId().toString();
    const vendor = await vendors.create({ orgId, name: 'Contractor Two', gstin: COMPANY_GSTIN, tdsSection: '194C' });
    const bill = await postedBill(orgId, vendor._id.toString(), 'CC-2');

    const note = await debitNotes.create(bill._id.toString(), orgId, ACTOR_ID, {
      noteDate: '2026-10-10', reason: 'Half the work redone at their cost', taxableValuePaise: 50000,
    });
    expect(await linesOf(note.journalId)).toEqual([
      ['Purchases', 0, 50000],
      ['Input CGST', 0, 4500],
      ['Input SGST', 0, 4500],
      ['Accounts Payable', 58000, 0],
      ['TDS Payable', 1000, 0],
    ]);
    const stored = await billModel.findById(bill._id).exec();
    expect(stored?.tds?.amountPaise).toBe(1000);
    expect((await vendors.outstanding(vendor._id.toString(), orgId))).toBe(58000);
  });
});

describe('reverse charge', () => {
  it('the vendor is owed the taxable value; the tax is our liability, with input credit', async () => {
    const orgId = new Types.ObjectId().toString();
    const vendor = await vendors.create({ orgId, name: 'Unregistered transporter' });
    const bill = await postedBill(orgId, vendor._id.toString(), 'GTA-1', { isReverseCharge: true });

    expect(await linesOf(bill.journalId)).toEqual([
      ['Purchases', 100000, 0],
      ['Input CGST', 9000, 0],
      ['Input SGST', 9000, 0],
      ['Accounts Payable', 0, 100000],
      ['GST Payable (Reverse Charge)', 0, 18000],
    ]);
    expect(await vendors.outstanding(vendor._id.toString(), orgId)).toBe(100000);
  });

  it('with TDS too, and a debit note takes back the liability for the returned part', async () => {
    const orgId = new Types.ObjectId().toString();
    const vendor = await vendors.create({ orgId, name: 'Advocate', pan: 'ABCPA1234F', tdsSection: '194J-b' });
    const bill = await postedBill(orgId, vendor._id.toString(), 'ADV-1', { isReverseCharge: true });
    expect((await linesOf(bill.journalId)).slice(3)).toEqual([
      ['Accounts Payable', 0, 90000], // ₹1,000 less 10% TDS
      ['TDS Payable', 0, 10000],
      ['GST Payable (Reverse Charge)', 0, 18000],
    ]);

    const note = await debitNotes.create(bill._id.toString(), orgId, ACTOR_ID, {
      noteDate: '2026-10-08', reason: 'Fee reduced', taxableValuePaise: 100000,
    });
    expect((await linesOf(note.journalId)).slice(3)).toEqual([
      ['Accounts Payable', 90000, 0],
      ['TDS Payable', 10000, 0],
      ['GST Payable (Reverse Charge)', 18000, 0],
    ]);
    expect((await billModel.findById(bill._id).exec())?.status).toBe(BillStatus.PAID);
  });
});

describe('TDS register and deposits', () => {
  it('groups by month and section, deposits once, and a reversed deposit is undeposited again', async () => {
    const orgId = new Types.ObjectId().toString();
    const contractor = await vendors.create({ orgId, name: 'Builder', gstin: COMPANY_GSTIN, tdsSection: '194C' });
    const landlord = await vendors.create({ orgId, name: 'Landlord', pan: 'ABCPL1234G', tdsSection: '194I-b' });
    await postedBill(orgId, contractor._id.toString(), 'B-1');
    await postedBill(orgId, contractor._id.toString(), 'B-2');
    await postedBill(orgId, landlord._id.toString(), 'RENT-OCT');

    let register = await tds.payable(orgId, '2026-27');
    expect(register.months.map((m) => [m.month, m.section, m.pendingPaise, m.dueDate])).toEqual([
      ['2026-10', '194C', 4000, '2026-11-07'],
      ['2026-10', '194I-b', 10000, '2026-11-07'],
    ]);

    const deposit = await tds.deposit(orgId, ACTOR_ID, {
      month: '2026-10', section: '194C', paidOn: '2026-11-06', challanNumber: 'ITNS281-00042',
    });
    expect(deposit.amountPaise).toBe(4000);
    expect(await linesOf(deposit.journalId)).toEqual([
      ['TDS Payable', 4000, 0],
      ['Bank Accounts', 0, 4000],
    ]);
    await expect(
      tds.deposit(orgId, ACTOR_ID, { month: '2026-10', section: '194C', paidOn: '2026-11-07', challanNumber: 'AGAIN-1' }),
    ).rejects.toThrow(/No undeposited 194C TDS for 2026-10/);

    register = await tds.payable(orgId, '2026-27');
    expect(register.months.find((m) => m.section === '194C')?.depositedPaise).toBe(4000);

    await reversals.reverse(String(deposit.journalId), orgId, ACTOR_ID);
    register = await tds.payable(orgId, '2026-27');
    expect(register.months.find((m) => m.section === '194C')?.pendingPaise).toBe(4000);
  });
});

describe('TDS a customer deducted', () => {
  it('settles the invoice through TDS Receivable, and reversing the receipt undoes both', async () => {
    const orgId = new Types.ObjectId().toString();
    const customer = await customers.create({ orgId, name: 'Big Client Ltd' });
    const draft = await invoices.create({
      orgId, customerId: customer._id.toString(), invoiceNumber: 'FEE-1', invoiceDate: '2026-10-01',
      amountsPaise: { taxableValue: 1000000, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 1000000 },
    });
    await invoices.post(draft._id.toString(), orgId, ACTOR_ID);

    // ₹10,000 fee, client deducts 10% under 194J and pays ₹9,000.
    const paid = await invoices.markPaid(draft._id.toString(), orgId, ACTOR_ID, '2026-10-20', 900000, 100000);
    expect(paid.status).toBe(InvoiceStatus.PAID);
    expect(await linesOf(paid.payments[0].journalId)).toEqual([
      ['Bank Accounts', 900000, 0],
      ['TDS Receivable', 100000, 0],
      ['Accounts Receivable', 0, 1000000],
    ]);
    expect((await tds.receivable(orgId, '2026-27')).map((r) => [r.customerName, r.receivedPaise, r.tdsPaise])).toEqual([
      ['Big Client Ltd', 900000, 100000],
    ]);

    await reversals.reverse(String(paid.payments[0].journalId), orgId, ACTOR_ID);
    const stored = await invoiceModel.findById(draft._id).exec();
    expect(stored?.status).toBe(InvoiceStatus.POSTED);
    expect(stored?.amountPaidPaise).toBe(0);
  });
});

describe('system accounts for an older chart', () => {
  it('adopts TDS Payable and adds TDS Receivable on first use', async () => {
    const orgId = new Types.ObjectId().toString();
    await accounts.seedDefaults(orgId);
    // Make it look like a chart seeded before these keys existed.
    await ledgerModel.collection.updateOne({ orgId, code: '2300' }, { $unset: { systemKey: '' } });
    await ledgerModel.collection.deleteOne({ orgId, systemKey: SystemAccountKey.TDS_RECEIVABLE });

    const found = await accounts.resolveSystemAccounts(orgId, [SystemAccountKey.TDS_PAYABLE, SystemAccountKey.TDS_RECEIVABLE]);
    expect(found.get(SystemAccountKey.TDS_PAYABLE)?.code).toBe('2300');
    expect(found.get(SystemAccountKey.TDS_RECEIVABLE)?.name).toBe('TDS Receivable');
    expect(await ledgerModel.countDocuments({ orgId, name: 'TDS Payable' })).toBe(1);
  });
});


