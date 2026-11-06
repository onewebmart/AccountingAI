import { BadRequestException } from '@nestjs/common';
import { CURRENCIES } from '../currency/currencies';
import { cleanPartyDetails, PartyDetailsInput } from './party-details';
import { panFromGstin } from './tds';

/**
 * The rest of what is known about a customer or vendor, beyond the name,
 * GSTIN and contact details every document prints: who the person is, their
 * addresses, the people to talk to there, and the terms they are given.
 * Every field is optional except the display name, which is `name`.
 *
 * Two of the requested fields are the existing ones under a second name, so
 * there is one place each is kept: `phone` is the work phone (`workPhone`
 * is accepted and returned as the same value) and `notes` are the remarks
 * (`remarks` likewise).
 *
 * The billing address and the flat `address`, `city` and `pincode` that the
 * invoice PDF, the e-invoice and the e-way bill read are kept in step: a
 * billing address sets them, and setting them the old way updates the
 * billing address. A customer's `stateCode` stays the place of supply.
 */

export const PARTY_TYPES = ['business', 'individual'] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const SALUTATIONS = ['Mr.', 'Mrs.', 'Ms.', 'Miss', 'Dr.'] as const;

/** Language codes: what reminders and documents would be sent in. English when not set. */
export const LANGUAGES = ['en', 'hi', 'bn', 'gu', 'kn', 'ml', 'mr', 'or', 'pa', 'ta', 'te', 'ur'] as const;

/**
 * Payment terms, as the due date a new invoice or bill starts with:
 *   due_on_receipt     the document date
 *   net_7 … net_90     that many days after it
 *   end_of_month       the last day of its month
 *   end_of_next_month  the last day of the month after
 * Only a form's default due date follows them; nothing already issued changes.
 */
export const PAYMENT_TERMS = ['due_on_receipt', 'net_7', 'net_15', 'net_30', 'net_45', 'net_60', 'net_90', 'end_of_month', 'end_of_next_month'] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];

/** The due date terms give a document dated `date` (YYYY-MM-DD); null for no terms or one not known. */
export function termsDueDate(terms: string | null | undefined, date: string): string | null {
  if (!terms || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = new Date(`${date}T00:00:00Z`);
  if (terms === 'due_on_receipt') return date;
  const net = /^net_(\d+)$/.exec(terms);
  if (net) return new Date(d.getTime() + Number(net[1]) * 86_400_000).toISOString().slice(0, 10);
  if (terms === 'end_of_month' || terms === 'end_of_next_month') {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + (terms === 'end_of_month' ? 1 : 2), 0)).toISOString().slice(0, 10);
  }
  return null;
}

/** One of the terms above, or any number of days as net_<days> (0 to 365). */
export const isPaymentTerms = (terms: string): boolean => (PAYMENT_TERMS as readonly string[]).includes(terms) || (/^net_(\d{1,3})$/.test(terms) && Number(terms.slice(4)) <= 365);

/** INR, or a currency the currency module keeps rates for. */
export const PARTY_CURRENCIES = ['INR', ...Object.keys(CURRENCIES)];

export const MAX_CONTACT_PERSONS = 50;

export interface PartyAddress {
  attention: string | null;
  country: string | null;
  street1: string | null;
  street2: string | null;
  city: string | null;
  /** Two-digit GST state code, for an address in India. */
  stateCode: string | null;
  pincode: string | null;
  phone: string | null;
  fax: string | null;
}

export interface ContactPerson {
  salutation: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  workPhone: string | null;
  mobile: string | null;
}

export interface PartySocial {
  x: string | null;
  skype: string | null;
  facebook: string | null;
}

type AddressInput = Partial<Record<keyof PartyAddress, string | null>>;
type ContactInput = Partial<Record<keyof ContactPerson, string | null>>;

