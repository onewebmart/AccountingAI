/**
 * Integration tests — recurring bills set up from lines.
 *
 *  ✓ A weekly recurring bill with a discount on a line drafts, on each date, a bill whose amounts, accounts and
 *    words are a typed bill's; nothing posts by itself
 *  ✓ A discount on the whole bill and month-end terms carry onto each draft; a template that cannot be priced is refused
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { BillStatus } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { RecurringService } from './recurring.service';
import { RecurringTemplate, RecurringTemplateSchema } from './schemas/recurring-template.schema';
import { BillsFromLinesService } from '../purchase/bills-from-lines.service';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { PurchaseBill, PurchaseBillDocument, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { ItemsService, HSN_QUEUE } from '../items/items.service';
import { HSN_MODEL } from '../items/hsn-model';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { AiSuggestion, AiSuggestionSchema } from '../ai-suggestions/schemas/ai-suggestion.schema';
import { UsageMeterService } from '../ocr/usage-meter.service';
import { UsageMeter, UsageMeterSchema } from '../ocr/schemas/usage-meter.schema';
import { PostingService } from '../gl/posting.service';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema } from '../gl/schemas/ledger-account.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';

const ACTOR = new Types.ObjectId().toString();
let moduleRef: TestingModule;
let recurring: RecurringService;
let fromLines: BillsFromLinesService;
let accounts: AccountsService;
let vendors: Model<{ _id: Types.ObjectId }>;
let customers: Model<{ _id: Types.ObjectId }>;
let settings: Model<unknown>;
let bills: Model<PurchaseBillDocument>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: RecurringTemplate.name, schema: RecurringTemplateSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: Item.name, schema: ItemSchema },
        { name: AiSuggestion.name, schema: AiSuggestionSchema },
        { name: UsageMeter.name, schema: UsageMeterSchema },
        { name: Project.name, schema: ProjectSchema },
      ]),
    ],
    providers: [
      RecurringService, BillsFromLinesService, PurchaseBillsService, SalesInvoicesService, ItemsService, UsageMeterService, PostingService, AccountsService, AuditService,
      { provide: getQueueToken(HSN_QUEUE), useValue: { add: jest.fn() } },
      { provide: HSN_MODEL, useValue: { available: false, ask: jest.fn() } },
    ],
  }).compile();
  recurring = moduleRef.get(RecurringService);
  fromLines = moduleRef.get(BillsFromLinesService);
  accounts = moduleRef.get(AccountsService);
  vendors = moduleRef.get(getModelToken(Vendor.name));
  customers = moduleRef.get(getModelToken(Customer.name));
  settings = moduleRef.get(getModelToken(OrgSettings.name));
  bills = moduleRef.get(getModelToken(PurchaseBill.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

async function org() {
  const orgId = new Types.ObjectId().toString();
  await settings.create({ orgId, gstin: '27AAPFU0939F1ZV', stateCode: '27', displayName: 'Kumar Stationers' });
  await accounts.seedDefaults(orgId);
  const [vendor] = await vendors.create([{ orgId, name: 'Sigma Housekeeping', gstin: '27AAACS1234A1Z1' }]);
  const [customer] = await customers.create([{ orgId, name: 'Mehta Interiors' }]);
  const named = async (name: string) => String((await accounts.list(orgId)).find((a) => a.name === name)!._id);
  return { orgId, vendorId: String(vendor._id), customerId: String(customer._id), named };
}

/** What the browser sends: amounts it previewed, which the server prices again. */
const preview = { taxableValue: 1, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 1 };
const plain = (b: PurchaseBillDocument) => {
  const o = b.toObject();
  return {
    amountsPaise: o.amountsPaise, discount: o.discount, discountLevel: o.discountLevel, adjustment: o.adjustment, orderNumber: o.orderNumber, subject: o.subject, paymentTerms: o.paymentTerms,
    lines: o.lineItems.map((l) => ({ description: l.description, amountPaise: l.amountPaise, discountPaise: l.discountPaise, discountPercent: l.discountPercent, accountId: l.accountId ? String(l.accountId) : null, customerId: l.customerId ? String(l.customerId) : null, billable: l.billable })),
  };
};

