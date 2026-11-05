import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AuditService } from '../gl/audit.service';
import { PartyChangesInput, partyChanges, partyView, sameValue } from '../gl/party-profile';
import { TDS_SECTION_CODES, TdsSection, defaultTdsRateBps, panFromGstin } from '../gl/tds';
import { Model, Types } from 'mongoose';
import { BillStatus } from '@ai-accounting/shared';
import { Vendor, VendorBankAccount, VendorDocument } from './schemas/vendor.schema';
import { MsmeActivity, MsmeCategory, UDYAM_PATTERN, VendorMsme } from './msme';
import { PurchaseBill, PurchaseBillDocument } from './schemas/purchase-bill.schema';
import { withOrg } from '../database/tenant.plugin';
import { buildAgeingSummary, AgeingSummary } from './ageing.util';
import { outstandingPaise } from '../gl/schemas/settlement.schema';

/** The details of PartyChangesInput (gl/party-profile.ts) and the vendor's TDS; only the name is required. */
export interface CreateVendorInput extends PartyChangesInput {
  orgId: string;
  /** Who created it, for the audit trail. */
  actorId?: string;
  /** The display name. */
  name: string;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  pincode?: string | null;
  notes?: string | null;
  pan?: string | null;
  tdsSection?: string | null;
  tdsRateBps?: number | null;
}

export interface UpdateVendorBankingInput {
  /** null removes it. */
  bankAccount?: { accountName?: string | null; accountNumber: string; ifsc: string; bankName?: string | null } | null;
  msme?: { udyamNumber: string; category: MsmeCategory; activity: MsmeActivity; writtenAgreement?: boolean } | null;
}

function cleanBankAccount(input: NonNullable<UpdateVendorBankingInput['bankAccount']>): VendorBankAccount {
  const accountNumber = input.accountNumber.replace(/[\s-]/g, '');
  if (!/^\d{6,18}$/.test(accountNumber)) throw new BadRequestException('A bank account number is 6 to 18 digits.');
  const ifsc = input.ifsc.trim().toUpperCase();
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new BadRequestException(`IFSC ${ifsc} is not in the format ABCD0123456.`);
  return { accountName: input.accountName?.trim() || null, accountNumber, ifsc, bankName: input.bankName?.trim() || null };
}

