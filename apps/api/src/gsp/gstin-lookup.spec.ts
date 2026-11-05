/**
 * Tests — "Prefill from GSTIN", and the bodies the customer and vendor forms send.
 *
 *  ✓ The state, PAN and kind of holder are read from the GSTIN itself
 *  ✓ A GSTIN that fails its format or check digit is refused, saying why
 *  ✓ The mock GSP has no taxpayer search: no legal name or address, and the reason given
 *  ✓ A GSP that answers gives the legal name, trade name and address; a record for another GSTIN is ignored
 *  ✓ A GSP that fails still leaves what the GSTIN says
 *  ✓ The form's full body passes validation; an unknown field or a bad email does not
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { gstinCheckChar } from '../extraction/invoice-checks';
import { GspProvider, MockGsp, TaxpayerRecord } from '../einvoice/gsp.provider';
import { GstinLookupService, gstinFacts } from './gstin-lookup';
import { CreateCustomerDto, UpdateCustomerDto } from '../sales/dto/sales.dto';
import { CreateVendorDto, UpdateVendorDto } from '../purchase/dto/purchase.dto';

const gstin = (first14: string) => first14 + gstinCheckChar(first14);
const COMPANY_KA = gstin('29AAACR5055K1Z');
const INDIVIDUAL_MH = gstin('27ABCPS1234D2Z');
const HUF_GJ = gstin('24AAAHP1234Q1Z');

describe('the facts in a GSTIN', () => {
  it('reads the state, the PAN and who holds it', () => {
    expect(gstinFacts(COMPANY_KA.toLowerCase())).toEqual({
      gstin: COMPANY_KA,
      stateCode: '29',
      stateName: 'Karnataka',
      pan: 'AAACR5055K',
      holder: { code: 'C', kind: 'company', label: 'Company' },
      partyType: 'business',
      registrationInState: '1',
    });
    expect(gstinFacts(INDIVIDUAL_MH)).toMatchObject({ stateName: 'Maharashtra', pan: 'ABCPS1234D', holder: { kind: 'individual' }, partyType: 'individual', registrationInState: '2' });
    expect(gstinFacts(HUF_GJ)).toMatchObject({ stateName: 'Gujarat', holder: { code: 'H', label: 'Hindu undivided family' }, partyType: 'business' });
  });

  it('refuses one that is not a GSTIN', () => {
    const mistyped = COMPANY_KA.slice(0, 14) + (COMPANY_KA[14] === 'A' ? 'B' : 'A');
    expect(() => gstinFacts(mistyped)).toThrow(/check digit/);
    expect(() => gstinFacts('29AAACR5055K')).toThrow(/15-character GSTIN format/);
    expect(() => gstinFacts('')).toThrow(/GSTIN/);
  });
});

/** A gateway that answers the taxpayer search, for the parts a real GSP would give. */
function gsp(search: (gstin: string) => Promise<TaxpayerRecord | null>): GspProvider {
  return Object.assign(new MockGsp(), { name: 'test-gsp', isMock: false, searchTaxpayer: search });
}

describe('prefilling from a GSTIN', () => {
  it('says the legal name and address need a GSP connection when the mock is in use', async () => {
    const found = await new GstinLookupService(new MockGsp()).lookup(COMPANY_KA);
    expect(found).toMatchObject({
      stateCode: '29',
      pan: 'AAACR5055K',
      partyType: 'business',
      registration: null,
      sources: { state: 'gstin', pan: 'gstin', holder: 'pan', registration: null },
      gateway: { name: 'mock', isMock: true },
    });
    expect(found.note).toMatch(/legal name and address need a GSP connection/);
  });

  it('adds what the GST portal holds when the GSP has it', async () => {
    const record: TaxpayerRecord = {
      gstin: COMPANY_KA,
      legalName: 'RAO TRADING COMPANY PRIVATE LIMITED',
      tradeName: 'Rao Traders',
      status: 'Active',
      taxpayerType: 'Regular',
      registeredOn: '2017-07-01',
      address: { street1: '12, 3rd Cross', street2: 'Jayanagar', city: 'Bengaluru', stateCode: '29', pincode: '560011' },
    };
    const found = await new GstinLookupService(gsp(async () => record)).lookup(COMPANY_KA);
    expect(found).toMatchObject({ registration: record, sources: { registration: 'gsp' }, note: null });
  });

  it('ignores a record for some other GSTIN, and says the portal has none', async () => {
    const other = { gstin: INDIVIDUAL_MH, legalName: 'Someone Else', tradeName: null, status: null, taxpayerType: null, registeredOn: null, address: null };
    const found = await new GstinLookupService(gsp(async () => other)).lookup(COMPANY_KA);
    expect(found.registration).toBeNull();
    expect(found.note).toMatch(/no record of this GSTIN/);
  });

  it('still gives what the GSTIN says when the GSP fails', async () => {
    const found = await new GstinLookupService(gsp(async () => { throw new Error('timeout'); })).lookup(COMPANY_KA);
    expect(found).toMatchObject({ stateCode: '29', pan: 'AAACR5055K', registration: null });
    expect(found.note).toMatch(/could not be searched just now \(timeout\)/);
  });
});

