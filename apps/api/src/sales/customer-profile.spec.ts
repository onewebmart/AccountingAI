/**
 * Integration tests — a customer's full details (the "New customer" form).
 *
 *  ✓ Only the display name is needed; every other field is optional
 *  ✓ The type, contact person, phones, language, PAN, terms, portal, website,
 *    social handles, both addresses, contact persons and remarks are kept and returned
 *  ✓ The billing address sets the address, city and pincode documents print;
 *    with no GSTIN or state, its state becomes the place of supply
 *  ✓ The old flat address, city and pincode still work, and fill the billing address
 *  ✓ PAN, pincode, email and the GSTIN check digit are checked; nothing is saved when one fails
 *  ✓ The PAN follows the GSTIN unless it was typed
 *  ✓ An edit is audited with what each changed field was; an unchanged form changes nothing
 *  ✓ Org B's customers stay out of Org A's GSTIN check
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { CustomersService } from './customers.service';
import { AuditService } from '../gl/audit.service';
import { gstinCheckChar } from '../extraction/invoice-checks';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { Customer, CustomerSchema } from './schemas/customer.schema';
import { SalesInvoice, SalesInvoiceSchema } from './schemas/sales-invoice.schema';

const ACTOR = new Types.ObjectId().toString();
const gstin = (first14: string) => first14 + gstinCheckChar(first14);
const KA = gstin('29AAACR5055K1Z');
const MH_INDIVIDUAL = gstin('27ABCPS1234D1Z');

let moduleRef: TestingModule;
let customers: CustomersService;
let customerModel: Model<Record<string, unknown>>;
let audit: Model<{ orgId: string; entityId: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
      ]),
    ],
    providers: [CustomersService, AuditService],
  }).compile();
  customers = moduleRef.get(CustomersService);
  customerModel = moduleRef.get(getModelToken(Customer.name));
  audit = moduleRef.get(getModelToken(AuditLog.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

const org = () => new Types.ObjectId().toString();

const fullForm = {
  name: 'Rao Traders',
  customerType: 'business',
  salutation: 'Mr.',
  firstName: ' Suresh ',
  lastName: 'Rao',
  companyName: 'Rao Traders Pvt Ltd',
  email: 'accounts@raotraders.in',
  workPhone: '080 4123 4567',
  mobile: '+91 98450 12345',
  language: 'kn',
  currency: 'INR',
  paymentTerms: 'net_30',
  portalEnabled: false,
  website: 'raotraders.in',
  department: 'Accounts',
  designation: 'Partner',
  social: { x: '@raotraders', skype: null, facebook: '' },
  billingAddress: {
    attention: 'Accounts',
    country: 'India',
    street1: '12, 3rd Cross',
    street2: 'Jayanagar',
    city: 'Bengaluru',
    stateCode: '29',
    pincode: '560 011',
    phone: '080 4123 4567',
    fax: '',
  },
  shippingAddress: { country: 'India', street1: 'Plot 9, KIADB', city: 'Hosur', stateCode: '33', pincode: '635126' },
  contactPersons: [
    { salutation: 'Ms.', firstName: 'Anita', lastName: 'Rao', email: 'anita@raotraders.in', workPhone: '', mobile: '9845000000' },
    { salutation: null, firstName: '', lastName: '', email: '', workPhone: '', mobile: '' },
  ],
  remarks: 'Pays on the 5th.',
};

describe('a new customer', () => {
  it('needs only the display name', async () => {
    const orgId = org();
    const c = await customers.create({ orgId, actorId: ACTOR, name: 'Walk-in' });
    expect(c.toJSON()).toMatchObject({
      name: 'Walk-in', customerType: null, firstName: null, billingAddress: null, shippingAddress: null,
      contactPersons: [], paymentTerms: null, portalEnabled: true, currency: 'INR', workPhone: null, remarks: null,
    });
  });

  it('keeps every detail the form sends, and returns them', async () => {
    const orgId = org();
    const created = await customers.create({ orgId, actorId: ACTOR, ...fullForm, gstin: KA });
    const got = (await customers.findById(String(created._id), orgId)).toJSON();
    expect(got).toMatchObject({
      name: 'Rao Traders',
      customerType: 'business',
      salutation: 'Mr.',
      firstName: 'Suresh',
      lastName: 'Rao',
      companyName: 'Rao Traders Pvt Ltd',
      // The work phone is the phone; the remarks are the notes.
      phone: '080 4123 4567',
      workPhone: '080 4123 4567',
      notes: 'Pays on the 5th.',
      remarks: 'Pays on the 5th.',
      mobile: '+91 98450 12345',
      language: 'kn',
      pan: 'AAACR5055K',
      paymentTerms: 'net_30',
      portalEnabled: false,
      website: 'raotraders.in',
      department: 'Accounts',
      designation: 'Partner',
      social: { x: '@raotraders', skype: null, facebook: null },
      billingAddress: {
        attention: 'Accounts', country: 'India', street1: '12, 3rd Cross', street2: 'Jayanagar',
        city: 'Bengaluru', stateCode: '29', pincode: '560011', phone: '080 4123 4567', fax: null,
      },
      shippingAddress: { street1: 'Plot 9, KIADB', city: 'Hosur', stateCode: '33', pincode: '635126', attention: null },
      // The blank row is not a person.
      contactPersons: [{ salutation: 'Ms.', firstName: 'Anita', lastName: 'Rao', email: 'anita@raotraders.in', workPhone: null, mobile: '9845000000' }],
      // What documents print follows the billing address; the GSTIN is the place of supply.
      address: '12, 3rd Cross, Jayanagar',
      city: 'Bengaluru',
      pincode: '560011',
      stateCode: '29',
    });

    const listed = (await customers.list(orgId))[0];
    expect(listed).toMatchObject({ workPhone: '080 4123 4567', remarks: 'Pays on the 5th.', paymentTerms: 'net_30', receivablePaise: 0 });

    const entry = await audit.findOne({ orgId, entityId: String(created._id), action: 'CREATE' }).lean().exec();
    expect(entry?.after).toMatchObject({ name: 'Rao Traders', gstin: KA, paymentTerms: 'net_30', pan: 'AAACR5055K', billingAddress: expect.objectContaining({ city: 'Bengaluru' }) });
  });

  it('takes the place of supply from the billing state when there is no GSTIN or state', async () => {
    const orgId = org();
    const c = await customers.create({ orgId, actorId: ACTOR, name: 'Unregistered', billingAddress: { street1: 'MG Road', city: 'Pune', stateCode: '27', pincode: '411001' } });
    expect(c).toMatchObject({ stateCode: '27', address: 'MG Road', city: 'Pune', pincode: '411001', gstin: null, pan: null });
    // A state picked for them wins over the billing address's.
    const d = await customers.create({ orgId, actorId: ACTOR, name: 'Picked', stateCode: '07', billingAddress: { city: 'Noida', stateCode: '09' } });
    expect(d.stateCode).toBe('07');
  });

  it('still takes the flat address, city and pincode, and fills the billing address from them', async () => {
    const orgId = org();
    const c = await customers.create({ orgId, actorId: ACTOR, name: 'Old form', gstin: KA, address: '4 Brigade Rd', city: 'Bengaluru', pincode: '560001' });
    expect(c.billingAddress).toEqual({
      attention: null, country: 'India', street1: '4 Brigade Rd', street2: null, city: 'Bengaluru', stateCode: '29', pincode: '560001', phone: null, fax: null,
    });
  });

  it('takes the PAN and type from an individual’s GSTIN, and a typed PAN over it', async () => {
    const orgId = org();
    const c = await customers.create({ orgId, actorId: ACTOR, name: 'S Patil', gstin: MH_INDIVIDUAL, customerType: 'individual' });
    expect(c).toMatchObject({ pan: 'ABCPS1234D', stateCode: '27', customerType: 'individual' });
    const typed = await customers.create({ orgId, actorId: ACTOR, name: 'Typed', pan: 'abcde1234f' });
    expect(typed.pan).toBe('ABCDE1234F');
  });

  it('refuses a bad PAN, pincode, GSTIN, salutation, website or contact email, and saves nothing', async () => {
    const orgId = org();
    await expect(customers.create({ orgId, name: 'X', pan: 'ABCD1234F' })).rejects.toThrow(/PAN ABCD1234F is not in the format/);
    await expect(customers.create({ orgId, name: 'X', billingAddress: { pincode: '012345' } })).rejects.toThrow(/six digits/);
    await expect(customers.create({ orgId, name: 'X', shippingAddress: { pincode: '56001' } })).rejects.toThrow(/Shipping address pincode/);
    await expect(customers.create({ orgId, name: 'X', gstin: '29AAACR5055K1ZX' })).rejects.toThrow(/check digit|GSTIN format/);
    await expect(customers.create({ orgId, name: 'X', salutation: 'Sir' })).rejects.toThrow(/Salutation/);
    await expect(customers.create({ orgId, name: 'X', website: 'not a site' })).rejects.toThrow(/not a web address/);
    await expect(customers.create({ orgId, name: 'X', contactPersons: [{ firstName: 'A', email: 'a@' }] })).rejects.toThrow(/not an email/);
    await expect(customers.create({ orgId, name: 'X', billingAddress: { stateCode: 'KA' } })).rejects.toThrow(/two-digit/);
    await expect(customers.create({ orgId, name: 'X', paymentTerms: 'net_31' })).rejects.toThrow(/Payment terms/);
    expect(await customerModel.countDocuments({ orgId })).toBe(0);
  });

  it('keeps an address abroad, with its postal code, out of the GST pincode', async () => {
    const orgId = org();
    const c = await customers.create({ orgId, name: 'Acme Inc', currency: 'USD', billingAddress: { country: 'United States', street1: '1 Main St', city: 'Austin', pincode: '78701' } });
    expect(c).toMatchObject({ currency: 'USD', city: 'Austin', pincode: null, stateCode: null, billingAddress: expect.objectContaining({ country: 'United States', pincode: '78701' }) });
  });
});

describe('editing a customer', () => {
  it('changes only what was sent, audited with what it was', async () => {
    const orgId = org();
    const c = await customers.create({ orgId, actorId: ACTOR, ...fullForm, gstin: KA });
    const id = String(c._id);

    const updated = await customers.update(id, orgId, ACTOR, {
      paymentTerms: 'end_of_month',
      mobile: null,
      shippingAddress: null,
      contactPersons: [{ firstName: 'Ravi', email: 'ravi@raotraders.in' }],
      remarks: 'Pays on the 10th.',
    });
    expect(updated.toJSON()).toMatchObject({
      paymentTerms: 'end_of_month', mobile: null, shippingAddress: null, notes: 'Pays on the 10th.', remarks: 'Pays on the 10th.',
      contactPersons: [{ salutation: null, firstName: 'Ravi', lastName: null, email: 'ravi@raotraders.in', workPhone: null, mobile: null }],
      // Untouched.
      firstName: 'Suresh', billingAddress: expect.objectContaining({ city: 'Bengaluru' }), stateCode: '29',
    });
    const entry = await audit.findOne({ orgId, entityId: id, action: 'UPDATE' }).lean().exec();
    expect(entry?.before).toMatchObject({ paymentTerms: 'net_30', mobile: '+91 98450 12345', notes: 'Pays on the 5th.', shippingAddress: expect.objectContaining({ city: 'Hosur' }) });
    expect(entry?.after).toMatchObject({ paymentTerms: 'end_of_month', mobile: null, notes: 'Pays on the 10th.', shippingAddress: null });
    expect(Object.keys(entry?.after ?? {}).sort()).toEqual(['contactPersons', 'mobile', 'notes', 'paymentTerms', 'shippingAddress']);
  });

  it('records nothing when the form is sent back unchanged', async () => {
    const orgId = org();
    const c = await customers.create({ orgId, actorId: ACTOR, ...fullForm, gstin: KA });
    await customers.update(String(c._id), orgId, ACTOR, {
      name: 'Rao Traders', billingAddress: fullForm.billingAddress, contactPersons: fullForm.contactPersons, social: fullForm.social, portalEnabled: false,
    });
    expect(await audit.countDocuments({ orgId, entityId: String(c._id), action: 'UPDATE' })).toBe(0);
  });

  it('keeps the billing address and the printed address in step either way', async () => {
    const orgId = org();
    const c = await customers.create({ orgId, actorId: ACTOR, name: 'Step', gstin: KA, billingAddress: { street1: '1 A Rd', street2: 'B Nagar', city: 'Mysuru', pincode: '570001' } });
    const id = String(c._id);
    // The old way: the billing address follows.
    const old = await customers.update(id, orgId, ACTOR, { city: 'Mandya', pincode: '571401' });
    expect(old.billingAddress).toMatchObject({ street1: '1 A Rd', street2: 'B Nagar', city: 'Mandya', pincode: '571401', stateCode: '29' });
    // The new way: the printed address follows.
    const next = await customers.update(id, orgId, ACTOR, { billingAddress: { street1: '7 C Rd', city: 'Hassan', stateCode: '29', pincode: '573201' } });
    expect(next).toMatchObject({ address: '7 C Rd', city: 'Hassan', pincode: '573201', stateCode: '29' });
  });

  it('moves a PAN that came from the GSTIN to the new GSTIN, but keeps a typed one', async () => {
    const orgId = org();
    const c = await customers.create({ orgId, actorId: ACTOR, name: 'Moves', gstin: KA });
    expect(c.pan).toBe('AAACR5055K');
    const moved = await customers.update(String(c._id), orgId, ACTOR, { gstin: MH_INDIVIDUAL });
    expect(moved).toMatchObject({ pan: 'ABCPS1234D', stateCode: '27' });

    const typed = await customers.create({ orgId, actorId: ACTOR, name: 'Typed', pan: 'ZZZZZ9999Z' });
    expect((await customers.update(String(typed._id), orgId, ACTOR, { gstin: KA })).pan).toBe('ZZZZZ9999Z');
  });

  it('finds a customer with the same GSTIN in this org only', async () => {
    const a = org();
    const b = org();
    await customers.create({ orgId: a, actorId: ACTOR, name: 'Here', gstin: KA });
    await customers.create({ orgId: b, actorId: ACTOR, name: 'Elsewhere', gstin: KA });
    expect((await customers.withGstin(a, KA.toLowerCase())).map((c) => c.name)).toEqual(['Here']);
  });
});
