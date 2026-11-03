/**
 * Integration tests — editing customers and vendors.
 *
 *  ✓ A customer's details change, audited with what they were
 *  ✓ Invoices already issued keep the GSTIN and state they were issued with:
 *    GSTR-1 for a past month does not change; invoices issued later use the new GSTIN
 *  ✓ A second edit stamps only what the first did not
 *  ✓ Drafts follow the customer as it is now
 *  ✓ A vendor's GSTIN changes without rewriting GSTR-3B or the purchase register
 *  ✓ A bad GSTIN or state is refused; a GSTIN sets the state
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { BillStatus, InvoiceStatus } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { CustomersService } from '../sales/customers.service';
import { VendorsService } from '../purchase/vendors.service';
import { AuditService } from './audit.service';
import { GstReturnsService } from '../gst/gst-returns.service';
import { gstinCheckChar } from '../extraction/invoice-checks';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';

const ACTOR = new Types.ObjectId().toString();
/** A GSTIN with a correct check character. */
const gstin = (first14: string) => first14 + gstinCheckChar(first14);
const MH_OLD = gstin('27AAACR5055K1Z');
const KA_NEW = gstin('29AAACR5055K1Z');
const VENDOR_OLD = gstin('27AAACS1234A1Z');
const VENDOR_NEW = gstin('24AAACS1234A1Z');

