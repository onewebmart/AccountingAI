import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { GSP_PROVIDER, GspProvider, TaxpayerRecord } from '../einvoice/gsp.provider';
import { gstinProblem } from '../extraction/invoice-checks';
import { GST_STATE_NAMES } from '../gst/gst-states';

/**
 * "Prefill from GSTIN". A GSTIN carries some facts in itself: the state it
 * was issued in (characters 1–2), the holder's PAN (3–12), and from the
 * PAN's fourth letter what kind of holder that is. Those are read here. The
 * legal name, trade name and registered address are on the GST portal only,
 * so they come from the GSP's taxpayer search, or not at all: nothing is
 * guessed.
 */

export type PartyType = 'business' | 'individual';

/** The PAN's fourth letter: who holds it. */
export const PAN_HOLDERS: Readonly<Record<string, { kind: string; label: string; partyType: PartyType }>> = {
  P: { kind: 'individual', label: 'Individual', partyType: 'individual' },
  C: { kind: 'company', label: 'Company', partyType: 'business' },
  F: { kind: 'firm', label: 'Firm or LLP', partyType: 'business' },
  H: { kind: 'huf', label: 'Hindu undivided family', partyType: 'business' },
  A: { kind: 'aop', label: 'Association of persons', partyType: 'business' },
  B: { kind: 'boi', label: 'Body of individuals', partyType: 'business' },
  T: { kind: 'trust', label: 'Trust', partyType: 'business' },
  G: { kind: 'government', label: 'Government', partyType: 'business' },
  L: { kind: 'local_authority', label: 'Local authority', partyType: 'business' },
  J: { kind: 'artificial_juridical_person', label: 'Artificial juridical person', partyType: 'business' },
};

export interface GstinFacts {
  gstin: string;
  stateCode: string;
  stateName: string | null;
  pan: string;
  /** From the PAN's fourth letter; null for a letter outside the PAN scheme. */
  holder: { code: string; kind: string; label: string } | null;
  /** Business or individual, as a customer or vendor form asks it. */
  partyType: PartyType | null;
  /** The 13th character: 1 for the holder's first registration in that state, 2 for the second… */
  registrationInState: string;
}

/** The facts in a GSTIN. A GSTIN that is not one (format or check digit) is refused, saying why. */
export function gstinFacts(raw: string): GstinFacts {
  const gstin = (raw ?? '').trim().toUpperCase();
  const problem = gstinProblem(gstin);
  if (problem) throw new BadRequestException(`GSTIN ${gstin || '(blank)'} ${problem}.`);
  const stateCode = gstin.slice(0, 2);
  const pan = gstin.slice(2, 12);
  const code = pan[3];
  const holder = PAN_HOLDERS[code] ?? null;
  return {
    gstin,
    stateCode,
    stateName: GST_STATE_NAMES[stateCode] ?? null,
    pan,
    holder: holder ? { code, kind: holder.kind, label: holder.label } : null,
    partyType: holder?.partyType ?? null,
    registrationInState: gstin[12],
  };
}

export interface GstinLookup extends GstinFacts {
  /** From the GST portal through the GSP; null when it could not say. */
  registration: TaxpayerRecord | null;
  /** Where each part came from. */
  sources: { state: 'gstin'; pan: 'gstin'; holder: 'pan'; registration: 'gsp' | null };
  /** Why there is no legal name or address, when there is none. */
  note: string | null;
  gateway: { name: string; isMock: boolean };
}

@Injectable()
export class GstinLookupService {
  private readonly log = new Logger(GstinLookupService.name);

  constructor(@Inject(GSP_PROVIDER) private readonly gsp: GspProvider) {}

  async lookup(raw: string): Promise<GstinLookup> {
    const facts = gstinFacts(raw);
    let registration: TaxpayerRecord | null = null;
    let note: string | null = null;
    try {
      registration = await this.gsp.searchTaxpayer(facts.gstin);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.log.warn(`Taxpayer search for ${facts.gstin} failed: ${why}`);
      note = `The GST portal could not be searched just now (${why}). The state, PAN and type are read from the GSTIN itself; type the legal name and address.`;
    }
    // Only a record for this GSTIN is used.
    if (registration && registration.gstin?.trim().toUpperCase() !== facts.gstin) registration = null;
    if (!registration && !note) {
      note = this.gsp.isMock
        ? 'The legal name and address need a GSP connection: the test gateway in use cannot search the GST portal. The state, PAN and type are read from the GSTIN itself.'
        : 'The GST portal has no record of this GSTIN. Check it was typed right; the state, PAN and type are read from the GSTIN itself.';
    }
    return {
      ...facts,
      registration,
      sources: { state: 'gstin', pan: 'gstin', holder: 'pan', registration: registration ? 'gsp' : null },
      note,
      gateway: { name: this.gsp.name, isMock: this.gsp.isMock },
    };
  }
}
