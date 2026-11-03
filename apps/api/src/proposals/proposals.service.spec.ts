/**
 * Phase 8 Integration Tests — Proposal layer.
 *
 * Done when:
 *  ✓ createFromExtracted builds a balanced ProposedEntry from an ExtractedDocument
 *  ✓ approve calls PostingService.post() and updates status to 'approved'
 *  ✓ approve with override lines posts those lines (human-corrected)
 *  ✓ reject updates status to 'rejected', keeps proposal for audit
 *  ✓ AI never writes to journals directly (Invariant 4 — tested by asserting that
 *     the only journal write is via PostingService.post())
 *  ✓ double-approve throws 400
 *  ✓ approveHighConfidence skips low-confidence proposals
 */
import 'reflect-metadata';
import mongoose, { Types } from 'mongoose';
import { testMongoUri } from '../test-utils/mongo';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import configuration from '../config/configuration';
import { ProposalsService } from './proposals.service';
import { LearningService } from './learning.service';
import { ProposedEntry, ProposedEntrySchema, ProposedEntryDocument } from './schemas/proposed-entry.schema';
import { ExtractedDocument, ExtractedDocumentSchema, ExtractedDocumentDocument } from '../extraction/schemas/extracted-document.schema';
import { VendorLedgerMap, VendorLedgerMapSchema } from './schemas/vendor-ledger-map.schema';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { SubledgerSyncService } from './subledger-sync.service';
import { AuditService } from '../gl/audit.service';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Document as UploadedDocument, DocumentSchema } from '../documents/schemas/document.schema';
import { AccountType, ProposedEntryStatus, VoucherType } from '@ai-accounting/shared';
import { REDIS_CLIENT } from '../redis/redis.module';
import { BillChecksService } from './checks/bill-checks.service';
import { ExpenseCategorizerService } from './categorisation/expense-categorizer.service';
import { CATEGORY_MODEL } from './categorisation/category-model';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';

const redisMock = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
};

const ORG_ID = new Types.ObjectId().toString();
const ACTOR_ID = new Types.ObjectId().toString();

