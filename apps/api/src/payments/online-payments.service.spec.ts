/**
 * Tests — getting paid online.
 *
 *  ✓ Razorpay webhooks are trusted only with a matching signature; other events are ignored
 *  ✓ A link asks for what is owed; a paid event marks the invoice and posts nothing
 *  ✓ Repeated paid events are harmless
 *  ✓ Confirming books a receipt through Payment Gateway Clearing and closes the invoice
 */
import 'reflect-metadata';
import { createHmac } from 'crypto';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { InvoiceStatus } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { OnlinePaymentsService } from './online-payments.service';
import { PartyPaymentsService } from './party-payments.service';
import { MockPaymentLinkProvider, PAYMENT_LINK_PROVIDER, PaidEvent, RazorpayPaymentLinkProvider } from './gateway/payment-link.provider';
import { PartyPayment, PartyPaymentSchema } from './schemas/party-payment.schema';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';

const ACTOR = new Types.ObjectId().toString();

describe('Razorpay webhook signature', () => {
  const secret = 'whsec_test';
  const provider = new RazorpayPaymentLinkProvider({ get: (k: string) => (k === 'razorpay.webhookSecret' ? secret : '') } as unknown as ConfigService);
  const body = Buffer.from(
    JSON.stringify({
      event: 'payment_link.paid',
      payload: {
        payment_link: { entity: { id: 'plink_1', reference_id: 'ref', amount_paid: 118000 } },
        payment: { entity: { id: 'pay_1', amount: 118000, created_at: 1791000000 } },
      },
    }),
  );
  const sign = (b: Buffer) => createHmac('sha256', secret).update(b).digest('hex');

  it('trusts only a matching signature', () => {
    expect(provider.parseWebhook(body, sign(body))).toEqual({ linkId: 'plink_1', referenceId: 'ref', paidPaise: 118000, gatewayPaymentId: 'pay_1', paidOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(() => provider.parseWebhook(body, sign(Buffer.from('tampered')))).toThrow(/does not match/);
    expect(() => provider.parseWebhook(body, undefined)).toThrow(/does not match/);
  });

  it('ignores events that are not a link being paid', () => {
    const other = Buffer.from(JSON.stringify({ event: 'payment.failed', payload: {} }));
    expect(provider.parseWebhook(other, sign(other))).toBeNull();
  });
});

describe('online payments', () => {
  let moduleRef: TestingModule;
  let online: OnlinePaymentsService;
  let invoicesSvc: SalesInvoicesService;
  let invoices: Model<{ status: string; paymentLink: Record<string, unknown> | null }>;
  let journals: Model<{ lines: Array<{ description: string; debitPaise: number; creditPaise: number }> }>;
  // The gateway, as the service sees it: the test provider, whose webhook we stand in for.
  const provider = new MockPaymentLinkProvider();
  const nextEvent: { value: PaidEvent | null } = { value: null };
  const gateway = Object.assign(Object.create(provider), { parseWebhook: () => nextEvent.value });

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
        ]),
      ],
      providers: [OnlinePaymentsService, PartyPaymentsService, PostingService, AccountsService, AuditService, SalesInvoicesService, { provide: PAYMENT_LINK_PROVIDER, useValue: gateway }],
    }).compile();
    online = moduleRef.get(OnlinePaymentsService);
    invoicesSvc = moduleRef.get(SalesInvoicesService);
    invoices = moduleRef.get(getModelToken(SalesInvoice.name));
    journals = moduleRef.get(getModelToken(Journal.name));
  }, 60_000);

  afterAll(async () => {
    await moduleRef.close();
    await mongoose.disconnect();
  });

  it('links, hears it was paid without posting, and books it once confirmed', async () => {
    const orgId = new Types.ObjectId().toString();
    const [rao] = await moduleRef.get<Model<{ _id: Types.ObjectId }>>(getModelToken(Customer.name)).create([{ orgId, name: 'Rao Traders', email: 'ap@rao.example' }]);
    const draft = await invoicesSvc.create({ orgId, customerId: String(rao._id), invoiceNumber: 'INV-50', invoiceDate: '2026-10-01', dueDate: '2026-10-31', amountsPaise: { taxableValue: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0, total: 118000 } });
    const id = String(draft._id);
    await expect(online.createLink(orgId, ACTOR, id)).rejects.toThrow(/Only a posted invoice/);
    await invoicesSvc.post(id, orgId, ACTOR);

    const link = await online.createLink(orgId, ACTOR, id);
    expect(link).toMatchObject({ provider: 'mock', amountPaise: 118000, status: 'created', url: expect.stringContaining('https://pay.example/') });

    const before = await journals.countDocuments({ orgId });
    nextEvent.value = { linkId: link.linkId, referenceId: link.referenceId, paidPaise: 118000, gatewayPaymentId: 'pay_9', paidOn: '2026-10-12' };
    expect(await online.handleWebhook(Buffer.from('{}'), 'sig')).toEqual({ ok: true, matched: true });
    expect(await online.handleWebhook(Buffer.from('{}'), 'sig')).toEqual({ ok: true, matched: true });
    expect(await journals.countDocuments({ orgId })).toBe(before);
    expect((await invoices.findById(id).lean().exec())!.paymentLink).toMatchObject({ status: 'paid', paidPaise: 118000, gatewayPaymentId: 'pay_9' });

    const receipt = await online.confirm(orgId, ACTOR, id);
    expect(receipt).toMatchObject({ via: 'gateway', amountPaise: 118000, reference: 'mock pay_9', date: '2026-10-12' });
    const journal = await journals.findById(receipt.journalId).lean().exec();
    expect(journal!.lines.map((l) => [l.description, l.debitPaise, l.creditPaise])).toEqual([
      ['Payment Gateway Clearing', 118000, 0],
      ['Accounts Receivable', 0, 118000],
    ]);
    expect(await invoices.findById(id).lean().exec()).toMatchObject({ status: InvoiceStatus.PAID, paymentLink: { status: 'confirmed' } });
    await expect(online.confirm(orgId, ACTOR, id)).rejects.toThrow(/no online payment on this invoice to confirm/);
  });

  it('ignores a paid event for a link nobody made', async () => {
    nextEvent.value = { linkId: 'plink_unknown', referenceId: null, paidPaise: 100, gatewayPaymentId: 'pay_x', paidOn: '2026-10-12' };
    expect(await online.handleWebhook(Buffer.from('{}'), 'sig')).toEqual({ ok: true, matched: false });
  });
});
