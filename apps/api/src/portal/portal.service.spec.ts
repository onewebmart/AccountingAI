/**
 * Integration tests — the customer portal.
 *
 *  ✓ A link shows that customer's issued invoices only: no drafts, no one else's
 *  ✓ It serves their PDFs, never another customer's
 *  ✓ Only the token's hash is stored; a tampered, expired or withdrawn link gets nowhere
 *  ✓ An open payment link is offered as "pay"
 */
import 'reflect-metadata';
import { createHash } from 'crypto';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { InvoiceStatus } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { PortalService } from './portal.service';
import { PortalLink, PortalLinkSchema } from './schemas/portal-link.schema';
import { InvoiceDeliveryService } from '../sales/invoice-delivery.service';
import { MailerService } from '../mail/mailer.service';
import { AuditService } from '../gl/audit.service';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';

const ACTOR = new Types.ObjectId().toString();

let moduleRef: TestingModule;
let portal: PortalService;
let invoices: Model<{ _id: Types.ObjectId }>;
let links: Model<{ tokenHash: string; expiresAt: Date }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: PortalLink.name, schema: PortalLinkSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
      ]),
    ],
    providers: [PortalService, InvoiceDeliveryService, AuditService, { provide: MailerService, useValue: { configured: false } }],
  }).compile();
  portal = moduleRef.get(PortalService);
  invoices = moduleRef.get(getModelToken(SalesInvoice.name));
  links = moduleRef.get(getModelToken(PortalLink.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

async function seed() {
  const orgId = new Types.ObjectId().toString();
  await moduleRef.get<Model<unknown>>(getModelToken(OrgSettings.name)).create({ orgId, displayName: 'Kumar Textiles', gstin: '27AAPFU0939F1ZV', stateCode: '27' });
  const customers = moduleRef.get<Model<{ _id: Types.ObjectId }>>(getModelToken(Customer.name));
  const [rao] = await customers.create([{ orgId, name: 'Rao Traders' }]);
  const [meera] = await customers.create([{ orgId, name: 'Meera Stores' }]);
  const invoice = async (customerId: Types.ObjectId, number: string, status: InvoiceStatus, extra: Record<string, unknown> = {}) =>
    (await invoices.create({ orgId, customerId, invoiceNumber: number, invoiceDate: '2026-10-01', dueDate: '2026-10-31', status, amountsPaise: { taxableValue: 10000, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 10000 }, ...extra }))._id;
  return { orgId, rao, meera, invoice };
}

describe('customer portal', () => {
  it('shows one customer their issued invoices and PDFs, and nothing else', async () => {
    const { orgId, rao, meera, invoice } = await seed();
    const open = await invoice(rao._id, 'INV-1', InvoiceStatus.POSTED, {
      paymentLink: { provider: 'mock', linkId: 'l1', url: 'https://pay.example/l1', referenceId: 'r', amountPaise: 10000, status: 'created', createdAt: new Date() },
    });
    await invoice(rao._id, 'INV-2', InvoiceStatus.PAID, { amountPaidPaise: 10000, invoiceDate: '2026-09-15' });
    await invoice(rao._id, 'INV-D', InvoiceStatus.DRAFT);
    const theirs = await invoice(meera._id, 'M-1', InvoiceStatus.POSTED);

    const { url } = await portal.createLink(orgId, ACTOR, String(rao._id));
    const token = url.split('/portal/')[1];
    expect(await links.countDocuments({ tokenHash: token })).toBe(0);
    expect(await links.countDocuments({ tokenHash: createHash('sha256').update(token).digest('hex') })).toBe(1);

    const view = await portal.view(token);
    expect(view.business).toMatchObject({ name: 'Kumar Textiles', gstin: '27AAPFU0939F1ZV' });
    expect(view.customer).toEqual({ name: 'Rao Traders' });
    expect(view.invoices.map((i) => [i.number, i.status, i.payUrl])).toEqual([
      ['INV-1', 'open', 'https://pay.example/l1'],
      ['INV-2', 'paid', null],
    ]);
    expect(view.owedPaise).toBe(10000);

    expect((await portal.pdf(token, String(open))).content.subarray(0, 8).toString()).toBe('%PDF-1.4');
    await expect(portal.pdf(token, String(theirs))).rejects.toThrow(/not found/);
  });

  it('refuses a tampered, expired or withdrawn link', async () => {
    const { orgId, rao } = await seed();
    const { url } = await portal.createLink(orgId, ACTOR, String(rao._id));
    const token = url.split('/portal/')[1];
    await expect(portal.view(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'))).rejects.toThrow(/expired or was withdrawn/);
    await expect(portal.view(`${new Types.ObjectId()}.${token.split('.')[1]}`)).rejects.toThrow(/expired or was withdrawn/);
    await expect(portal.view('not-a-token')).rejects.toThrow(/expired or was withdrawn/);

    await links.updateOne({ orgId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(portal.view(token)).rejects.toThrow(/expired or was withdrawn/);

    const fresh = (await portal.createLink(orgId, ACTOR, String(rao._id))).url.split('/portal/')[1];
    await expect(portal.view(fresh)).resolves.toBeDefined();
    expect(await portal.revoke(orgId, ACTOR, String(rao._id))).toEqual({ revoked: 2 });
    await expect(portal.view(fresh)).rejects.toThrow(/expired or was withdrawn/);
  });

  it('makes no link, and opens none, while portal access is turned off for the customer', async () => {
    const { orgId, rao } = await seed();
    const customers = moduleRef.get<Model<unknown>>(getModelToken(Customer.name));
    const token = (await portal.createLink(orgId, ACTOR, String(rao._id))).url.split('/portal/')[1];

    await customers.updateOne({ _id: rao._id }, { $set: { portalEnabled: false } });
    await expect(portal.createLink(orgId, ACTOR, String(rao._id))).rejects.toThrow(/Portal access is turned off for Rao Traders/);
    await expect(portal.view(token)).rejects.toThrow(/expired or was withdrawn/);

    // Turned on again, the link still in date works again.
    await customers.updateOne({ _id: rao._id }, { $set: { portalEnabled: true } });
    await expect(portal.view(token)).resolves.toMatchObject({ customer: { name: 'Rao Traders' } });
  });
});
