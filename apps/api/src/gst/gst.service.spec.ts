/**
 * Phase 12 Integration Tests — GstService.
 *
 * Done when:
 *  ✓ Purchase register: intra-state bill → CGST + SGST (IGST = 0)
 *  ✓ Purchase register: inter-state bill → IGST (CGST = SGST = 0)
 *  ✓ Purchase register: only returns bills in the requested period
 *  ✓ Sales register: returns posted invoices for the period
 *  ✓ importGstr2b: stores 2B lines with PENDING status
 *  ✓ reconcile2b: matching line classified as MATCHED
 *  ✓ reconcile2b: 2B line with no book entry → MISSING_IN_BOOKS
 *  ✓ reconcile2b: amount mismatch → MISMATCHED + mismatchType AMOUNT_DIFFERS
 *  ✓ reconcile2b: book entry with no 2B line → missingIn2B bucket
 *  ✓ ITC summary: confirmedIn2B = matched ITC; missingCredit = missing_in_books ITC
 *  ✓ createEntryFrom2bLine: ProposedEntry created (Invariant 4 — NOT in journals)
 */
import 'reflect-metadata';
import mongoose, { Types, Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import configuration from '../config/configuration';
import { GstService } from './gst.service';
import { Gstr2bLine, Gstr2bLineSchema, Gstr2bLineDocument } from './schemas/gstr2b-line.schema';
import { PurchaseBill, PurchaseBillSchema, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema, VendorDocument } from '../purchase/schemas/vendor.schema';
import { SalesInvoice, SalesInvoiceSchema, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema, CustomerDocument } from '../sales/schemas/customer.schema';
import { ProposedEntry, ProposedEntrySchema, ProposedEntryDocument } from '../proposals/schemas/proposed-entry.schema';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { BillStatus, GstReconStatus, GstMismatchType, InvoiceStatus, ProposedEntryStatus } from '@ai-accounting/shared';

const ORG_ID = new Types.ObjectId().toString();

/** Maharashtra state code. Suppliers with GSTIN starting with '27' are intra-state. */
const BUYER_STATE = '27';

let replSet: MongoMemoryReplSet;
let moduleRef: TestingModule;
let svc: GstService;
let vendorModel: Model<VendorDocument>;
let billModel: Model<PurchaseBillDocument>;
let invoiceModel: Model<SalesInvoiceDocument>;
let customerModel: Model<CustomerDocument>;
let gstr2bModel: Model<Gstr2bLineDocument>;
let proposedModel: Model<ProposedEntryDocument>;
let journalModel: Model<JournalDocument>;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createVendor(name: string, gstin: string | null) {
  return vendorModel.create({ orgId: ORG_ID, name, gstin });
}

async function createPostedBill(
  vendorId: Types.ObjectId,
  billDate: string,
  taxable: number,
  cgst: number,
  sgst: number,
  igst: number,
  billNumber?: string,
): Promise<PurchaseBillDocument> {
  return billModel.create({
    orgId: ORG_ID,
    vendorId,
    billNumber: billNumber ?? null,
    billDate,
    status: BillStatus.POSTED,
    amountsPaise: {
      taxableValue: taxable,
      cgst,
      sgst,
      igst,
      cess: 0,
      total: taxable + cgst + sgst + igst,
    },
    lineItems: [],
    financialYear: '2025-26',
  });
}

async function createPostedInvoice(
  customerId: Types.ObjectId,
  invoiceDate: string,
  taxable: number,
  cgst: number,
  sgst: number,
  igst: number,
): Promise<SalesInvoiceDocument> {
  return invoiceModel.create({
    orgId: ORG_ID,
    customerId,
    invoiceNumber: `INV-${Date.now()}`,
    invoiceDate,
    status: InvoiceStatus.POSTED,
    amountsPaise: {
      taxableValue: taxable,
      cgst,
      sgst,
      igst,
      cess: 0,
      total: taxable + cgst + sgst + igst,
    },
    lineItems: [],
    financialYear: '2025-26',
  });
}

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(replSet.getUri()),
      MongooseModule.forFeature([
        { name: Gstr2bLine.name, schema: Gstr2bLineSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: ProposedEntry.name, schema: ProposedEntrySchema },
        { name: Journal.name, schema: JournalSchema },
      ]),
    ],
    providers: [GstService],
  }).compile();

  svc = moduleRef.get(GstService);
  vendorModel = moduleRef.get(getModelToken(Vendor.name));
  billModel = moduleRef.get(getModelToken(PurchaseBill.name));
  invoiceModel = moduleRef.get(getModelToken(SalesInvoice.name));
  customerModel = moduleRef.get(getModelToken(Customer.name));
  gstr2bModel = moduleRef.get(getModelToken(Gstr2bLine.name));
  proposedModel = moduleRef.get(getModelToken(ProposedEntry.name));
  journalModel = moduleRef.get(getModelToken(Journal.name));
});

