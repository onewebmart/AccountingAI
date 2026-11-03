/**
 * Integration tests — credit notes against sales invoices, and debit notes
 * against purchase bills.
 *
 *  ✓ A part credit reverses sales and output tax in proportion, numbered CRN/…
 *  ✓ Crediting what remains closes the invoice, and the notes add up to it exactly
 *  ✓ A note never exceeds what is still owed, never predates the document
 *  ✓ Reversing a note's voucher takes the credit back; the note is kept, reversed
 *  ✓ A sale with a credit note against it cannot be reversed underneath it
 *  ✓ A debit note credits the ledger the bill actually posted to
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { AccountType, BillStatus, InvoiceStatus, VoucherType } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { SalesInvoicesService } from './sales-invoices.service';
import { CustomersService } from './customers.service';
import { CreditNotesService } from './credit-notes.service';
import { SalesInvoice, SalesInvoiceSchema, SalesInvoiceDocument } from './schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from './schemas/customer.schema';
import { CreditNote, CreditNoteSchema, CreditNoteDocument } from './schemas/credit-note.schema';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { VendorsService } from '../purchase/vendors.service';
import { DebitNotesService } from '../purchase/debit-notes.service';
import { PurchaseBill, PurchaseBillSchema, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';
import { JournalReversalService } from '../journals/journal-reversal.service';
import { TdsDeposit, TdsDepositSchema } from '../tds/schemas/tds-deposit.schema';
import {
  BankStatementLine,
  BankStatementLineSchema,
} from '../banking/schemas/bank-statement-line.schema';

const ACTOR_ID = new Types.ObjectId().toString();
// ₹8,474.58 + 9% CGST + 9% SGST = ₹10,000
const tenThousand = { taxableValue: 847458, cgst: 76271, sgst: 76271, igst: 0, cess: 0, total: 1000000 };

let moduleRef: TestingModule;
let invoices: SalesInvoicesService;
let customers: CustomersService;
let creditNotes: CreditNotesService;
let bills: PurchaseBillsService;
let vendors: VendorsService;
let debitNotes: DebitNotesService;
let reversals: JournalReversalService;
let posting: PostingService;
let accounts: AccountsService;
let journalModel: Model<JournalDocument>;
let invoiceModel: Model<SalesInvoiceDocument>;
let billModel: Model<PurchaseBillDocument>;
let noteModel: Model<CreditNoteDocument>;

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
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
        { name: TdsDeposit.name, schema: TdsDepositSchema },
      ]),
    ],
    providers: [
      PostingService, AccountsService, AuditService,
      SalesInvoicesService, CustomersService, CreditNotesService,
      PurchaseBillsService, VendorsService, DebitNotesService,
      JournalReversalService,
    ],
  }).compile();

  invoices = moduleRef.get(SalesInvoicesService);
  customers = moduleRef.get(CustomersService);
  creditNotes = moduleRef.get(CreditNotesService);
  bills = moduleRef.get(PurchaseBillsService);
  vendors = moduleRef.get(VendorsService);
  debitNotes = moduleRef.get(DebitNotesService);
  reversals = moduleRef.get(JournalReversalService);
  posting = moduleRef.get(PostingService);
  accounts = moduleRef.get(AccountsService);
  journalModel = moduleRef.get(getModelToken(Journal.name));
  invoiceModel = moduleRef.get(getModelToken(SalesInvoice.name));
  billModel = moduleRef.get(getModelToken(PurchaseBill.name));
  noteModel = moduleRef.get(getModelToken(CreditNote.name));
  await journalModel.init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

async function postedInvoice(orgId: string, invoiceNumber: string) {
  const customer = await customers.create({ orgId, name: `Customer ${invoiceNumber}` });
  const draft = await invoices.create({
    orgId, customerId: customer._id.toString(), invoiceNumber, invoiceDate: '2026-10-08', amountsPaise: tenThousand,
  });
  return invoices.post(draft._id.toString(), orgId, ACTOR_ID);
}

/** Net debit − credit on accounts whose name matches, across posted journals. */
async function net(orgId: string, account: RegExp) {
  const posted = await journalModel.find({ orgId, status: 'posted' }).exec();
  return posted.flatMap((j) => j.lines).filter((l) => account.test(l.description)).reduce((s, l) => s + l.debitPaise - l.creditPaise, 0);
}