/** What a create or an edit may send, beyond PartyDetailsInput. Only the fields given change. */
export interface PartyProfileInput {
  customerType?: string | null;
  vendorType?: string | null;
  salutation?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  /** The same as phone. */
  workPhone?: string | null;
  mobile?: string | null;
  language?: string | null;
  pan?: string | null;
  currency?: string | null;
  paymentTerms?: string | null;
  portalEnabled?: boolean | null;
  website?: string | null;
  department?: string | null;
  designation?: string | null;
  social?: Partial<Record<keyof PartySocial, string | null>> | null;
  billingAddress?: AddressInput | null;
  shippingAddress?: AddressInput | null;
  contactPersons?: ContactInput[] | null;
  /** The same as notes. */
  remarks?: string | null;
}

export type PartyChangesInput = PartyDetailsInput & PartyProfileInput;

/** What a party holds now, for working out what an edit changes. */
export interface CurrentParty {
  gstin: string | null;
  stateCode?: string | null;
  pan?: string | null;
  billingAddress?: PartyAddress | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[0-9+()\-.\s/]{3,20}$/;
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;

const bad = (message: string) => new BadRequestException(message);

/** Trimmed text, or null when blank; undefined stays undefined (not sent). */
function text(value: string | null | undefined, max: number, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw bad(`${label} must be text.`);
  const v = value.trim();
  if (!v) return null;
  if (v.length > max) throw bad(`${label} can be at most ${max} characters.`);
  return v;
}

function oneOf<T extends string>(value: string | null | undefined, allowed: readonly T[], label: string): T | null | undefined {
  if (value === undefined) return undefined;
  const v = typeof value === 'string' ? value.trim() : value;
  if (v === null || v === '') return null;
  if (!(allowed as readonly string[]).includes(v)) throw bad(`${label} must be one of ${allowed.join(', ')}.`);
  return v as T;
}

function phone(value: string | null | undefined, label: string): string | null | undefined {
  const v = text(value, 20, label);
  if (v && !PHONE.test(v)) throw bad(`${label} ${v} is not a phone number.`);
  return v;
}

function email(value: string | null | undefined, label: string): string | null | undefined {
  const v = text(value, 200, label);
  if (v && !EMAIL.test(v)) throw bad(`${label} ${v} is not an email address.`);
  return v;
}

const isIndia = (country: string | null) => !country || /^(india|in|bharat)$/i.test(country);

/** A billing or shipping address, cleaned; null when nothing in it is filled. */
export function cleanAddress(input: AddressInput | null | undefined, label: string): PartyAddress | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;
  const country = text(input.country, 60, `${label} country`) ?? null;
  const india = isIndia(country);
  const out: PartyAddress = {
    attention: text(input.attention, 100, `${label} attention`) ?? null,
    country: country ?? 'India',
    street1: text(input.street1, 200, `${label} street`) ?? null,
    street2: text(input.street2, 200, `${label} street`) ?? null,
    city: text(input.city, 100, `${label} city`) ?? null,
    stateCode: text(input.stateCode, 2, `${label} state`) ?? null,
    pincode: input.pincode?.replace(/\s/g, '') || null,
    phone: phone(input.phone, `${label} phone`) ?? null,
    fax: phone(input.fax, `${label} fax`) ?? null,
  };
  if (out.stateCode && !/^\d{2}$/.test(out.stateCode)) throw bad(`${label} state must be a two-digit GST state code, like 27.`);
  if (out.stateCode && !india) throw bad(`${label}: a GST state goes with an address in India.`);
  if (out.pincode) {
    if (india && !/^[1-9]\d{5}$/.test(out.pincode)) throw bad(`${label} pincode: a pincode is six digits and does not start with 0.`);
    if (!india && !/^[A-Za-z0-9-]{2,10}$/.test(out.pincode)) throw bad(`${label} postal code ${out.pincode} is not a postal code.`);
  }
  const { country: _country, ...rest } = out;
  void _country;
  return Object.values(rest).some((v) => v) ? out : null;
}

