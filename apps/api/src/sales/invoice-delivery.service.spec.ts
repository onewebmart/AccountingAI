/**
 * Integration tests — the invoice PDF and email.
 *
 *  ✓ The PDF prints the seller from Settings and the buyer as invoiced
 *  ✓ Email: needs a number, an address, and a mail server; each refusal says what to do
 *  ✓ Emailing attaches the PDF, marks a draft sent, records where it went, and audits it
 *  ✓ Another org's invoice is not found
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { InvoiceStatus } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { InvoiceDeliveryService } from './invoice-delivery.service';
import { MailerService } from '../mail/mailer.service';
import { AuditService } from '../gl/audit.service';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { SalesInvoice, SalesInvoiceSchema } from './schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from './schemas/customer.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';

const ACTOR = new Types.ObjectId().toString();
const mailer = { configured: true, send: jest.fn().mockResolvedValue({ messageId: '<abc@mail>' }) };

let moduleRef: TestingModule;
let delivery: InvoiceDeliveryService;
let invoices: Model<{ status: string; emailedTo: string | null; emailedAt: Date | null }>;
let customers: Model<{ _id: Types.ObjectId }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
      ]),
    ],
    providers: [InvoiceDeliveryService, AuditService, { provide: MailerService, useValue: mailer }],
  }).compile();
  delivery = moduleRef.get(InvoiceDeliveryService);
  invoices = moduleRef.get(getModelToken(SalesInvoice.name));
  customers = moduleRef.get(getModelToken(Customer.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

beforeEach(() => {
  mailer.configured = true;
  mailer.send.mockClear();
});

async function seed(email: string | null = 'ap@rao.example') {
  const orgId = new Types.ObjectId().toString();
  await moduleRef.get<Model<unknown>>(getModelToken(OrgSettings.name)).create({
    orgId, displayName: 'Kumar Textiles', gstin: '27AAPFU0939F1ZV', stateCode: '27', address: '12 MG Road, Pune', email: 'accounts@kumar.example',
    invoiceNotes: 'Pay to HDFC Bank A/c 50100000001234',
  });
  const [customer] = await customers.create([{ orgId, name: 'Rao Traders', gstin: '29AAACR5055K1Z2', stateCode: '29', email }]);
  const invoice = (status: InvoiceStatus, invoiceNumber: string | null) =>
    invoices.create({
      orgId, customerId: customer._id, invoiceNumber, invoiceDate: '2026-10-14', dueDate: '2026-11-13', status,
      amountsPaise: { taxableValue: 100000, cgst: 0, sgst: 0, igst: 18000, cess: 0, total: 118000 },
      lineItems: [{ description: 'Consulting, October', hsnSac: '998311', qty: 1, ratePaise: 100000, amountPaise: 100000, taxRatePct: 18 }],
    });
  return { orgId, invoice };
}

describe('invoice delivery', () => {
  it('renders the PDF with the seller from Settings', async () => {
    const { orgId, invoice } = await seed();
    const inv = await invoice(InvoiceStatus.POSTED, 'INV/2026-27/0007');
    const { filename, content } = await delivery.pdf(orgId, String(inv._id));
    expect(filename).toBe('Invoice-INV-2026-27-0007.pdf');
    const s = content.toString('latin1');
    expect(s).toContain('Kumar Textiles');
    expect(s).toContain('12 MG Road, Pune');
    expect(s).toContain('Karnataka \\(29\\)');
    await expect(delivery.pdf(new Types.ObjectId().toString(), String(inv._id))).rejects.toThrow(/not found/);
  });

  it('refuses to email without a number, an address, or a mail server', async () => {
    const { orgId, invoice } = await seed(null);
    const unnumbered = await invoice(InvoiceStatus.DRAFT, null);
    await expect(delivery.email(orgId, ACTOR, String(unnumbered._id), {})).rejects.toThrow(/Post the invoice first/);
    const numbered = await invoice(InvoiceStatus.POSTED, 'INV/2026-27/0008');
    await expect(delivery.email(orgId, ACTOR, String(numbered._id), {})).rejects.toThrow(/Rao Traders has no email address/);
    await expect(delivery.email(orgId, ACTOR, String(numbered._id), { to: 'not-an-address' })).rejects.toThrow(/not an email address/);
    mailer.configured = false;
    await expect(delivery.email(orgId, ACTOR, String(numbered._id), { to: 'ap@rao.example' })).rejects.toThrow(/nothing was sent/);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('emails the PDF, marks a numbered draft sent, and records it', async () => {
    const { orgId, invoice } = await seed();
    const inv = await invoice(InvoiceStatus.DRAFT, 'KT-101');
    const result = await delivery.email(orgId, ACTOR, String(inv._id), { cc: ['owner@kumar.example'], message: 'Thanks for the order.' });
    expect(result).toEqual({ emailedTo: 'ap@rao.example', cc: ['owner@kumar.example'], messageId: '<abc@mail>' });

    const mail = mailer.send.mock.calls[0][0];
    expect(mail).toMatchObject({ to: 'ap@rao.example', replyTo: 'accounts@kumar.example', fromName: 'Kumar Textiles', subject: 'Invoice KT-101 from Kumar Textiles' });
    expect(mail.text).toContain('Thanks for the order.');
    expect(mail.text).toContain('Rs. 1,180.00 is due by 13/11/2026.');
    expect(mail.attachments[0]).toMatchObject({ filename: 'Invoice-KT-101.pdf', contentType: 'application/pdf' });
    expect(mail.attachments[0].content.subarray(0, 8).toString()).toBe('%PDF-1.4');

    expect(await invoices.findById(inv._id).lean().exec()).toMatchObject({ status: InvoiceStatus.SENT, emailedTo: 'ap@rao.example' });
    const audit = moduleRef.get<Model<{ action: string; meta: Record<string, unknown> }>>(getModelToken(AuditLog.name));
    expect(await audit.findOne({ orgId, entityId: String(inv._id), action: 'EMAIL' }).lean().exec()).toMatchObject({ meta: { messageId: '<abc@mail>' } });
  });
});
