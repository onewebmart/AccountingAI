/**
 * Integration tests — bill checks against the books.
 *
 *  ✓ The same vendor's bill number already posted, or waiting in review, is a likely duplicate
 *  ✓ The same amount within a week, under another number, is worth a look
 *  ✓ A GSTIN that is not the vendor's on file, and a large first bill from a new vendor, are flagged
 *  ✓ Another vendor's bill with the same number is not a duplicate; nor is another org's
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { BillStatus, ProposedEntryStatus } from '@ai-accounting/shared';
import configuration from '../../config/configuration';
import { testMongoUri } from '../../test-utils/mongo';
import { BillChecksService, BillToCheck } from './bill-checks.service';
import { PurchaseBill, PurchaseBillSchema } from '../../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../../purchase/schemas/vendor.schema';
import { ProposedEntry, ProposedEntrySchema } from '../schemas/proposed-entry.schema';

const SIGMA_GSTIN = '27AAPFU0939F1ZV';

let moduleRef: TestingModule;
let checks: BillChecksService;
let bills: Model<unknown>;
let vendors: Model<{ _id: Types.ObjectId }>;
let proposals: Model<unknown>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: ProposedEntry.name, schema: ProposedEntrySchema },
      ]),
    ],
    providers: [BillChecksService],
  }).compile();
  checks = moduleRef.get(BillChecksService);
  bills = moduleRef.get(getModelToken(PurchaseBill.name));
  vendors = moduleRef.get(getModelToken(Vendor.name));
  proposals = moduleRef.get(getModelToken(ProposedEntry.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

const amounts = (total: number) => ({ taxableValue: total, cgst: 0, sgst: 0, igst: 0, cess: 0, total });

async function seed() {
  const orgId = new Types.ObjectId().toString();
  const [sigma] = await vendors.create([{ orgId, name: 'Sigma Supplies Pvt Ltd', gstin: SIGMA_GSTIN }]);
  const [other] = await vendors.create([{ orgId, name: 'Other Traders', gstin: null }]);
  await bills.create({ orgId, vendorId: sigma._id, billNumber: 'SS/2026/118', billDate: '2026-10-02', status: BillStatus.POSTED, amountsPaise: amounts(2360000) });
  await bills.create({ orgId, vendorId: other._id, billNumber: 'OT-5', billDate: '2026-10-02', status: BillStatus.POSTED, amountsPaise: amounts(99900) });
  const bill = (over: Partial<BillToCheck>): BillToCheck => ({
    orgId,
    vendorName: 'SIGMA SUPPLIES PRIVATE LIMITED',
    vendorGstin: SIGMA_GSTIN,
    invoiceNumber: 'SS-2026-200',
    invoiceDate: '2026-10-20',
    totalPaise: 100000,
    gstPaise: 0,
    lines: [],
    ...over,
  });
  return { orgId, bill };
}

const codes = (found: Array<{ code: string }>) => found.map((c) => c.code);

describe('bill checks', () => {
  it('finds a bill already in the books under the same vendor and number', async () => {
    const { bill } = await seed();
    const found = await checks.check(bill({ invoiceNumber: 'ss 2026 118' }));
    expect(found).toEqual([
      expect.objectContaining({ code: 'duplicate_number', severity: 'high', message: expect.stringMatching(/SS\/2026\/118 .* already in the books \(2026-10-02, ₹23,600, posted\)/) }),
    ]);
    // Another vendor's OT-5 is someone else's numbering.
    expect(await checks.check(bill({ invoiceNumber: 'OT-5' }))).toEqual([]);
  });

  it('finds one waiting in the review queue, but never the proposal itself', async () => {
    const { orgId, bill } = await seed();
    const [queued] = await proposals.create([
      {
        orgId, status: ProposedEntryStatus.PROPOSED, documentType: 'purchase_invoice', vendorName: 'Sigma Supplies', vendorGstin: SIGMA_GSTIN,
        invoiceNumber: 'SS-2026-300', invoiceDate: '2026-10-18', amountsPaise: amounts(55000), confidenceOverall: 0.9,
        fieldConfidence: { vendor: 1, invoiceNumber: 1, invoiceDate: 1, amounts: 1 }, suggestedLines: [], financialYear: '2026-27',
      },
    ]);
    expect(codes(await checks.check(bill({ invoiceNumber: 'SS-2026-300' })))).toEqual(['duplicate_number']);
    expect(await checks.check(bill({ invoiceNumber: 'SS-2026-300', excludeProposalId: (queued as { _id: Types.ObjectId })._id }))).toEqual([]);
    // The same amount a few days apart, under a new number.
    expect(codes(await checks.check(bill({ invoiceNumber: 'SS-2026-301', totalPaise: 55000 })))).toEqual(['duplicate_amount']);
  });

  it('flags a GSTIN that is not the vendor on file, and a large first bill from a new vendor', async () => {
    const { bill } = await seed();
    const otherGstin = '29AAPFU0939F1ZP';
    expect(codes(await checks.check(bill({ vendorGstin: otherGstin })))).toEqual(['gstin_differs']);
    expect(codes(await checks.check(bill({ vendorName: 'Brand New Vendor', vendorGstin: null, totalPaise: 7500000 })))).toEqual(['new_vendor_large']);
    expect(await checks.check(bill({ vendorName: 'Brand New Vendor', vendorGstin: null, totalPaise: 4999900 }))).toEqual([]);
  });

  it('never looks at another org', async () => {
    const { bill } = await seed();
    const elsewhere = new Types.ObjectId().toString();
    const found = await checks.check({ ...bill({ invoiceNumber: 'SS/2026/118' }), orgId: elsewhere, totalPaise: 100 });
    expect(found).toEqual([]);
  });
});
