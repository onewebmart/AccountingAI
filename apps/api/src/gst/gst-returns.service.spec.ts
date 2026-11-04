/**
 * Integration tests — GstReturnsService loads the right month.
 *
 *  ✓ Only posted and paid documents dated in the month count; drafts are noted
 *  ✓ A credit note on last month's invoice files this month, in its invoice's table
 *  ✓ Reversed notes drop out
 *  ✓ GSTR-3B takes credit from bills, net of debit notes, and reverse charge apart
 *  ✓ No GSTIN in Settings blocks the return
 *  ✓ Another org's documents never appear
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { BillStatus, InvoiceStatus } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { Gstr2bLine, Gstr2bLineSchema } from './schemas/gstr2b-line.schema';
import { GstReturnsService } from './gst-returns.service';
import { gstr3bPortalJson } from './gst-returns';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';

let moduleRef: TestingModule;
let returns: GstReturnsService;
let invoices: Model<unknown>;
let customers: Model<unknown>;
let creditNotes: Model<unknown>;
let bills: Model<unknown>;
let vendors: Model<unknown>;
let debitNotes: Model<unknown>;
let settings: Model<unknown>;

let gstr2b: Model<Gstr2bLine>;
beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: CreditNote.name, schema: CreditNoteSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: DebitNote.name, schema: DebitNoteSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
        { name: Gstr2bLine.name, schema: Gstr2bLineSchema },
      ]),
    ],
    providers: [GstReturnsService],
  }).compile();

  returns = moduleRef.get(GstReturnsService);
  invoices = moduleRef.get(getModelToken(SalesInvoice.name));
  customers = moduleRef.get(getModelToken(Customer.name));
  creditNotes = moduleRef.get(getModelToken(CreditNote.name));
  bills = moduleRef.get(getModelToken(PurchaseBill.name));
  vendors = moduleRef.get(getModelToken(Vendor.name));
  debitNotes = moduleRef.get(getModelToken(DebitNote.name));
  settings = moduleRef.get(getModelToken(OrgSettings.name));
  gstr2b = moduleRef.get(getModelToken(Gstr2bLine.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

const tax = (taxableValue: number, t: { cgst?: number; sgst?: number; igst?: number } = {}) => {
  const cgst = t.cgst ?? 0;
  const sgst = t.sgst ?? 0;
  const igst = t.igst ?? 0;
  return { taxableValue, cgst, sgst, igst, cess: 0, total: taxableValue + cgst + sgst + igst };
};

/** An org registered in Maharashtra, with one registered customer and one vendor. */
async function seedOrg(gstin: string | null = '27AAPFU0939F1ZV') {
  const orgId = new Types.ObjectId().toString();
  await settings.create({ orgId, gstin, stateCode: '27' });
  const [customer] = await customers.create([{ orgId, name: 'Rao Traders', gstin: '27AAACR5055K1Z5', stateCode: '27' }]);
  const [vendor] = await vendors.create([{ orgId, name: 'Sigma Supplies', gstin: '27AAACS1234A1Z1' }]);
  const invoice = (number: string, date: string, status: InvoiceStatus, amounts = tax(100000, { cgst: 9000, sgst: 9000 })) =>
    invoices.create({ orgId, customerId: customer._id, invoiceNumber: number, invoiceDate: date, status, amountsPaise: amounts });
  const bill = (number: string, date: string, amounts: ReturnType<typeof tax>, isReverseCharge = false) =>
    bills.create({ orgId, vendorId: vendor._id, billNumber: number, billDate: date, status: BillStatus.POSTED, amountsPaise: amounts, isReverseCharge });
  return { orgId, customer, vendor, invoice, bill };
}

