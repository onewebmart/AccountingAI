import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { InvoiceStatus } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { partyAsIssued } from '../gl/party-as-issued';
import { JournalReversalService } from '../journals/journal-reversal.service';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import { todayIst } from '../automation/schedule';
import { EInvoice, EInvoiceDocument } from './schemas/e-invoice.schema';
import { EWayBill, EWayBillDocument } from './schemas/e-way-bill.schema';
import { EinvoiceInput, buildEinvoicePayload } from './einvoice-payload';
import { PrecheckIssue, precheck } from './precheck';
import { GSP_PROVIDER, GspProvider, GspRejected } from './gsp.provider';
import { EWB_THRESHOLD_PAISE, MAX_DISTANCE_KM, canExtend, normaliseVehicleNo, validDays, validUpto, within24h } from './eway';

export const IRN_CANCEL_REASONS: Record<string, string> = { '1': 'Duplicate', '2': 'Data entry mistake', '3': 'Order cancelled', '4': 'Other' };
export const EWB_CANCEL_REASONS: Record<string, string> = { '1': 'Duplicate', '2': 'Order cancelled', '3': 'Data entry mistake', '4': 'Other' };
export const VEHICLE_REASONS: Record<string, string> = { '1': 'Breakdown', '2': 'Transhipment', '3': 'Other', '4': 'First time' };
export const EXTEND_REASONS: Record<string, string> = { '1': 'Natural calamity', '2': 'Law and order', '4': 'Transhipment', '5': 'Accident', '99': 'Other' };

export interface EwbRequest {
  distanceKm: number;
  mode: 'road' | 'rail' | 'air' | 'ship';
  vehicleNo?: string | null;
  vehicleType?: 'regular' | 'odc';
  transporterId?: string | null;
  transporterName?: string | null;
  transDocNo?: string | null;
  transDocDate?: string | null;
}

/** A pending request older than this was cut off; it may be tried again. */
const STALE_PENDING_MS = 2 * 60_000;

/**
 * E-invoices and e-way bills for posted sales. Every call to the IRP or the
 * e-way bill system is an explicit action by a person: it is outward-facing,
 * and registering an IRN cannot be undone except by cancelling it within a
 * day. Nothing here changes the ledger except cancelling an IRN, which
 * reverses the sale through the one sanctioned path.
 */
@Injectable()
export class EinvoiceService {
  constructor(
    @InjectModel(EInvoice.name) private einvoiceModel: Model<EInvoiceDocument>,
    @InjectModel(EWayBill.name) private ewbModel: Model<EWayBillDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(OrgSettings.name) private settingsModel: Model<OrgSettingsDocument>,
    @Inject(GSP_PROVIDER) private gsp: GspProvider,
    private reversals: JournalReversalService,
    private audit: AuditService,
  ) {}

  /** Everything the invoice page shows: whether it applies, what the IRP would refuse, what exists. */
  async view(orgId: string, invoiceId: string, today = todayIst()) {
    const { invoice, input } = await this.load(orgId, invoiceId);
    const [einvoice, ewayBills] = await Promise.all([
      this.einvoiceModel.findOne({ orgId, invoiceId: invoice._id }).lean().exec(),
      this.ewbModel.find({ orgId, invoiceId: invoice._id }).sort({ createdAt: -1 }).lean().exec(),
    ]);
    const issues = this.issuesFor(input, today, einvoice?.status === 'cancelled');
    return {
      provider: { name: this.gsp.name, isMock: this.gsp.isMock },
      posted: invoice.status === InvoiceStatus.POSTED || invoice.status === InvoiceStatus.PAID,
      applicable: !!input.buyer.gstin,
      precheck: issues,
      ready: !issues.some((i) => i.level === 'block'),
      einvoice,
      canCancelIrn: einvoice?.status === 'active' && !!einvoice.ackDate && within24h(new Date(einvoice.ackDate), new Date()),
      ewayBills,
      ewbRequired: invoice.amountsPaise.total > EWB_THRESHOLD_PAISE,
    };
  }

