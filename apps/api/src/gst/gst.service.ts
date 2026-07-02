import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BillStatus,
  InvoiceStatus,
  GstReconStatus,
  GstMismatchType,
  ProposedEntryStatus,
} from '@ai-accounting/shared';
import { Gstr2bLine, Gstr2bLineDocument } from './schemas/gstr2b-line.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerDocument } from '../sales/schemas/customer.schema';
import { ProposedEntry, ProposedEntryDocument } from '../proposals/schemas/proposed-entry.schema';

// ── GST state-code helpers ────────────────────────────────────────────────────

/** Extract the 2-digit state code from a 15-character GSTIN. */
function gstinStateCode(gstin: string | null): string | null {
  if (!gstin || gstin.length < 2) return null;
  return gstin.slice(0, 2);
}

/** Determine if a transaction is inter-state: supplier state ≠ buyer state. */
function isInterState(supplierGstin: string | null, buyerStateCode: string): boolean {
  const supplierState = gstinStateCode(supplierGstin);
  if (!supplierState) return false;
  return supplierState !== buyerStateCode;
}

/**
 * Normalise the GST split deterministically based on place-of-supply rules.
 * - Inter-state: all GST flows as IGST (CGST + SGST zeroed out).
 * - Intra-state: IGST split evenly into CGST + SGST.
 * This overrides whatever the AI extractor guessed.
 */
function normalizeGstSplit(
  cgst: number,
  sgst: number,
  igst: number,
  cess: number,
  interState: boolean,
): { cgstPaise: number; sgstPaise: number; igstPaise: number; cessPaise: number } {
  const totalGst = cgst + sgst + igst;
  if (interState) {
    return { cgstPaise: 0, sgstPaise: 0, igstPaise: totalGst, cessPaise: cess };
  }
  const half = Math.floor(totalGst / 2);
  return { cgstPaise: half, sgstPaise: totalGst - half, igstPaise: 0, cessPaise: cess };
}

/** Derive period (YYYY-MM) from a YYYY-MM-DD date string. */
function dateToPeriod(date: string): string {
  return date.slice(0, 7);
}

/** Compute financial year from a YYYY-MM-DD date string. */
function getFY(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return m >= 4
    ? `${y}-${String(y + 1).slice(-2)}`
    : `${y - 1}-${String(y).slice(-2)}`;
}

// ── DTOs (plain objects — no decorators needed in the service layer) ──────────

export interface PurchaseRegisterEntry {
  billId: string;
  vendorId: string;
  vendorName: string;
  supplierGstin: string | null;
  invoiceNumber: string | null;
  invoiceDate: string;
  period: string;
  financialYear: string;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  totalPaise: number;
  itcEligiblePaise: number;
  isInterState: boolean;
  isReverseCharge: boolean;
  hsnSac: string | null;
}

export interface SalesRegisterEntry {
  invoiceId: string;
  customerId: string;
  customerName: string;
  customerGstin: string | null;
  invoiceNumber: string | null;
  invoiceDate: string;
  period: string;
  financialYear: string;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  totalPaise: number;
  isInterState: boolean;
}

export interface ImportGstr2bLineDto {
  supplierGstin: string | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  documentType?: string;
  isReverseCharge?: boolean;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  cessPaise?: number;
}

export interface ReconBucket {
  matched: Array<{
    lineId: string;
    billId: string;
    supplierGstin: string | null;
    invoiceNumber: string | null;
    taxableValuePaise: number;
    itcPaise: number;
  }>;
  missingInBooks: Array<{
    lineId: string;
    supplierGstin: string | null;
    supplierName: string | null;
    invoiceNumber: string | null;
    taxableValuePaise: number;
    itcPaise: number;
  }>;
  missingIn2B: Array<{
    billId: string;
    vendorName: string;
    invoiceNumber: string | null;
    taxableValuePaise: number;
    itcPaise: number;
  }>;
  mismatched: Array<{
    lineId: string;
    billId: string | null;
    mismatchType: GstMismatchType;
    line2bTaxablePaise: number;
    billTaxablePaise: number;
    line2bItcPaise: number;
  }>;
  totalMissingCreditPaise: number;
}

export interface ItcSummary {
  period: string;
  totalInBooksPaise: number;
  confirmedIn2BPaise: number;
  missingCreditPaise: number;
  mismatchedPaise: number;
}

// ─────────────────────────────────────────────────────────────────────────────

/** Rounding tolerance for 2B vs book amount matching (₹5 = 500 paise). */
const RECON_TOLERANCE_PAISE = 500;

@Injectable()
export class GstService {
  constructor(
    @InjectModel(Gstr2bLine.name) private gstr2bModel: Model<Gstr2bLineDocument>,
    @InjectModel(PurchaseBill.name) private purchaseBillModel: Model<PurchaseBillDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(SalesInvoice.name) private salesInvoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(ProposedEntry.name) private proposedEntryModel: Model<ProposedEntryDocument>,
  ) {}

