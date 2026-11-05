import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Document, DocumentDocument } from './schemas/document.schema';
import { ExtractedDocument, ExtractedDocumentDocument } from '../extraction/schemas/extracted-document.schema';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { withOrg } from '../database/tenant.plugin';

/** What a form needs to start from a scanned document: what the AI read, and who it is from, if we know them. */
export interface DocumentExtraction {
  documentId: string;
  fileName: string;
  mimeType: string;
  /** Not yet read, or read: the form can only be filled once it has been. */
  read: boolean;
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
      read: !!x,
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