  async generateIrn(orgId: string, actorId: string, invoiceId: string, today = todayIst()) {
    const { invoice, input } = await this.load(orgId, invoiceId);
    if (invoice.status !== InvoiceStatus.POSTED && invoice.status !== InvoiceStatus.PAID) throw new BadRequestException('Post the invoice first: an IRN is for an issued invoice.');
    const existing = await this.einvoiceModel.findOne({ orgId, invoiceId: invoice._id }).exec();
    const issues = this.issuesFor(input, today, existing?.status === 'cancelled');
    const blocking = issues.filter((i) => i.level === 'block');
    if (blocking.length) throw new BadRequestException(`The IRP would refuse this invoice: ${blocking.map((i) => i.message).join(' ')}`);

    // Claim the request, so a second click does not register it twice.
    let record: EInvoiceDocument | null;
    if (!existing) {
      try {
        record = await this.einvoiceModel.create({ orgId, invoiceId: invoice._id, status: 'pending', provider: this.gsp.name, isTest: this.gsp.isMock, attempts: 1 });
      } catch (err) {
        if ((err as { code?: number }).code === 11000) throw new ConflictException('An IRN is already being generated for this invoice.');
        throw err;
      }
    } else {
      record = await this.einvoiceModel
        .findOneAndUpdate(
          { _id: existing._id, $or: [{ status: 'failed' }, { status: 'pending', updatedAt: { $lt: new Date(Date.now() - STALE_PENDING_MS) } }] },
          { $set: { status: 'pending', irpErrors: [] }, $inc: { attempts: 1 } },
          { new: true },
        )
        .exec();
      if (!record) throw new ConflictException(existing.status === 'active' ? 'This invoice already has an IRN.' : 'An IRN is already being generated for this invoice.');
    }

    try {
      const result = await this.gsp.generateIrn(buildEinvoicePayload(input));
      record.set({ status: 'active', irn: result.irn, ackNo: result.ackNo, ackDate: new Date(result.ackDate), signedQrCode: result.signedQrCode, generatedBy: actorId, irpErrors: [] });
      await record.save();
      await this.audit.record({ orgId, entityType: 'SalesInvoice', entityId: invoiceId, action: 'GENERATE_IRN', performedBy: actorId, after: { irn: result.irn, ackNo: result.ackNo, provider: this.gsp.name, test: this.gsp.isMock } });
      return record;
    } catch (err) {
      const errors = err instanceof GspRejected ? err.errors : [{ code: 'NETWORK', message: err instanceof Error ? err.message : String(err) }];
      record.set({ status: 'failed', irpErrors: errors });
      await record.save();
      await this.audit.record({ orgId, entityType: 'SalesInvoice', entityId: invoiceId, action: 'IRN_REFUSED', performedBy: actorId, after: { errors } });
      throw new BadRequestException(`The IRP refused it: ${errors.map((e) => `${e.message} (${e.code})`).join('; ')}`);
    }
  }

  /**
   * Cancel within 24 hours: the IRP first, then the sale is reversed in the
   * books. After 24 hours the IRP no longer allows it; a credit note does the job.
   */
  async cancelIrn(orgId: string, actorId: string, invoiceId: string, input: { reasonCode: string; remark: string }) {
    const { invoice } = await this.load(orgId, invoiceId);
    const record = await this.einvoiceModel.findOne({ orgId, invoiceId: invoice._id, status: 'active' }).exec();
    if (!record?.irn) throw new BadRequestException('This invoice has no IRN to cancel.');
    if (!IRN_CANCEL_REASONS[input.reasonCode]) throw new BadRequestException('Pick a reason: duplicate, data entry mistake, order cancelled, or other.');
    if (!input.remark?.trim()) throw new BadRequestException('Say why, in a few words: the IRP records it.');
    if (!record.ackDate || !within24h(record.ackDate, new Date())) {
      throw new BadRequestException('An IRN can only be cancelled within 24 hours. Raise a credit note against the invoice instead.');
    }
    if ((invoice.amountPaidPaise ?? 0) > 0 || (invoice.adjustedPaise ?? 0) > 0) {
      throw new BadRequestException('The invoice has receipts or credit notes against it. Reverse those first, then cancel the IRN.');
    }
    if (await this.ewbModel.exists({ orgId, invoiceId: invoice._id, status: 'active' }).exec()) {
      throw new BadRequestException('Cancel the e-way bill first: the IRP will not cancel an IRN with an active e-way bill.');
    }
    if (!invoice.journalId) throw new BadRequestException('The invoice has no posting to reverse.');
    // A locked Sales period refuses the reversal: find out before the IRP cancels.
    await this.reversals.assertReversible(String(invoice.journalId), orgId);

    const { cancelledAt } = await this.gsp.cancelIrn(record.irn, input.reasonCode, input.remark.trim());
    record.set({ status: 'cancelled', cancelledAt: new Date(cancelledAt), cancelReason: `${IRN_CANCEL_REASONS[input.reasonCode]}: ${input.remark.trim()}`, cancelledBy: actorId });
    await record.save();
    await this.audit.record({ orgId, entityType: 'SalesInvoice', entityId: invoiceId, action: 'CANCEL_IRN', performedBy: actorId, before: { irn: record.irn, status: 'active' }, after: { status: 'cancelled', reason: record.cancelReason } });
    // The IRN is gone at the IRP; the sale comes out of the books the sanctioned way.
    const reversal = await this.reversals.reverse(String(invoice.journalId), orgId, actorId);
    return { einvoice: record, reversalJournalId: String(reversal._id) };
  }