  // ── Purchase register ───────────────────────────────────────────────────────

  async getPurchaseRegister(
    orgId: string,
    period: string,
    buyerStateCode: string,
  ): Promise<PurchaseRegisterEntry[]> {
    const bills = await this.purchaseBillModel
      .find({ orgId, status: { $in: [BillStatus.POSTED, BillStatus.PAID] } })
      .lean()
      .exec();

    const vendorIds = [...new Set(bills.map((b) => b.vendorId.toString()))];
    const vendors = await this.vendorModel
      .find({ orgId, _id: { $in: vendorIds.map((id) => new Types.ObjectId(id)) } })
      .lean()
      .exec();
    const vendorMap = new Map(vendors.map((v) => [v._id.toString(), v]));

    const entries: PurchaseRegisterEntry[] = [];
    for (const bill of bills) {
      if (dateToPeriod(bill.billDate) !== period) continue;

      const vendor = vendorMap.get(bill.vendorId.toString());
      const interState = isInterState(vendor?.gstin ?? null, buyerStateCode);
      const split = normalizeGstSplit(
        bill.amountsPaise.cgst,
        bill.amountsPaise.sgst,
        bill.amountsPaise.igst,
        bill.amountsPaise.cess,
        interState,
      );
      const itcPaise = split.cgstPaise + split.sgstPaise + split.igstPaise;

      const hsnSac =
        bill.lineItems.length > 0
          ? (bill.lineItems.find((l) => l.hsnSac)?.hsnSac ?? null)
          : null;

      entries.push({
        billId: bill._id.toString(),
        vendorId: bill.vendorId.toString(),
        vendorName: vendor?.name ?? 'Unknown',
        supplierGstin: vendor?.gstin ?? null,
        invoiceNumber: bill.billNumber,
        invoiceDate: bill.billDate,
        period,
        financialYear: bill.financialYear ?? getFY(bill.billDate),
        taxableValuePaise: bill.amountsPaise.taxableValue,
        ...split,
        totalPaise: bill.amountsPaise.total,
        itcEligiblePaise: itcPaise,
        isInterState: interState,
        isReverseCharge: false,
        hsnSac,
      });
    }
    return entries;
  }

  // ── Sales register ──────────────────────────────────────────────────────────

  async getSalesRegister(
    orgId: string,
    period: string,
    buyerStateCode: string,
  ): Promise<SalesRegisterEntry[]> {
    const invoices = await this.salesInvoiceModel
      .find({ orgId, status: { $in: [InvoiceStatus.POSTED, InvoiceStatus.PAID] } })
      .lean()
      .exec();

    const customerIds = [...new Set(invoices.map((i) => i.customerId.toString()))];
    const customers = await this.customerModel
      .find({ orgId, _id: { $in: customerIds.map((id) => new Types.ObjectId(id)) } })
      .lean()
      .exec();
    const customerMap = new Map(customers.map((c) => [c._id.toString(), c]));

    const entries: SalesRegisterEntry[] = [];
    for (const inv of invoices) {
      if (dateToPeriod(inv.invoiceDate) !== period) continue;

      const customer = customerMap.get(inv.customerId.toString());
      const interState = isInterState(customer?.gstin ?? null, buyerStateCode);
      const split = normalizeGstSplit(
        inv.amountsPaise.cgst,
        inv.amountsPaise.sgst,
        inv.amountsPaise.igst,
        inv.amountsPaise.cess,
        interState,
      );

      entries.push({
        invoiceId: inv._id.toString(),
        customerId: inv.customerId.toString(),
        customerName: customer?.name ?? 'Unknown',
        customerGstin: customer?.gstin ?? null,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        period,
        financialYear: inv.financialYear ?? getFY(inv.invoiceDate),
        taxableValuePaise: inv.amountsPaise.taxableValue,
        ...split,
        totalPaise: inv.amountsPaise.total,
        isInterState: interState,
      });
    }
    return entries;
  }

  // ── GSTR-2B import ──────────────────────────────────────────────────────────

  async importGstr2b(
    orgId: string,
    period: string,
    lines: ImportGstr2bLineDto[],
  ): Promise<Gstr2bLineDocument[]> {
    const docs = lines.map((l) => {
      const itc = l.cgstPaise + l.sgstPaise + l.igstPaise;
      return {
        orgId,
        period,
        supplierGstin: l.supplierGstin,
        supplierName: l.supplierName,
        invoiceNumber: l.invoiceNumber,
        invoiceDate: l.invoiceDate,
        documentType: l.documentType ?? 'B2B',
        isReverseCharge: l.isReverseCharge ?? false,
        taxableValuePaise: l.taxableValuePaise,
        cgstPaise: l.cgstPaise,
        sgstPaise: l.sgstPaise,
        igstPaise: l.igstPaise,
        cessPaise: l.cessPaise ?? 0,
        itcEligiblePaise: itc,
        reconStatus: GstReconStatus.PENDING,
        mismatchType: null,
        matchedBillId: null,
      };
    });

    return this.gstr2bModel.insertMany(docs) as unknown as Gstr2bLineDocument[];
  }

