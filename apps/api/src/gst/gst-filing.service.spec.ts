/**
 * Integration tests — filing GSTR-1 and GSTR-3B through the (mock) GSP, the
 * GST payment voucher, the review before filing, and GSTR-9.
 *
 *  ✓ GSTR-3B waits for GSTR-1; each needs saving, then an OTP, then filing
 *  ✓ A return that changed since it was saved is not filed; filed is final, with its ARN, audited
 *  ✓ The payment voucher clears output tax against credit used and the cash paid, once, balanced
 *  ✓ The review flags a month far from the usual; GSTR-9 adds the year up
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { BillStatus, InvoiceStatus } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { GstFilingService } from './gst-filing.service';
import { GstReturnsService } from './gst-returns.service';
import { GstFiling, GstFilingSchema } from './schemas/gst-filing.schema';
import { Gstr2bLine, Gstr2bLineSchema } from './schemas/gstr2b-line.schema';
import { GSP_PROVIDER, MOCK_FILING_OTP, MockGsp } from '../einvoice/gsp.provider';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';

const ACTOR = new Types.ObjectId().toString();
let moduleRef: TestingModule;
let filing: GstFilingService;
let invoices: Model<unknown>;
let bills: Model<unknown>;
let customers: Model<{ _id: Types.ObjectId }>;
let vendors: Model<{ _id: Types.ObjectId }>;
let settings: Model<unknown>;
let journals: Model<JournalDocument>;
let audit: Model<{ orgId: string; action: string }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: GstFiling.name, schema: GstFilingSchema },
        { name: Gstr2bLine.name, schema: Gstr2bLineSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: CreditNote.name, schema: CreditNoteSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: DebitNote.name, schema: DebitNoteSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
      ]),
    ],
    providers: [GstFilingService, GstReturnsService, PostingService, AccountsService, AuditService, { provide: GSP_PROVIDER, useValue: new MockGsp() }],
  }).compile();
  filing = moduleRef.get(GstFilingService);
  invoices = moduleRef.get(getModelToken(SalesInvoice.name));
  bills = moduleRef.get(getModelToken(PurchaseBill.name));
  customers = moduleRef.get(getModelToken(Customer.name));
  vendors = moduleRef.get(getModelToken(Vendor.name));
  settings = moduleRef.get(getModelToken(OrgSettings.name));
  journals = moduleRef.get(getModelToken(Journal.name));
  audit = moduleRef.get(getModelToken(AuditLog.name));
  await journals.init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

const tax = (taxableValue: number, cgst: number) => ({ taxableValue, cgst, sgst: cgst, igst: 0, cess: 0, total: taxableValue + 2 * cgst });

async function seed() {
  const orgId = new Types.ObjectId().toString();
  await settings.create({ orgId, gstin: '27AAPFU0939F1ZV', stateCode: '27' });
  const [customer] = await customers.create([{ orgId, name: 'Rao Traders', gstin: '27AAACR5055K1Z7', stateCode: '27' }]);
  const [vendor] = await vendors.create([{ orgId, name: 'Sigma Supplies', gstin: '27AAACS1234A1Z1' }]);
  const sale = (n: string, date: string, taxable = 100000) =>
    invoices.create({ orgId, customerId: customer._id, invoiceNumber: n, invoiceDate: date, status: InvoiceStatus.POSTED, amountsPaise: tax(taxable, taxable * 0.09), lineItems: [{ description: 'Cloth', hsnSac: '5208', qty: 1, ratePaise: taxable, amountPaise: taxable, taxRatePct: 18 }] });
  const bill = (n: string, date: string, taxable = 50000) =>
    bills.create({ orgId, vendorId: vendor._id, billNumber: n, billDate: date, status: BillStatus.POSTED, amountsPaise: tax(taxable, taxable * 0.09) });
  return { orgId, sale, bill };
}

describe('filing returns', () => {
  it('files GSTR-1 then GSTR-3B: saved, OTP, filed; never what changed since saving', async () => {
    const { orgId, sale, bill } = await seed();
    await sale('KT/1', '2026-10-05');
    await bill('SG/1', '2026-10-06');

    await expect(filing.save(orgId, ACTOR, 'GSTR3B', '2026-10')).rejects.toThrow(/File GSTR-1 for the month first/);
    const saved = await filing.save(orgId, ACTOR, 'GSTR1', '2026-10');
    expect(saved.toObject()).toMatchObject({ status: 'saved', isTest: true });
    await expect(filing.file(orgId, ACTOR, 'GSTR1', '2026-10', MOCK_FILING_OTP)).rejects.toThrow(/OTP first/);
    await filing.requestOtp(orgId, ACTOR, 'GSTR1', '2026-10');
    await expect(filing.file(orgId, ACTOR, 'GSTR1', '2026-10', '000000')).rejects.toThrow(/Invalid OTP/);

    // A sale booked after saving: the saved return is no longer the books.
    await sale('KT/2', '2026-10-20');
    await expect(filing.file(orgId, ACTOR, 'GSTR1', '2026-10', MOCK_FILING_OTP)).rejects.toThrow(/changed since the return was saved/);

    await filing.save(orgId, ACTOR, 'GSTR1', '2026-10');
    await filing.requestOtp(orgId, ACTOR, 'GSTR1', '2026-10');
    const filed = await filing.file(orgId, ACTOR, 'GSTR1', '2026-10', MOCK_FILING_OTP);
    expect(filed.arn).toMatch(/^AA271026[0-9A-F]{7}$/);
    await expect(filing.save(orgId, ACTOR, 'GSTR1', '2026-10')).rejects.toThrow(/already filed/);
    expect(await audit.countDocuments({ orgId, action: 'FILE_RETURN' })).toBe(1);

    await filing.save(orgId, ACTOR, 'GSTR3B', '2026-10');
    await filing.requestOtp(orgId, ACTOR, 'GSTR3B', '2026-10');
    expect((await filing.file(orgId, ACTOR, 'GSTR3B', '2026-10', MOCK_FILING_OTP)).status).toBe('filed');
    const status = await filing.status(orgId, '2026-10');
    expect([status.GSTR1?.status, status.GSTR3B?.status]).toEqual(['filed', 'filed']);
    // Another org sees none of it.
    expect((await filing.status(new Types.ObjectId().toString(), '2026-10')).GSTR1).toBeNull();
  });

  it('records the GST payment once: output tax against credit used and the cash paid', async () => {
    const { orgId, sale, bill } = await seed();
    await sale('KT/1', '2026-09-05');
    await bill('SG/1', '2026-09-06');
    await filing.save(orgId, ACTOR, 'GSTR1', '2026-09');
    await filing.requestOtp(orgId, ACTOR, 'GSTR1', '2026-09');
    await filing.file(orgId, ACTOR, 'GSTR1', '2026-09', MOCK_FILING_OTP);
    await filing.save(orgId, ACTOR, 'GSTR3B', '2026-09');

    const journal = await filing.recordPayment(orgId, ACTOR, '2026-09', { paidOn: '2026-10-18', challanNo: 'CPIN123' });
    const by = (re: RegExp) => journal.lines.filter((l) => re.test(l.description)).reduce((s, l) => s + l.debitPaise - l.creditPaise, 0);
    expect(by(/output.*cgst|cgst.*output/i)).toBe(9000);
    expect(by(/input.*cgst|cgst.*input/i)).toBe(-4500);
    expect(by(/bank/i)).toBe(-9000);
    const debits = journal.lines.reduce((s, l) => s + l.debitPaise, 0);
    expect(debits).toBe(journal.lines.reduce((s, l) => s + l.creditPaise, 0));
    expect(journal.narration).toMatch(/challan CPIN123/);
    await expect(filing.recordPayment(orgId, ACTOR, '2026-09', {})).rejects.toThrow(/already recorded/);
  });
});

describe('before filing, and the year', () => {
  it('flags a month far from the usual', async () => {
    const { orgId, sale } = await seed();
    for (const m of ['2026-04', '2026-05', '2026-06']) await sale(`KT/${m}`, `${m}-10`, 100000);
    await sale('KT/BIG', '2026-07-10', 400000);
    const flags = await filing.review(orgId, 'GSTR3B', '2026-07');
    expect(flags.map((f) => f.message).join(' ')).toMatch(/Taxable sales is ₹4,000, 300% above your average of ₹1,000/);
  });

  it('adds the year up into GSTR-9', async () => {
    const { orgId, sale, bill } = await seed();
    await sale('KT/A', '2026-04-10');
    await sale('KT/B', '2027-03-10');
    await bill('SG/A', '2026-05-10');
    const r = await filing.gstr9(orgId, '2026-27');
    expect(r.months).toBe(12);
    expect(r.table4.b2b).toMatchObject({ txval: 200000, camt: 18000 });
    expect(r.table6.other.camt).toBe(4500);
    expect(r.table17).toEqual([expect.objectContaining({ hsn: '5208', txval: 200000 })]);
    await expect(filing.gstr9(orgId, '2026')).rejects.toThrow(/2025-26/);
  });
});