  async generateEwb(orgId: string, actorId: string, invoiceId: string, req: EwbRequest) {
    const { invoice, input, customer } = await this.load(orgId, invoiceId);
    if (invoice.status !== InvoiceStatus.POSTED && invoice.status !== InvoiceStatus.PAID) throw new BadRequestException('Post the invoice first.');
    if (await this.ewbModel.exists({ orgId, invoiceId: invoice._id, status: 'active' }).exec()) throw new ConflictException('This invoice already has an active e-way bill.');
    const sellerGstin = input.seller.gstin;
    if (!sellerGstin) throw new BadRequestException('Enter your GSTIN in Settings → Business first.');
    if (!/^[1-9]\d{5}$/.test(input.seller.pincode ?? '')) throw new BadRequestException('Add your pincode in Settings → Business: it is where the goods start from.');
    if (!/^[1-9]\d{5}$/.test(input.buyer.pincode ?? '')) throw new BadRequestException(`Add ${input.buyer.legalName}'s pincode: it is where the goods go.`);
    const distanceKm = Math.round(req.distanceKm);
    if (!Number.isFinite(distanceKm) || distanceKm < 1 || distanceKm > MAX_DISTANCE_KM) throw new BadRequestException(`Enter the distance in kilometres, from 1 to ${MAX_DISTANCE_KM}.`);
    const transport = this.checkedTransport(req);

    const irn = (await this.einvoiceModel.findOne({ orgId, invoiceId: invoice._id, status: 'active' }).lean().exec())?.irn ?? null;
    const { ewbNo, ewbDate } = await this.gsp.generateEwb({
      irn, sellerGstin, docNo: invoice.invoiceNumber ?? '', docDate: invoice.invoiceDate, fromPincode: input.seller.pincode!, toPincode: input.buyer.pincode!,
      distanceKm, valuePaise: invoice.amountsPaise.total, ...transport,
    });
    const generated = new Date(ewbDate);
    const ewb = await this.ewbModel.create({
      orgId, invoiceId: invoice._id, customerId: customer?._id ?? null, status: 'active', ewbNo, ewbDate: generated,
      validUpto: validUpto(generated, validDays(distanceKm, transport.vehicleType)),
      fromPincode: input.seller.pincode, toPincode: input.buyer.pincode, distanceKm, valuePaise: invoice.amountsPaise.total,
      ...transport, provider: this.gsp.name, isTest: this.gsp.isMock, createdBy: actorId,
      vehicleHistory: transport.vehicleNo ? [{ vehicleNo: transport.vehicleNo, at: generated, reason: VEHICLE_REASONS['4'], by: actorId }] : [],
    });
    await this.audit.record({ orgId, entityType: 'SalesInvoice', entityId: invoiceId, action: 'GENERATE_EWB', performedBy: actorId, after: { ewbNo, distanceKm, vehicleNo: transport.vehicleNo, validUpto: ewb.validUpto } });
    return ewb;
  }