  // ── 2B reconciliation ───────────────────────────────────────────────────────

  async reconcile2b(
    orgId: string,
    period: string,
    buyerStateCode: string,
  ): Promise<ReconBucket> {
    const registerEntries = await this.getPurchaseRegister(orgId, period, buyerStateCode);
    const lines2b = await this.gstr2bModel
      .find({ orgId, period })
      .lean()
      .exec();

    // Index register entries by supplierGstin+invoiceNumber for O(1) lookup
    const registerByKey = new Map<string, PurchaseRegisterEntry>();
    for (const entry of registerEntries) {
      if (entry.supplierGstin && entry.invoiceNumber) {
        const key = `${entry.supplierGstin}::${entry.invoiceNumber}`;
        registerByKey.set(key, entry);
      }
    }

    const matched: ReconBucket['matched'] = [];
    const missingInBooks: ReconBucket['missingInBooks'] = [];
    const mismatched: ReconBucket['mismatched'] = [];
    const matchedBillIds = new Set<string>();

    for (const line of lines2b) {
      const lineId = line._id.toString();

      if (!line.supplierGstin || !line.invoiceNumber) {
        // Can't match without both keys — treat as missing_in_books
        await this.gstr2bModel.updateOne(
          { _id: line._id },
          { reconStatus: GstReconStatus.MISSING_IN_BOOKS },
        );
        missingInBooks.push({
          lineId,
          supplierGstin: line.supplierGstin,
          supplierName: line.supplierName,
          invoiceNumber: line.invoiceNumber,
          taxableValuePaise: line.taxableValuePaise,
          itcPaise: line.itcEligiblePaise,
        });
        continue;
      }

      const key = `${line.supplierGstin}::${line.invoiceNumber}`;
      const entry = registerByKey.get(key);

      if (!entry) {
        await this.gstr2bModel.updateOne(
          { _id: line._id },
          { reconStatus: GstReconStatus.MISSING_IN_BOOKS },
        );
        missingInBooks.push({
          lineId,
          supplierGstin: line.supplierGstin,
          supplierName: line.supplierName,
          invoiceNumber: line.invoiceNumber,
          taxableValuePaise: line.taxableValuePaise,
          itcPaise: line.itcEligiblePaise,
        });
        continue;
      }

      const taxableDiff = Math.abs(entry.taxableValuePaise - line.taxableValuePaise);
      if (taxableDiff <= RECON_TOLERANCE_PAISE) {
        await this.gstr2bModel.updateOne(
          { _id: line._id },
          { reconStatus: GstReconStatus.MATCHED, matchedBillId: new Types.ObjectId(entry.billId) },
        );
        matchedBillIds.add(entry.billId);
        matched.push({
          lineId,
          billId: entry.billId,
          supplierGstin: line.supplierGstin,
          invoiceNumber: line.invoiceNumber,
          taxableValuePaise: line.taxableValuePaise,
          itcPaise: line.itcEligiblePaise,
        });
      } else {
        await this.gstr2bModel.updateOne(
          { _id: line._id },
          {
            reconStatus: GstReconStatus.MISMATCHED,
            mismatchType: GstMismatchType.AMOUNT_DIFFERS,
            matchedBillId: new Types.ObjectId(entry.billId),
          },
        );
        mismatched.push({
          lineId,
          billId: entry.billId,
          mismatchType: GstMismatchType.AMOUNT_DIFFERS,
          line2bTaxablePaise: line.taxableValuePaise,
          billTaxablePaise: entry.taxableValuePaise,
          line2bItcPaise: line.itcEligiblePaise,
        });
      }
    }

    // Register entries with no matching 2B line → MISSING_IN_2B
    const missingIn2B: ReconBucket['missingIn2B'] = registerEntries
      .filter((e) => !matchedBillIds.has(e.billId))
      .map((e) => ({
        billId: e.billId,
        vendorName: e.vendorName,
        invoiceNumber: e.invoiceNumber,
        taxableValuePaise: e.taxableValuePaise,
        itcPaise: e.itcEligiblePaise,
      }));

    const totalMissingCreditPaise = missingInBooks.reduce((s, l) => s + l.itcPaise, 0);

    return { matched, missingInBooks, missingIn2B, mismatched, totalMissingCreditPaise };
  }

