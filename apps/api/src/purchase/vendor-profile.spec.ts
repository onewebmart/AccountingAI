/**
 * Integration tests — a vendor's full details (the "New vendor" form).
 *
 *  ✓ The same optional details as a customer: type, contact person, phones,
 *    language, currency, terms, website, social, both addresses, contact persons, remarks
 *  ✓ The PAN, TDS, bank account and MSME details work as before beside them
 *  ✓ City and pincode can be given when the vendor is created
 *  ✓ An edit of the new fields is audited, and leaves the PAN and TDS alone
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { VendorsService } from './vendors.service';
import { AuditService } from '../gl/audit.service';
import { gstinCheckChar } from '../extraction/invoice-checks';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { PurchaseBill, PurchaseBillSchema } from './schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from './schemas/vendor.schema';

const ACTOR = new Types.ObjectId().toString();
const gstin = (first14: string) => first14 + gstinCheckChar(first14);
const TN = gstin('33AABCS1429B1Z');

let moduleRef: TestingModule;
let vendors: VendorsService;
let audit: Model<{ orgId: string; entityId: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
      ]),
    ],
    providers: [VendorsService, AuditService],
  }).compile();
  vendors = moduleRef.get(VendorsService);
  audit = moduleRef.get(getModelToken(AuditLog.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

const org = () => new Types.ObjectId().toString();

describe('a new vendor', () => {
  it('keeps the profile beside the PAN and TDS', async () => {
    const orgId = org();
    const v = await vendors.create({
      orgId,
      actorId: ACTOR,
      name: 'Sigma Electricals',
      gstin: TN,
      vendorType: 'business',
      salutation: 'Dr.',
      firstName: 'K',
      lastName: 'Murugan',
      companyName: 'Sigma Electricals Pvt Ltd',
      workPhone: '044 2345 6789',
      mobile: '98400 12345',
      language: 'ta',
      currency: 'INR',
      paymentTerms: 'net_45',
      website: 'https://sigma.example.in',
      social: { skype: 'sigma.sales' },
      billingAddress: { street1: '22 Anna Salai', city: 'Chennai', pincode: '600002' },
      shippingAddress: null,
      contactPersons: [{ firstName: 'Lakshmi', mobile: '9840000000' }],
      remarks: 'Ask for Lakshmi.',
      tdsSection: '194C',
    });
    expect(v.toJSON()).toMatchObject({
      name: 'Sigma Electricals',
      vendorType: 'business',
      salutation: 'Dr.',
      companyName: 'Sigma Electricals Pvt Ltd',
      phone: '044 2345 6789',
      workPhone: '044 2345 6789',
      mobile: '98400 12345',
      language: 'ta',
      paymentTerms: 'net_45',
      website: 'https://sigma.example.in',
      social: { x: null, skype: 'sigma.sales', facebook: null },
      // The GSTIN gives the billing address its state.
      billingAddress: expect.objectContaining({ street1: '22 Anna Salai', city: 'Chennai', stateCode: '33', pincode: '600002' }),
      shippingAddress: null,
      contactPersons: [expect.objectContaining({ firstName: 'Lakshmi', mobile: '9840000000' })],
      notes: 'Ask for Lakshmi.',
      remarks: 'Ask for Lakshmi.',
      address: '22 Anna Salai',
      city: 'Chennai',
      pincode: '600002',
      // As before: the PAN from the GSTIN, and 194C at a company's 2%.
      pan: 'AABCS1429B',
      tdsSection: '194C',
      tdsRateBps: 200,
    });
    expect(v.toJSON()).not.toHaveProperty('customerType');
    expect(v.toJSON()).not.toHaveProperty('portalEnabled');
  });

  it('takes city and pincode when it is created, the old way', async () => {
    const orgId = org();
    const v = await vendors.create({ orgId, actorId: ACTOR, name: 'Flat', city: 'Madurai', pincode: '625001' });
    expect(v).toMatchObject({ city: 'Madurai', pincode: '625001', billingAddress: expect.objectContaining({ city: 'Madurai', pincode: '625001' }) });
  });

  it('refuses a bad vendor type, mobile or pincode', async () => {
    const orgId = org();
    await expect(vendors.create({ orgId, name: 'X', vendorType: 'company' })).rejects.toThrow(/Vendor type/);
    await expect(vendors.create({ orgId, name: 'X', mobile: 'call me' })).rejects.toThrow(/not a phone number/);
    await expect(vendors.create({ orgId, name: 'X', billingAddress: { pincode: '6000' } })).rejects.toThrow(/six digits/);
  });
});

describe('editing a vendor', () => {
  it('changes the profile, audited, and leaves the PAN, TDS and bank alone', async () => {
    const orgId = org();
    const v = await vendors.create({ orgId, actorId: ACTOR, name: 'Shakti', gstin: TN, tdsSection: '194J-b' });
    const id = String(v._id);
    await vendors.edit(id, orgId, ACTOR, { bankAccount: { accountNumber: '50100012345678', ifsc: 'HDFC0001234' } });

    const after = await vendors.edit(id, orgId, ACTOR, {
      paymentTerms: 'due_on_receipt',
      department: 'Purchase',
      shippingAddress: { attention: 'Stores', street1: 'Gate 2', city: 'Hosur', stateCode: '33', pincode: '635109' },
    });
    expect(after).toMatchObject({
      paymentTerms: 'due_on_receipt',
      department: 'Purchase',
      shippingAddress: expect.objectContaining({ attention: 'Stores', city: 'Hosur' }),
      pan: 'AABCS1429B',
      tdsSection: '194J-b',
      bankAccount: expect.objectContaining({ accountNumber: '50100012345678' }),
    });
    const entry = await audit.findOne({ orgId, entityId: id, action: 'UPDATE' }).lean().exec();
    expect(entry?.before).toEqual({ paymentTerms: null, department: null, shippingAddress: null });
    expect(entry?.after).toMatchObject({ paymentTerms: 'due_on_receipt', department: 'Purchase' });
  });

  it('lists vendors with the work phone and remarks under both names', async () => {
    const orgId = org();
    await vendors.create({ orgId, actorId: ACTOR, name: 'Listed', phone: '0422 222222', notes: 'Net 30 agreed' });
    expect((await vendors.list(orgId))[0]).toMatchObject({ phone: '0422 222222', workPhone: '0422 222222', notes: 'Net 30 agreed', remarks: 'Net 30 agreed', outstandingPaise: 0 });
  });
});