describe('GSTR-1', () => {
  it('counts posted and paid documents dated in the month, and notes the drafts', async () => {
    const { orgId, invoice } = await seedOrg();
    await invoice('INV-1', '2026-09-03', InvoiceStatus.POSTED);
    await invoice('INV-2', '2026-09-30', InvoiceStatus.PAID);
    await invoice('INV-3', '2026-09-15', InvoiceStatus.DRAFT);
    await invoice('INV-0', '2026-08-31', InvoiceStatus.POSTED);
    await invoice('INV-4', '2026-10-01', InvoiceStatus.POSTED);

    const r = await returns.gstr1(orgId, '2026-09');
    expect(r.gstin).toBe('27AAPFU0939F1ZV');
    expect(r.b2b.flatMap((p) => p.invoices.map((i) => i.number))).toEqual(['INV-1', 'INV-2']);
    expect(r.issues.map((i) => i.message)).toContain('1 invoice is dated this month but not posted, so left out.');
    expect(r.issues.some((i) => i.level === 'block')).toBe(false);
  });

  it("files a note on last month's invoice this month, and drops a reversed one", async () => {
    const { orgId, customer, invoice } = await seedOrg();
    const old = await invoice('INV-8', '2026-08-20', InvoiceStatus.POSTED);
    const note = (noteNumber: string, status: 'posted' | 'reversed') =>
      creditNotes.create({
        orgId, invoiceId: old._id, customerId: customer._id, noteNumber, noteDate: '2026-09-05', financialYear: '2026-27',
        reason: 'Rate difference', amountsPaise: tax(10000, { cgst: 900, sgst: 900 }), journalId: new Types.ObjectId(),
        status, createdBy: 'tester',
      });
    await note('CRN/2026-27/0001', 'posted');
    await note('CRN/2026-27/0002', 'reversed');

    const r = await returns.gstr1(orgId, '2026-09');
    expect(r.b2b).toHaveLength(0);
    expect(r.cdnr.map((p) => [p.ctin, p.notes.map((n) => [n.number, n.items[0].camt])])).toEqual([
      ['27AAACR5055K1Z5', [['CRN/2026-27/0001', 900]]],
    ]);
  });

  it('is blocked until the GSTIN is in Settings', async () => {
    const { orgId } = await seedOrg(null);
    const r = await returns.gstr1(orgId, '2026-09');
    expect(r.issues.filter((i) => i.level === 'block').map((i) => i.message)).toEqual([
      'Add your GSTIN in Settings — the return is filed against it.',
    ]);
  });

  it('refuses a malformed period', async () => {
    const { orgId } = await seedOrg();
    await expect(returns.gstr1(orgId, '2026-13')).rejects.toThrow(/month like 2026-09/);
  });

  it("never shows another org's documents", async () => {
    const a = await seedOrg();
    const b = await seedOrg();
    await b.invoice('B-1', '2026-09-10', InvoiceStatus.POSTED);
    const r = await returns.gstr1(a.orgId, '2026-09');
    expect(r.b2b).toHaveLength(0);
    expect(r.docs).toHaveLength(0);
  });
});

