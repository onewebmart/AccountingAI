/**
 * Phase 10 Integration Tests — Sales (CustomersService + SalesInvoicesService).
 *
 * Done when:
 *  ✓ Customer can be created and retrieved
 *  ✓ SalesInvoice created as DRAFT, sent → SENT, posted via PostingService → POSTED
 *  ✓ Posting creates a balanced journal (Invariant 2)
 *  ✓ Receivable for customer = sum of SENT + POSTED (unpaid) invoices
 *  ✓ After markPaid, receivable drops to zero
 *  ✓ AR ageing buckets invoices by days past due date
 *  ✓ Cannot post an already-posted invoice
 *  ✓ AR reconciles to GL: sum of unpaid invoice totals = sum of journal AR debits
 */
import 'reflect-metadata';
import mongoose, { Types, Model } from 'mongoose';
import { testMongoUri } from '../test-utils/mongo';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import configuration from '../config/configuration';
import { CustomersService } from './customers.service';
import { SalesInvoicesService } from './sales-invoices.service';
import { Customer, CustomerSchema, CustomerDocument } from './schemas/customer.schema';
import { SalesInvoice, SalesInvoiceSchema, SalesInvoiceDocument } from './schemas/sales-invoice.schema';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { PostingService, financialYearOf } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { InvoiceStatus, VoucherType } from '@ai-accounting/shared';

const ORG_ID = new Types.ObjectId().toString();
const ACTOR_ID = new Types.ObjectId().toString();

let moduleRef: TestingModule;
let customersSvc: CustomersService;
let invoicesSvc: SalesInvoicesService;
let invoiceModel: Model<SalesInvoiceDocument>;
let journalModel: Model<JournalDocument>;

