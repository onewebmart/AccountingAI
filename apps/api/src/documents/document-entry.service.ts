import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Document, DocumentDocument } from './schemas/document.schema';
import { ExtractedDocument, ExtractedDocumentDocument } from '../extraction/schemas/extracted-document.schema';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { withOrg } from '../database/tenant.plugin';
import { ProposedEntry, ProposedEntryDocument } from '../proposals/schemas/proposed-entry.schema';
import { ProposedEntryStatus } from '@ai-accounting/shared';

/** What a form needs to start from a scanned document: what the AI read, and who it is from, if we know them. */
export interface DocumentExtraction {
  documentId: string;
  fileName: string;
  mimeType: string;
  /** Read by the AI: the form can only be filled from it once it has been. */
  read: boolean;
  /** Why it could not be read, when the AI tried and failed. */
  readProblem: string | null;
  documentType: string | null;
  party: { name: string | null; gstin: string | null };
  /** The vendor and the customer whose GSTIN, or failing that whose name, matches. */
  vendor: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
  number: string | null;
  date: string | null;
  dueDate: string | null;
  currency: string;
  isReverseCharge: boolean;
  amountsPaise: { taxableValue: number; cgst: number; sgst: number; igst: number; cess: number; total: number } | null;
  lines: Array<{ description: string; hsnSac: string | null; qty: number; ratePaise: number; taxRatePct: number; amountPaise: number }>;
  confidence: number | null;
  /** Already entered by hand as this record. */
  enteredAs: { entityType: string; entityId: string; label: string } | null;
  /**
   * What the AI's proposal for this document worked out, for the form to
   * start from: the cost account it chose, whether the GST is blocked
   * (17(5)) so not claimed, and whether the bill says it was paid at the
   * counter, and how. Null when no proposal is waiting.
   */
  suggested: {
    accountId: string | null;
    accountName: string | null;
    reason: string | null;
    gstBlocked: boolean;
    paid: { mode: string; evidence: string } | null;
  } | null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Reads a scanned document for "Add to": the form for a bill, an expense or
 * an invoice opens filled from it, beside the file, for a person to check
 * and save. Nothing here writes; the form saves a draft as it always does.
 */
@Injectable()
export class DocumentEntryService {
  constructor(
    @InjectModel(Document.name) private documentModel: Model<DocumentDocument>,
    @InjectModel(ExtractedDocument.name) private extractedModel: Model<ExtractedDocumentDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(ProposedEntry.name) private proposalModel: Model<ProposedEntryDocument>,
  ) {}

  async extraction(orgId: string, documentId: string): Promise<DocumentExtraction> {
    if (!Types.ObjectId.isValid(documentId)) throw new NotFoundException('Document not found');
    const doc = await withOrg(orgId, () => this.documentModel.findOne({ _id: documentId }).lean().exec());
    if (!doc) throw new NotFoundException('Document not found');
    const x = await withOrg(orgId, () => this.extractedModel.findOne({ documentId: doc._id }).sort({ createdAt: -1 }).lean().exec());

    const name = x?.vendor?.name?.trim() || null;
    const gstin = x?.vendor?.gstin?.trim().toUpperCase() || null;
    const [vendor, customer] = await Promise.all([this.match(orgId, this.vendorModel, gstin, name), this.match(orgId, this.customerModel, gstin, name)]);

    return {
      documentId: String(doc._id),
      fileName: doc.originalName,
      mimeType: doc.mimeType,
      read: x?.status === 'extracted',
      readProblem: doc.failureReason ?? (x && x.status !== 'extracted' ? (x.rawWarnings?.[0] ?? 'The AI could not read this document.') : null),
      documentType: x?.documentType ?? doc.type ?? null,
      party: { name, gstin },
      vendor,
      customer,
      number: x?.invoiceNumber?.value?.trim() || null,
      date: x?.invoiceDate?.value ?? null,
      dueDate: x?.dueDate?.value ?? null,
      currency: x?.currency ?? 'INR',
      isReverseCharge: x?.isReverseCharge ?? false,
      amountsPaise: x?.amountsPaise
        ? { taxableValue: x.amountsPaise.taxableValue, cgst: x.amountsPaise.cgst, sgst: x.amountsPaise.sgst, igst: x.amountsPaise.igst, cess: x.amountsPaise.cess, total: x.amountsPaise.total }
        : null,
      lines: (x?.lineItems ?? []).map((l) => ({ description: l.description, hsnSac: l.hsnSac ?? null, qty: l.qty, ratePaise: l.ratePaise, taxRatePct: l.taxRatePct, amountPaise: l.amountPaise })),
      confidence: x?.confidenceOverall ?? null,
      enteredAs: doc.enteredAs ? { entityType: doc.enteredAs.entityType, entityId: doc.enteredAs.entityId, label: doc.enteredAs.label } : null,
      suggested: await this.suggested(orgId, doc._id, x?.paidAtCounter ?? null, x?.amountsPaise ?? null),
    };
  }

  /** The waiting proposal's choices, in the shape a form can start from. */
  private async suggested(
    orgId: string,
    documentId: Types.ObjectId,
    paid: { mode: string; evidence: string } | null,
    a: { cgst: number; sgst: number; igst: number; cess: number } | null,
  ): Promise<DocumentExtraction['suggested']> {
    const p = await withOrg(orgId, () =>
      this.proposalModel.findOne({ documentId, status: ProposedEntryStatus.PROPOSED }).sort({ createdAt: -1 }).lean().exec(),
    );
    if (!p && !paid) return null;
    const lines = p?.suggestedLines ?? [];
    const isGst = (name: string) => /^input (cgst|sgst|igst|cess)/i.test(name);
    const cost = p?.category?.accountName ? lines.find((l) => l.accountName === p.category!.accountName && l.debitPaise > 0) : null;
    const gst = a ? a.cgst + a.sgst + a.igst + a.cess : 0;
    return {
      accountId: cost ? String(cost.accountId) : null,
      accountName: cost?.accountName ?? null,
      reason: p?.category?.reason ?? null,
      // GST on the bill, none of it on input lines, and a blocked-credit check: the proposal moved it into the cost.
      gstBlocked: gst > 0 && !lines.some((l) => isGst(l.accountName)) && !!p?.checks?.some((c) => c.code === 'blocked_itc'),
      paid,
    };
  }

  /** The party with this GSTIN, or with exactly this name; none when neither matches. */
  private async match(orgId: string, model: Model<VendorDocument> | Model<CustomerDocument>, gstin: string | null, name: string | null): Promise<{ id: string; name: string } | null> {
    const m = model as unknown as Model<{ _id: Types.ObjectId; name: string; gstin?: string | null }>;
    const byGstin = gstin ? await m.findOne({ orgId, gstin }).select('name').lean().exec() : null;
    const found = byGstin ?? (name ? await m.findOne({ orgId, name: new RegExp(`^${escape(name)}$`, 'i') }).select('name').lean().exec() : null);
    return found ? { id: String(found._id), name: found.name } : null;
  }
}