afterAll(async () => {
  await moduleRef.close();
  await replSet.stop();
});

afterEach(async () => {
  await Promise.all([
    vendorModel.deleteMany({}),
    billModel.deleteMany({}),
    invoiceModel.deleteMany({}),
    customerModel.deleteMany({}),
    gstr2bModel.deleteMany({}),
    proposedModel.deleteMany({}),
  ]);
});

// ── Purchase register: GST split normalisation ────────────────────────────────

describe('getPurchaseRegister — GST split normalisation', () => {
  it('intra-state supplier (GSTIN 27xxx) → CGST + SGST; IGST = 0', async () => {
    const vendor = await createVendor('Sigma Electricals', '27AAPFS0939F1ZV');
    // Bill stored with igst=36000 (AI extractor mistake); service should normalize to cgst+sgst
    await createPostedBill(vendor._id, '2025-03-10', 200000, 0, 0, 36000);

    const entries = await svc.getPurchaseRegister(ORG_ID, '2025-03', BUYER_STATE);
    expect(entries).toHaveLength(1);
    expect(entries[0].isInterState).toBe(false);
    expect(entries[0].igstPaise).toBe(0);
    expect(entries[0].cgstPaise).toBe(18000);
    expect(entries[0].sgstPaise).toBe(18000);
  });

  it('inter-state supplier (GSTIN 07xxx = Delhi) → IGST; CGST = SGST = 0', async () => {
    const vendor = await createVendor('Delhi Supplies Co', '07AAPFD0939F1ZV');
    // Bill stored with cgst=9000, sgst=9000; service normalizes to igst=18000
    await createPostedBill(vendor._id, '2025-03-15', 100000, 9000, 9000, 0);

    const entries = await svc.getPurchaseRegister(ORG_ID, '2025-03', BUYER_STATE);
    expect(entries).toHaveLength(1);
    expect(entries[0].isInterState).toBe(true);
    expect(entries[0].igstPaise).toBe(18000);
    expect(entries[0].cgstPaise).toBe(0);
    expect(entries[0].sgstPaise).toBe(0);
  });

  it('only returns bills whose billDate falls in the requested period', async () => {
    const vendor = await createVendor('ACME Ltd', '27AAPFA0939F1ZV');
    await createPostedBill(vendor._id, '2025-03-05', 100000, 9000, 9000, 0);
    await createPostedBill(vendor._id, '2025-04-01', 100000, 9000, 9000, 0); // different period

    const march = await svc.getPurchaseRegister(ORG_ID, '2025-03', BUYER_STATE);
    const april = await svc.getPurchaseRegister(ORG_ID, '2025-04', BUYER_STATE);

    expect(march).toHaveLength(1);
    expect(april).toHaveLength(1);
  });
});

// ── Sales register ────────────────────────────────────────────────────────────

