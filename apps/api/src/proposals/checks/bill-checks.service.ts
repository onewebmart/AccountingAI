import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProposedEntryStatus } from '@ai-accounting/shared';
import { PurchaseBill, PurchaseBillDocument } from '../../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorDocument } from '../../purchase/schemas/vendor.schema';
import { ProposedEntry, ProposedEntryDocument } from '../schemas/proposed-entry.schema';
import { BillCheck, blockedItc, normaliseBillNumber, normaliseName } from './bill-checks';

/** A first bill from a vendor not on file, at or above this, is worth a second look. */
export const NEW_VENDOR_LARGE_PAISE = 5_000_000; // ₹50,000
/** The same amount from the same vendor within this many days may be the same bill. */
const SAME_AMOUNT_DAYS = 7;

export interface BillToCheck {
  orgId: string;
  vendorName: string | null;
  vendorGstin: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalPaise: number;
  gstPaise: number;
  lines: Array<{ description?: string | null; hsnSac?: string | null }>;
  /** The proposal being checked, so it never matches itself. */
  excludeProposalId?: Types.ObjectId | null;
}

const days = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Looks a scanned bill up against the books: bills already posted and
 * proposals still waiting, under the same vendor. A scanned bill and a
 * photo of the same bill are different files, so the upload's duplicate
 * check (by file) cannot see this.
 */
@Injectable()
export class BillChecksService {
  constructor(
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(ProposedEntry.name) private proposalModel: Model<ProposedEntryDocument>,
  ) {}

  async check(bill: BillToCheck): Promise<BillCheck[]> {
    const { orgId } = bill;
    const checks: BillCheck[] = [];
    const gstin = bill.vendorGstin?.trim().toUpperCase() || null;
    const name = normaliseName(bill.vendorName);

    // The vendor on file: by GSTIN first, then by name.
    const vendors = await this.vendorModel.find({ orgId }, { name: 1, gstin: 1 }).lean().exec();
    const byGstin = gstin ? vendors.filter((v) => v.gstin?.toUpperCase() === gstin) : [];
    const byName = name ? vendors.filter((v) => normaliseName(v.name) === name) : [];
    const known = byGstin.length ? byGstin : byName;

    if (gstin && byGstin.length === 0 && byName.some((v) => v.gstin)) {
      const onFile = byName.find((v) => v.gstin)!;
      checks.push({
        code: 'gstin_differs',
        severity: 'medium',
        message: `The GSTIN on this bill (${gstin}) is not the one on file for ${onFile.name} (${onFile.gstin}). Check the bill is really from them before paying it.`,
      });
    }
    if (known.length === 0 && bill.totalPaise >= NEW_VENDOR_LARGE_PAISE) {
      checks.push({
        code: 'new_vendor_large',
        severity: 'medium',
        message: `First bill from ${bill.vendorName ?? 'a vendor not on file'}, for ${rupees(bill.totalPaise)}. Confirm the vendor and their bank details another way before paying.`,
      });
    }

    // Same vendor and bill number: in the books, or waiting in review.
    const number = normaliseBillNumber(bill.invoiceNumber);
    const vendorIds = known.map((v) => v._id);
    const [bills, proposals] = await Promise.all([
      vendorIds.length
        ? this.billModel
            .find({ orgId, vendorId: { $in: vendorIds } }, { billNumber: 1, billDate: 1, status: 1, amountsPaise: 1 })
            .lean()
            .exec()
        : Promise.resolve([]),
      this.proposalModel
        .find(
          {
            orgId,
            status: { $in: [ProposedEntryStatus.PROPOSED, ProposedEntryStatus.APPROVED] },
            ...(bill.excludeProposalId ? { _id: { $ne: bill.excludeProposalId } } : {}),
            ...(gstin ? { vendorGstin: gstin } : { vendorName: { $ne: null } }),
          },
          { vendorName: 1, invoiceNumber: 1, invoiceDate: 1, status: 1, amountsPaise: 1 },
        )
        .lean()
        .exec(),
    ]);
    const sameVendorProposals = gstin ? proposals : proposals.filter((p) => normaliseName(p.vendorName) === name && name);
    // An approved proposal already made its bill; count the bill, not both.
    const waiting = sameVendorProposals.filter((p) => p.status === ProposedEntryStatus.PROPOSED);

    if (number) {
      const bookBill = bills.find((b) => normaliseBillNumber(b.billNumber) === number);
      const queued = waiting.find((p) => normaliseBillNumber(p.invoiceNumber) === number);
      if (bookBill) {
        checks.push({
          code: 'duplicate_number',
          severity: 'high',
          message: `Bill ${bookBill.billNumber} from this vendor is already in the books (${bookBill.billDate}, ${rupees(bookBill.amountsPaise.total)}, ${bookBill.status}). Approving this would book it twice.`,
        });
      } else if (queued) {
        checks.push({
          code: 'duplicate_number',
          severity: 'high',
          message: `Bill ${queued.invoiceNumber} from this vendor is already waiting in the review queue. Reject one of the two.`,
        });
      }
    }

    // Same amount within a week, under another number or none.
    if (!checks.some((c) => c.code === 'duplicate_number') && bill.invoiceDate && bill.totalPaise > 0) {
      const near = [
        ...bills.map((b) => ({ number: b.billNumber, date: b.billDate, total: b.amountsPaise.total, where: 'in the books' })),
        ...waiting.map((p) => ({ number: p.invoiceNumber, date: p.invoiceDate, total: p.amountsPaise.total, where: 'in the review queue' })),
      ].find((d) => d.total === bill.totalPaise && d.date && days(d.date, bill.invoiceDate!) <= SAME_AMOUNT_DAYS);
      if (near) {
        checks.push({
          code: 'duplicate_amount',
          severity: 'medium',
          message: `A bill for the same amount (${rupees(near.total)}) from this vendor is already ${near.where}: ${near.number ?? 'no number'}, ${near.date}. Check this isn't the same bill again.`,
        });
      }
    }

    checks.push(...blockedItc({ vendorName: bill.vendorName, lines: bill.lines, gstPaise: bill.gstPaise }));
    return checks;
  }
}
