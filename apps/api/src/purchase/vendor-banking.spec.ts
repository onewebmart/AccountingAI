/**
 * Tests — vendor bank details and the 43B(h) pay-by date.
 *
 *  ✓ Micro and small vendors: 15 days without a written agreement; the agreed day up to 45 with one
 *  ✓ Medium enterprises and traders are outside it
 *  ✓ Bank details and Udyam numbers are checked, kept, and audited with what they replaced
 *  ✓ The bill list shows the pay-by day, and flags it once it has passed unpaid
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { BillStatus } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { msmePayBy, VendorMsme } from './msme';
import { VendorsService } from './vendors.service';
import { PurchaseBillsService } from './purchase-bills.service';
import { AuditService } from '../gl/audit.service';
import { AccountsService } from '../gl/accounts.service';
import { PostingService } from '../gl/posting.service';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { PurchaseBill, PurchaseBillSchema } from './schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from './schemas/vendor.schema';

const ACTOR = new Types.ObjectId().toString();
const micro = (over: Partial<VendorMsme> = {}): VendorMsme => ({ udyamNumber: 'UDYAM-MH-26-0012345', category: 'micro', activity: 'manufacturing', writtenAgreement: false, ...over });

describe('msmePayBy', () => {
  it('gives 15 days, or the agreed day up to 45', () => {
    expect(msmePayBy('2026-10-01', '2026-11-30', micro())).toBe('2026-10-16');
    expect(msmePayBy('2026-10-01', '2026-10-20', micro({ writtenAgreement: true }))).toBe('2026-10-20');
    expect(msmePayBy('2026-10-01', '2026-12-31', micro({ writtenAgreement: true, category: 'small' }))).toBe('2026-11-15');
    expect(msmePayBy('2026-10-01', null, micro({ writtenAgreement: true }))).toBe('2026-11-15');
  });

  it('leaves medium enterprises, traders and non-MSMEs alone', () => {
    expect(msmePayBy('2026-10-01', null, micro({ category: 'medium' }))).toBeNull();
    expect(msmePayBy('2026-10-01', null, micro({ activity: 'trading' }))).toBeNull();
    expect(msmePayBy('2026-10-01', null, null)).toBeNull();
  });
});

describe('vendor bank and MSME details', () => {
  let moduleRef: TestingModule;
  let vendors: VendorsService;
  let bills: PurchaseBillsService;
  let audit: Model<{ action: string; before: Record<string, unknown>; after: Record<string, unknown> }>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        MongooseModule.forRoot(testMongoUri()),
        MongooseModule.forFeature([
          { name: AuditLog.name, schema: AuditLogSchema },
          { name: Journal.name, schema: JournalSchema },
          { name: Counter.name, schema: CounterSchema },
          { name: LedgerAccount.name, schema: LedgerAccountSchema },
          { name: PurchaseBill.name, schema: PurchaseBillSchema },
          { name: Vendor.name, schema: VendorSchema },
        ]),
      ],
      providers: [VendorsService, PurchaseBillsService, AuditService, AccountsService, PostingService],
    }).compile();
    vendors = moduleRef.get(VendorsService);
    bills = moduleRef.get(PurchaseBillsService);
    audit = moduleRef.get(getModelToken(AuditLog.name));
  }, 60_000);

  afterAll(async () => {
    await moduleRef.close();
    await mongoose.disconnect();
  });

  it('checks, keeps and audits bank details and the Udyam number', async () => {
    const orgId = new Types.ObjectId().toString();
    const vendor = await vendors.create({ orgId, actorId: ACTOR, name: 'Shakti Fabricators' });
    const id = String(vendor._id);

    await expect(vendors.edit(id, orgId, ACTOR, { bankAccount: { accountNumber: '12-34', ifsc: 'HDFC0001234' } })).rejects.toThrow(/6 to 18 digits/);
    await expect(vendors.edit(id, orgId, ACTOR, { bankAccount: { accountNumber: '50100012345678', ifsc: 'HDFC1001234' } })).rejects.toThrow(/IFSC HDFC1001234/);
    await expect(vendors.edit(id, orgId, ACTOR, { msme: { udyamNumber: 'UDYAM-MH-26-12345', category: 'micro', activity: 'services' } })).rejects.toThrow(/not a Udyam number/);

    const first = await vendors.edit(id, orgId, ACTOR, {
      bankAccount: { accountName: 'Shakti Fabricators', accountNumber: '5010 0012 3456 78', ifsc: 'hdfc0001234', bankName: 'HDFC Bank' },
      msme: { udyamNumber: 'udyam-mh-26-0012345', category: 'micro', activity: 'manufacturing', writtenAgreement: true },
    });
    expect(first.bankAccount).toEqual({ accountName: 'Shakti Fabricators', accountNumber: '50100012345678', ifsc: 'HDFC0001234', bankName: 'HDFC Bank' });
    expect(first.msme).toEqual({ udyamNumber: 'UDYAM-MH-26-0012345', category: 'micro', activity: 'manufacturing', writtenAgreement: true });

    await vendors.edit(id, orgId, ACTOR, { bankAccount: { accountNumber: '000405001234', ifsc: 'ICIC0000004' } });
    const changed = await audit.findOne({ orgId, entityId: id, action: 'UPDATE_BANK_ACCOUNT' }).sort({ _id: -1 }).lean().exec();
    expect(changed?.before.bankAccount).toMatchObject({ accountNumber: '50100012345678' });
    expect(changed?.after.bankAccount).toMatchObject({ accountNumber: '000405001234', ifsc: 'ICIC0000004' });

    expect((await vendors.edit(id, orgId, ACTOR, { bankAccount: null })).bankAccount).toBeNull();
  });

  it('shows the 43B(h) pay-by day on bills, late once it has passed unpaid', async () => {
    const orgId = new Types.ObjectId().toString();
    const smallCo = await vendors.create({ orgId, actorId: ACTOR, name: 'Small Co' });
    await vendors.edit(String(smallCo._id), orgId, ACTOR, { msme: { udyamNumber: 'UDYAM-KA-03-0000001', category: 'small', activity: 'services' } });
    const trader = await vendors.create({ orgId, actorId: ACTOR, name: 'Trader Co' });
    await vendors.edit(String(trader._id), orgId, ACTOR, { msme: { udyamNumber: 'UDYAM-KA-03-0000002', category: 'micro', activity: 'trading' } });

    const billModel = moduleRef.get<Model<unknown>>(getModelToken(PurchaseBill.name));
    const amounts = { taxableValue: 100000, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 100000 };
    await billModel.create([
      { orgId, vendorId: smallCo._id, billNumber: 'S-OLD', billDate: '2026-01-05', status: BillStatus.POSTED, amountsPaise: amounts },
      { orgId, vendorId: smallCo._id, billNumber: 'S-PAID', billDate: '2026-01-05', status: BillStatus.PAID, amountsPaise: amounts, amountPaidPaise: 100000 },
      { orgId, vendorId: trader._id, billNumber: 'T-1', billDate: '2026-01-05', status: BillStatus.POSTED, amountsPaise: amounts },
    ]);
    const list = await bills.list(orgId);
    const row = (n: string) => list.find((b) => b.billNumber === n)!;
    expect(row('S-OLD')).toMatchObject({ msmePayBy: '2026-01-20', msmeLate: true });
    expect(row('S-PAID')).toMatchObject({ msmePayBy: '2026-01-20', msmeLate: false });
    expect(row('T-1')).toMatchObject({ msmePayBy: null, msmeLate: false });
  });
});