describe('getSalesRegister', () => {
  it('returns posted invoices for the period', async () => {
    const customer = await customerModel.create({
      orgId: ORG_ID,
      name: 'Rahul Enterprises',
      gstin: '29AAPFR0939F1ZV', // Karnataka
    });
    await createPostedInvoice(customer._id, '2025-03-07', 250000, 0, 0, 45000);

    const entries = await svc.getSalesRegister(ORG_ID, '2025-03', BUYER_STATE);
    expect(entries).toHaveLength(1);
    expect(entries[0].customerName).toBe('Rahul Enterprises');
    expect(entries[0].isInterState).toBe(true); // Karnataka ≠ Maharashtra
    expect(entries[0].igstPaise).toBe(45000);
  });
});

// ── GSTR-2B import ────────────────────────────────────────────────────────────

describe('importGstr2b', () => {
  it('stores 2B lines with PENDING reconStatus', async () => {
    const stored = await svc.importGstr2b(ORG_ID, '2025-03', [
      {
        supplierGstin: '07AAPFD0939F1ZV',
        supplierName: 'Delhi Supplies Co',
        invoiceNumber: 'DEL/2025/001',
        invoiceDate: '2025-03-15',
        taxableValuePaise: 100000,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 18000,
      },
    ]);

    expect(stored).toHaveLength(1);
    expect(stored[0].reconStatus).toBe(GstReconStatus.PENDING);
    expect(stored[0].itcEligiblePaise).toBe(18000);
  });
});

// ── 2B reconciliation buckets ─────────────────────────────────────────────────

describe('reconcile2b', () => {
  it('classifies a matching line as MATCHED', async () => {
    const vendor = await createVendor('Delhi Supplies Co', '07AAPFD0939F1ZV');
    await createPostedBill(vendor._id, '2025-03-15', 100000, 0, 0, 18000, 'DEL/2025/001');

    await svc.importGstr2b(ORG_ID, '2025-03', [
      {
        supplierGstin: '07AAPFD0939F1ZV',
        supplierName: 'Delhi Supplies Co',
        invoiceNumber: 'DEL/2025/001',
        invoiceDate: '2025-03-15',
        taxableValuePaise: 100000,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 18000,
      },
    ]);

    const summary = await svc.reconcile2b(ORG_ID, '2025-03', BUYER_STATE);
    expect(summary.matched).toHaveLength(1);
    expect(summary.missingInBooks).toHaveLength(0);
    expect(summary.mismatched).toHaveLength(0);

    const line = await gstr2bModel.findOne({ orgId: ORG_ID }).lean();
    expect(line!.reconStatus).toBe(GstReconStatus.MATCHED);
  });

  it('classifies a 2B line with no matching bill as MISSING_IN_BOOKS', async () => {
    // No bill in DB for this supplier+invoice
    await svc.importGstr2b(ORG_ID, '2025-03', [
      {
        supplierGstin: '29AAPFK0939F1ZV',
        supplierName: 'Karnataka Goods',
        invoiceNumber: 'KA/2025/999',
        invoiceDate: '2025-03-20',
        taxableValuePaise: 50000,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 9000,
      },
    ]);

    const summary = await svc.reconcile2b(ORG_ID, '2025-03', BUYER_STATE);
    expect(summary.missingInBooks).toHaveLength(1);
    expect(summary.missingInBooks[0].invoiceNumber).toBe('KA/2025/999');
    expect(summary.totalMissingCreditPaise).toBe(9000);
  });

  it('classifies an amount mismatch as MISMATCHED with AMOUNT_DIFFERS', async () => {
    const vendor = await createVendor('Sigma Electricals', '27AAPFS0939F1ZV');
    // Book has taxable = 200000
    await createPostedBill(vendor._id, '2025-03-10', 200000, 18000, 18000, 0, 'SE/2025/087');

    // 2B has taxable = 210000 (more than ₹5 difference)
    await svc.importGstr2b(ORG_ID, '2025-03', [
      {
        supplierGstin: '27AAPFS0939F1ZV',
        supplierName: 'Sigma Electricals',
        invoiceNumber: 'SE/2025/087',
        invoiceDate: '2025-03-10',
        taxableValuePaise: 210000,
        cgstPaise: 18900,
        sgstPaise: 18900,
        igstPaise: 0,
      },
    ]);

    const summary = await svc.reconcile2b(ORG_ID, '2025-03', BUYER_STATE);
    expect(summary.mismatched).toHaveLength(1);
    expect(summary.mismatched[0].mismatchType).toBe(GstMismatchType.AMOUNT_DIFFERS);

    const line = await gstr2bModel.findOne({ orgId: ORG_ID }).lean();
    expect(line!.reconStatus).toBe(GstReconStatus.MISMATCHED);
    expect(line!.mismatchType).toBe(GstMismatchType.AMOUNT_DIFFERS);
  });

  it('puts a posted bill with no 2B line in the missingIn2B bucket', async () => {
    const vendor = await createVendor('ACME Ltd', '27AAPFA0939F1ZV');
    await createPostedBill(vendor._id, '2025-03-05', 100000, 9000, 9000, 0, 'ACME/2025/001');
    // No 2B lines imported

    const summary = await svc.reconcile2b(ORG_ID, '2025-03', BUYER_STATE);
    expect(summary.missingIn2B).toHaveLength(1);
    expect(summary.missingIn2B[0].invoiceNumber).toBe('ACME/2025/001');
  });

  it('within ₹5 tolerance: still classifies as matched', async () => {
    const vendor = await createVendor('Tally Corp', '27AAPFT0939F1ZV');
    await createPostedBill(vendor._id, '2025-03-20', 100000, 9000, 9000, 0, 'TC/2025/010');

    // 2B has taxable = 100003 (₹0.03 difference — within ₹5 tolerance)
    await svc.importGstr2b(ORG_ID, '2025-03', [
      {
        supplierGstin: '27AAPFT0939F1ZV',
        supplierName: 'Tally Corp',
        invoiceNumber: 'TC/2025/010',
        invoiceDate: '2025-03-20',
        taxableValuePaise: 100003,
        cgstPaise: 9000,
        sgstPaise: 9000,
        igstPaise: 0,
      },
    ]);

    const summary = await svc.reconcile2b(ORG_ID, '2025-03', BUYER_STATE);
    expect(summary.matched).toHaveLength(1);
    expect(summary.mismatched).toHaveLength(0);
  });
});

