import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BillStatus, InvoiceStatus } from '@ai-accounting/shared';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { ProposedEntryDocument } from './schemas/proposed-entry.schema';
import { withOrg } from '../database/tenant.plugin';

export interface SyncResult {
  vendorId?: string;
  billId?: string;
  customerId?: string;
  invoiceId?: string;
  created: boolean;
}

/** Trims and collapses whitespace so "  Swiggy   Business " matches "Swiggy Business". */
function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Keeps the purchase and sales sub-ledgers in step with the general ledger.
 *
 * When a reviewer approves a proposal, PostingService writes the journal — but the
 * Purchase, Sales, GST and ageing screens all read from purchase_bills /
 * sales_invoices. This service creates those records against the journal that was
 * just posted, so one approval populates every screen.
 *
 * It never posts a journal of its own: the sub-ledger record is created already
 * carrying the journalId from the approval, which is why status is POSTED here
 * without a second trip through PostingService (that would double-count the ledger).
 */
@Injectable()
export class SubledgerSyncService {
  private readonly logger = new Logger(SubledgerSyncService.name);

  constructor(
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
  ) {}

  async syncApprovedProposal(
    proposal: ProposedEntryDocument,
    journalId: Types.ObjectId,
    actorId: string,
  ): Promise<SyncResult> {
    const orgId = proposal.orgId;

    try {
      if (
        proposal.documentType === 'purchase_invoice' ||
        proposal.documentType === 'bill'
      ) {
        return await this.syncPurchase(proposal, journalId, actorId, orgId);
      }

      if (proposal.documentType === 'sales_invoice') {
        return await this.syncSales(proposal, journalId, actorId, orgId);
      }
    } catch (err) {
      // The ledger entry is already committed and is the source of truth. A
      // sub-ledger hiccup must not roll back or mask a successful posting.
      this.logger.error(
        `Sub-ledger sync failed for proposal ${proposal._id}: ${String(err)}`,
      );
    }

    return { created: false };
  }

  private async syncPurchase(
    proposal: ProposedEntryDocument,
    journalId: Types.ObjectId,
    actorId: string,
    orgId: string,
  ): Promise<SyncResult> {
    const vendor = await this.upsertVendor(orgId, proposal.vendorName, proposal.vendorGstin);
    const billDate = proposal.invoiceDate ?? new Date().toISOString().slice(0, 10);

    // Re-approving the same document must not create a second bill.
    const existing = await withOrg(orgId, () =>
      this.billModel.findOne({ journalId }).exec(),
    );
    if (existing) {
      return {
        vendorId: vendor._id.toString(),
        billId: existing._id.toString(),
        created: false,
      };
    }

    const bill = await this.billModel.create({
      orgId,
      vendorId: vendor._id,
      billNumber: proposal.invoiceNumber,
      billDate,
      dueDate: null,
      status: BillStatus.POSTED,
      amountsPaise: {
        taxableValue: proposal.amountsPaise.taxableValue,
        cgst: proposal.amountsPaise.cgst,
        sgst: proposal.amountsPaise.sgst,
        igst: proposal.amountsPaise.igst,
        cess: proposal.amountsPaise.cess,
        total: proposal.amountsPaise.total,
      },
      lineItems: [],
      financialYear: proposal.financialYear,
      journalId,
      // Marks this row as read off an upload rather than typed in, and links
      // back to the file so Purchase and Sales can show the original.
      sourceDocumentId: proposal.documentId ?? null,
      postedBy: actorId,
      notes: `Auto-created from approved document ${proposal.documentId ?? proposal._id}`,
    });

    this.logger.log(
      `Proposal ${proposal._id} → purchase bill ${bill._id} for vendor "${vendor.name}"`,
    );

    return { vendorId: vendor._id.toString(), billId: bill._id.toString(), created: true };
  }

  private async syncSales(
    proposal: ProposedEntryDocument,
    journalId: Types.ObjectId,
    actorId: string,
    orgId: string,
  ): Promise<SyncResult> {
    const customer = await this.upsertCustomer(orgId, proposal.vendorName, proposal.vendorGstin);
    const invoiceDate = proposal.invoiceDate ?? new Date().toISOString().slice(0, 10);

    const existing = await withOrg(orgId, () =>
      this.invoiceModel.findOne({ journalId }).exec(),
    );
    if (existing) {
      return {
        customerId: customer._id.toString(),
        invoiceId: existing._id.toString(),
        created: false,
      };
    }

    const invoice = await this.invoiceModel.create({
      orgId,
      customerId: customer._id,
      invoiceNumber: proposal.invoiceNumber,
      invoiceDate,
      dueDate: null,
      status: InvoiceStatus.POSTED,
      amountsPaise: {
        taxableValue: proposal.amountsPaise.taxableValue,
        cgst: proposal.amountsPaise.cgst,
        sgst: proposal.amountsPaise.sgst,
        igst: proposal.amountsPaise.igst,
        cess: proposal.amountsPaise.cess,
        total: proposal.amountsPaise.total,
      },
      lineItems: [],
      financialYear: proposal.financialYear,
      journalId,
      // Marks this row as read off an upload rather than typed in, and links
      // back to the file so Purchase and Sales can show the original.
      sourceDocumentId: proposal.documentId ?? null,
      postedBy: actorId,
      notes: `Auto-created from approved document ${proposal.documentId ?? proposal._id}`,
    });

    this.logger.log(
      `Proposal ${proposal._id} → sales invoice ${invoice._id} for customer "${customer.name}"`,
    );

    return {
      customerId: customer._id.toString(),
      invoiceId: invoice._id.toString(),
      created: true,
    };
  }

  /** Match on GSTIN first (exact identity), then on name, else create. */
  private async upsertVendor(
    orgId: string,
    name: string | null,
    gstin: string | null,
  ): Promise<VendorDocument> {
    const resolved = cleanName(name || '') || 'Unknown Vendor';

    if (gstin) {
      const byGstin = await withOrg(orgId, () =>
        this.vendorModel.findOne({ gstin: gstin.toUpperCase() }).exec(),
      );
      if (byGstin) return byGstin;
    }

    const byName = await withOrg(orgId, () =>
      this.vendorModel
        .findOne({ name: new RegExp(`^${escapeRegex(resolved)}$`, 'i') })
        .exec(),
    );
    if (byName) {
      // Backfill a GSTIN we only learned about on a later bill.
      if (gstin && !byName.gstin) {
        byName.gstin = gstin.toUpperCase();
        await byName.save();
      }
      return byName;
    }

    return this.vendorModel.create({
      orgId,
      name: resolved,
      gstin: gstin ? gstin.toUpperCase() : null,
    });
  }

  private async upsertCustomer(
    orgId: string,
    name: string | null,
    gstin: string | null,
  ): Promise<CustomerDocument> {
    const resolved = cleanName(name || '') || 'Unknown Customer';

    if (gstin) {
      const byGstin = await withOrg(orgId, () =>
        this.customerModel.findOne({ gstin: gstin.toUpperCase() }).exec(),
      );
      if (byGstin) return byGstin;
    }

    const byName = await withOrg(orgId, () =>
      this.customerModel
        .findOne({ name: new RegExp(`^${escapeRegex(resolved)}$`, 'i') })
        .exec(),
    );
    if (byName) {
      if (gstin && !byName.gstin) {
        byName.gstin = gstin.toUpperCase();
        await byName.save();
      }
      return byName;
    }

    return this.customerModel.create({
      orgId,
      name: resolved,
      gstin: gstin ? gstin.toUpperCase() : null,
    });
  }
}
