import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AuditService } from '../gl/audit.service';
import { gstinProblem } from '../extraction/invoice-checks';
import { cleanPartyDetails, PartyDetailsInput } from '../gl/party-details';
import { TDS_SECTION_CODES, TdsSection, defaultTdsRateBps, panFromGstin } from '../gl/tds';
import { Model, Types } from 'mongoose';
import { BillStatus } from '@ai-accounting/shared';
import { Vendor, VendorDocument } from './schemas/vendor.schema';
import { PurchaseBill, PurchaseBillDocument } from './schemas/purchase-bill.schema';
import { withOrg } from '../database/tenant.plugin';
import { buildAgeingSummary, AgeingSummary } from './ageing.util';
import { outstandingPaise } from '../gl/schemas/settlement.schema';

export interface CreateVendorInput {
  orgId: string;
  /** Who created it, for the audit trail. */
  actorId?: string;
  name: string;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  pan?: string | null;
  tdsSection?: string | null;
  tdsRateBps?: number | null;
}

export interface UpdateVendorTaxInput {
  pan?: string | null;
  /** null stops deducting TDS for this vendor. */
  tdsSection?: string | null;
  tdsRateBps?: number | null;
}

@Injectable()
export class VendorsService {
  constructor(
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    private auditService: AuditService,
  ) {}

  async create(input: CreateVendorInput): Promise<VendorDocument> {
    // A typed GSTIN with a wrong check digit is a typo; catch it here rather
    // than on the GST return.
    const gstin = input.gstin?.trim() ? input.gstin.trim().toUpperCase() : null;
    const problem = gstin ? gstinProblem(gstin) : null;
    if (problem) throw new BadRequestException(`GSTIN ${gstin} ${problem}`);

    const vendor = await this.vendorModel.create({
      orgId: input.orgId,
      name: input.name,
      gstin,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
      ...this.taxSettings({ pan: input.pan ?? panFromGstin(gstin), tdsSection: input.tdsSection, tdsRateBps: input.tdsRateBps }),
    });
    await this.auditService.record({
      orgId: input.orgId,
      entityType: 'Vendor',
      entityId: vendor._id.toString(),
      action: 'CREATE',
      performedBy: input.actorId ?? 'unknown',
      after: { name: vendor.name, gstin: vendor.gstin, tdsSection: vendor.tdsSection, tdsRateBps: vendor.tdsRateBps },
    });
    return vendor;
  }

  /**
   * Vendors with what is still owed to each. The Purchase page read
   * outstandingPaise off this list, but it returned the raw documents — so
   * every vendor showed "Cleared" and the total outstanding read ₹NaN.
   */
  async list(orgId: string): Promise<Array<Record<string, unknown> & { outstandingPaise: number }>> {
    const [vendors, open] = await Promise.all([
      withOrg(orgId, () => this.vendorModel.find().sort({ name: 1 }).lean().exec()),
      withOrg(orgId, () => this.billModel.find({ status: BillStatus.POSTED }).lean().exec()),
    ]);
    const owed = new Map<string, number>();
    for (const bill of open) {
      const key = String(bill.vendorId);
      owed.set(key, (owed.get(key) ?? 0) + outstandingPaise(bill));
    }
    return vendors.map((v) => ({ ...v, outstandingPaise: owed.get(String(v._id)) ?? 0 }));
  }

  /**
   * Change a vendor's details. Bills already issued keep the name and GSTIN
   * they were issued with: they are stamped first, so a corrected GSTIN does
   * not rewrite GST returns or the purchase register for past months.
   */
  async update(id: string, orgId: string, actorId: string, input: PartyDetailsInput): Promise<VendorDocument> {
    const vendor = await this.findById(id, orgId);
    const set = cleanPartyDetails(input, { gstin: vendor.gstin });
    const changed = Object.keys(set).filter((k) => set[k] !== (vendor as unknown as Record<string, unknown>)[k]);
    if (changed.length === 0) return vendor;

    let stamped = 0;
    if (changed.some((k) => k === 'name' || k === 'gstin')) {
      const result = await withOrg(orgId, () =>
        this.billModel
          .updateMany(
            { vendorId: vendor._id, status: { $ne: BillStatus.DRAFT }, partyAtIssue: null },
            { $set: { partyAtIssue: { name: vendor.name, gstin: vendor.gstin, stateCode: vendor.gstin?.slice(0, 2) ?? null } } },
          )
          .exec(),
      );
      stamped = result.modifiedCount;
    }
    const updated = await withOrg(orgId, () =>
      this.vendorModel.findOneAndUpdate({ _id: vendor._id }, { $set: set }, { new: true }).exec(),
    );
    await this.auditService.record({
      orgId,
      entityType: 'Vendor',
      entityId: id,
      action: 'UPDATE',
      performedBy: actorId,
      before: Object.fromEntries(changed.map((k) => [k, (vendor as unknown as Record<string, unknown>)[k] ?? null])),
      after: Object.fromEntries(changed.map((k) => [k, set[k]])),
      meta: stamped ? { billsKeptAsIssued: stamped } : undefined,
    });
    return updated!;
  }

