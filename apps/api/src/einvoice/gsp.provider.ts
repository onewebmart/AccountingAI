import { createHash } from 'crypto';
import { EinvoicePayload, financialYear } from './einvoice-payload';

export const GSP_PROVIDER = Symbol('GSP_PROVIDER');

export interface IrnResult {
  irn: string;
  ackNo: string;
  /** ISO timestamp. */
  ackDate: string;
  signedQrCode: string;
}

export interface GspError {
  code: string;
  message: string;
}

/** The IRP said no, with its reasons. */
export class GspRejected extends Error {
  constructor(public readonly errors: GspError[]) {
    super(errors.map((e) => `${e.code}: ${e.message}`).join('; '));
  }
}

export interface EwbInput {
  irn: string | null;
  sellerGstin: string;
  docNo: string;
  docDate: string;
  fromPincode: string;
  toPincode: string;
  distanceKm: number;
  valuePaise: number;
  mode: 'road' | 'rail' | 'air' | 'ship';
  vehicleNo: string | null;
  vehicleType: 'regular' | 'odc';
  transporterId: string | null;
  transporterName: string | null;
  transDocNo: string | null;
  transDocDate: string | null;
}

/**
 * The GST Suvidha Provider: the licensed gateway to the IRP (e-invoice) and
 * the e-way bill system. An interface, so the mock runs everything here and
 * a GSP's adapter can replace it without touching the rest.
 */
export interface GspProvider {
  readonly name: string;
  readonly isMock: boolean;
  generateIrn(payload: EinvoicePayload): Promise<IrnResult>;
  cancelIrn(irn: string, reasonCode: string, remark: string): Promise<{ cancelledAt: string }>;
  generateEwb(input: EwbInput): Promise<{ ewbNo: string; ewbDate: string }>;
  updateVehicle(ewbNo: string, vehicleNo: string, reasonCode: string, remark: string): Promise<void>;
  extendEwb(ewbNo: string, remainingKm: number, reasonCode: string, remark: string): Promise<void>;
  cancelEwb(ewbNo: string, reasonCode: string, remark: string): Promise<void>;
}

/** The IRN is a SHA-256 of the supplier's GSTIN, financial year, document type and number. */
export function irnFor(payload: EinvoicePayload): string {
  const d = payload.DocDtls;
  const date = `${d.Dt.slice(6, 10)}-${d.Dt.slice(3, 5)}-${d.Dt.slice(0, 2)}`;
  return createHash('sha256').update(`${payload.SellerDtls.Gstin}${financialYear(date)}${d.Typ}${d.No}`).digest('hex');
}

/**
 * Stands in for a GSP in development and tests. IRNs are computed the way
 * the IRP computes them, so a second request for the same invoice gets the
 * duplicate error the IRP gives. The QR is marked as a test QR: nothing
 * here is registered anywhere.
 */
export class MockGsp implements GspProvider {
  readonly name = 'mock';
  readonly isMock = true;
  private readonly irns = new Map<string, IrnResult & { cancelled: boolean }>();
  private ewbSeq = 0;

  async generateIrn(payload: EinvoicePayload): Promise<IrnResult> {
    const irn = irnFor(payload);
    const existing = this.irns.get(irn);
    if (existing && !existing.cancelled) throw new GspRejected([{ code: '2150', message: 'Duplicate IRN' }]);
    if (existing?.cancelled) throw new GspRejected([{ code: '2278', message: 'IRN is already generated and is cancelled for this document' }]);
    const ackNo = String(BigInt(`0x${irn.slice(0, 15)}`) % 10n ** 15n).padStart(15, '1');
    const ackDate = new Date().toISOString();
    const signedQrCode = `TEST-QR.${Buffer.from(JSON.stringify({ SellerGstin: payload.SellerDtls.Gstin, BuyerGstin: payload.BuyerDtls.Gstin, DocNo: payload.DocDtls.No, DocDt: payload.DocDtls.Dt, TotInvVal: payload.ValDtls.TotInvVal, ItemCnt: payload.ItemList.length, MainHsnCode: payload.ItemList[0]?.HsnCd, Irn: irn, IrnDt: ackDate })).toString('base64url')}`;
    const result = { irn, ackNo, ackDate, signedQrCode };
    this.irns.set(irn, { ...result, cancelled: false });
    return result;
  }

  async cancelIrn(irn: string) {
    const existing = this.irns.get(irn);
    if (existing) existing.cancelled = true;
    return { cancelledAt: new Date().toISOString() };
  }

  async generateEwb(input: EwbInput) {
    this.ewbSeq += 1;
    const ewbNo = `1${String(Date.now()).slice(-8)}${String(this.ewbSeq).padStart(3, '0')}`.slice(0, 12);
    void input;
    return { ewbNo, ewbDate: new Date().toISOString() };
  }

  async updateVehicle() {}
  async extendEwb() {}
  async cancelEwb() {}
}