  /** Part B: the vehicle, entered later or changed on the way. */
  async updateVehicle(orgId: string, actorId: string, ewbId: string, input: { vehicleNo: string; reasonCode: string; remark?: string }) {
    const ewb = await this.activeEwb(orgId, ewbId);
    if (ewb.mode !== 'road') throw new BadRequestException('A vehicle number is for goods moving by road.');
    const vehicleNo = normaliseVehicleNo(input.vehicleNo ?? '');
    if (!vehicleNo) throw new BadRequestException('Enter a vehicle number like MH12AB1234.');
    if (!VEHICLE_REASONS[input.reasonCode]) throw new BadRequestException('Pick a reason: breakdown, transhipment, first time, or other.');
    if (ewb.validUpto.getTime() < Date.now()) throw new BadRequestException('The e-way bill has expired. Extend it first.');
    await this.gsp.updateVehicle(ewb.ewbNo, vehicleNo, input.reasonCode, input.remark ?? '');
    const before = ewb.vehicleNo;
    ewb.vehicleNo = vehicleNo;
    ewb.vehicleHistory.push({ vehicleNo, at: new Date(), reason: VEHICLE_REASONS[input.reasonCode], by: actorId });
    await ewb.save();
    await this.audit.record({ orgId, entityType: 'EWayBill', entityId: ewbId, action: 'UPDATE_VEHICLE', performedBy: actorId, before: { vehicleNo: before }, after: { vehicleNo } });
    return ewb;
  }

  async extendEwb(orgId: string, actorId: string, ewbId: string, input: { remainingKm: number; reasonCode: string; remark?: string }, now = new Date()) {
    const ewb = await this.activeEwb(orgId, ewbId);
    if (!EXTEND_REASONS[input.reasonCode]) throw new BadRequestException('Pick a reason for the extension.');
    const km = Math.round(input.remainingKm);
    if (!Number.isFinite(km) || km < 1 || km > ewb.distanceKm) throw new BadRequestException(`Enter the distance still to go, from 1 to ${ewb.distanceKm} km.`);
    if (!canExtend(ewb.validUpto, now)) throw new BadRequestException('An e-way bill can be extended from 8 hours before it expires until 8 hours after.');
    await this.gsp.extendEwb(ewb.ewbNo, km, input.reasonCode, input.remark ?? '');
    const until = validUpto(now, validDays(km, ewb.vehicleType));
    const before = ewb.validUpto;
    ewb.validUpto = until;
    ewb.extensions.push({ at: now, remainingKm: km, reason: EXTEND_REASONS[input.reasonCode], validUpto: until, by: actorId });
    await ewb.save();
    await this.audit.record({ orgId, entityType: 'EWayBill', entityId: ewbId, action: 'EXTEND_EWB', performedBy: actorId, before: { validUpto: before }, after: { validUpto: until, remainingKm: km } });
    return ewb;
  }