describe('GSTR-3B', () => {
  it('takes credit from the bills, net of debit notes, with reverse charge apart', async () => {
    const { orgId, vendor, invoice, bill } = await seedOrg();
    await invoice('INV-1', '2026-09-03', InvoiceStatus.POSTED);
    const goods = await bill('PB-1', '2026-09-04', tax(50000, { cgst: 4500, sgst: 4500 }));
    await bill('PB-2', '2026-09-06', tax(20000, { cgst: 1800, sgst: 1800 }), true);
    await bill('PB-3', '2026-08-28', tax(70000, { cgst: 6300, sgst: 6300 }));
    await debitNotes.create({
      orgId, billId: goods._id, vendorId: vendor._id, noteNumber: 'DBN/2026-27/0001', noteDate: '2026-09-12',
      financialYear: '2026-27', reason: 'Short supply', amountsPaise: tax(10000, { cgst: 900, sgst: 900 }),
      journalId: new Types.ObjectId(), createdBy: 'tester',
    });

    const r = await returns.gstr3b(orgId, '2026-09');
    expect(r.outwardTaxable).toEqual({ txval: 100000, iamt: 0, camt: 9000, samt: 9000, csamt: 0 });
    expect(r.inwardReverseCharge).toEqual({ txval: 20000, iamt: 0, camt: 1800, samt: 1800, csamt: 0 });
    expect(r.itcReverseCharge.camt).toBe(1800);
    expect(r.itcOther.camt).toBe(3600);
    expect(r.itcNet.camt).toBe(5400);
    // CGST: 9,000 due − 5,400 credit + 1,800 reverse charge in cash.
    expect(r.setOff.rows.find((row) => row.head === 'cgst')?.cashPaise).toBe(5400);
    expect(r.setOff.cashTotalPaise).toBe(10800);

    const json = gstr3bPortalJson(r) as { ret_period: string; sup_details: { isup_rev: { camt: number } } };
    expect(json.ret_period).toBe('092026');
    expect(json.sup_details.isup_rev.camt).toBe(18);
  });

  it('claims only what the 2B carries, and reverses credit on bills unpaid after 180 days', async () => {
    const { orgId, bill } = await seedOrg();
    const gstin = '27AAACS1234A1Z1';
    const line = (period: string, invoiceNumber: string, amounts: ReturnType<typeof tax>) =>
      gstr2b.create({
        orgId, period, supplierGstin: gstin, supplierName: 'Sigma Supplies', invoiceNumber, invoiceDate: `${period}-05`,
        taxableValuePaise: amounts.taxableValue, cgstPaise: amounts.cgst, sgstPaise: amounts.sgst, igstPaise: 0, cessPaise: 0, itcEligiblePaise: amounts.cgst + amounts.sgst,
      });
    // October: two bills, the vendor reports one, typed differently.
    await bill('SG/0041', '2026-10-04', tax(50000, { cgst: 4500, sgst: 4500 }));
    await bill('SG/42', '2026-10-09', tax(20000, { cgst: 1800, sgst: 1800 }));
    await line('2026-10', 'sg-41', tax(50000, { cgst: 4500, sgst: 4500 }));
    // An April bill, claimed in April's 2B and still unpaid: 180 days end on 7 October, reversed in November.
    await bill('SG/7', '2026-04-10', tax(100000, { cgst: 9000, sgst: 9000 }));
    await line('2026-04', 'SG/7', tax(100000, { cgst: 9000, sgst: 9000 }));

    const oct = await returns.gstr3b(orgId, '2026-10');
    expect(oct.itcBasis).toBe('twoB');
    expect(oct.itcOther.camt).toBe(4500);
    expect(oct.issues.map((i) => i.message).join(' ')).toMatch(/1 bill is not in your 2B for 2026-10/);

    // November: SG/42 reported late is claimed now; SG/7's credit is reversed.
    await line('2026-11', 'SG/42', tax(20000, { cgst: 1800, sgst: 1800 }));
    const nov = await returns.gstr3b(orgId, '2026-11');
    expect(nov.itcOther.camt).toBe(1800);
    expect(nov.itcReversed.camt).toBe(9000);
    expect(nov.itcNet.camt).toBe(1800 - 9000);
    const json = gstr3bPortalJson(nov) as { itc_elg: { itc_rev: Array<{ ty: string; camt: number }> } };
    expect(json.itc_elg.itc_rev.find((r) => r.ty === 'OTH')?.camt).toBe(90);

    const explained = await returns.explain2b(orgId, '2026-10');
    expect(explained.items.map((e) => e.kind).sort()).toEqual(['not_in_2b', 'number_typed_differently']);
    const watch = await returns.rule37Watchlist(orgId, '2026-10-01');
    expect(watch.map((w) => [w.number, w.daysLeft])).toEqual([['SG/7', 6]]);
  });
});