describe('the bodies the forms send', () => {
  const opts = { whitelist: true, forbidNonWhitelisted: true };
  const errorsOf = async (cls: new () => object, body: Record<string, unknown>) =>
    (await validate(plainToInstance(cls, body, { enableImplicitConversion: true }) as object, opts)).map((e) => [e.property, ...Object.values(e.constraints ?? {}), ...(e.children ?? []).map((c) => c.property)].join(' '));

  const profile = {
    salutation: 'Mrs.',
    firstName: 'Meena',
    lastName: 'Iyer',
    companyName: 'Iyer & Co',
    workPhone: '044 1234 5678',
    mobile: '98400 00000',
    language: 'ta',
    currency: 'INR',
    paymentTerms: 'net_15',
    website: 'iyer.co.in',
    department: 'Finance',
    designation: 'Partner',
    social: { x: '@iyerco', skype: null, facebook: '' },
    billingAddress: { attention: 'Meena', country: 'India', street1: '1 Mount Rd', street2: '', city: 'Chennai', stateCode: '33', pincode: '600002', phone: '', fax: '' },
    shippingAddress: null,
    contactPersons: [{ salutation: '', firstName: 'Ravi', lastName: '', email: '', workPhone: '', mobile: '9840011111' }],
    remarks: 'Internal',
  };

  it('accepts everything the customer form sends', async () => {
    expect(await errorsOf(CreateCustomerDto, { name: 'Iyer & Co', customerType: 'business', gstin: COMPANY_KA, email: 'a@iyer.co.in', pan: 'AAACR5055K', portalEnabled: true, stateCode: '33', notes: 'x', ...profile })).toEqual([]);
    expect(await errorsOf(UpdateCustomerDto, { customerType: null, email: null, salutation: null, paymentTerms: null, contactPersons: [], ...{ billingAddress: null } })).toEqual([]);
  });

  it('accepts everything the vendor form sends', async () => {
    expect(await errorsOf(CreateVendorDto, { name: 'Iyer & Co', vendorType: 'individual', city: 'Chennai', pincode: '600002', tdsSection: '194C', ...profile })).toEqual([]);
    expect(await errorsOf(UpdateVendorDto, { vendorType: '', email: '', ...profile, bankAccount: null })).toEqual([]);
  });

  it('refuses an unknown field, a bad email, terms or salutation', async () => {
    expect(await errorsOf(CreateCustomerDto, { name: 'X', nickname: 'Y' })).toEqual([expect.stringMatching(/^nickname/)]);
    expect(await errorsOf(CreateCustomerDto, { name: 'X', email: 'nobody' })).toEqual([expect.stringMatching(/^email .*name@example.com/)]);
    expect(await errorsOf(CreateCustomerDto, { name: 'X', paymentTerms: 'net_31' })).toEqual([expect.stringMatching(/^paymentTerms/)]);
    expect(await errorsOf(UpdateVendorDto, { salutation: 'Sir' })).toEqual([expect.stringMatching(/^salutation/)]);
    expect(await errorsOf(CreateCustomerDto, { name: 'X', billingAddress: { street3: 'no' } })).toEqual([expect.stringMatching(/^billingAddress/)]);
    expect(await errorsOf(CreateCustomerDto, { name: 'X', contactPersons: [{ email: 'bad' }] })).toEqual([expect.stringMatching(/^contactPersons/)]);
  });
});