// ── ITC summary ───────────────────────────────────────────────────────────────

describe('getItcSummary', () => {
  it('correctly computes confirmed and missing credit totals', async () => {
    // Bill 1: matched in 2B (ITC = 18000)
    const v1 = await createVendor('Supplier A', '07AAPFA0939F1ZV');
    await createPostedBill(v1._id, '2025-03-10', 100000, 0, 0, 18000, 'A/001');

    // Bill 2: no 2B line — missingIn2B (ITC = 9000 each cgst+sgst)
    const v2 = await createVendor('Supplier B', '27AAPFB0939F1ZV');
    await createPostedBill(v2._id, '2025-03-15', 100000, 9000, 9000, 0, 'B/001');

    // 2B line matching Bill 1 only; 2B line for unknown invoice (missing_in_books, ITC = 5000)
    await svc.importGstr2b(ORG_ID, '2025-03', [
      {
        supplierGstin: '07AAPFA0939F1ZV',
        supplierName: 'Supplier A',
        invoiceNumber: 'A/001',
        invoiceDate: '2025-03-10',
        taxableValuePaise: 100000,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 18000,
      },
      {
        supplierGstin: '36AAPFX0939F1ZV',
        supplierName: 'Unknown Co',
        invoiceNumber: 'UNK/001',
        invoiceDate: '2025-03-01',
        taxableValuePaise: 50000,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 5000,
      },
    ]);

    await svc.reconcile2b(ORG_ID, '2025-03', BUYER_STATE);
    const summary = await svc.getItcSummary(ORG_ID, '2025-03', BUYER_STATE);

    // Bill 1: IGST 18000; Bill 2: CGST+SGST = 18000 (normalized from 9000+9000)
    expect(summary.totalInBooksPaise).toBe(36000);
    expect(summary.confirmedIn2BPaise).toBe(18000);
    // Unknown Co line is missing_in_books
    expect(summary.missingCreditPaise).toBe(5000);
  });
});