describe('credit notes', () => {
  it('a part credit reverses sales and output tax in proportion', async () => {
    const orgId = new Types.ObjectId().toString();
    const invoice = await postedInvoice(orgId, 'KT/CN/1');

    const note = await creditNotes.create(invoice._id.toString(), orgId, ACTOR_ID, {
      noteDate: '2026-10-20', reason: 'Two bolts of cloth returned', taxableValuePaise: 100000,
    });

    expect(note.noteNumber).toBe('CRN/2026-27/0001');
    expect(note.toObject().amountsPaise).toEqual({ taxableValue: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0, total: 118000 });
    const journal = await journalModel.findById(note.journalId).exec();
    expect(journal?.voucherType).toBe(VoucherType.CREDIT_NOTE);
    expect(journal?.lines.map((l) => [l.description, l.debitPaise, l.creditPaise])).toEqual([
      ['Sales Revenue', 100000, 0],
      ['Output CGST', 9000, 0],
      ['Output SGST', 9000, 0],
      ['Accounts Receivable', 0, 118000],
    ]);

    const stored = await invoiceModel.findById(invoice._id).exec();
    expect(stored?.status).toBe(InvoiceStatus.POSTED);
    expect(stored?.adjustedPaise).toBe(118000);
    expect(await customers.receivable(String(stored?.customerId), orgId)).toBe(882000);
  });

  it('crediting what remains closes the invoice, and the notes add up to it exactly', async () => {
    const orgId = new Types.ObjectId().toString();
    const invoice = await postedInvoice(orgId, 'KT/CN/2');
    const id = invoice._id.toString();
    await creditNotes.create(id, orgId, ACTOR_ID, { noteDate: '2026-10-20', reason: 'Price corrected', taxableValuePaise: 333333 });
    await creditNotes.create(id, orgId, ACTOR_ID, { noteDate: '2026-10-21', reason: 'Rest returned', taxableValuePaise: 847458 - 333333 });

    const stored = await invoiceModel.findById(invoice._id).exec();
    expect(stored?.status).toBe(InvoiceStatus.PAID);
    expect(stored?.adjustedPaise).toBe(1000000);
    // Sales, output tax and the receivable are all back to zero — no stray paisa.
    expect(await net(orgId, /^Sales/)).toBe(0);
    expect(await net(orgId, /Output CGST/)).toBe(0);
    expect(await net(orgId, /Receivable/)).toBe(0);
  });

  it('never exceeds what is owed, never predates the invoice, and needs a posted invoice', async () => {
    const orgId = new Types.ObjectId().toString();
    const invoice = await postedInvoice(orgId, 'KT/CN/3');
    const id = invoice._id.toString();
    await invoices.markPaid(id, orgId, ACTOR_ID, '2026-10-10', 900000);

    await expect(
      creditNotes.create(id, orgId, ACTOR_ID, { noteDate: '2026-10-20', reason: 'Too much', taxableValuePaise: 200000 }),
    ).rejects.toThrow(/₹2,360\.00 is more than the ₹1,000\.00 still owed/);
    await expect(
      creditNotes.create(id, orgId, ACTOR_ID, { noteDate: '2026-10-01', reason: 'Backdated', taxableValuePaise: 100 }),
    ).rejects.toThrow(/cannot be dated before/);

    // Without the payments service there is nowhere to hold the customer's
    // credit, so a note on a paid invoice is still refused here. With it, the
    // excess becomes credit: see payments/party-payments.service.spec.ts.
    await invoices.markPaid(id, orgId, ACTOR_ID, '2026-10-11');
    await expect(
      creditNotes.create(id, orgId, ACTOR_ID, { noteDate: '2026-10-20', reason: 'After payment', taxableValuePaise: 100 }),
    ).rejects.toThrow(/is more than the ₹0\.00 still owed/);
  });

  it('reversing the note takes the credit back; the note is kept, marked reversed', async () => {
    const orgId = new Types.ObjectId().toString();
    const invoice = await postedInvoice(orgId, 'KT/CN/4');
    const note = await creditNotes.create(invoice._id.toString(), orgId, ACTOR_ID, {
      noteDate: '2026-10-20', reason: 'Wrong item', taxableValuePaise: 847458,
    });
    expect((await invoiceModel.findById(invoice._id).exec())?.status).toBe(InvoiceStatus.PAID);

    // The sale cannot be reversed underneath its credit note…
    await expect(reversals.reverse(String(invoice.journalId), orgId, ACTOR_ID)).rejects.toThrow(/credit notes against it/);

    // …but the note can, which reopens the invoice.
    await reversals.reverse(String(note.journalId), orgId, ACTOR_ID);
    const stored = await invoiceModel.findById(invoice._id).exec();
    expect(stored?.status).toBe(InvoiceStatus.POSTED);
    expect(stored?.adjustedPaise).toBe(0);
    expect((await noteModel.findById(note._id).exec())?.status).toBe('reversed');
    expect(await net(orgId, /Receivable/)).toBe(1000000);
  });
});