  async cancelEwb(orgId: string, actorId: string, ewbId: string, input: { reasonCode: string; remark?: string }) {
    const ewb = await this.activeEwb(orgId, ewbId);
    if (!EWB_CANCEL_REASONS[input.reasonCode]) throw new BadRequestException('Pick a reason for cancelling.');
    if (!within24h(ewb.ewbDate, new Date())) throw new BadRequestException('An e-way bill can only be cancelled within 24 hours of making it.');
    await this.gsp.cancelEwb(ewb.ewbNo, input.reasonCode, input.remark ?? '');
    ewb.set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: EWB_CANCEL_REASONS[input.reasonCode] });
    await ewb.save();
    await this.audit.record({ orgId, entityType: 'EWayBill', entityId: ewbId, action: 'CANCEL_EWB', performedBy: actorId, before: { status: 'active' }, after: { status: 'cancelled', reason: ewb.cancelReason } });
    return ewb;
  }

  /** The transporter and vehicle used last time for this customer, else for anyone; the distance only for the same route. */
  async ewbSuggestion(orgId: string, invoiceId: string) {
    const { input, customer } = await this.load(orgId, invoiceId);
    const sameCustomer = customer ? await this.ewbModel.findOne({ orgId, customerId: customer._id }).sort({ createdAt: -1 }).lean().exec() : null;
    const last = sameCustomer ?? (await this.ewbModel.findOne({ orgId }).sort({ createdAt: -1 }).lean().exec());
    if (!last) return null;
    const sameRoute = last.fromPincode === input.seller.pincode && last.toPincode === input.buyer.pincode;
    return {
      mode: last.mode,
      vehicleNo: last.vehicleNo,
      vehicleType: last.vehicleType,
      transporterId: last.transporterId,
      transporterName: last.transporterName,
      distanceKm: sameRoute ? last.distanceKm : null,
      basis: sameCustomer ? 'this customer' : 'your last e-way bill',
    };
  }

  private checkedTransport(req: EwbRequest) {
    const mode = req.mode;
    if (!['road', 'rail', 'air', 'ship'].includes(mode)) throw new BadRequestException('Pick how the goods move: road, rail, air or ship.');
    const vehicleType = req.vehicleType === 'odc' ? 'odc' : 'regular';
    let vehicleNo: string | null = null;
    if (mode === 'road' && req.vehicleNo?.trim()) {
      vehicleNo = normaliseVehicleNo(req.vehicleNo);
      if (!vehicleNo) throw new BadRequestException('Enter a vehicle number like MH12AB1234.');
    }
    const transDocNo = req.transDocNo?.trim() || null;
    const transDocDate = req.transDocDate?.trim() || null;
    if (mode !== 'road' && (!transDocNo || !transDocDate)) throw new BadRequestException(`Goods by ${mode} need the transport document number and date (RR, airway bill or bill of lading).`);
    const transporterId = req.transporterId?.trim().toUpperCase() || null;
    if (transporterId && !/^[0-9A-Z]{15}$/.test(transporterId)) throw new BadRequestException('A transporter ID is the 15-character GSTIN or TRANSIN.');
    if (mode === 'road' && !vehicleNo && !transporterId) throw new BadRequestException('Give the vehicle number, or the transporter who will add it.');
    return { mode, vehicleNo, vehicleType, transporterId, transporterName: req.transporterName?.trim() || null, transDocNo, transDocDate } as const;
  }

  private issuesFor(input: EinvoiceInput, today: string, cancelledBefore: boolean): PrecheckIssue[] {
    const issues = precheck(input, today);
    if (cancelledBefore) {
      issues.unshift({
        level: 'block', code: 'irn_cancelled', where: 'invoice',
        message: `An IRN for invoice ${input.number} was cancelled, and the IRP will not register that number again.`,
        fix: 'Raise a new invoice, with a new number, and e-invoice that.',
      });
    }
    return issues;
  }

  private async activeEwb(orgId: string, id: string): Promise<EWayBillDocument> {
    const ewb = Types.ObjectId.isValid(id) ? await this.ewbModel.findOne({ _id: id, orgId }).exec() : null;
    if (!ewb) throw new NotFoundException('E-way bill not found');
    if (ewb.status !== 'active') throw new BadRequestException('This e-way bill is cancelled.');
    return ewb;
  }

  private async load(orgId: string, invoiceId: string) {
    const invoice = Types.ObjectId.isValid(invoiceId) ? await this.invoiceModel.findOne({ _id: invoiceId, orgId }).exec() : null;
    if (!invoice) throw new NotFoundException('Invoice not found');
    const [customer, settings] = await Promise.all([
      this.customerModel.findOne({ _id: invoice.customerId, orgId }).lean().exec(),
      this.settingsModel.findOne({ orgId }).lean().exec(),
    ]);
    const buyer = partyAsIssued(invoice, customer, 'Customer');
    const sellerGstin = settings?.gstin?.trim().toUpperCase() || null;
    const input: EinvoiceInput = {
      docType: 'INV',
      number: invoice.invoiceNumber,
      date: invoice.invoiceDate,
      seller: {
        gstin: sellerGstin,
        legalName: settings?.displayName?.trim() || '',
        address: settings?.address ?? null,
        city: settings?.city ?? null,
        pincode: settings?.pincode ?? null,
        stateCode: sellerGstin?.slice(0, 2) ?? settings?.stateCode ?? null,
      },
      buyer: {
        gstin: buyer.gstin,
        legalName: buyer.name,
        address: customer?.address ?? null,
        city: customer?.city ?? null,
        pincode: customer?.pincode ?? null,
        stateCode: buyer.stateCode,
      },
      placeOfSupply: buyer.stateCode,
      isReverseCharge: false,
      amounts: invoice.amountsPaise,
      lines: (invoice.lineItems ?? []).map((l) => ({
        description: l.description,
        hsnSac: l.hsnSac,
        qty: l.qty ?? 1,
        uqc: l.uqc ?? null,
        ratePaise: l.ratePaise,
        // The line's assessable value: its amount less its share of any discount.
        amountPaise: l.amountPaise - (l.discountPaise ?? 0),
        taxRatePct: l.taxRatePct ?? 0,
      })),
    };
    return { invoice, customer, input };
  }
}