// ── createEntryFrom2bLine — Invariant 4 ──────────────────────────────────────

describe('createEntryFrom2bLine (Invariant 4)', () => {
  it('creates a ProposedEntry from a missing_in_books 2B line — journals collection untouched', async () => {
    await svc.importGstr2b(ORG_ID, '2025-03', [
      {
        supplierGstin: '29AAPFK0939F1ZV',
        supplierName: 'Karnataka Goods',
        invoiceNumber: 'KA/2025/999',
        invoiceDate: '2025-03-20',
        taxableValuePaise: 50000,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 9000,
      },
    ]);

    // Classify it as missing_in_books
    await svc.reconcile2b(ORG_ID, '2025-03', BUYER_STATE);

    const line = await gstr2bModel.findOne({ orgId: ORG_ID }).lean();
    expect(line!.reconStatus).toBe(GstReconStatus.MISSING_IN_BOOKS);

    // One-click entry creation
    const proposal = await svc.createEntryFrom2bLine(line!._id.toString(), ORG_ID);

    // Verify ProposedEntry exists in proposal layer
    expect(proposal.status).toBe(ProposedEntryStatus.PROPOSED);
    expect(proposal.sourceType).toBe('gst2b');
    expect(proposal.vendorGstin).toBe('29AAPFK0939F1ZV');
    expect(proposal.invoiceNumber).toBe('KA/2025/999');

    // Journal lines must balance
    const totalDebit = proposal.suggestedLines.reduce((s: number, l: { debitPaise: number }) => s + l.debitPaise, 0);
    const totalCredit = proposal.suggestedLines.reduce((s: number, l: { creditPaise: number }) => s + l.creditPaise, 0);
    expect(totalDebit).toBe(totalCredit);

    // Invariant 4: journals collection must have zero entries
    const journalCount = await journalModel.countDocuments({});
    expect(journalCount).toBe(0);
  });

  it('throws when trying to create entry from a non-missing_in_books line', async () => {
    const vendor = await createVendor('Matched Vendor', '07AAPFM0939F1ZV');
    await createPostedBill(vendor._id, '2025-03-10', 100000, 0, 0, 18000, 'MV/001');

    await svc.importGstr2b(ORG_ID, '2025-03', [
      {
        supplierGstin: '07AAPFM0939F1ZV',
        supplierName: 'Matched Vendor',
        invoiceNumber: 'MV/001',
        invoiceDate: '2025-03-10',
        taxableValuePaise: 100000,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 18000,
      },
    ]);

    await svc.reconcile2b(ORG_ID, '2025-03', BUYER_STATE);
    const matched = await gstr2bModel.findOne({ orgId: ORG_ID, reconStatus: GstReconStatus.MATCHED }).lean();

    await expect(
      svc.createEntryFrom2bLine(matched!._id.toString(), ORG_ID),
    ).rejects.toThrow('Can only create entries for lines classified as missing_in_books');
  });

  it('tenant isolation: cannot create entry for 2B line belonging to another org', async () => {
    const OTHER_ORG = new Types.ObjectId().toString();
    await svc.importGstr2b(OTHER_ORG, '2025-03', [
      {
        supplierGstin: '29AAPFX0939F1ZV',
        supplierName: 'Other Org Supplier',
        invoiceNumber: 'OT/001',
        invoiceDate: '2025-03-10',
        taxableValuePaise: 10000,
        cgstPaise: 900,
        sgstPaise: 900,
        igstPaise: 0,
      },
    ]);

    // Classify as missing_in_books in OTHER_ORG context
    await svc.reconcile2b(OTHER_ORG, '2025-03', BUYER_STATE);
    const line = await gstr2bModel.findOne({ orgId: OTHER_ORG }).lean();

    // Try to access it as ORG_ID — should throw NotFoundException
    await expect(
      svc.createEntryFrom2bLine(line!._id.toString(), ORG_ID),
    ).rejects.toThrow();
  });
});