beforeAll(async () => {

  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: Customer.name, schema: CustomerSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        // Posting resolves real accounts by system key, seeding the chart on
        // first use — so these specs need the ledger accounts collection.
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
      ]),
    ],
    providers: [CustomersService, SalesInvoicesService, PostingService, AccountsService, AuditService],
  }).compile();

  customersSvc = moduleRef.get(CustomersService);
  invoicesSvc = moduleRef.get(SalesInvoicesService);
  invoiceModel = moduleRef.get<Model<SalesInvoiceDocument>>(getModelToken(SalesInvoice.name));
  journalModel = moduleRef.get<Model<JournalDocument>>(getModelToken(Journal.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

// ── Helpers ───────────────────────────────────────────────────────────────

async function seedCustomer(name = 'Rahul Enterprises') {
  return customersSvc.create({ orgId: ORG_ID, name, gstin: '27AAPFU0939F1ZV' });
}

async function seedInvoice(customerId: string, overrides: Record<string, unknown> = {}) {
  return invoicesSvc.create({
    orgId: ORG_ID,
    customerId,
    invoiceNumber: 'INV-001',
    invoiceDate: '2025-04-15',
    dueDate: '2025-05-15',
    amountsPaise: {
      taxableValue: 2500000,
      cgst: 225000,
      sgst: 225000,
      igst: 0,
      cess: 0,
      total: 2950000,
    },
    ...overrides,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CustomersService', () => {
  it('creates and retrieves a customer', async () => {
    const customer = await seedCustomer('Test Customer Ltd');
    const found = await customersSvc.findById(customer._id.toString(), ORG_ID);
    expect(found.name).toBe('Test Customer Ltd');
    expect(found.orgId).toBe(ORG_ID);
  });

  it('takes the state from the GSTIN, or as given for an unregistered customer', async () => {
    const registered = await customersSvc.create({ orgId: ORG_ID, name: 'Registered', gstin: '27AAPFU0939F1ZV', stateCode: '29' });
    expect(registered.stateCode).toBe('27');
    const walkIn = await customersSvc.create({ orgId: ORG_ID, name: 'Walk-in', stateCode: '29' });
    expect(walkIn.stateCode).toBe('29');
    const unknown = await customersSvc.create({ orgId: ORG_ID, name: 'Unknown' });
    expect(unknown.stateCode).toBeNull();
  });

  it('lists customers scoped to orgId', async () => {
    await seedCustomer('Customer Alpha');
    await seedCustomer('Customer Beta');
    const customers = await customersSvc.list(ORG_ID);
    expect(customers.length).toBeGreaterThanOrEqual(2);
    expect(customers.every((c) => c.orgId === ORG_ID)).toBe(true);
  });
});

describe('SalesInvoicesService — lifecycle', () => {
  it('creates an invoice in DRAFT status', async () => {
    const customer = await seedCustomer();
    const invoice = await seedInvoice(customer._id.toString());
    expect(invoice.status).toBe(InvoiceStatus.DRAFT);
    expect(invoice.journalId).toBeNull();
    expect(invoice.amountsPaise.total).toBe(2950000);
  });

  it('send() transitions DRAFT → SENT (button: Send invoice → toast: Invoice sent)', async () => {
    const customer = await seedCustomer();
    const invoice = await seedInvoice(customer._id.toString());
    const sent = await invoicesSvc.send(invoice._id.toString(), ORG_ID, ACTOR_ID);
    expect(sent.status).toBe(InvoiceStatus.SENT);
    expect(sent.sentAt).not.toBeNull();
  });

  it('post() creates a balanced journal and transitions to POSTED', async () => {
    const customer = await seedCustomer();
    const invoice = await seedInvoice(customer._id.toString(), { invoiceDate: '2025-05-01', dueDate: '2025-06-01' });

    const posted = await invoicesSvc.post(invoice._id.toString(), ORG_ID, ACTOR_ID);

    expect(posted.status).toBe(InvoiceStatus.POSTED);
    expect(posted.journalId).not.toBeNull();

    // Journal must be balanced (Invariant 2)
    const journal = await journalModel.findById(posted.journalId).exec();
    const totalDebit = journal!.lines.reduce((s, l) => s + l.debitPaise, 0);
    const totalCredit = journal!.lines.reduce((s, l) => s + l.creditPaise, 0);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(2950000);
  });

  it('can post a SENT invoice (also valid)', async () => {
    const customer = await seedCustomer();
    const invoice = await seedInvoice(customer._id.toString(), { invoiceDate: '2025-06-01', dueDate: '2025-07-01' });
    await invoicesSvc.send(invoice._id.toString(), ORG_ID, ACTOR_ID);
    const posted = await invoicesSvc.post(invoice._id.toString(), ORG_ID, ACTOR_ID);
    expect(posted.status).toBe(InvoiceStatus.POSTED);
  });

  it('cannot re-post an already-posted invoice', async () => {
    const customer = await seedCustomer();
    const invoice = await seedInvoice(customer._id.toString(), { invoiceDate: '2025-07-01' });
    await invoicesSvc.post(invoice._id.toString(), ORG_ID, ACTOR_ID);
    await expect(invoicesSvc.post(invoice._id.toString(), ORG_ID, ACTOR_ID)).rejects.toThrow('already');
  });

  it('markPaid() transitions POSTED → PAID and creates a receipt journal', async () => {
    const customer = await seedCustomer();
    const invoice = await seedInvoice(customer._id.toString(), { invoiceDate: '2025-08-01' });
    await invoicesSvc.post(invoice._id.toString(), ORG_ID, ACTOR_ID);
    const paid = await invoicesSvc.markPaid(invoice._id.toString(), ORG_ID, ACTOR_ID);
    expect(paid.status).toBe(InvoiceStatus.PAID);
  });
});

describe('CustomersService — receivables & reconciliation', () => {
  it('receivable equals sum of sent+posted (unpaid) invoices', async () => {
    const customer = await seedCustomer('Receivables Customer');

    const inv1 = await invoicesSvc.create({
      orgId: ORG_ID,
      customerId: customer._id.toString(),
      invoiceDate: '2025-09-01',
      amountsPaise: { taxableValue: 1000000, cgst: 90000, sgst: 90000, igst: 0, cess: 0, total: 1180000 },
    });
    const inv2 = await invoicesSvc.create({
      orgId: ORG_ID,
      customerId: customer._id.toString(),
      invoiceDate: '2025-09-05',
      amountsPaise: { taxableValue: 500000, cgst: 45000, sgst: 45000, igst: 0, cess: 0, total: 590000 },
    });

    await invoicesSvc.post(inv1._id.toString(), ORG_ID, ACTOR_ID);
    await invoicesSvc.send(inv2._id.toString(), ORG_ID, ACTOR_ID); // sent not posted

    const receivable = await customersSvc.receivable(customer._id.toString(), ORG_ID);
    expect(receivable).toBe(1180000 + 590000);
  });

  it('receivable drops to zero after payment', async () => {
    const customer = await seedCustomer('Paid Customer');
    const inv = await invoicesSvc.create({
      orgId: ORG_ID,
      customerId: customer._id.toString(),
      invoiceDate: '2025-10-01',
      amountsPaise: { taxableValue: 200000, cgst: 18000, sgst: 18000, igst: 0, cess: 0, total: 236000 },
    });
    await invoicesSvc.post(inv._id.toString(), ORG_ID, ACTOR_ID);
    await invoicesSvc.markPaid(inv._id.toString(), ORG_ID, ACTOR_ID);

    const receivable = await customersSvc.receivable(customer._id.toString(), ORG_ID);
    expect(receivable).toBe(0);
  });

  it('AR reconciles to GL: sum of unpaid invoice totals = sum of journal AR debits', async () => {
    const customer = await seedCustomer('AR Recon Customer');

    const amounts1 = { taxableValue: 800000, cgst: 72000, sgst: 72000, igst: 0, cess: 0, total: 944000 };
    const amounts2 = { taxableValue: 400000, cgst: 36000, sgst: 36000, igst: 0, cess: 0, total: 472000 };

    const inv1 = await invoicesSvc.create({ orgId: ORG_ID, customerId: customer._id.toString(), invoiceDate: '2025-11-01', amountsPaise: amounts1 });
    const inv2 = await invoicesSvc.create({ orgId: ORG_ID, customerId: customer._id.toString(), invoiceDate: '2025-11-05', amountsPaise: amounts2 });

    const posted1 = await invoicesSvc.post(inv1._id.toString(), ORG_ID, ACTOR_ID);
    const posted2 = await invoicesSvc.post(inv2._id.toString(), ORG_ID, ACTOR_ID);

    // Receivable (AR balance from invoice side)
    const receivable = await customersSvc.receivable(customer._id.toString(), ORG_ID);
    expect(receivable).toBe(944000 + 472000);

    // GL side: sum of AR debits from the two sales journals
    const j1 = await journalModel.findById(posted1.journalId).exec();
    const j2 = await journalModel.findById(posted2.journalId).exec();
    const arDebits =
      j1!.lines.reduce((s, l) => s + l.debitPaise, 0) +
      j2!.lines.reduce((s, l) => s + l.debitPaise, 0);

    // Each journal's debit side = total paise (Accounts Receivable)
    expect(arDebits).toBe(receivable);
  });
});

describe('CustomersService — AR ageing', () => {
  it('buckets overdue invoices by days past due date', async () => {
    const customer = await seedCustomer('AR Ageing Customer');

    // Past due 70 days
    const overdue70 = await invoicesSvc.create({
      orgId: ORG_ID,
      customerId: customer._id.toString(),
      invoiceDate: '2025-04-01',
      dueDate: new Date(Date.now() - 70 * 86_400_000).toISOString().slice(0, 10),
      amountsPaise: { taxableValue: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0, total: 118000 },
    });
    await invoicesSvc.post(overdue70._id.toString(), ORG_ID, ACTOR_ID);

    const ageing = await customersSvc.arAgeing(ORG_ID);
    expect(ageing.days61_90).toBeGreaterThanOrEqual(118000);
    expect(ageing.total).toBeGreaterThan(0);
  });
});

describe('SalesInvoicesService — a double-click posts once', () => {
  const settle = <T>(ps: Promise<T>[]) => Promise.allSettled(ps);
  const fulfilled = (rs: PromiseSettledResult<unknown>[]) => rs.filter((r) => r.status === 'fulfilled');
  const reasons = (rs: PromiseSettledResult<unknown>[]) =>
    rs.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => String(r.reason));

  it('two simultaneous posts create one sales journal', async () => {
    const customer = await seedCustomer('Race Post Customer');
    const inv = await seedInvoice(customer._id.toString(), { invoiceNumber: 'INV-RACE-POST' });

    const results = await settle([
      invoicesSvc.post(inv._id.toString(), ORG_ID, ACTOR_ID),
      invoicesSvc.post(inv._id.toString(), ORG_ID, ACTOR_ID),
    ]);

    expect(fulfilled(results)).toHaveLength(1);
    // Either the up-front status check or the atomic claim refuses the loser.
    expect(reasons(results)).toEqual([expect.stringMatching(/already (been )?posted/i)]);
    expect(
      await journalModel.countDocuments({ orgId: ORG_ID, voucherType: VoucherType.SALES, narration: /^Sales invoice INV-RACE-POST / }),
    ).toBe(1);
    const stored = await invoiceModel.findById(inv._id).exec();
    expect(stored?.status).toBe(InvoiceStatus.POSTED);
    expect(stored?.journalId).toBeTruthy();
  });

  it('two simultaneous payments create one receipt', async () => {
    const customer = await seedCustomer('Race Pay Customer');
    const inv = await seedInvoice(customer._id.toString(), { invoiceNumber: 'INV-RACE-PAY' });
    await invoicesSvc.post(inv._id.toString(), ORG_ID, ACTOR_ID);

    const results = await settle([
      invoicesSvc.markPaid(inv._id.toString(), ORG_ID, ACTOR_ID),
      invoicesSvc.markPaid(inv._id.toString(), ORG_ID, ACTOR_ID),
    ]);

    expect(fulfilled(results)).toHaveLength(1);
    expect(reasons(results)).toEqual([expect.stringMatching(/already been marked paid|current: paid/i)]);
    expect(
      await journalModel.countDocuments({ orgId: ORG_ID, voucherType: VoucherType.RECEIPT, narration: 'Receipt for invoice INV-RACE-PAY' }),
    ).toBe(1);
  });

  it("files a receipt under the financial year of its own date, not the invoice's", async () => {
    const customer = await seedCustomer('Last Year Customer');
    // 400 days back is always in an earlier financial year than today.
    const lastYear = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
    const inv = await seedInvoice(customer._id.toString(), { invoiceNumber: 'INV-LAST-FY', invoiceDate: lastYear });
    await invoicesSvc.post(inv._id.toString(), ORG_ID, ACTOR_ID);
    await invoicesSvc.markPaid(inv._id.toString(), ORG_ID, ACTOR_ID);

    const receipt = await journalModel
      .findOne({ orgId: ORG_ID, voucherType: VoucherType.RECEIPT, narration: 'Receipt for invoice INV-LAST-FY' })
      .exec();
    expect(receipt!.date).toBe(new Date().toISOString().slice(0, 10));
    expect(receipt!.financialYear).toBe(financialYearOf(receipt!.date));
    expect(receipt!.financialYear).not.toBe(financialYearOf(lastYear));
  });
});

describe('SalesInvoicesService — part payments', () => {
  it('stays posted until the last rupee arrives, then is paid', async () => {
    const customer = await seedCustomer('Part Pay Customer');
    const inv = await seedInvoice(customer._id.toString(), { invoiceNumber: 'INV-PART-1' }); // ₹29,500
    await invoicesSvc.post(inv._id.toString(), ORG_ID, ACTOR_ID);

    const first = await invoicesSvc.markPaid(inv._id.toString(), ORG_ID, ACTOR_ID, '2026-10-01', 1000000);
    expect(first.status).toBe(InvoiceStatus.POSTED);
    expect(first.amountPaidPaise).toBe(1000000);
    expect(await customersSvc.receivable(customer._id.toString(), ORG_ID)).toBe(1950000);

    const rest = await invoicesSvc.markPaid(inv._id.toString(), ORG_ID, ACTOR_ID, '2026-10-05');
    expect(rest.status).toBe(InvoiceStatus.PAID);
    expect(rest.payments.map((p) => p.amountPaise)).toEqual([1000000, 1950000]);
    expect(await customersSvc.receivable(customer._id.toString(), ORG_ID)).toBe(0);

    const receipts = await journalModel
      .find({ orgId: ORG_ID, voucherType: VoucherType.RECEIPT, narration: /INV-PART-1/ })
      .sort({ date: 1 })
      .exec();
    expect(receipts.map((r) => [r.date, r.lines[0].debitPaise])).toEqual([
      ['2026-10-01', 1000000],
      ['2026-10-05', 1950000],
    ]);
    expect(receipts[0].narration).toMatch(/\(part\)$/);
  });

  it('refuses a payment larger than what is owed', async () => {
    const customer = await seedCustomer('Over Pay Customer');
    const inv = await seedInvoice(customer._id.toString(), { invoiceNumber: 'INV-OVER-1' });
    await invoicesSvc.post(inv._id.toString(), ORG_ID, ACTOR_ID);
    await invoicesSvc.markPaid(inv._id.toString(), ORG_ID, ACTOR_ID, undefined, 2000000);

    await expect(
      invoicesSvc.markPaid(inv._id.toString(), ORG_ID, ACTOR_ID, undefined, 1000000),
    ).rejects.toThrow(/₹10,000\.00 is more than the ₹9,500\.00 still owed/);
  });

  it('two part payments at once cannot overpay between them', async () => {
    const customer = await seedCustomer('Race Part Customer');
    const inv = await seedInvoice(customer._id.toString(), { invoiceNumber: 'INV-RACE-PART' }); // ₹29,500
    await invoicesSvc.post(inv._id.toString(), ORG_ID, ACTOR_ID);

    const results = await Promise.allSettled([
      invoicesSvc.markPaid(inv._id.toString(), ORG_ID, ACTOR_ID, undefined, 2000000),
      invoicesSvc.markPaid(inv._id.toString(), ORG_ID, ACTOR_ID, undefined, 2000000),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await invoiceModel.findById(inv._id).exec())?.amountPaidPaise).toBe(2000000);
  });

  it('AR ageing counts what is still owed', async () => {
    const customer = await seedCustomer('Ageing Part Customer');
    const before = await customersSvc.arAgeing(ORG_ID);
    const inv = await seedInvoice(customer._id.toString(), { invoiceNumber: 'INV-AGE-PART' });
    await invoicesSvc.post(inv._id.toString(), ORG_ID, ACTOR_ID);
    await invoicesSvc.markPaid(inv._id.toString(), ORG_ID, ACTOR_ID, undefined, 950000);

    const after = await customersSvc.arAgeing(ORG_ID);
    expect(after.total - before.total).toBe(2000000);
  });

  it('lists each customer with what they still owe', async () => {
    const customer = await seedCustomer('Listed Owing Customer');
    const inv = await seedInvoice(customer._id.toString(), { invoiceNumber: 'INV-LIST-1' });
    await invoicesSvc.post(inv._id.toString(), ORG_ID, ACTOR_ID);
    await invoicesSvc.markPaid(inv._id.toString(), ORG_ID, ACTOR_ID, undefined, 500000);

    const listed = (await customersSvc.list(ORG_ID)).find((c) => String(c._id) === String(customer._id));
    expect(listed?.receivablePaise).toBe(2450000);
  });
});
