import { BadRequestException } from '@nestjs/common';
import { gstinProblem } from '../extraction/invoice-checks';

/** The contact and tax details a person can change on a customer or vendor. */
export interface PartyDetailsInput {
  name?: string;
  gstin?: string | null;
  /** Customers only: the GST state when there is no GSTIN to give it. */
  stateCode?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  /** Six digits; the e-invoice and e-way bill need it. */
  pincode?: string | null;
  notes?: string | null;
}

const text = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() ? v.trim() : null);

/**
 * Only the fields given, cleaned. A GSTIN must pass its check digit; the
 * state follows the GSTIN when there is one.
 */
export function cleanPartyDetails(input: PartyDetailsInput, current: { gstin: string | null; stateCode?: string | null }) {
  const out: Record<string, string | null> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('A name is required.');
    if (name.length > 200) throw new BadRequestException('The name can be at most 200 characters.');
    out.name = name;
  }
  if (input.gstin !== undefined) {
    const gstin = input.gstin?.trim() ? input.gstin.trim().toUpperCase() : null;
    const problem = gstin ? gstinProblem(gstin) : null;
    if (problem) throw new BadRequestException(`GSTIN ${gstin} ${problem}`);
    out.gstin = gstin;
  }
  if (input.pincode !== undefined) {
    const pin = input.pincode?.replace(/\s/g, '') || null;
    if (pin && !/^[1-9]\d{5}$/.test(pin)) throw new BadRequestException('A pincode is six digits and does not start with 0.');
    out.pincode = pin;
  }
  for (const key of ['phone', 'email', 'address', 'city', 'notes'] as const) {
    const v = text(input[key]);
    if (v !== undefined) out[key] = v;
  }
  if ('stateCode' in current) {
    const gstin = out.gstin !== undefined ? out.gstin : current.gstin;
    if (gstin) out.stateCode = gstin.slice(0, 2);
    else if (input.stateCode !== undefined) {
      const code = input.stateCode?.trim() || null;
      if (code && !/^\d{2}$/.test(code)) throw new BadRequestException('The state must be a two-digit GST state code, like 27.');
      out.stateCode = code;
    }
  }
  return out;
}
