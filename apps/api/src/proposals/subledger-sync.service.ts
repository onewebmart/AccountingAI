import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
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
 *
 * It runs inside the approval's transaction. It used to run after the journal
 * committed and swallow its own errors, so a failure left a posted journal with
 * no bill or invoice behind it — invisible to ageing, GST and bank matching.
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
    session?: ClientSession,
    tds: { section: string; rateBps: number; amountPaise: number } | null = null,
  ): Promise<SyncResult> {
    const orgId = proposal.orgId;

    if (proposal.documentType === 'purchase_invoice' || proposal.documentType === 'bill') {
      return this.syncPurchase(proposal, journalId, actorId, orgId, session, tds);
    }
    if (proposal.documentType === 'sales_invoice') {
      return this.syncSales(proposal, journalId, actorId, orgId, session);
    }
    return { created: false };
  }

  private async syncPurchase(
    proposal: ProposedEntryDocument,
    journalId: Types.ObjectId,
    actorId: string,
    orgId: string,
    session?: ClientSession,
    tds: { section: string; rateBps: number; amountPaise: number } | null = null,
  ): Promise<SyncResult> {
    const vendor = await this.upsertVendor(orgId, proposal.vendorName, proposal.vendorGstin, session);
    const billDate = proposal.invoiceDate ?? new Date().toISOString().slice(0, 10);

    // Re-approving the same document must not create a second bill.
    const existing = await withOrg(orgId, () =>
      this.billModel.findOne({ journalId }).session(session ?? null).exec(),
    );
    if (existing) {
      return {
        vendorId: vendor._id.toString(),
        billId: existing._id.toString(),
        created: false,
      };
    }

    const [bill] = await this.billModel.create([{
      orgId,
      vendorId: vendor._id,
      billNumber: proposal.invoiceNumber,
      billDate,
      dueDate: proposal.dueDate ?? null,
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
      isReverseCharge: proposal.isReverseCharge ?? false,
      tds: tds ? { ...tds, depositId: null } : null,
      financialYear: proposal.financialYear,
      journalId,
      // Marks this row as read off an upload rather than typed in, and links
      // back to the file so Purchase and Sales can show the original.
      sourceDocumentId: proposal.documentId ?? null,
      postedBy: actorId,
      notes: `Auto-created from approved document ${proposal.documentId ?? proposal._id}`,
    }], { session });

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
    session?: ClientSession,
  ): Promise<SyncResult> {
    const customer = await this.upsertCustomer(orgId, proposal.vendorName, proposal.vendorGstin, session);
    const invoiceDate = proposal.invoiceDate ?? new Date().toISOString().slice(0, 10);

    const existing = await withOrg(orgId, () =>
      this.invoiceModel.findOne({ journalId }).session(session ?? null).exec(),
    );
    if (existing) {
      return {
        customerId: customer._id.toString(),
        invoiceId: existing._id.toString(),
        created: false,
      };
    }

    const [invoice] = await this.invoiceModel.create([{
      orgId,
      customerId: customer._id,
      invoiceNumber: proposal.invoiceNumber,
      invoiceDate,
      dueDate: proposal.dueDate ?? null,
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
    }], { session });

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
    session?: ClientSession,
  ): Promise<VendorDocument> {
    const resolved = cleanName(name || '') || 'Unknown Vendor';

    if (gstin) {
      const byGstin = await withOrg(orgId, () =>
        this.vendorModel.findOne({ gstin: gstin.toUpperCase() }).session(session ?? null).exec(),
      );
      if (byGstin) return byGstin;
    }

    const byName = await withOrg(orgId, () =>
      this.vendorModel
        .findOne({ name: new RegExp(`^${escapeRegex(resolved)}$`, 'i') })
        .session(session ?? null)
        .exec(),
    );
    if (byName) {
      // Backfill a GSTIN we only learned about on a later bill.
      if (gstin && !byName.gstin) {
        byName.gstin = gstin.toUpperCase();
        await byName.save({ session });
      }
      return byName;
    }

    const [created] = await this.vendorModel.create(
      [{ orgId, name: resolved, gstin: gstin ? gstin.toUpperCase() : null }],
      { session },
    );
    return created;
  }

  private async upsertCustomer(
    orgId: string,
    name: string | null,
    gstin: string | null,
    session?: ClientSession,
  ): Promise<CustomerDocument> {
    const resolved = cleanName(name || '') || 'Unknown Customer';

    if (gstin) {
      const byGstin = await withOrg(orgId, () =>
        this.customerModel.findOne({ gstin: gstin.toUpperCase() }).session(session ?? null).exec(),
      );
      if (byGstin) return byGstin;
    }

    const byName = await withOrg(orgId, () =>
      this.customerModel
        .findOne({ name: new RegExp(`^${escapeRegex(resolved)}$`, 'i') })
        .session(session ?? null)
        .exec(),
    );
    if (byName) {
      if (gstin && !byName.gstin) {
        byName.gstin = gstin.toUpperCase();
        await byName.save({ session });
      }
      return byName;
    }

    const [created] = await this.customerModel.create(
      [{ orgId, name: resolved, gstin: gstin ? gstin.toUpperCase() : null }],
      { session },
    );
    return created;
  }
}