describe('debit notes', () => {
  it('credits the ledger the bill actually posted to', async () => {
    // A bill the reviewer booked to Rent rather than the default Purchases.
    const orgId = new Types.ObjectId().toString();
    await accounts.seedDefaults(orgId);
    const rent = await accounts.create({ orgId, name: 'Office Rent', type: AccountType.EXPENSE });
    const sys = await accounts.resolveSystemAccounts(orgId, [
      SystemAccountKey.GST_INPUT_CGST, SystemAccountKey.GST_INPUT_SGST, SystemAccountKey.ACCOUNTS_PAYABLE,
    ]);
    const line = (key: SystemAccountKey, dr: number, cr: number) => ({
      accountId: sys.get(key)!._id.toString(), description: sys.get(key)!.name, debitPaise: dr, creditPaise: cr,
    });
    const journal = await posting.post({
      orgId, voucherType: VoucherType.PURCHASE, financialYear: '2026-27', date: '2026-10-01', postedBy: ACTOR_ID,
      lines: [
        { accountId: rent._id.toString(), description: 'Office Rent', debitPaise: 847458, creditPaise: 0 },
        line(SystemAccountKey.GST_INPUT_CGST, 76271, 0),
        line(SystemAccountKey.GST_INPUT_SGST, 76271, 0),
        line(SystemAccountKey.ACCOUNTS_PAYABLE, 0, 1000000),
      ],
    });
    const vendor = await vendors.create({ orgId, name: 'Landlord' });
    const bill = await billModel.create({
      orgId, vendorId: vendor._id, billNumber: 'RENT-OCT', billDate: '2026-10-01', status: BillStatus.POSTED,
      amountsPaise: tenThousand, journalId: journal._id, financialYear: '2026-27',
    });

    const note = await debitNotes.create(bill._id.toString(), orgId, ACTOR_ID, {
      noteDate: '2026-10-15', reason: 'Five days of the month waived', taxableValuePaise: 141243,
    });

    expect(note.noteNumber).toBe('DBN/2026-27/0001');
    const posted = await journalModel.findById(note.journalId).exec();
    const credited = posted?.lines.find((l) => l.creditPaise === 141243);
    expect(String(credited?.accountId)).toBe(String(rent._id));
    expect(posted?.lines.find((l) => l.debitPaise > 0)?.description).toBe('Accounts Payable');
    expect((await billModel.findById(bill._id).exec())?.adjustedPaise).toBe(note.amountsPaise.total);
  });
});