  // ── 2B lines list ───────────────────────────────────────────────────────────

  async getReconLines(orgId: string, period: string): Promise<Gstr2bLineDocument[]> {
    return this.gstr2bModel.find({ orgId, period }).sort({ createdAt: -1 }).exec();
  }

  // ── ITC summary ─────────────────────────────────────────────────────────────

  async getItcSummary(
    orgId: string,
    period: string,
    buyerStateCode: string,
  ): Promise<ItcSummary> {
    const registerEntries = await this.getPurchaseRegister(orgId, period, buyerStateCode);
    const totalInBooksPaise = registerEntries.reduce((s, e) => s + e.itcEligiblePaise, 0);

    const lines2b = await this.gstr2bModel.find({ orgId, period }).lean().exec();
    const confirmedIn2BPaise = lines2b
      .filter((l) => l.reconStatus === GstReconStatus.MATCHED)
      .reduce((s, l) => s + l.itcEligiblePaise, 0);

    const missingCreditPaise = lines2b
      .filter((l) => l.reconStatus === GstReconStatus.MISSING_IN_BOOKS)
      .reduce((s, l) => s + l.itcEligiblePaise, 0);

    const mismatchedPaise = lines2b
      .filter((l) => l.reconStatus === GstReconStatus.MISMATCHED)
      .reduce((s, l) => s + l.itcEligiblePaise, 0);

    return { period, totalInBooksPaise, confirmedIn2BPaise, missingCreditPaise, mismatchedPaise };
  }

  // ── Create entry from 2B line (Invariant 4 — proposal layer only) ───────────

  async createEntryFrom2bLine(lineId: string, orgId: string): Promise<ProposedEntryDocument> {
    const line = await this.gstr2bModel.findOne({ _id: lineId, orgId }).lean().exec();
    if (!line) throw new NotFoundException('GSTR-2B line not found');
    if (line.reconStatus !== GstReconStatus.MISSING_IN_BOOKS) {
      throw new Error('Can only create entries for lines classified as missing_in_books');
    }

    const totalPaise = line.taxableValuePaise + line.itcEligiblePaise + line.cessPaise;
    const fy = line.invoiceDate ? getFY(line.invoiceDate) : getFY(`${line.period}-01`);

    // Build balanced journal lines:
    // Dr Purchase (taxable value) + Dr GST Input (ITC) = Cr Accounts Payable (total)
    const suggestedLines = [
      {
        accountName: 'Purchase Account',
        accountCode: null,
        accountId: new Types.ObjectId(),
        debitPaise: line.taxableValuePaise,
        creditPaise: 0,
        confidence: 0.75,
        isAiSuggested: false,
      },
      ...(line.igstPaise > 0
        ? [
            {
              accountName: 'GST Input — IGST',
              accountCode: null,
              accountId: new Types.ObjectId(),
              debitPaise: line.igstPaise,
              creditPaise: 0,
              confidence: 0.9,
              isAiSuggested: false,
            },
          ]
        : [
            {
              accountName: 'GST Input — CGST',
              accountCode: null,
              accountId: new Types.ObjectId(),
              debitPaise: line.cgstPaise,
              creditPaise: 0,
              confidence: 0.9,
              isAiSuggested: false,
            },
            {
              accountName: 'GST Input — SGST',
              accountCode: null,
              accountId: new Types.ObjectId(),
              debitPaise: line.sgstPaise,
              creditPaise: 0,
              confidence: 0.9,
              isAiSuggested: false,
            },
          ]),
      {
        accountName: 'Accounts Payable',
        accountCode: null,
        accountId: new Types.ObjectId(),
        debitPaise: 0,
        creditPaise: totalPaise,
        confidence: 0.9,
        isAiSuggested: false,
      },
    ];

    const proposal = await this.proposedEntryModel.create({
      orgId,
      documentId: null,
      extractedDocumentId: null,
      sourceType: 'gst2b',
      gstr2bLineId: new Types.ObjectId(lineId),
      status: ProposedEntryStatus.PROPOSED,
      documentType: 'purchase_invoice',
      vendorName: line.supplierName,
      vendorGstin: line.supplierGstin,
      invoiceNumber: line.invoiceNumber,
      invoiceDate: line.invoiceDate,
      amountsPaise: {
        taxableValue: line.taxableValuePaise,
        cgst: line.cgstPaise,
        sgst: line.sgstPaise,
        igst: line.igstPaise,
        cess: line.cessPaise,
        total: totalPaise,
      },
      confidenceOverall: 0.75,
      rawWarnings: ['Created from GSTR-2B import — review before posting.'],
      suggestedLines,
      financialYear: fy,
      journalId: null,
      approvedBy: null,
      rejectedBy: null,
      rejectionReason: null,
    });

    return proposal;
  }
}
