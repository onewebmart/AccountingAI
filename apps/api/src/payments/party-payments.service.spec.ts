/**
 * Integration tests — receipts and payments across documents, and advances.
 *
 *  ✓ One receipt settles two invoices (one with TDS) and holds the rest as an advance
 *  ✓ The advance is applied to a later invoice by a journal
 *  ✓ Reversal: the receipt is refused while its advance stands applied; the
 *    application reverses back into the advance; then the receipt reopens every invoice
 *  ✓ A payment to a vendor across two bills, with an advance
 *  ✓ Refused: more than owed, another customer's invoice, more allocated than received
 *  ✓ A credit note on a paid invoice is the customer's credit; refunded, and reversed in order
 *  ✓ A note on a part-paid invoice takes off what is owed, the rest as credit
 *  ✓ A debit note on a paid bill is the vendor's credit, refunded to us
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { BillStatus, InvoiceStatus } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { PartyPaymentsService } from './party-payments.service';
import { PartyPayment, PartyPaymentSchema } from './schemas/party-payment.schema';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { JournalReversalService } from '../journals/journal-reversal.service';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { CreditNotesService } from '../sales/credit-notes.service';
import { DebitNotesService } from '../purchase/debit-notes.service';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';
import { TdsDeposit, TdsDepositSchema } from '../tds/schemas/tds-deposit.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';

const ACTOR = new Types.ObjectId().toString();
const amounts = (taxable: number) => ({ taxableValue: taxable, cgst: 0, sgst: 0, igst: 0, cess: 0, total: taxable });

let moduleRef: TestingModule;
let payments: PartyPaymentsService;
let reversal: JournalReversalService;
let invoicesSvc: SalesInvoicesService;
let billsSvc: PurchaseBillsService;
let journals: Model<{ voucherType: string; lines: Array<{ description: string; debitPaise: number; creditPaise: number }> }>;
let invoices: Model<{ status: string; amountPaidPaise: number; payments: unknown[] }>;
let bills: Model<{ status: string; amountPaidPaise: number }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: PartyPayment.name, schema: PartyPaymentSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: CreditNote.name, schema: CreditNoteSchema },
        { name: DebitNote.name, schema: DebitNoteSchema },
        { name: TdsDeposit.name, schema: TdsDepositSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
      ]),
    ],
    providers: [PartyPaymentsService, PostingService, AccountsService, AuditService, JournalReversalService, SalesInvoicesService, PurchaseBillsService, CreditNotesService, DebitNotesService],
  }).compile();
  payments = moduleRef.get(PartyPaymentsService);
  reversal = moduleRef.get(JournalReversalService);
  invoicesSvc = moduleRef.get(SalesInvoicesService);
  billsSvc = moduleRef.get(PurchaseBillsService);
  journals = moduleRef.get(getModelToken(Journal.name));
  invoices = moduleRef.get(getModelToken(SalesInvoice.name));
  bills = moduleRef.get(getModelToken(PurchaseBill.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

async function seed() {
  const orgId = new Types.ObjectId().toString();
  const customers = moduleRef.get<Model<{ _id: Types.ObjectId }>>(getModelToken(Customer.name));
  const [rao] = await customers.create([{ orgId, name: 'Rao Traders' }]);
  const [meera] = await customers.create([{ orgId, name: 'Meera Stores' }]);
  const invoice = async (customerId: Types.ObjectId, number: string, date: string, taxable: number) => {
    const inv = await invoicesSvc.create({ orgId, customerId: String(customerId), invoiceNumber: number, invoiceDate: date, dueDate: date, amountsPaise: amounts(taxable) });
    await invoicesSvc.post(String(inv._id), orgId, ACTOR);
    return String(inv._id);
  };
  return { orgId, rao: String(rao._id), meera: String(meera._id), raoId: rao._id, meeraId: meera._id, invoice };
}

const linesOf = async (id: unknown) =>
  (await journals.findById(id).lean().exec())!.lines.map((l) => [l.description, l.debitPaise, l.creditPaise]);

describe('receipts across invoices', () => {
  it('settles several invoices, holds the rest as an advance, applies it, and reverses in order', async () => {
    const { orgId, rao, raoId, invoice } = await seed();
    const a = await invoice(raoId, 'INV-1', '2026-09-01', 100000);
    const b = await invoice(raoId, 'INV-2', '2026-09-10', 50000);

    // ₹1,000 for INV-1 less ₹100 TDS (₹900 paid), ₹200 of INV-2, and ₹300 extra.
    const receipt = await payments.record(orgId, ACTOR, {
      kind: 'receipt', partyId: rao, date: '2026-10-05', amountPaise: 140000,
      allocations: [{ documentId: a, amountPaise: 90000, tdsPaise: 10000 }, { documentId: b, amountPaise: 20000 }],
    });
    expect(receipt).toMatchObject({ amountPaise: 140000, tdsPaise: 10000, unappliedPaise: 30000, status: 'posted' });
    expect(await linesOf(receipt.journalId)).toEqual([
      ['Bank Accounts', 140000, 0],
      ['TDS Receivable', 10000, 0],
      ['Accounts Receivable', 0, 120000],
      ['Advances from Customers', 0, 30000],
    ]);
    expect(await invoices.findById(a).lean().exec()).toMatchObject({ status: InvoiceStatus.PAID, amountPaidPaise: 100000 });
    expect(await invoices.findById(b).lean().exec()).toMatchObject({ status: InvoiceStatus.POSTED, amountPaidPaise: 20000 });
    expect(await payments.advances(orgId, 'receipt')).toEqual([{ partyId: rao, partyName: 'Rao Traders', unappliedPaise: 30000, payments: 1 }]);

    // A later invoice takes ₹250 of the advance.
    const c = await invoice(raoId, 'INV-3', '2026-10-20', 25000);
    const applied = await payments.applyAdvance(orgId, ACTOR, String(receipt._id), { documentId: c, amountPaise: 25000, date: '2026-10-20' });
    expect(applied.unappliedPaise).toBe(5000);
    const applyJournal = applied.allocations[2].journalId;
    expect(await linesOf(applyJournal)).toEqual([
      ['Advances from Customers', 25000, 0],
      ['Accounts Receivable', 0, 25000],
    ]);
    expect(await invoices.findById(c).lean().exec()).toMatchObject({ status: InvoiceStatus.PAID });
    await expect(payments.applyAdvance(orgId, ACTOR, String(receipt._id), { documentId: b, amountPaise: 6000, date: '2026-10-21' })).rejects.toThrow(/Only ₹50.00/);

    // The receipt cannot go while its advance stands applied elsewhere.
    await expect(reversal.reverse(String(receipt.journalId), orgId, ACTOR)).rejects.toThrow(/applied later \(to INV-3\)/);
    await reversal.reverse(String(applyJournal), orgId, ACTOR);
    expect(await invoices.findById(c).lean().exec()).toMatchObject({ status: InvoiceStatus.POSTED, amountPaidPaise: 0 });
    expect((await moduleRef.get<Model<{ unappliedPaise: number }>>(getModelToken(PartyPayment.name)).findById(receipt._id).lean().exec())!.unappliedPaise).toBe(30000);

    // Now the receipt reverses, and every invoice it settled opens again.
    await reversal.reverse(String(receipt.journalId), orgId, ACTOR);
    expect(await invoices.findById(a).lean().exec()).toMatchObject({ status: InvoiceStatus.POSTED, amountPaidPaise: 0, payments: [] });
    expect(await invoices.findById(b).lean().exec()).toMatchObject({ status: InvoiceStatus.POSTED, amountPaidPaise: 0, payments: [] });
    expect(await payments.advances(orgId, 'receipt')).toEqual([]);
  });

  it('refuses more than owed, another customer’s invoice, and more allocated than received', async () => {
    const { orgId, rao, raoId, meeraId, invoice } = await seed();
    const a = await invoice(raoId, 'INV-1', '2026-09-01', 100000);
    const other = await invoice(meeraId, 'M-1', '2026-09-01', 100000);
    await expect(payments.record(orgId, ACTOR, { kind: 'receipt', partyId: rao, date: '2026-10-05', amountPaise: 200000, allocations: [{ documentId: a, amountPaise: 100001 }] })).rejects.toThrow(
      /only ₹1,000.00 outstanding/,
    );
    await expect(payments.record(orgId, ACTOR, { kind: 'receipt', partyId: rao, date: '2026-10-05', amountPaise: 100000, allocations: [{ documentId: other, amountPaise: 100000 }] })).rejects.toThrow(
      /not Rao Traders's/,
    );
    await expect(payments.record(orgId, ACTOR, { kind: 'receipt', partyId: rao, date: '2026-10-05', amountPaise: 50000, allocations: [{ documentId: a, amountPaise: 60000 }] })).rejects.toThrow(
      /more than the ₹500.00 that moved/,
    );
    expect(await journals.countDocuments({ orgId, voucherType: 'RECEIPT' })).toBe(0);
  });

  it('suggests from the narration, then the exact combination', async () => {
    const { orgId, rao, raoId, invoice } = await seed();
    await invoice(raoId, 'INV-7', '2026-09-01', 30000);
    const b = await invoice(raoId, 'INV-8', '2026-09-05', 45000);
    expect((await payments.suggest(orgId, 'receipt', rao, 45000, 'IMPS/RAO/INV-8')).allocations.map((x) => x.documentId)).toEqual([b]);
    expect((await payments.suggest(orgId, 'receipt', rao, 75000)).method).toBe('exact');
  });
});

describe('payments to vendors', () => {
  it('pays two bills and holds the rest as an advance to the vendor', async () => {
    const orgId = new Types.ObjectId().toString();
    const vendors = moduleRef.get<Model<{ _id: Types.ObjectId }>>(getModelToken(Vendor.name));
    const [sigma] = await vendors.create([{ orgId, name: 'Sigma Supplies' }]);
    const bill = async (n: string, taxable: number) => {
      const b = await billsSvc.create({ orgId, vendorId: String(sigma._id), billNumber: n, billDate: '2026-09-01', dueDate: '2026-09-30', amountsPaise: amounts(taxable) });
      await billsSvc.post(String(b._id), orgId, ACTOR);
      return String(b._id);
    };
    const x = await bill('PB-1', 40000);
    const y = await bill('PB-2', 60000);
    const paid = await payments.record(orgId, ACTOR, {
      kind: 'payment', partyId: String(sigma._id), date: '2026-10-01', amountPaise: 120000,
      allocations: [{ documentId: x, amountPaise: 40000 }, { documentId: y, amountPaise: 60000 }],
    });
    expect(await linesOf(paid.journalId)).toEqual([
      ['Accounts Payable', 100000, 0],
      ['Advances to Vendors', 20000, 0],
      ['Bank Accounts', 0, 120000],
    ]);
    expect((await bills.find({ orgId }).lean().exec()).map((b) => b.status)).toEqual([BillStatus.PAID, BillStatus.PAID]);
    await expect(payments.record(orgId, ACTOR, { kind: 'payment', partyId: String(sigma._id), date: '2026-10-01', amountPaise: 100, allocations: [{ documentId: x, amountPaise: 0, tdsPaise: 100 }] })).rejects.toThrow(
      /withheld when the bill is posted/,
    );
  });
});

describe('refunds and note credits', () => {
  const creditsOf = async (orgId: string, kind: 'receipt' | 'payment') =>
    (await payments.list(orgId, kind)).filter((p) => p.source !== 'money' && p.status === 'posted');

  it('turns a credit note on a paid invoice into the customer’s credit, refunds it, and reverses in order', async () => {
    const { orgId, rao, raoId, invoice } = await seed();
    const a = await invoice(raoId, 'INV-1', '2026-09-01', 100000);
    await payments.record(orgId, ACTOR, { kind: 'receipt', partyId: rao, date: '2026-09-10', amountPaise: 100000, allocations: [{ documentId: a, amountPaise: 100000 }] });

    const note = await moduleRef.get(CreditNotesService).create(a, orgId, ACTOR, { noteDate: '2026-10-01', reason: 'Goods returned', taxableValuePaise: 20000 });
    expect(await linesOf(note.journalId)).toEqual([
      ['Sales Revenue', 20000, 0],
      ['Advances from Customers', 0, 20000],
    ]);
    expect(await invoices.findById(a).lean().exec()).toMatchObject({ status: InvoiceStatus.PAID, amountPaidPaise: 100000 });
    const [credit] = await creditsOf(orgId, 'receipt');
    expect(credit).toMatchObject({ source: 'credit_note', unappliedPaise: 20000, partyName: 'Rao Traders' });

    const refunded = await payments.refund(orgId, ACTOR, String(credit._id), { amountPaise: 15000, date: '2026-10-05' });
    expect(refunded.unappliedPaise).toBe(5000);
    const refundJournal = refunded.refunds[0].journalId;
    expect(await linesOf(refundJournal)).toEqual([
      ['Advances from Customers', 15000, 0],
      ['Bank Accounts', 0, 15000],
    ]);
    await expect(payments.refund(orgId, ACTOR, String(credit._id), { amountPaise: 6000, date: '2026-10-06' })).rejects.toThrow(/Only ₹50.00/);

    await expect(reversal.reverse(String(note.journalId), orgId, ACTOR)).rejects.toThrow(/refunded since/);
    await reversal.reverse(String(refundJournal), orgId, ACTOR);
    expect((await creditsOf(orgId, 'receipt'))[0].unappliedPaise).toBe(20000);
    await reversal.reverse(String(note.journalId), orgId, ACTOR);
    expect(await creditsOf(orgId, 'receipt')).toEqual([]);
  });

  it('takes off what a part-paid invoice still owes, the rest as credit', async () => {
    const { orgId, rao, raoId, invoice } = await seed();
    const a = await invoice(raoId, 'INV-1', '2026-09-01', 100000);
    await payments.record(orgId, ACTOR, { kind: 'receipt', partyId: rao, date: '2026-09-10', amountPaise: 70000, allocations: [{ documentId: a, amountPaise: 70000 }] });
    const note = await moduleRef.get(CreditNotesService).create(a, orgId, ACTOR, { noteDate: '2026-10-01', reason: 'Rate revised', taxableValuePaise: 50000 });
    expect(await linesOf(note.journalId)).toEqual([
      ['Sales Revenue', 50000, 0],
      ['Accounts Receivable', 0, 30000],
      ['Advances from Customers', 0, 20000],
    ]);
    expect(await invoices.findById(a).lean().exec()).toMatchObject({ status: InvoiceStatus.PAID });
    expect((await creditsOf(orgId, 'receipt'))[0].unappliedPaise).toBe(20000);
  });

  it('turns a debit note on a paid bill into the vendor’s credit, refunded to us', async () => {
    const orgId = new Types.ObjectId().toString();
    const vendors = moduleRef.get<Model<{ _id: Types.ObjectId }>>(getModelToken(Vendor.name));
    const [sigma] = await vendors.create([{ orgId, name: 'Sigma Supplies' }]);
    const b = await billsSvc.create({ orgId, vendorId: String(sigma._id), billNumber: 'PB-9', billDate: '2026-09-01', dueDate: '2026-09-30', amountsPaise: amounts(60000) });
    await billsSvc.post(String(b._id), orgId, ACTOR);
    await payments.record(orgId, ACTOR, { kind: 'payment', partyId: String(sigma._id), date: '2026-09-15', amountPaise: 60000, allocations: [{ documentId: String(b._id), amountPaise: 60000 }] });

    const note = await moduleRef.get(DebitNotesService).create(String(b._id), orgId, ACTOR, { noteDate: '2026-10-01', reason: 'Short supply', taxableValuePaise: 10000 });
    expect(await linesOf(note.journalId)).toEqual([
      ['Purchases', 0, 10000],
      ['Advances to Vendors', 10000, 0],
    ]);
    const [credit] = await creditsOf(orgId, 'payment');
    const back = await payments.refund(orgId, ACTOR, String(credit._id), { amountPaise: 10000, date: '2026-10-10' });
    expect(await linesOf(back.refunds[0].journalId)).toEqual([
      ['Bank Accounts', 10000, 0],
      ['Advances to Vendors', 0, 10000],
    ]);
  });
});
