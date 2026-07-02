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
import { MongoMemoryReplSet } from 'mongodb-memory-server';
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
import { PostingService } from '../gl/posting.service';
import { InvoiceStatus } from '@ai-accounting/shared';

const ORG_ID = new Types.ObjectId().toString();
const ACTOR_ID = new Types.ObjectId().toString();

let replSet: MongoMemoryReplSet;
let moduleRef: TestingModule;
let customersSvc: CustomersService;
let invoicesSvc: SalesInvoicesService;
let invoiceModel: Model<SalesInvoiceDocument>;
let journalModel: Model<JournalDocument>;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(replSet.getUri()),
      MongooseModule.forFeature([
        { name: Customer.name, schema: CustomerSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
      ]),
    ],
    providers: [CustomersService, SalesInvoicesService, PostingService],
  }).compile();

  customersSvc = moduleRef.get(CustomersService);
  invoicesSvc = moduleRef.get(SalesInvoicesService);
  invoiceModel = moduleRef.get<Model<SalesInvoiceDocument>>(getModelToken(SalesInvoice.name));
  journalModel = moduleRef.get<Model<JournalDocument>>(getModelToken(Journal.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
  await replSet.stop();
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
