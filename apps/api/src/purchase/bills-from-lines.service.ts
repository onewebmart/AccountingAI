import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ItemsService } from '../items/items.service';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import { DocLineInput, docAmounts, isInterState, lineAmount, lineProblem } from '../orders/doc-lines';
import { PurchaseBillsService } from './purchase-bills.service';
import { PurchaseBillDocument } from './schemas/purchase-bill.schema';
import { Vendor, VendorDocument } from './schemas/vendor.schema';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface BillLineInput extends DocLineInput {
  projectId?: string | null;
}

export interface BillFromLinesInput {
  vendorId: string;
  billNumber?: string | null;
  billDate: string;
  dueDate?: string | null;
  lines: BillLineInput[];
  notes?: string | null;
  /** GST on this purchase is ours to pay (reverse charge). */
  isReverseCharge?: boolean;
  /** Overrides the vendor's TDS section; 'none' deducts nothing. */
  tdsSection?: string;
  tdsRateBps?: number;
}

/**
 * A bill typed line by line. The server prices it: each line's amount from
 * its quantity and rate, the tax from its slab, CGST and SGST or IGST from
 * where the vendor is registered against where we are. The browser's own
 * arithmetic is only a preview. The bill is a draft, posted as any bill is.
 */
@Injectable()
export class BillsFromLinesService {
  constructor(
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(OrgSettings.name) private settingsModel: Model<OrgSettingsDocument>,
    private items: ItemsService,
    private bills: PurchaseBillsService,
  ) {}

  async create(orgId: string, actorId: string, input: BillFromLinesInput): Promise<PurchaseBillDocument> {
    if (!DATE.test(input.billDate ?? '')) throw new BadRequestException('billDate must be a date like 2026-11-04');
    if (input.dueDate && (!DATE.test(input.dueDate) || input.dueDate < input.billDate)) {
      throw new BadRequestException('The due date is a date on or after the bill date.');
    }
    const vendor = Types.ObjectId.isValid(input.vendorId) ? await this.vendorModel.findOne({ _id: input.vendorId, orgId }).lean().exec() : null;
    if (!vendor) throw new NotFoundException('Vendor not found');
    const typed = (input.lines ?? []).filter((l) => l.description?.trim());
    if (typed.length === 0) throw new BadRequestException('Add at least one line.');
    typed.forEach((l, i) => {
      const problem = lineProblem(l, i);
      if (problem) throw new BadRequestException(problem);
    });

    // An item fills the line's HSN/SAC, unit and expense account; the project is checked to be this org's.
    const resolved = await this.items.resolveLines(
      orgId,
      typed.map((l) => ({
        description: l.description.trim(),
        itemId: l.itemId ?? null,
        hsnSac: l.hsnSac?.trim() || null,
        uqc: l.uqc ?? null,
        qty: l.qty,
        ratePaise: l.ratePaise,
        amountPaise: lineAmount(l),
        taxRatePct: l.taxRatePct,
        projectId: l.projectId ?? null,
      })),
      'purchase',
    );
    const lineItems = resolved.map((l) => ({ ...l, qty: l.qty ?? 1, taxRatePct: l.taxRatePct ?? 0 }));

    const settings = await this.settingsModel.findOne({ orgId }).lean().exec();
    const ours = settings?.gstin?.slice(0, 2) ?? settings?.stateCode ?? null;
    const amountsPaise = docAmounts(lineItems, isInterState(ours, vendor.gstin?.slice(0, 2) ?? null));
    if (amountsPaise.total <= 0) throw new BadRequestException('A bill needs an amount.');

    return this.bills.create({
      orgId,
      actorId,
      vendorId: input.vendorId,
      billNumber: input.billNumber?.trim() || null,
      billDate: input.billDate,
      dueDate: input.dueDate || null,
      amountsPaise,
      lineItems,
      notes: input.notes?.trim() || null,
      isReverseCharge: input.isReverseCharge ?? false,
      tdsSection: input.tdsSection,
      tdsRateBps: input.tdsRateBps,
    });
  }
}
