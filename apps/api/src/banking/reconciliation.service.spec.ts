/**
 * Integration tests — ReconciliationService.
 *
 * Done when:
 *  ✓ Import flags possible duplicates, within a statement and across overlapping ones
 *  ✓ autoMatch pairs bank lines with receipts / payments (same amount, ±3 days) — never sales or purchase journals
 *  ✓ autoMatch never reuses a voucher, invoice or bill another line already holds, across runs
 *  ✓ A bank credit matched to an open invoice settles it on confirm: receipt dated the bank date, invoice PAID
 *  ✓ A bank debit matched to an open bill settles it the same way
 *  ✓ Ambiguous candidates are left for a person unless the narration names one
 *  ✓ One line that cannot be confirmed does not stop the others
 *  ✓ Manual match enforces direction, full amount and one-line-per-target
 *  ✓ The report's GL balance counts only movement that is in the books
 *
 * All against a real replica set — settlement posts inside transactions.
 */
import 'reflect-metadata';
import mongoose, { Types, Model } from 'mongoose';
import { testMongoUri } from '../test-utils/mongo';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import configuration from '../config/configuration';
import { ReconciliationService } from './reconciliation.service';
import { BankAccount, BankAccountSchema } from './schemas/bank-account.schema';
import { BankStatement, BankStatementSchema } from './schemas/bank-statement.schema';
import { BankStatementLine, BankStatementLineSchema, BankStatementLineDocument } from './schemas/bank-statement-line.schema';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { SalesInvoice, SalesInvoiceSchema, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { PurchaseBill, PurchaseBillSchema, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { CustomersService } from '../sales/customers.service';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { VendorsService } from '../purchase/vendors.service';
import { BillStatus, InvoiceStatus, MatchStatus, VoucherType } from '@ai-accounting/shared';

const ACTOR_ID = new Types.ObjectId().toString();

let moduleRef: TestingModule;
let svc: ReconciliationService;
let postingSvc: PostingService;
let invoicesSvc: SalesInvoicesService;
let customersSvc: CustomersService;
let billsSvc: PurchaseBillsService;
let vendorsSvc: VendorsService;
let lineModel: Model<BankStatementLineDocument>;
let journalModel: Model<JournalDocument>;
let invoiceModel: Model<SalesInvoiceDocument>;
let billModel: Model<PurchaseBillDocument>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: BankAccount.name, schema: BankAccountSchema },
        { name: BankStatement.name, schema: BankStatementSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: ProposedEntry.name, schema: ProposedEntrySchema },
      ]),
    ],
    providers: [
      ReconciliationService,
      PostingService,
      AccountsService,
      AuditService,
      SalesInvoicesService,
      CustomersService,
      PurchaseBillsService,
      VendorsService,
    ],
  }).compile();

  svc = moduleRef.get(ReconciliationService);
  postingSvc = moduleRef.get(PostingService);
  invoicesSvc = moduleRef.get(SalesInvoicesService);
  customersSvc = moduleRef.get(CustomersService);
  billsSvc = moduleRef.get(PurchaseBillsService);
  vendorsSvc = moduleRef.get(VendorsService);
  lineModel = moduleRef.get(getModelToken(BankStatementLine.name));
  journalModel = moduleRef.get(getModelToken(Journal.name));
  invoiceModel = moduleRef.get(getModelToken(SalesInvoice.name));
  billModel = moduleRef.get(getModelToken(PurchaseBill.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

// ── Helpers ───────────────────────────────────────────────────────────────

/** A fresh organisation per test, so no test can match another's vouchers. */
const newOrg = () => new Types.ObjectId().toString();

async function seedAccount(orgId: string) {
  return svc.createAccount({ orgId, actorId: ACTOR_ID, name: 'HDFC Current', bankName: 'HDFC', openingBalancePaise: 0 });
}

type Line = { date: string; description: string; debitPaise?: number; creditPaise?: number };

async function importLines(orgId: string, lines: Line[], opening = 0) {
  const account = await seedAccount(orgId);
  return importInto(orgId, account._id.toString(), lines, opening);
}

async function importInto(orgId: string, bankAccountId: string, lines: Line[], opening = 0) {
  const normalized = lines.map((l) => ({ debitPaise: 0, creditPaise: 0, ...l }));
  const closing = opening + normalized.reduce((s, l) => s + l.creditPaise - l.debitPaise, 0);
  const dates = normalized.map((l) => l.date).sort();
  return svc.importStatement({
    orgId,
    actorId: ACTOR_ID,
    bankAccountId,
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
    openingBalancePaise: opening,
    closingBalancePaise: closing,
    lines: normalized,
  });
}

async function postVoucher(orgId: string, type: VoucherType, amountPaise: number, date: string) {
  return postingSvc.post({
    orgId,
    voucherType: type,
    financialYear: '2026-27',
    date,
    narration: `${type} ${amountPaise}`,
    postedBy: ACTOR_ID,
    lines: [
      { accountId: new Types.ObjectId().toString(), description: 'Dr', debitPaise: amountPaise, creditPaise: 0 },
      { accountId: new Types.ObjectId().toString(), description: 'Cr', debitPaise: 0, creditPaise: amountPaise },
    ],
  });
}

const tenThousand = { taxableValue: 847458, cgst: 76271, sgst: 76271, igst: 0, cess: 0, total: 1000000 };

async function postedInvoice(orgId: string, invoiceNumber: string, invoiceDate = '2026-10-08') {
  const customer = await customersSvc.create({ orgId, name: `Customer ${invoiceNumber}` });
  const invoice = await invoicesSvc.create({
    orgId, customerId: customer._id.toString(), invoiceNumber, invoiceDate, amountsPaise: tenThousand,
  });
  return invoicesSvc.post(invoice._id.toString(), orgId, ACTOR_ID);
}

async function postedBill(orgId: string, billNumber: string, billDate = '2026-10-05') {
  const vendor = await vendorsSvc.create({ orgId, name: `Vendor ${billNumber}` });
  const bill = await billsSvc.create({ orgId, vendorId: vendor._id.toString(), billNumber, billDate, amountsPaise: tenThousand });
  return billsSvc.post(bill._id.toString(), orgId, ACTOR_ID);
}

const linesOf = (statementId: unknown) => lineModel.find({ statementId }).sort({ date: 1, _id: 1 }).exec();

// ── Import ────────────────────────────────────────────────────────────────

describe('Statement import', () => {
  it('stores lines unmatched and flags a repeated line as a possible duplicate', async () => {
    const orgId = newOrg();
    const statement = await importLines(orgId, [
      { date: '2026-10-10', description: 'NEFT CR SHARMA TEXTILES', creditPaise: 1000000 },
      { date: '2026-10-10', description: 'NEFT CR  sharma textiles', creditPaise: 1000000 },
      { date: '2026-10-11', description: 'UPI/9988776655', debitPaise: 499900 },
    ]);

    const lines = await linesOf(statement._id);
    expect(lines.every((l) => l.matchStatus === MatchStatus.UNMATCHED)).toBe(true);
    expect(lines.map((l) => l.possibleDuplicate)).toEqual([false, true, false]);
  });

  it('flags lines already imported from an overlapping statement', async () => {
    const orgId = newOrg();
    const account = await seedAccount(orgId);
    await importInto(orgId, account._id.toString(), [{ date: '2026-10-10', description: 'NEFT CR A', creditPaise: 500000 }]);
    const second = await importInto(orgId, account._id.toString(), [
      { date: '2026-10-10', description: 'NEFT CR A', creditPaise: 500000 },
      { date: '2026-10-12', description: 'NEFT CR B', creditPaise: 700000 },
    ]);

    expect((await linesOf(second._id)).map((l) => l.possibleDuplicate)).toEqual([true, false]);
  });
});

// ── Auto-match against vouchers already in the books ─────────────────────────

describe('autoMatch — receipts and payments already posted', () => {
  it('pairs money out with a PAYMENT and money in with a RECEIPT, within 3 days', async () => {
    const orgId = newOrg();
    const payment = await postVoucher(orgId, VoucherType.PAYMENT, 200000, '2026-10-06');
    const receipt = await postVoucher(orgId, VoucherType.RECEIPT, 300000, '2026-10-09');
    await postVoucher(orgId, VoucherType.RECEIPT, 400000, '2026-10-01'); // 9 days early — out of window

    const statement = await importLines(orgId, [
      { date: '2026-10-05', description: 'NEFT OUT', debitPaise: 200000 },
      { date: '2026-10-10', description: 'NEFT IN', creditPaise: 300000 },
      { date: '2026-10-10', description: 'NEFT IN 2', creditPaise: 400000 },
    ]);
    const result = await svc.autoMatch(statement._id.toString(), orgId);

    expect(result).toEqual({ matched: 2, unmatched: 1 });
    const lines = await linesOf(statement._id);
    expect(String(lines[0].matchedJournalId)).toBe(String(payment._id));
    expect(String(lines[1].matchedJournalId)).toBe(String(receipt._id));
    expect(lines[2].matchStatus).toBe(MatchStatus.UNMATCHED);
  });

  it('never pairs a bank line with a sales or purchase journal, which does not touch the bank', async () => {
    const orgId = newOrg();
    await postVoucher(orgId, VoucherType.SALES, 1000000, '2026-10-08');
    const statement = await importLines(orgId, [{ date: '2026-10-10', description: 'NEFT CR', creditPaise: 1000000 }]);

    expect(await svc.autoMatch(statement._id.toString(), orgId)).toEqual({ matched: 0, unmatched: 1 });
  });

  it('does not hand a voucher already matched in an earlier run to another line', async () => {
    // Found end to end: a second, identical deposit was paired with the same
    // sale the first one had taken, hiding the duplicate.
    const orgId = newOrg();
    const account = await seedAccount(orgId);
    await postVoucher(orgId, VoucherType.RECEIPT, 1000000, '2026-10-10');

    const first = await importInto(orgId, account._id.toString(), [{ date: '2026-10-10', description: 'NEFT CR X', creditPaise: 1000000 }]);
    expect((await svc.autoMatch(first._id.toString(), orgId)).matched).toBe(1);

    const second = await importInto(orgId, account._id.toString(), [{ date: '2026-10-11', description: 'NEFT CR Y', creditPaise: 1000000 }]);
    expect((await svc.autoMatch(second._id.toString(), orgId)).matched).toBe(0);
  });

  it('leaves possible duplicates for a person to decide', async () => {
    const orgId = newOrg();
    await postVoucher(orgId, VoucherType.RECEIPT, 1000000, '2026-10-10');
    await postVoucher(orgId, VoucherType.RECEIPT, 1000000, '2026-10-10');
    const statement = await importLines(orgId, [
      { date: '2026-10-10', description: 'NEFT CR', creditPaise: 1000000 },
      { date: '2026-10-10', description: 'NEFT CR', creditPaise: 1000000 },
    ]);
    expect(await svc.autoMatch(statement._id.toString(), orgId)).toEqual({ matched: 1, unmatched: 0 });
    const lines = await linesOf(statement._id);
    expect(lines[1].possibleDuplicate).toBe(true);
    expect(lines[1].matchStatus).toBe(MatchStatus.UNMATCHED);
  });
});

// ── Settling invoices and bills ───────────────────────────────────────────

describe('settling an open invoice or bill from the bank', () => {
  it('a ₹10,000 deposit settles the invoice: receipt on the bank date, AR cleared, invoice paid', async () => {
    const orgId = newOrg();
    const invoice = await postedInvoice(orgId, 'KT/26-27/001');
    const statement = await importLines(orgId, [
      { date: '2026-10-10', description: 'NEFT CR SHARMA TEXTILES KT/26-27/001', creditPaise: 1000000 },
    ]);

    await svc.autoMatch(statement._id.toString(), orgId);
    let [line] = await linesOf(statement._id);
    expect(line.matchStatus).toBe(MatchStatus.AUTO_MATCHED);
    expect(String(line.matchedInvoiceId)).toBe(String(invoice._id));
    // Suggesting posts nothing.
    expect(await journalModel.countDocuments({ orgId, voucherType: VoucherType.RECEIPT })).toBe(0);

    const result = await svc.confirmMatches(statement._id.toString(), orgId, ACTOR_ID);
    expect(result).toEqual({ confirmed: 1, failed: [] });

    [line] = await linesOf(statement._id);
    const receipt = await journalModel.findById(line.matchedJournalId).exec();
    expect(line.matchStatus).toBe(MatchStatus.CONFIRMED);
    expect(receipt?.voucherType).toBe(VoucherType.RECEIPT);
    expect(receipt?.date).toBe('2026-10-10');
    expect(receipt?.financialYear).toBe('2026-27');
    expect((await invoiceModel.findById(invoice._id).exec())?.status).toBe(InvoiceStatus.PAID);

    // Accounts Receivable: +₹10,000 on the sale, −₹10,000 on the receipt.
    const posted = await journalModel.find({ orgId }).exec();
    const ar = posted.flatMap((j) => j.lines).filter((l) => /receivable/i.test(l.description));
    expect(ar.reduce((s, l) => s + l.debitPaise - l.creditPaise, 0)).toBe(0);

    const report = await svc.getDiffReport(statement._id.toString(), orgId);
    expect(report.glBalancePaise).toBe(1000000);
    expect(report.isReconciled).toBe(true);
    expect(report.lines[0].matchLabel).toMatch(/^RCT\/2026-27\//);
  });

  it('a payment out settles the matching bill', async () => {
    const orgId = newOrg();
    const bill = await postedBill(orgId, 'STS/0442');
    const statement = await importLines(orgId, [{ date: '2026-10-12', description: 'NEFT DR STERLING', debitPaise: 1000000 }]);

    await svc.autoMatch(statement._id.toString(), orgId);
    expect(await svc.confirmMatches(statement._id.toString(), orgId, ACTOR_ID)).toEqual({ confirmed: 1, failed: [] });

    const [line] = await linesOf(statement._id);
    const payment = await journalModel.findById(line.matchedJournalId).exec();
    expect(payment?.voucherType).toBe(VoucherType.PAYMENT);
    expect(payment?.date).toBe('2026-10-12');
    expect((await billModel.findById(bill._id).exec())?.status).toBe(BillStatus.PAID);
  });

  it('with two open invoices for the same amount, matches only the one the narration names', async () => {
    const orgId = newOrg();
    await postedInvoice(orgId, 'INV-1001');
    const named = await postedInvoice(orgId, 'INV-1002');
    const statement = await importLines(orgId, [
      { date: '2026-10-10', description: 'NEFT CR AGAINST INV-1002', creditPaise: 1000000 },
      { date: '2026-10-11', description: 'NEFT CR NO REFERENCE', creditPaise: 1000000 },
    ]);

    await svc.autoMatch(statement._id.toString(), orgId);
    const [withRef, without] = await linesOf(statement._id);
    expect(String(withRef.matchedInvoiceId)).toBe(String(named._id));
    // One candidate is left after the named one is taken, so it is matched too.
    expect(without.matchStatus).toBe(MatchStatus.AUTO_MATCHED);
  });

  it('leaves a line alone when several invoices fit and none is named', async () => {
    const orgId = newOrg();
    await postedInvoice(orgId, 'INV-2001');
    await postedInvoice(orgId, 'INV-2002');
    const statement = await importLines(orgId, [{ date: '2026-10-10', description: 'NEFT CR', creditPaise: 1000000 }]);

    expect(await svc.autoMatch(statement._id.toString(), orgId)).toEqual({ matched: 0, unmatched: 1 });
  });

  it('reports a line it cannot confirm and confirms the rest', async () => {
    const orgId = newOrg();
    const paidByHand = await postedInvoice(orgId, 'INV-3001');
    await postedBill(orgId, 'BILL-3001');
    const statement = await importLines(orgId, [
      { date: '2026-10-10', description: 'NEFT CR INV-3001', creditPaise: 1000000 },
      { date: '2026-10-12', description: 'NEFT DR BILL-3001', debitPaise: 1000000 },
    ]);
    await svc.autoMatch(statement._id.toString(), orgId);

    // Someone clicks "mark paid" on the invoice before the bank match is confirmed.
    await invoicesSvc.markPaid(paidByHand._id.toString(), orgId, ACTOR_ID);

    const result = await svc.confirmMatches(statement._id.toString(), orgId, ACTOR_ID);
    expect(result.confirmed).toBe(1);
    expect(result.failed).toEqual([{ lineId: expect.any(String), reason: expect.stringMatching(/already been marked paid/) }]);
    // Exactly one receipt — the hand-recorded one; no second receipt from the bank.
    expect(await journalModel.countDocuments({ orgId, voucherType: VoucherType.RECEIPT })).toBe(1);
  });
});

// ── Manual decisions ─────────────────────────────────────────────────────────

describe('manual matching', () => {
  it('matches a deposit to an invoice by hand, and confirm settles it', async () => {
    const orgId = newOrg();
    await postedInvoice(orgId, 'INV-4001');
    const target = await postedInvoice(orgId, 'INV-4002');
    const statement = await importLines(orgId, [{ date: '2026-10-10', description: 'CASH DEPOSIT', creditPaise: 1000000 }]);
    const [line] = await linesOf(statement._id);

    const matched = await svc.manualMatch(line._id.toString(), { invoiceId: target._id.toString() }, orgId, ACTOR_ID);
    expect(matched.matchStatus).toBe(MatchStatus.MANUALLY_MATCHED);
    expect((await svc.confirmMatches(statement._id.toString(), orgId, ACTOR_ID)).confirmed).toBe(1);
    expect((await invoiceModel.findById(target._id).exec())?.status).toBe(InvoiceStatus.PAID);
  });

  it('settles one invoice from two part payments, and refuses more than is owed', async () => {
    const orgId = newOrg();
    const invoice = await postedInvoice(orgId, 'INV-5001');
    const statement = await importLines(orgId, [
      { date: '2026-10-10', description: 'PART PAYMENT 1', creditPaise: 400000 },
      { date: '2026-10-10', description: 'REFUND OUT', debitPaise: 1000000 },
      { date: '2026-10-11', description: 'PART PAYMENT 2', creditPaise: 600000 },
      { date: '2026-10-12', description: 'ONE TOO MANY', creditPaise: 100000 },
    ]);
    const [first, out, second, extra] = await linesOf(statement._id);
    const target = { invoiceId: invoice._id.toString() };

    await expect(svc.manualMatch(out._id.toString(), target, orgId, ACTOR_ID)).rejects.toThrow(/Only money coming in/);
    await svc.manualMatch(first._id.toString(), target, orgId, ACTOR_ID);
    await svc.manualMatch(second._id.toString(), target, orgId, ACTOR_ID);
    // ₹4,000 + ₹6,000 are already matched to it, so nothing is left for a third line.
    await expect(svc.manualMatch(extra._id.toString(), target, orgId, ACTOR_ID)).rejects.toThrow(
      /has ₹0\.00 left to settle \(₹10,000\.00 is already matched/,
    );

    expect(await svc.confirmMatches(statement._id.toString(), orgId, ACTOR_ID)).toEqual({ confirmed: 2, failed: [] });
    const stored = await invoiceModel.findById(invoice._id).exec();
    expect(stored?.status).toBe(InvoiceStatus.PAID);
    expect(stored?.payments.map((p) => [p.amountPaise, p.paidOn])).toEqual([
      [400000, '2026-10-10'],
      [600000, '2026-10-11'],
    ]);
  });

  it('auto-matches against what is still owed, not the invoice total', async () => {
    const orgId = newOrg();
    const invoice = await postedInvoice(orgId, 'INV-5002');
    await invoicesSvc.markPaid(invoice._id.toString(), orgId, ACTOR_ID, '2026-10-09', 300000);
    const statement = await importLines(orgId, [
      { date: '2026-10-12', description: 'NEFT CR INV-5002 balance', creditPaise: 700000 },
    ]);

    await svc.autoMatch(statement._id.toString(), orgId);
    const [line] = await linesOf(statement._id);
    expect(String(line.matchedInvoiceId)).toBe(String(invoice._id));
  });

  it('can unmatch, exclude, and clear a duplicate flag — but not undo a confirmed line', async () => {
    const orgId = newOrg();
    await postVoucher(orgId, VoucherType.RECEIPT, 1000000, '2026-10-10');
    const statement = await importLines(orgId, [
      { date: '2026-10-10', description: 'NEFT CR', creditPaise: 1000000 },
      { date: '2026-10-10', description: 'NEFT CR', creditPaise: 1000000 },
    ]);
    await svc.autoMatch(statement._id.toString(), orgId);
    const [matched, dup] = await linesOf(statement._id);

    expect((await svc.unmatch(matched._id.toString(), orgId, ACTOR_ID)).matchStatus).toBe(MatchStatus.UNMATCHED);
    expect((await svc.clearDuplicateFlag(dup._id.toString(), orgId, ACTOR_ID)).possibleDuplicate).toBe(false);
    expect((await svc.setExcluded(dup._id.toString(), true, orgId, ACTOR_ID)).excluded).toBe(true);

    await svc.autoMatch(statement._id.toString(), orgId);
    await svc.confirmMatches(statement._id.toString(), orgId, ACTOR_ID);
    await expect(svc.unmatch(matched._id.toString(), orgId, ACTOR_ID)).rejects.toThrow(/confirmed/);
  });
});

// ── Report ───────────────────────────────────────────────────────────────────

describe('getDiffReport', () => {
  it('counts only movement in the books, and shows the rest as the difference', async () => {
    const orgId = newOrg();
    await postVoucher(orgId, VoucherType.RECEIPT, 300000, '2026-10-05');
    await postedInvoice(orgId, 'INV-6001');
    const statement = await importLines(
      orgId,
      [
        { date: '2026-10-05', description: 'NEFT IN', creditPaise: 300000 }, // matches the receipt — in the books
        { date: '2026-10-10', description: 'NEFT CR INV-6001', creditPaise: 1000000 }, // invoice — pending until confirmed
        { date: '2026-10-11', description: 'UPI/unknown', debitPaise: 499900 }, // nothing records it
      ],
      5000000,
    );
    await svc.autoMatch(statement._id.toString(), orgId);

    let report = await svc.getDiffReport(statement._id.toString(), orgId);
    expect(report.glBalancePaise).toBe(5000000 + 300000);
    expect(report.differencePaise).toBe(1000000 - 499900);
    expect(report.unmatchedLines).toBe(1);
    expect(report.pendingSettlements).toBe(1);
    expect(report.isReconciled).toBe(false);

    await svc.confirmMatches(statement._id.toString(), orgId, ACTOR_ID);
    report = await svc.getDiffReport(statement._id.toString(), orgId);
    // Only the unknown ₹4,999 debit is left: the books do not have it.
    expect(report.differencePaise).toBe(-499900);
    expect(report.pendingSettlements).toBe(0);
    expect(report.isReconciled).toBe(false);
  });
});