let moduleRef: TestingModule;
let customersSvc: CustomersService;
let vendorsSvc: VendorsService;
let returns: GstReturnsService;
let invoices: Model<{ partyAtIssue: unknown }>;
let bills: Model<{ partyAtIssue: unknown }>;
let audit: Model<{ entityId: string; action: string; before: Record<string, unknown>; after: Record<string, unknown>; meta?: Record<string, unknown> }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: CreditNote.name, schema: CreditNoteSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: DebitNote.name, schema: DebitNoteSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
      ]),
    ],
    providers: [CustomersService, VendorsService, AuditService, GstReturnsService],
  }).compile();
  customersSvc = moduleRef.get(CustomersService);
  vendorsSvc = moduleRef.get(VendorsService);
  returns = moduleRef.get(GstReturnsService);
  invoices = moduleRef.get(getModelToken(SalesInvoice.name));
  bills = moduleRef.get(getModelToken(PurchaseBill.name));
  audit = moduleRef.get(getModelToken(AuditLog.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

const amounts = { taxableValue: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0, total: 118000 };

async function seed() {
  const orgId = new Types.ObjectId().toString();
  await moduleRef.get<Model<unknown>>(getModelToken(OrgSettings.name)).create({ orgId, gstin: gstin('27AAPFU0939F1Z'), stateCode: '27' });
  const customer = await customersSvc.create({ orgId, actorId: ACTOR, name: 'Rao Traders', gstin: MH_OLD });
  const vendor = await vendorsSvc.create({ orgId, actorId: ACTOR, name: 'Sigma Supplies', gstin: VENDOR_OLD });
  const invoice = (number: string, date: string, status: InvoiceStatus) =>
    invoices.create({ orgId, customerId: customer._id, invoiceNumber: number, invoiceDate: date, status, amountsPaise: amounts });
  const bill = (number: string, date: string) =>
    bills.create({ orgId, vendorId: vendor._id, billNumber: number, billDate: date, status: BillStatus.POSTED, amountsPaise: amounts });
  return { orgId, customer, vendor, invoice, bill };
}

const b2bCtins = (r: Awaited<ReturnType<GstReturnsService['gstr1']>>) => r.b2b.map((p) => [p.ctin, p.invoices.map((i) => i.number)]);

describe('editing a customer', () => {
  it('keeps issued invoices as issued, and audits the change', async () => {
    const { orgId, customer, invoice } = await seed();
    await invoice('INV-1', '2026-09-10', InvoiceStatus.POSTED);
    await invoice('INV-2', '2026-09-20', InvoiceStatus.PAID);
    const draft = await invoice('INV-D', '2026-10-05', InvoiceStatus.DRAFT);

    const updated = await customersSvc.update(String(customer._id), orgId, ACTOR, { gstin: KA_NEW, phone: ' 98200 00000 ' });
    expect(updated).toMatchObject({ gstin: KA_NEW, stateCode: '29', phone: '98200 00000' });

    // September was issued to the Maharashtra GSTIN, and stays so.
    expect(b2bCtins(await returns.gstr1(orgId, '2026-09'))).toEqual([[MH_OLD, ['INV-1', 'INV-2']]]);
    expect((await invoices.findById(draft._id).lean().exec())?.partyAtIssue).toBeNull();

    // October's invoice, posted after the change, goes to the new GSTIN, as an inter-state B2B supply.
    await invoices.updateOne({ _id: draft._id }, { $set: { status: InvoiceStatus.POSTED } });
    expect(b2bCtins(await returns.gstr1(orgId, '2026-10'))).toEqual([[KA_NEW, ['INV-D']]]);

    const entry = await audit.findOne({ orgId, entityId: String(customer._id), action: 'UPDATE' }).lean().exec();
    expect(entry).toMatchObject({
      before: { gstin: MH_OLD, stateCode: '27', phone: null },
      after: { gstin: KA_NEW, stateCode: '29', phone: '98200 00000' },
      meta: { invoicesKeptAsIssued: 2 },
    });
  });

  it('stamps on a second edit only what the first left', async () => {
    const { orgId, customer, invoice } = await seed();
    await invoice('INV-1', '2026-09-10', InvoiceStatus.POSTED);
    await customersSvc.update(String(customer._id), orgId, ACTOR, { gstin: KA_NEW });
    await invoice('INV-2', '2026-10-10', InvoiceStatus.POSTED);
    await customersSvc.update(String(customer._id), orgId, ACTOR, { name: 'Rao Traders LLP' });

    expect(b2bCtins(await returns.gstr1(orgId, '2026-09'))).toEqual([[MH_OLD, ['INV-1']]]);
    const october = await returns.gstr1(orgId, '2026-10');
    expect(october.b2b).toEqual([expect.objectContaining({ ctin: KA_NEW, customerName: 'Rao Traders' })]);
  });

  it('refuses a bad GSTIN or state, and leaves nothing changed', async () => {
    const { orgId, customer } = await seed();
    await expect(customersSvc.update(String(customer._id), orgId, ACTOR, { gstin: '27AAACR5055K1ZX' })).rejects.toThrow(/GSTIN/);
    await expect(customersSvc.update(String(customer._id), orgId, ACTOR, { gstin: null, stateCode: 'MH' })).rejects.toThrow(/two-digit/);
    await expect(customersSvc.update(String(customer._id), orgId, ACTOR, { name: '  ' })).rejects.toThrow(/name is required/);
    expect(await customersSvc.findById(String(customer._id), orgId)).toMatchObject({ gstin: MH_OLD, name: 'Rao Traders' });

    // No GSTIN: the state is the customer's to say.
    expect(await customersSvc.update(String(customer._id), orgId, ACTOR, { gstin: null, stateCode: '07' })).toMatchObject({ gstin: null, stateCode: '07' });
  });
});

describe('editing a vendor', () => {
  it('keeps issued bills as issued in GSTR-3B and the register', async () => {
    const { orgId, vendor, bill } = await seed();
    await bill('PB-1', '2026-09-12');

    const updated = await vendorsSvc.edit(String(vendor._id), orgId, ACTOR, { gstin: VENDOR_NEW, email: 'ac@sigma.example', tdsSection: '194C' });
    expect(updated).toMatchObject({ gstin: VENDOR_NEW, email: 'ac@sigma.example', tdsSection: '194C', tdsRateBps: 200 });

    const stamped = await bills.findOne({ orgId, billNumber: 'PB-1' }).lean().exec();
    expect(stamped?.partyAtIssue).toEqual({ name: 'Sigma Supplies', gstin: VENDOR_OLD, stateCode: '27' });
    const entry = await audit.findOne({ orgId, entityId: String(vendor._id), action: 'UPDATE' }).lean().exec();
    expect(entry).toMatchObject({ before: { gstin: VENDOR_OLD }, after: { gstin: VENDOR_NEW }, meta: { billsKeptAsIssued: 1 } });
  });
});
