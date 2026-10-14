import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AuditService } from '../gl/audit.service';
import { gstinProblem } from '../extraction/invoice-checks';
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
  openingBalancePaise?: number;
  notes?: string | null;
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
      openingBalancePaise: input.openingBalancePaise ?? 0,
      notes: input.notes ?? null,
    });
    await this.auditService.record({
      orgId: input.orgId,
      entityType: 'Vendor',
      entityId: vendor._id.toString(),
      action: 'CREATE',
      performedBy: input.actorId ?? 'unknown',
      after: { name: vendor.name, gstin: vendor.gstin },
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