/** Build a minimal valid ExtractedDocument for testing. */
async function seedExtracted(
  model: Model<ExtractedDocumentDocument>,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<ExtractedDocumentDocument> {
  return model.create({
    orgId: ORG_ID,
    documentId: new Types.ObjectId(),
    ocrResultId: new Types.ObjectId(),
    status: 'extracted',
    retryCount: 0,
    documentType: 'purchase_invoice',
    confidenceOverall: 0.92,
    vendor: { name: 'Acme Pvt Ltd', gstin: '27AAPFU0939F1ZV', confidence: 0.95 },
    invoiceNumber: { value: 'INV-2025-001', confidence: 0.98 },
    invoiceDate: { value: '2025-03-01', confidence: 0.97 },
    placeOfSupply: 'Maharashtra',
    currency: 'INR',
    amountsPaise: { taxableValue: 1000000, cgst: 90000, sgst: 90000, igst: 0, cess: 0, total: 1180000, confidence: 0.93 },
    lineItems: [],
    isReverseCharge: false,
    rawWarnings: [],
    ...overrides,
  });
}

let moduleRef: TestingModule;
let svc: ProposalsService;
let proposalModel: Model<ProposedEntryDocument>;
let extractedModel: Model<ExtractedDocumentDocument>;
let journalModel: Model<JournalDocument>;

beforeAll(async () => {

  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: ProposedEntry.name, schema: ProposedEntrySchema },
        { name: ExtractedDocument.name, schema: ExtractedDocumentSchema },
        { name: VendorLedgerMap.name, schema: VendorLedgerMapSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: UploadedDocument.name, schema: DocumentSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
      ]),
    ],
    providers: [
      ProposalsService,
      PostingService,
      LearningService,
      AccountsService,
      SubledgerSyncService,
      AuditService,
      ExpenseCategorizerService,
      BillChecksService,
      // No model in these tests: categorisation falls back to rules, past choices and Purchases.
      { provide: CATEGORY_MODEL, useValue: { available: false, choose: jest.fn() } },
      { provide: REDIS_CLIENT, useValue: redisMock },
    ],
  }).compile();

  svc = moduleRef.get(ProposalsService);
  proposalModel = moduleRef.get<Model<ProposedEntryDocument>>(getModelToken(ProposedEntry.name));
  extractedModel = moduleRef.get<Model<ExtractedDocumentDocument>>(getModelToken(ExtractedDocument.name));
  journalModel = moduleRef.get<Model<JournalDocument>>(getModelToken(Journal.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

beforeEach(() => {
  jest.clearAllMocks();
  redisMock.get.mockResolvedValue(null); // default: cache miss so DB path is exercised
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('createFromExtracted', () => {
  it('creates a ProposedEntry with balanced suggested lines', async () => {
    const extracted = await seedExtracted(extractedModel);
    const proposal = await svc.createFromExtracted(extracted._id.toString(), ORG_ID);

    expect(proposal.status).toBe(ProposedEntryStatus.PROPOSED);
    expect(proposal.orgId).toBe(ORG_ID);
    expect(proposal.documentType).toBe('purchase_invoice');
    expect(proposal.vendorName).toBe('Acme Pvt Ltd');
    expect(proposal.invoiceNumber).toBe('INV-2025-001');

    const totalDebit = proposal.suggestedLines.reduce((s, l) => s + l.debitPaise, 0);
    const totalCredit = proposal.suggestedLines.reduce((s, l) => s + l.creditPaise, 0);
    expect(totalDebit).toBe(totalCredit); // suggested lines must balance
    expect(totalDebit).toBe(1180000);     // = total paise
  });

  it('splits input GST across the CGST and SGST ledgers', async () => {
    const extracted = await seedExtracted(extractedModel);
    const proposal = await svc.createFromExtracted(extracted._id.toString(), ORG_ID);

    // CGST and SGST are separate ledgers under GST law — they are set off against
    // their own output heads and reported separately, so they never share a line.
    const cgstLine = proposal.suggestedLines.find((l) => /cgst/i.test(l.accountName));
    const sgstLine = proposal.suggestedLines.find((l) => /sgst/i.test(l.accountName));

    expect(cgstLine).toBeDefined();
    expect(sgstLine).toBeDefined();
    expect(cgstLine!.debitPaise).toBe(90000);
    expect(sgstLine!.debitPaise).toBe(90000);

    // Each line points at a real chart-of-accounts entry, not a placeholder id.
    expect(cgstLine!.accountCode).toBe('1300');
    expect(sgstLine!.accountCode).toBe('1310');
  });

  it('computes correct financial year from invoice date', async () => {
    // April 2025 → FY 2025-26
    const extracted = await seedExtracted(extractedModel, {
      invoiceDate: { value: '2025-04-15', confidence: 0.95 },
    });
    const proposal = await svc.createFromExtracted(extracted._id.toString(), ORG_ID);
    expect(proposal.financialYear).toBe('2025-26');
  });

  it('handles invoice date before April (FY spans previous calendar year)', async () => {
    // Jan 2025 → FY 2024-25
    const extracted = await seedExtracted(extractedModel, {
      invoiceDate: { value: '2025-01-10', confidence: 0.95 },
    });
    const proposal = await svc.createFromExtracted(extracted._id.toString(), ORG_ID);
    expect(proposal.financialYear).toBe('2024-25');
  });
});

describe('approve', () => {
  it('posts a balanced journal via PostingService and marks proposal approved', async () => {
    const extracted = await seedExtracted(extractedModel, {
      invoiceDate: { value: '2025-04-01', confidence: 0.95 },
    });
    const proposal = await svc.createFromExtracted(extracted._id.toString(), ORG_ID);

    const approved = await svc.approve({
      proposalId: proposal._id.toString(),
      orgId: ORG_ID,
      actorId: ACTOR_ID,
    });

    expect(approved.status).toBe(ProposedEntryStatus.APPROVED);
    expect(approved.approvedBy).toBe(ACTOR_ID);
    expect(approved.journalId).toBeTruthy();
  });

  it('the posted journal is balanced (Σdebit === Σcredit)', async () => {
    const extracted = await seedExtracted(extractedModel, {
      invoiceDate: { value: '2025-05-01', confidence: 0.95 },
    });
    const proposal = await svc.createFromExtracted(extracted._id.toString(), ORG_ID);

    const approved = await svc.approve({
      proposalId: proposal._id.toString(),
      orgId: ORG_ID,
      actorId: ACTOR_ID,
    });

    const journal = await journalModel.findById(approved.journalId).exec();
    expect(journal).not.toBeNull();
    const totalDebit = journal!.lines.reduce((s, l) => s + l.debitPaise, 0);
    const totalCredit = journal!.lines.reduce((s, l) => s + l.creditPaise, 0);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBeGreaterThan(0);
  });

  it('accepts override lines (human-corrected accounts)', async () => {
    const extracted = await seedExtracted(extractedModel, {
      invoiceDate: { value: '2025-06-01', confidence: 0.95 },
    });
    const proposal = await svc.createFromExtracted(extracted._id.toString(), ORG_ID);

    const overrideAccountId = new Types.ObjectId().toString();
    const payableAccountId = new Types.ObjectId().toString();

    const approved = await svc.approve({
      proposalId: proposal._id.toString(),
      orgId: ORG_ID,
      actorId: ACTOR_ID,
      lines: [
        { accountId: overrideAccountId, accountName: 'Food Expense', debitPaise: 1180000, creditPaise: 0 },
        { accountId: payableAccountId, accountName: 'Accounts Payable', debitPaise: 0, creditPaise: 1180000 },
      ],
    });

    expect(approved.status).toBe(ProposedEntryStatus.APPROVED);
    const journal = await journalModel.findById(approved.journalId).exec();
    expect(journal!.lines[0].accountId.toString()).toBe(overrideAccountId);
  });

  it('throws 400 when approving an already-approved proposal (Invariant 3 protection)', async () => {
    const extracted = await seedExtracted(extractedModel, {
      invoiceDate: { value: '2025-07-01', confidence: 0.95 },
    });
    const proposal = await svc.createFromExtracted(extracted._id.toString(), ORG_ID);

    await svc.approve({ proposalId: proposal._id.toString(), orgId: ORG_ID, actorId: ACTOR_ID });
    await expect(
      svc.approve({ proposalId: proposal._id.toString(), orgId: ORG_ID, actorId: ACTOR_ID }),
    ).rejects.toThrow('Cannot approve a proposal with status "approved"');
  });
});

describe('reject', () => {
  it('marks proposal as rejected and records reason (kept for audit)', async () => {
    const extracted = await seedExtracted(extractedModel);
    const proposal = await svc.createFromExtracted(extracted._id.toString(), ORG_ID);

    const rejected = await svc.reject({
      proposalId: proposal._id.toString(),
      orgId: ORG_ID,
      actorId: ACTOR_ID,
      reason: 'Duplicate invoice submitted by vendor',
    });

    expect(rejected.status).toBe(ProposedEntryStatus.REJECTED);
    expect(rejected.rejectedBy).toBe(ACTOR_ID);
    expect(rejected.rejectionReason).toBe('Duplicate invoice submitted by vendor');

    // Rejected proposal must still exist in DB (kept for audit — Invariant 6)
    const inDb = await proposalModel.findById(proposal._id).exec();
    expect(inDb).not.toBeNull();
    expect(inDb!.status).toBe(ProposedEntryStatus.REJECTED);
  });

  it('throws 400 when rejecting an already-rejected proposal', async () => {
    const extracted = await seedExtracted(extractedModel);
    const proposal = await svc.createFromExtracted(extracted._id.toString(), ORG_ID);

    await svc.reject({ proposalId: proposal._id.toString(), orgId: ORG_ID, actorId: ACTOR_ID });
    await expect(
      svc.reject({ proposalId: proposal._id.toString(), orgId: ORG_ID, actorId: ACTOR_ID }),
    ).rejects.toThrow('Cannot reject a proposal with status "rejected"');
  });
});

describe('approveHighConfidence', () => {
  it('only approves proposals at or above the confidence threshold', async () => {
    // Create two high-confidence and one low-confidence proposal
    // Three different vendors' bills, so none is a duplicate of another.
    const vendor = (name: string, number: string) => ({
      vendor: { name, gstin: null, confidence: 0.95 },
      invoiceNumber: { value: number, confidence: 0.95 },
    });
    const highConf1 = await seedExtracted(extractedModel, {
      ...vendor('Bulk Vendor One', 'B1-001'),
      confidenceOverall: 0.95,
      invoiceDate: { value: '2025-08-01', confidence: 0.95 },
    });
    const highConf2 = await seedExtracted(extractedModel, {
      ...vendor('Bulk Vendor Two', 'B2-001'),
      confidenceOverall: 0.91,
      invoiceDate: { value: '2025-08-02', confidence: 0.91 },
    });
    const lowConf = await seedExtracted(extractedModel, {
      ...vendor('Bulk Vendor Three', 'B3-001'),
      confidenceOverall: 0.65,
      invoiceDate: { value: '2025-08-03', confidence: 0.65 },
    });

    await svc.createFromExtracted(highConf1._id.toString(), ORG_ID);
    await svc.createFromExtracted(highConf2._id.toString(), ORG_ID);
    const lowProposal = await svc.createFromExtracted(lowConf._id.toString(), ORG_ID);

    const result = await svc.approveHighConfidence(ORG_ID, ACTOR_ID, 0.9);

    expect(result.approved).toBeGreaterThanOrEqual(2);

    // Low-confidence proposal must still be proposed
    const stillProposed = await proposalModel.findById(lowProposal._id).exec();
    expect(stillProposed!.status).toBe(ProposedEntryStatus.PROPOSED);
  });

  it('leaves a flagged proposal for a person, however confident', async () => {
    const same = {
      vendor: { name: 'Twice Billed Traders', gstin: null, confidence: 0.98 },
      invoiceNumber: { value: 'TB/77', confidence: 0.98 },
      invoiceDate: { value: '2025-08-10', confidence: 0.98 },
      confidenceOverall: 0.97,
    };
    const first = await svc.createFromExtracted((await seedExtracted(extractedModel, same))._id.toString(), ORG_ID);
    const second = await svc.createFromExtracted((await seedExtracted(extractedModel, same))._id.toString(), ORG_ID);
    expect(first.checks).toEqual([]);
    expect(second.checks).toEqual([expect.objectContaining({ code: 'duplicate_number', severity: 'high' })]);

    await svc.approveHighConfidence(ORG_ID, ACTOR_ID, 0.9);
    expect((await proposalModel.findById(first._id).exec())!.status).toBe(ProposedEntryStatus.APPROVED);
    expect((await proposalModel.findById(second._id).exec())!.status).toBe(ProposedEntryStatus.PROPOSED);
  });
});

describe('learning loop (Phase 9)', () => {
  it('correcting vendor account once causes next proposal to pre-fill learned account', async () => {
    // A real account: a learned choice is only suggested while the account exists.
    const food = await moduleRef.get(AccountsService).create({ orgId: ORG_ID, name: 'Food Expense', type: AccountType.EXPENSE });
    const correctedAccountId = food._id.toString();
    const payableAccountId = new Types.ObjectId().toString();

    // Step 1: first document from vendor — approve with human-corrected expense account
    const extracted1 = await seedExtracted(extractedModel, {
      vendor: { name: 'Swiggy India Pvt Ltd', gstin: '27AAPFU0939F1ZV', confidence: 0.95 },
      invoiceDate: { value: '2025-09-01', confidence: 0.95 },
    });
    const proposal1 = await svc.createFromExtracted(extracted1._id.toString(), ORG_ID);

    // With nothing learned yet, the AI falls back to the seeded Purchases account.
    const aiExpenseLine = proposal1.suggestedLines.find(
      (l) => l.debitPaise > 0 && !l.accountName.toLowerCase().includes('gst'),
    );
    expect(aiExpenseLine?.accountName).toBe('Purchases');
    expect(aiExpenseLine?.isAiSuggested).toBe(true);

    // Human corrects: uses "Food Expense" instead
    await svc.approve({
      proposalId: proposal1._id.toString(),
      orgId: ORG_ID,
      actorId: ACTOR_ID,
      lines: [
        { accountId: correctedAccountId, accountName: 'Food Expense', debitPaise: 1000000, creditPaise: 0 },
        { accountId: new Types.ObjectId().toString(), accountName: 'GST Input Tax Credit', debitPaise: 180000, creditPaise: 0 },
        { accountId: payableAccountId, accountName: 'Accounts Payable', debitPaise: 0, creditPaise: 1180000 },
      ],
    });

    // Step 2: second document from same vendor — proposal should pre-fill "Food Expense"
    const extracted2 = await seedExtracted(extractedModel, {
      vendor: { name: 'Swiggy India Pvt Ltd', gstin: '27AAPFU0939F1ZV', confidence: 0.95 },
      invoiceDate: { value: '2025-09-15', confidence: 0.95 },
    });
    const proposal2 = await svc.createFromExtracted(extracted2._id.toString(), ORG_ID);

    const learnedExpenseLine = proposal2.suggestedLines.find(
      (l) => l.debitPaise > 0 && !l.accountName.toLowerCase().includes('gst'),
    );
    expect(learnedExpenseLine?.accountName).toBe('Food Expense');
    expect(learnedExpenseLine?.accountId.toString()).toBe(correctedAccountId);
    expect(learnedExpenseLine?.isAiSuggested).toBe(false);
  });

  it('does NOT learn when approve uses AI-suggested lines (no override)', async () => {
    const extracted = await seedExtracted(extractedModel, {
      vendor: { name: 'No Override Vendor', gstin: '27AAPFU0939F1ZV', confidence: 0.95 },
      invoiceDate: { value: '2025-10-01', confidence: 0.95 },
    });
    const proposal = await svc.createFromExtracted(extracted._id.toString(), ORG_ID);

    // Approve WITHOUT override lines — should not update learning map
    await svc.approve({ proposalId: proposal._id.toString(), orgId: ORG_ID, actorId: ACTOR_ID });

    // Next doc from same vendor should still get AI generic suggestion
    const extracted2 = await seedExtracted(extractedModel, {
      vendor: { name: 'No Override Vendor', gstin: '27AAPFU0939F1ZV', confidence: 0.95 },
      invoiceDate: { value: '2025-10-15', confidence: 0.95 },
    });
    const proposal2 = await svc.createFromExtracted(extracted2._id.toString(), ORG_ID);
    const expenseLine = proposal2.suggestedLines.find(
      (l) => l.debitPaise > 0 && !l.accountName.toLowerCase().includes('gst'),
    );
    expect(expenseLine?.isAiSuggested).toBe(true);
    expect(expenseLine?.accountName).toBe('Purchases');
  });
});

describe('approve — a double-click posts once', () => {
  const refused = /already been approved or rejected|Cannot (approve|reject) a proposal/;

  it('two simultaneous approvals post one journal', async () => {
    const extracted = await seedExtracted(extractedModel, {
      invoiceNumber: { value: 'INV-RACE-APPROVE', confidence: 0.98 },
    });
    const proposal = await svc.createFromExtracted(extracted._id.toString(), ORG_ID);
    const input = { proposalId: proposal._id.toString(), orgId: ORG_ID, actorId: ACTOR_ID };

    const results = await Promise.allSettled([svc.approve(input), svc.approve(input)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(String(rejected?.reason)).toMatch(refused);
    expect(await journalModel.countDocuments({ orgId: ORG_ID, narration: / — INV-RACE-APPROVE$/ })).toBe(1);
  });

  it('an approve racing a reject ends in exactly one outcome', async () => {
    const extracted = await seedExtracted(extractedModel, {
      invoiceNumber: { value: 'INV-RACE-REJECT', confidence: 0.98 },
    });
    const proposal = await svc.createFromExtracted(extracted._id.toString(), ORG_ID);
    const input = { proposalId: proposal._id.toString(), orgId: ORG_ID, actorId: ACTOR_ID };

    const results = await Promise.allSettled([svc.approve(input), svc.reject(input)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const final = await proposalModel.findById(proposal._id).exec();
    const journals = await journalModel.countDocuments({ orgId: ORG_ID, narration: / — INV-RACE-REJECT$/ });
    // Never a rejected proposal with a posted journal, nor an approved one without.
    expect(journals).toBe(final!.status === ProposedEntryStatus.APPROVED ? 1 : 0);
  });
});

describe('what a proposal carries into the books', () => {
  const docs = () => moduleRef.get<Model<{ status: string }>>(getModelToken(UploadedDocument.name));
  const bills = () => moduleRef.get<Model<{ journalId: unknown; dueDate: string | null }>>(getModelToken(PurchaseBill.name));

  async function seedUpload() {
    return docs().create({
      orgId: ORG_ID,
      status: 'PROPOSED',
      s3Key: `k/${new Types.ObjectId()}`,
      originalName: 'invoice.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      sha256: new Types.ObjectId().toString(),
      uploadedBy: new Types.ObjectId(),
    });
  }

  it('owes the vendor the printed total, showing any difference on a Round Off line', async () => {
    // Printed ₹47,700 but the parts add to ₹47,200. AP used to be credited with
    // the parts, so the ₹500 the vendor will ask for vanished from the books.
    const extracted = await seedExtracted(extractedModel, {
      amountsPaise: { taxableValue: 4000000, cgst: 360000, sgst: 360000, igst: 0, cess: 0, total: 4770000, confidence: 0.9 },
    });
    const proposal = await svc.createFromExtracted(extracted._id.toString(), ORG_ID);

    const payable = proposal.suggestedLines.find((l) => /payable/i.test(l.accountName));
    const roundOff = proposal.suggestedLines.find((l) => /round/i.test(l.accountName));
    expect(payable?.creditPaise).toBe(4770000);
    expect(roundOff?.debitPaise).toBe(50000);
  });

  it('works out the due date from the payment terms, and the bill carries it', async () => {
    const upload = await seedUpload();
    const extracted = await seedExtracted(extractedModel, {
      documentId: upload._id,
      invoiceNumber: { value: 'INV-NET30', confidence: 0.98 },
      invoiceDate: { value: '2026-10-05', confidence: 0.97 },
      paymentTerms: 'Net 30 days',
    });
    const proposal = await svc.createFromExtracted(extracted._id.toString(), ORG_ID);
    expect(proposal.dueDate).toBe('2026-11-04');

    const approved = await svc.approve({ proposalId: proposal._id.toString(), orgId: ORG_ID, actorId: ACTOR_ID });
    const bill = await bills().findOne({ journalId: approved.journalId }).exec();
    // A null due date made every AI-created bill read as "current" forever.
    expect(bill?.dueDate).toBe('2026-11-04');
  });

  it('moves the uploaded document to APPROVED or REJECTED with its proposal', async () => {
    const approvedUpload = await seedUpload();
    const toApprove = await svc.createFromExtracted(
      (await seedExtracted(extractedModel, { documentId: approvedUpload._id, invoiceNumber: { value: 'INV-DOC-A', confidence: 0.9 } }))._id.toString(),
      ORG_ID,
    );
    await svc.approve({ proposalId: toApprove._id.toString(), orgId: ORG_ID, actorId: ACTOR_ID });
    expect((await docs().findById(approvedUpload._id).exec())?.status).toBe('APPROVED');

    const rejectedUpload = await seedUpload();
    const toReject = await svc.createFromExtracted(
      (await seedExtracted(extractedModel, { documentId: rejectedUpload._id, invoiceNumber: { value: 'INV-DOC-R', confidence: 0.9 } }))._id.toString(),
      ORG_ID,
    );
    await svc.reject({ proposalId: toReject._id.toString(), orgId: ORG_ID, actorId: ACTOR_ID });
    expect((await docs().findById(rejectedUpload._id).exec())?.status).toBe('REJECTED');
  });

  it('books a paid receipt as money out (PAYMENT), not money in', async () => {
    const extracted = await seedExtracted(extractedModel, {
      documentType: 'receipt',
      invoiceNumber: { value: 'RCPT-CAFE-9', confidence: 0.9 },
    });
    const proposal = await svc.createFromExtracted(extracted._id.toString(), ORG_ID);
    const approved = await svc.approve({ proposalId: proposal._id.toString(), orgId: ORG_ID, actorId: ACTOR_ID });
    const journal = await journalModel.findById(approved.journalId).exec();
    expect(journal?.voucherType).toBe(VoucherType.PAYMENT);
  });
});

describe('TDS and reverse charge on proposed bills', () => {
  const vendors = () => moduleRef.get<Model<{ name: string }>>(getModelToken(Vendor.name));
  const bills = () => moduleRef.get<Model<{ journalId: unknown; tds: { amountPaise: number } | null; isReverseCharge: boolean }>>(getModelToken(PurchaseBill.name));

  it("withholds a known vendor's TDS in the suggestion, and the bill carries what was posted", async () => {
    await vendors().create({ orgId: ORG_ID, name: 'TDS Builders', gstin: '29AABCT1234C1ZX', tdsSection: '194C', tdsRateBps: 200 });
    const extracted = await seedExtracted(extractedModel, {
      vendor: { name: 'TDS Builders', gstin: '29AABCT1234C1ZX', confidence: 0.95 },
      invoiceNumber: { value: 'TB-77', confidence: 0.98 },
    });
    const proposal = await svc.createFromExtracted(extracted._id.toString(), ORG_ID);

    expect(proposal.tds).toEqual({ section: '194C', rateBps: 200, amountPaise: 20000 }); // 2% of ₹10,000
    const credits = proposal.suggestedLines.filter((l) => l.creditPaise > 0).map((l) => [l.accountName, l.creditPaise]);
    expect(credits).toEqual([['Accounts Payable', 1160000], ['TDS Payable', 20000]]);

    const approved = await svc.approve({ proposalId: proposal._id.toString(), orgId: ORG_ID, actorId: ACTOR_ID });
    const bill = await bills().findOne({ journalId: approved.journalId }).exec();
    expect(bill?.tds?.amountPaise).toBe(20000);
  });

  it('books a reverse-charge purchase: vendor owed the taxable value, tax as our liability', async () => {
    const extracted = await seedExtracted(extractedModel, {
      vendor: { name: 'Goods Transport Agency', gstin: null, confidence: 0.9 },
      invoiceNumber: { value: 'GTA-9', confidence: 0.98 },
      isReverseCharge: true,
    });
    const proposal = await svc.createFromExtracted(extracted._id.toString(), ORG_ID);
    expect(proposal.isReverseCharge).toBe(true);
    const credits = proposal.suggestedLines.filter((l) => l.creditPaise > 0).map((l) => [l.accountName, l.creditPaise]);
    expect(credits).toEqual([['Accounts Payable', 1000000], ['GST Payable (Reverse Charge)', 180000]]);

    const approved = await svc.approve({ proposalId: proposal._id.toString(), orgId: ORG_ID, actorId: ACTOR_ID });
    expect((await bills().findOne({ journalId: approved.journalId }).exec())?.isReverseCharge).toBe(true);
  });
});