export function cleanContactPersons(input: ContactInput[] | null | undefined): ContactPerson[] | undefined {
  if (input === undefined) return undefined;
  if (input === null) return [];
  if (!Array.isArray(input)) throw bad('Contact persons must be a list.');
  if (input.length > MAX_CONTACT_PERSONS) throw bad(`At most ${MAX_CONTACT_PERSONS} contact persons.`);
  const out: ContactPerson[] = [];
  input.forEach((p, i) => {
    const label = `Contact person ${i + 1}`;
    const person: ContactPerson = {
      salutation: oneOf(p?.salutation, SALUTATIONS, `${label}'s salutation`) ?? null,
      firstName: text(p?.firstName, 100, `${label}'s first name`) ?? null,
      lastName: text(p?.lastName, 100, `${label}'s last name`) ?? null,
      email: email(p?.email, `${label}'s email`) ?? null,
      workPhone: phone(p?.workPhone, `${label}'s work phone`) ?? null,
      mobile: phone(p?.mobile, `${label}'s mobile`) ?? null,
    };
    // A row left blank is not a person.
    if (!person.firstName && !person.lastName && !person.email && !person.workPhone && !person.mobile) return;
    out.push(person);
  });
  return out;
}

export function cleanPan(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const pan = value?.trim() ? value.trim().toUpperCase() : null;
  if (pan && !PAN.test(pan)) throw bad(`PAN ${pan} is not in the format ABCDE1234F.`);
  return pan;
}

/** The website as typed, if it could be one: no spaces, a dot in it. */
function website(value: string | null | undefined): string | null | undefined {
  const v = text(value, 200, 'Website');
  if (v && (!/^(https?:\/\/)?[^\s/]+\.[^\s]{2,}$/i.test(v))) throw bad(`Website ${v} is not a web address.`);
  return v;
}

/** The fields of PartyProfileInput that were sent, cleaned. Addresses and contacts are whole values. */
export function cleanPartyProfile(input: PartyProfileInput, kind: 'customer' | 'vendor'): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value !== undefined) out[key] = value;
  };
  const typeKey = kind === 'customer' ? 'customerType' : 'vendorType';
  put(typeKey, oneOf(input[typeKey], PARTY_TYPES, kind === 'customer' ? 'Customer type' : 'Vendor type'));
  put('salutation', oneOf(input.salutation, SALUTATIONS, 'Salutation'));
  put('firstName', text(input.firstName, 100, 'First name'));
  put('lastName', text(input.lastName, 100, 'Last name'));
  put('companyName', text(input.companyName, 200, 'Company name'));
  put('mobile', phone(input.mobile, 'Mobile'));
  put('language', oneOf(input.language, LANGUAGES, 'Language'));
  if (input.currency !== undefined) out.currency = oneOf(input.currency, PARTY_CURRENCIES, 'Currency') ?? 'INR';
  put('paymentTerms', oneOf(input.paymentTerms, PAYMENT_TERMS, 'Payment terms'));
  if (kind === 'customer' && input.portalEnabled !== undefined) {
    if (input.portalEnabled !== null && typeof input.portalEnabled !== 'boolean') throw bad('portalEnabled is true or false.');
    out.portalEnabled = input.portalEnabled !== false;
  }
  put('website', website(input.website));
  put('department', text(input.department, 100, 'Department'));
  put('designation', text(input.designation, 100, 'Designation'));
  if (input.social !== undefined) {
    const s: PartySocial = {
      x: text(input.social?.x, 100, 'X') ?? null,
      skype: text(input.social?.skype, 100, 'Skype') ?? null,
      facebook: text(input.social?.facebook, 200, 'Facebook') ?? null,
    };
    out.social = s.x || s.skype || s.facebook ? s : null;
  }
  put('billingAddress', cleanAddress(input.billingAddress, 'Billing address'));
  put('shippingAddress', cleanAddress(input.shippingAddress, 'Shipping address'));
  put('contactPersons', cleanContactPersons(input.contactPersons));
  return out;
}

/** The billing address's two street lines as the one address line documents print. */
export function addressLine(a: PartyAddress | null): string | null {
  return [a?.street1, a?.street2].filter(Boolean).join(', ') || null;
}