function cleanMsme(input: NonNullable<UpdateVendorBankingInput['msme']>): VendorMsme {
  const udyamNumber = input.udyamNumber.trim().toUpperCase();
  if (!UDYAM_PATTERN.test(udyamNumber)) throw new BadRequestException(`${udyamNumber} is not a Udyam number like UDYAM-MH-26-0012345.`);
  if (!['micro', 'small', 'medium'].includes(input.category)) throw new BadRequestException('The MSME category is micro, small or medium.');
  if (!['manufacturing', 'services', 'trading'].includes(input.activity)) throw new BadRequestException('The activity is manufacturing, services or trading.');
  return { udyamNumber, category: input.category, activity: input.activity, writtenAgreement: !!input.writtenAgreement };
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
    const { orgId, actorId, pan, tdsSection, tdsRateBps, ...details } = input;
    // A typed GSTIN with a wrong check digit is a typo; caught here rather
    // than on the GST return.
    const set = partyChanges(details, { gstin: null, billingAddress: null }, 'vendor');
    const gstin = (set.gstin as string | null | undefined) ?? null;
    const tax = this.taxSettings({ pan: pan || panFromGstin(gstin), tdsSection, tdsRateBps });
    const vendor = await this.vendorModel.create({ orgId, gstin: null, ...set, ...tax });
    await this.auditService.record({
      orgId,
      entityType: 'Vendor',
      entityId: vendor._id.toString(),
      action: 'CREATE',
      performedBy: actorId ?? 'unknown',
      // What was filled in: every field, as kept, that is not blank.
      after: Object.fromEntries(
        Object.entries({ ...set, gstin: vendor.gstin, ...tax }).filter(([, v]) => v !== null && !(Array.isArray(v) && v.length === 0)),
      ),
    });
    return vendor;
  }

  /** Vendors already on the books with this GSTIN: a second one is usually the same business typed twice. */
  async withGstin(orgId: string, gstin: string): Promise<Array<{ _id: string; name: string }>> {
    const found = await withOrg(orgId, () => this.vendorModel.find({ gstin: gstin.trim().toUpperCase() }, { name: 1 }).limit(5).lean().exec());
    return found.map((v) => ({ _id: String(v._id), name: v.name }));
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
    return vendors.map((v) => ({ ...partyView(v), outstandingPaise: owed.get(String(v._id)) ?? 0 }));
  }

  /**
   * Change a vendor's details. Bills already issued keep the name and GSTIN
   * they were issued with: they are stamped first, so a corrected GSTIN does
   * not rewrite GST returns or the purchase register for past months.
   */
  async update(id: string, orgId: string, actorId: string, input: PartyChangesInput): Promise<VendorDocument> {
    const vendor = await this.findById(id, orgId);
    // The PAN goes with the TDS settings (updateTax), never here.
    const { pan: _pan, ...rest } = input;
    void _pan;
    const set = partyChanges(rest, { gstin: vendor.gstin, billingAddress: vendor.billingAddress }, 'vendor');
    const now = vendor.toObject() as unknown as Record<string, unknown>;
    const changed = Object.keys(set).filter((k) => !sameValue(set[k], now[k]));
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
      this.vendorModel.findOneAndUpdate({ _id: vendor._id }, { $set: Object.fromEntries(changed.map((k) => [k, set[k]])) }, { new: true }).exec(),
    );
    await this.auditService.record({
      orgId,
      entityType: 'Vendor',
      entityId: id,
      action: 'UPDATE',
      performedBy: actorId,
      before: Object.fromEntries(changed.map((k) => [k, now[k] ?? null])),
      after: Object.fromEntries(changed.map((k) => [k, set[k]])),
      meta: stamped ? { billsKeptAsIssued: stamped } : undefined,
    });
    return updated!;
  }

  /** Contact details, tax settings, and bank and MSME details together, as the vendor form sends them. */
  async edit(
    id: string,
    orgId: string,
    actorId: string,
    input: PartyChangesInput & UpdateVendorTaxInput & UpdateVendorBankingInput,
  ): Promise<VendorDocument> {
    const { pan, tdsSection, tdsRateBps, bankAccount, msme, ...details } = input;
    let vendor = await this.update(id, orgId, actorId, details);
    if (pan !== undefined || tdsSection !== undefined || tdsRateBps !== undefined) {
      vendor = await this.updateTax(id, orgId, actorId, { pan, tdsSection, tdsRateBps });
    }
    if (bankAccount !== undefined || msme !== undefined) {
      vendor = await this.updateBanking(id, orgId, actorId, { bankAccount, msme });
    }
    return vendor;
  }

  /**
   * Where the vendor is paid, and their MSME registration. A change of bank
   * account is the commonest step in invoice fraud, so each is audited with
   * the account it replaced.
   */
  async updateBanking(id: string, orgId: string, actorId: string, input: UpdateVendorBankingInput): Promise<VendorDocument> {
    const vendor = await this.findById(id, orgId);
    const set: Record<string, unknown> = {};
    if (input.bankAccount !== undefined) set.bankAccount = input.bankAccount === null ? null : cleanBankAccount(input.bankAccount);
    if (input.msme !== undefined) set.msme = input.msme === null ? null : cleanMsme(input.msme);
    const changed = Object.keys(set).filter((k) => JSON.stringify(set[k]) !== JSON.stringify((vendor as unknown as Record<string, unknown>)[k] ?? null));
    if (changed.length === 0) return vendor;
    const updated = await withOrg(orgId, () => this.vendorModel.findOneAndUpdate({ _id: vendor._id }, { $set: set }, { new: true }).exec());
    await this.auditService.record({
      orgId,
      entityType: 'Vendor',
      entityId: id,
      action: changed.includes('bankAccount') ? 'UPDATE_BANK_ACCOUNT' : 'UPDATE_MSME',
      performedBy: actorId,
      before: Object.fromEntries(changed.map((k) => [k, (vendor as unknown as Record<string, unknown>)[k] ?? null])),
      after: Object.fromEntries(changed.map((k) => [k, set[k]])),
    });
    return updated!;
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