describe('recurring bills from lines', () => {
  it('drafts each week a bill priced as a typed one: the line discount, accounts, customer and adjustment', async () => {
    const { orgId, vendorId, customerId, named } = await org();
    const cleaning = await named('Repairs & Maintenance');
    const lines = [
      { description: 'Office cleaning, weekly', hsnSac: '998533', qty: 1, ratePaise: 450000, taxRatePct: 18, accountId: cleaning, discount: { percent: 5 } },
      { description: 'Site cleaning, Carter Road', qty: 2, ratePaise: 125050, taxRatePct: 18, discount: { amountPaise: 2500 }, customerId, billable: true },
    ];
    const words = { paymentTerms: 'net_7', referenceNumber: 'AMC-2026', subject: 'Housekeeping contract', adjustment: { label: 'Round off', paise: -27 } };

    const template = await recurring.create(orgId, ACTOR, {
      kind: 'bill', name: 'Weekly cleaning', partyId: vendorId, frequency: 'weekly', dayOfMonth: 1, startDate: '2026-11-02', amountsPaise: preview,
      lineItems: lines.map((l) => ({ ...l, amountPaise: 0 })), ...words,
    });
    // 4,500 less 5% = 4,275; 2,501 less 25 = 2,476; 18% on 6,751 = 1,215.18. Less 0.27.
    expect(template.toObject()).toMatchObject({
      billFromLines: true, discountLevel: 'line', paymentTerms: 'net_7', referenceNumber: 'AMC-2026', subject: 'Housekeeping contract',
      amountsPaise: { taxableValue: 675100, cgst: 60759, sgst: 60759, total: 675100 + 121518 - 27 }, nextRunDate: '2026-11-02',
    });

    const run = await recurring.runDue(orgId, '2026-11-09', ACTOR, ['bill']);
    expect(run.failed).toEqual([]);
    expect(run.drafted.map((d) => d.documentDate)).toEqual(['2026-11-02', '2026-11-09']);
    const drafted = await bills.find({ orgId, recurringTemplateId: template._id }).sort({ billDate: 1 }).exec();
    expect(drafted.map((b) => [b.status, b.billDate, b.dueDate])).toEqual([[BillStatus.DRAFT, '2026-11-02', '2026-11-09'], [BillStatus.DRAFT, '2026-11-09', '2026-11-16']]);

    // The same bill typed by hand on the first date: the same figures, to the paisa, and the same accounts.
    const typed = await fromLines.create(orgId, ACTOR, {
      vendorId, billDate: '2026-11-02', lines, paymentTerms: 'net_7', orderNumber: 'AMC-2026', subject: 'Housekeeping contract', adjustment: { label: 'Round off', paise: -27 },
    });
    expect(plain(drafted[0])).toEqual(plain(typed));
    expect(plain(drafted[0]).lines.map((l) => l.accountId)).toEqual([cleaning, null]);
    expect(plain(drafted[0]).lines[1]).toMatchObject({ customerId, billable: true, discountPaise: 2500 });
  });

  it('carries a discount on the whole bill and month-end terms; refuses lines it cannot price', async () => {
    const { orgId, vendorId } = await org();
    const line = { description: 'Software licences', qty: 3, ratePaise: 99900, amountPaise: 0, taxRatePct: 18 };
    const template = await recurring.create(orgId, ACTOR, {
      kind: 'bill', name: 'Licences', partyId: vendorId, frequency: 'monthly', dayOfMonth: 5, startDate: '2026-11-05', amountsPaise: preview,
      lineItems: [line], discount: { percent: 10 }, paymentTerms: 'end_of_month',
    });
    expect(template.toObject()).toMatchObject({ discountLevel: 'transaction', discount: { percent: 10, amountPaise: 29970 }, amountsPaise: { taxableValue: 269730 } });
    await recurring.runDue(orgId, '2026-11-05', ACTOR, ['bill']);
    const [bill] = await bills.find({ orgId, recurringTemplateId: template._id }).exec();
    expect(bill.toObject()).toMatchObject({ status: BillStatus.DRAFT, dueDate: '2026-11-30', discount: { percent: 10, amountPaise: 29970 }, discountLevel: 'transaction', amountsPaise: { taxableValue: 269730, cgst: 24276, sgst: 24275 } });

    const base = { kind: 'bill' as const, name: 'Bad', partyId: vendorId, frequency: 'monthly' as const, dayOfMonth: 1, startDate: '2026-11-01', amountsPaise: preview };
    await expect(recurring.create(orgId, ACTOR, { ...base, lineItems: [{ ...line, taxRatePct: 7 }] })).rejects.toThrow(/Line 1: 7% is not a GST slab/);
    await expect(recurring.create(orgId, ACTOR, { ...base, lineItems: [{ ...line, discount: { percent: 5 } }], discount: { percent: 5 } })).rejects.toThrow(/not both/);
    await expect(recurring.create(orgId, ACTOR, { ...base, lineItems: [{ ...line, billable: true }] })).rejects.toThrow(/choose the customer/);
  });
});