  /** Contact details and tax settings together, as the vendor form sends them. */
  async edit(id: string, orgId: string, actorId: string, input: PartyDetailsInput & UpdateVendorTaxInput): Promise<VendorDocument> {
    const { pan, tdsSection, tdsRateBps, ...details } = input;
    let vendor = await this.update(id, orgId, actorId, details);
    if (pan !== undefined || tdsSection !== undefined || tdsRateBps !== undefined) {
      vendor = await this.updateTax(id, orgId, actorId, { pan, tdsSection, tdsRateBps });
    }
    return vendor;
  }

  /** Set a vendor's PAN and the TDS section and rate applied to their bills from now on. */
  async updateTax(id: string, orgId: string, actorId: string, input: UpdateVendorTaxInput): Promise<VendorDocument> {
    const vendor = await this.findById(id, orgId);
    const set = this.taxSettings({
      pan: input.pan !== undefined ? input.pan : vendor.pan ?? panFromGstin(vendor.gstin),
      tdsSection: input.tdsSection !== undefined ? input.tdsSection : vendor.tdsSection,
      tdsRateBps: input.tdsSection === undefined && input.tdsRateBps === undefined ? vendor.tdsRateBps : input.tdsRateBps,
    });
    const updated = await withOrg(orgId, () =>
      this.vendorModel.findOneAndUpdate({ _id: vendor._id }, { $set: set }, { new: true }).exec(),
    );
    await this.auditService.record({
      orgId,
      entityType: 'Vendor',
      entityId: id,
      action: 'UPDATE_TAX',
      performedBy: actorId,
      before: { pan: vendor.pan, tdsSection: vendor.tdsSection, tdsRateBps: vendor.tdsRateBps },
      after: set,
    });
    return updated!;
  }

  /**
   * Validated PAN and TDS settings. A section with no rate takes the
   * section's default for this payee (194C: 1% for an individual or HUF).
   */
  private taxSettings(input: { pan?: string | null; tdsSection?: string | null; tdsRateBps?: number | null }) {
    const pan = input.pan?.trim() ? input.pan.trim().toUpperCase() : null;
    if (pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) throw new BadRequestException(`PAN ${pan} is not in the format ABCDE1234F`);
    if (!input.tdsSection) return { pan, tdsSection: null, tdsRateBps: null };
    if (!(TDS_SECTION_CODES as string[]).includes(input.tdsSection)) {
      throw new BadRequestException(`Unknown TDS section ${input.tdsSection} — use one of ${TDS_SECTION_CODES.join(', ')}`);
    }
    const rate = input.tdsRateBps ?? defaultTdsRateBps(input.tdsSection as TdsSection, pan);
    if (!Number.isInteger(rate) || rate < 0 || rate > 10_000) {
      throw new BadRequestException('The TDS rate must be whole basis points between 0 and 10000 (100 = 1%)');
    }
    return { pan, tdsSection: input.tdsSection, tdsRateBps: rate };
  }

  async findById(id: string, orgId: string): Promise<VendorDocument> {
    const vendor = await withOrg(orgId, () => this.vendorModel.findById(id).exec());
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  /** What is still owed to this vendor on posted bills, after part payments. */
  async outstanding(vendorId: string, orgId: string): Promise<number> {
    const bills = await withOrg(orgId, () =>
      this.billModel
        .find({ vendorId: new Types.ObjectId(vendorId), status: { $in: [BillStatus.POSTED] } })
        .exec(),
    );
    return bills.reduce((sum, b) => sum + outstandingPaise(b), 0);
  }

  /** AP ageing: bucket posted-but-unpaid bills by days past due date. */
  async apAgeing(orgId: string): Promise<AgeingSummary> {
    const bills = await withOrg(orgId, () =>
      this.billModel.find({ status: BillStatus.POSTED }).exec(),
    );
    return buildAgeingSummary(bills.map((b) => ({ owedPaise: outstandingPaise(b), dueDate: b.dueDate })));
  }
}
