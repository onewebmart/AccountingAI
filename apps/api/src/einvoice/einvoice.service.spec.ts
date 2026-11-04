/**
 * Integration tests — e-invoices and e-way bills, with the mock GSP.
 *
 *  ✓ The pre-check holds an IRN back until the business and customer details are there
 *  ✓ An IRN is registered once, audited; a second request is refused
 *  ✓ A sale with a live IRN cannot be reversed from the vouchers; cancelling the IRN reverses it
 *  ✓ After cancellation the same number cannot be registered again
 *  ✓ E-way bill: made, its vehicle changed, cancelled; the next one suggests the last vehicle
 *  ✓ Another org can see none of it
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { InvoiceStatus } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { EinvoiceService } from './einvoice.service';
import { EInvoice, EInvoiceSchema } from './schemas/e-invoice.schema';
import { EWayBill, EWayBillSchema } from './schemas/e-way-bill.schema';
import { GSP_PROVIDER, MockGsp } from './gsp.provider';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { Journal, JournalSchema, JournalDocument } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { CustomersService } from '../sales/customers.service';
import { SalesInvoice, SalesInvoiceSchema, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { CreditNote, CreditNoteSchema } from '../sales/schemas/credit-note.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { DebitNote, DebitNoteSchema } from '../purchase/schemas/debit-note.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { TdsDeposit, TdsDepositSchema } from '../tds/schemas/tds-deposit.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { JournalReversalService } from '../journals/journal-reversal.service';
import { todayIst } from '../automation/schedule';

const ACTOR = new Types.ObjectId().toString();

let moduleRef: TestingModule;
let einvoices: EinvoiceService;
let invoices: SalesInvoicesService;
let customers: CustomersService;
let reversals: JournalReversalService;
let settings: Model<OrgSettings>;
let journals: Model<JournalDocument>;
let invoiceModel: Model<SalesInvoiceDocument>;
let audit: Model<{ orgId: string; action: string }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: EInvoice.name, schema: EInvoiceSchema },
        { name: EWayBill.name, schema: EWayBillSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: CreditNote.name, schema: CreditNoteSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: DebitNote.name, schema: DebitNoteSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
        { name: TdsDeposit.name, schema: TdsDepositSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
      ]),
    ],
    providers: [
      EinvoiceService, { provide: GSP_PROVIDER, useValue: new MockGsp() },
      PostingService, AccountsService, AuditService, SalesInvoicesService, CustomersService, JournalReversalService,
    ],
  }).compile();
  einvoices = moduleRef.get(EinvoiceService);
  invoices = moduleRef.get(SalesInvoicesService);
  customers = moduleRef.get(CustomersService);
  reversals = moduleRef.get(JournalReversalService);
  settings = moduleRef.get(getModelToken(OrgSettings.name));
  journals = moduleRef.get(getModelToken(Journal.name));
  invoiceModel = moduleRef.get(getModelToken(SalesInvoice.name));
  audit = moduleRef.get(getModelToken(AuditLog.name));
  await journals.init();
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

/** A Maharashtra business selling to a Karnataka customer, the invoice posted today. */
async function postedSale(opts: { complete?: boolean; number?: string } = {}) {
  const orgId = new Types.ObjectId().toString();
  await settings.create({
    orgId, gstin: '27AAPFU0939F1ZV', displayName: 'Kumar Textiles', address: '12 Mill Road', stateCode: '27',
    ...(opts.complete === false ? {} : { city: 'Mumbai', pincode: '400001' }),
  });
  const customer = await customers.create({ orgId, name: 'Rao Traders', gstin: '29AAACR5055K1Z3', address: '4 MG Road', city: 'Bengaluru', pincode: '560001' });
  const draft = await invoices.create({
    orgId, customerId: String(customer._id), invoiceNumber: opts.number ?? 'KT/101', invoiceDate: todayIst(),
    amountsPaise: { taxableValue: 10000000, cgst: 0, sgst: 0, igst: 1800000, cess: 0, total: 11800000 },
    lineItems: [{ description: 'Cotton fabric', hsnSac: '520812', qty: 100, ratePaise: 100000, amountPaise: 10000000, taxRatePct: 18 }],
  });
  const invoice = await invoices.post(String(draft._id), orgId, ACTOR);
  return { orgId, invoiceId: String(invoice._id), journalId: String(invoice.journalId) };
}

