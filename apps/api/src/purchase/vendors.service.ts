import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BillStatus } from '@ai-accounting/shared';
import { Vendor, VendorDocument } from './schemas/vendor.schema';
import { PurchaseBill, PurchaseBillDocument } from './schemas/purchase-bill.schema';
import { withOrg } from '../database/tenant.plugin';
import { buildAgeingSummary, AgeingSummary } from './ageing.util';

export interface CreateVendorInput {
  orgId: string;
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
  ) {}

  async create(input: CreateVendorInput): Promise<VendorDocument> {
    return this.vendorModel.create({
      orgId: input.orgId,
      name: input.name,
      gstin: input.gstin ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      openingBalancePaise: input.openingBalancePaise ?? 0,
      notes: input.notes ?? null,
    });
  }

  async list(orgId: string): Promise<VendorDocument[]> {
    return withOrg(orgId, () => this.vendorModel.find().sort({ name: 1 }).exec());
  }

  async findById(id: string, orgId: string): Promise<VendorDocument> {
    const vendor = await withOrg(orgId, () => this.vendorModel.findById(id).exec());
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  /** Sum of all posted-but-unpaid bill amounts for this vendor. */
  async outstanding(vendorId: string, orgId: string): Promise<number> {
    const bills = await withOrg(orgId, () =>
      this.billModel
        .find({ vendorId: new Types.ObjectId(vendorId), status: { $in: [BillStatus.POSTED] } })
        .exec(),
    );
    return bills.reduce((sum, b) => sum + b.amountsPaise.total, 0);
  }

  /** AP ageing: bucket posted-but-unpaid bills by days past due date. */
  async apAgeing(orgId: string): Promise<AgeingSummary> {
    const bills = await withOrg(orgId, () =>
      this.billModel.find({ status: BillStatus.POSTED }).exec(),
    );
    return buildAgeingSummary(bills.map((b) => ({ amountsPaise: b.amountsPaise, dueDate: b.dueDate })));
  }
}