/**
 * Everything a create or an edit changes, as one $set: the details
 * cleanPartyDetails checks (name, GSTIN, phone, email, address, city,
 * pincode, the customer's place of supply, notes) and the profile fields.
 * A customer's PAN follows the GSTIN when it is not given; a vendor's PAN
 * and TDS are set by the vendor service, with its TDS rules.
 */
export function partyChanges(raw: PartyChangesInput, current: CurrentParty, kind: 'customer' | 'vendor'): Record<string, unknown> {
  // One field under two names: the newer name wins when both are sent.
  const input: PartyChangesInput = {
    ...raw,
    ...(raw.workPhone !== undefined ? { phone: raw.workPhone } : {}),
    ...(raw.remarks !== undefined ? { notes: raw.remarks } : {}),
  };
  // The phone and notes are checked as they always were: imports bring phones written every which way.
  const profile = cleanPartyProfile(input, kind);
  const billing = profile.billingAddress as PartyAddress | null | undefined;

  // A billing address is where the address, city and pincode on documents come from.
  const fromBilling: PartyDetailsInput =
    billing === undefined ? {} : { address: addressLine(billing), city: billing?.city ?? null, pincode: billing && isIndia(billing.country) ? billing.pincode : null };
  // The place of supply: the GSTIN's state, or the one given; with neither, and none kept, the billing state.
  const placeFromBilling =
    kind === 'customer' && input.stateCode === undefined && billing?.stateCode && !current.stateCode ? { stateCode: billing.stateCode } : {};
  const details = cleanPartyDetails(
    { ...input, ...fromBilling, ...placeFromBilling },
    kind === 'customer' ? { gstin: current.gstin, stateCode: current.stateCode ?? null } : { gstin: current.gstin },
  );
  const set: Record<string, unknown> = { ...details, ...profile };
  const gstinNow = 'gstin' in details ? (details.gstin as string | null) : current.gstin;

  if (billing && !billing.stateCode && isIndia(billing.country) && gstinNow) {
    // An address in India without its state: the GSTIN says which.
    set.billingAddress = { ...billing, stateCode: gstinNow.slice(0, 2) };
  }

  if (billing === undefined && ['address', 'city', 'pincode'].some((k) => k in details)) {
    // Changed the old way: the billing address follows, so the form shows what documents print.
    const base: PartyAddress = current.billingAddress ?? {
      attention: null, country: 'India', street1: null, street2: null, city: null, stateCode: null, pincode: null, phone: null, fax: null,
    };
    const next: PartyAddress = { ...base };
    if ('address' in details) {
      next.street1 = (details.address as string | null) ?? null;
      next.street2 = null;
    }
    if ('city' in details) next.city = (details.city as string | null) ?? null;
    if ('pincode' in details) next.pincode = (details.pincode as string | null) ?? null;
    if (!next.stateCode) next.stateCode = gstinNow?.slice(0, 2) ?? ((details.stateCode as string | null | undefined) ?? current.stateCode ?? null);
    set.billingAddress = Object.entries(next).some(([k, v]) => k !== 'country' && v) ? next : null;
  }

  if (kind === 'customer') {
    const pan = cleanPan(input.pan);
    if (pan !== undefined) set.pan = pan;
    else if ('gstin' in details) {
      // A PAN that came from the old GSTIN, or none, follows the new one.
      const derived = panFromGstin(current.gstin);
      if (!current.pan || current.pan === derived) set.pan = panFromGstin(details.gstin as string | null);
    }
  }
  return set;
}

/** Equal as stored: objects and lists compared by value, missing as null. */
export function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => JSON.stringify(v === undefined ? null : v);
  return norm(a) === norm(b);
}

/** A party as the API returns it: the work phone and the remarks under both their names. */
export function partyView<T extends { phone?: string | null; notes?: string | null }>(p: T): T & { workPhone: string | null; remarks: string | null } {
  return { ...p, workPhone: p.phone ?? null, remarks: p.notes ?? null };
}