describe('e-invoices', () => {
  it('holds the IRN back until the details are there, then registers it once', async () => {
    const { orgId, invoiceId } = await postedSale({ complete: false });
    const before = await einvoices.view(orgId, invoiceId);
    expect(before).toMatchObject({ applicable: true, ready: false, einvoice: null, ewbRequired: true, provider: { isMock: true } });
    expect(before.precheck.map((i) => i.code)).toEqual(['settings_city', 'settings_pincode']);
    await expect(einvoices.generateIrn(orgId, ACTOR, invoiceId)).rejects.toThrow(/IRP would refuse.*no city/);

    await settings.updateOne({ orgId }, { $set: { city: 'Mumbai', pincode: '400001' } });
    const e = await einvoices.generateIrn(orgId, ACTOR, invoiceId);
    expect(e.toObject()).toMatchObject({ status: 'active', isTest: true, attempts: 1 });
    expect(e.irn).toHaveLength(64);
    await expect(einvoices.generateIrn(orgId, ACTOR, invoiceId)).rejects.toThrow(/already has an IRN/);
    expect(await audit.countDocuments({ orgId, action: 'GENERATE_IRN' })).toBe(1);

    // Another org cannot see it.
    await expect(einvoices.view(new Types.ObjectId().toString(), invoiceId)).rejects.toThrow(/not found/i);
  });

  it('cannot be reversed from the vouchers while live; cancelling the IRN reverses the sale', async () => {
    const { orgId, invoiceId, journalId } = await postedSale({ number: 'KT/202' });
    await einvoices.generateIrn(orgId, ACTOR, invoiceId);
    await expect(reversals.reverse(journalId, orgId, ACTOR)).rejects.toThrow(/live e-invoice/);

    await expect(einvoices.cancelIrn(orgId, ACTOR, invoiceId, { reasonCode: '9', remark: 'x' })).rejects.toThrow(/Pick a reason/);
    const { einvoice, reversalJournalId } = await einvoices.cancelIrn(orgId, ACTOR, invoiceId, { reasonCode: '2', remark: 'Wrong quantity' });
    expect(einvoice.toObject()).toMatchObject({ status: 'cancelled', cancelReason: 'Data entry mistake: Wrong quantity' });
    expect(await journals.exists({ _id: reversalJournalId })).toBeTruthy();
    expect((await invoiceModel.findById(invoiceId).lean().exec())?.status).toBe(InvoiceStatus.DRAFT);

    // Posted again under the same number, the IRP will not take it.
    await invoices.post(invoiceId, orgId, ACTOR);
    const view = await einvoices.view(orgId, invoiceId);
    expect(view.precheck[0]).toMatchObject({ code: 'irn_cancelled', level: 'block' });
    await expect(einvoices.generateIrn(orgId, ACTOR, invoiceId)).rejects.toThrow(/will not register that number again/);
  });
});

describe('e-way bills', () => {
  it('is made, its vehicle changed and cancelled; the next suggests the last vehicle', async () => {
    const { orgId, invoiceId } = await postedSale({ number: 'KT/303' });
    await expect(einvoices.generateEwb(orgId, ACTOR, invoiceId, { distanceKm: 980, mode: 'road', vehicleNo: '1234' })).rejects.toThrow(/vehicle number like/);
    await expect(einvoices.generateEwb(orgId, ACTOR, invoiceId, { distanceKm: 980, mode: 'rail' })).rejects.toThrow(/transport document/);

    const ewb = await einvoices.generateEwb(orgId, ACTOR, invoiceId, { distanceKm: 980, mode: 'road', vehicleNo: 'mh 12 ab 1234', transporterName: 'VRL Logistics' });
    expect(ewb.toObject()).toMatchObject({ status: 'active', vehicleNo: 'MH12AB1234', fromPincode: '400001', toPincode: '560001', valuePaise: 11800000 });
    // 980 km: five days.
    const days = Math.round((ewb.validUpto.getTime() - ewb.ewbDate.getTime()) / 86_400_000);
    expect(days).toBeGreaterThanOrEqual(4);
    expect(days).toBeLessThanOrEqual(6);
    await expect(einvoices.generateEwb(orgId, ACTOR, invoiceId, { distanceKm: 980, mode: 'road', vehicleNo: 'MH12AB1234' })).rejects.toThrow(/already has an active/);

    const moved = await einvoices.updateVehicle(orgId, ACTOR, String(ewb._id), { vehicleNo: 'KA01F0001', reasonCode: '1', remark: 'Breakdown at Satara' });
    expect(moved.vehicleNo).toBe('KA01F0001');
    expect(moved.vehicleHistory.map((v) => v.vehicleNo)).toEqual(['MH12AB1234', 'KA01F0001']);
    // Not near expiry yet.
    await expect(einvoices.extendEwb(orgId, ACTOR, String(ewb._id), { remainingKm: 300, reasonCode: '5' })).rejects.toThrow(/8 hours/);

    const cancelled = await einvoices.cancelEwb(orgId, ACTOR, String(ewb._id), { reasonCode: '3' });
    expect(cancelled.status).toBe('cancelled');
    expect(await einvoices.ewbSuggestion(orgId, invoiceId)).toMatchObject({ vehicleNo: 'KA01F0001', distanceKm: 980, basis: 'this customer' });
    expect(await audit.countDocuments({ orgId, action: { $in: ['GENERATE_EWB', 'UPDATE_VEHICLE', 'CANCEL_EWB'] } })).toBe(3);
  });
});
