/**
 * Integration tests — the bell's notifications, against a real replica-set MongoDB.
 *
 *  ✓ Lists what needs attention, worked out from the books
 *  ✓ Opening the list marks it read; something newer is unread again
 *  ✓ Each role sees only what it can act on
 *  ✓ An approval never asks its own maker
 */
import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import mongoose, { Model, Types } from 'mongoose';
import { UserRole } from '@ai-accounting/shared';
import { testMongoUri } from '../test-utils/mongo';
import { NotificationsService } from './notifications.service';
import { User, UserSchema } from '../tenancy/schemas/user.schema';
import { Organization, OrganizationSchema } from '../tenancy/schemas/organization.schema';
import { Document, DocumentSchema } from '../documents/schemas/document.schema';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';
import { ApprovalRequest, ApprovalRequestSchema } from '../approvals/schemas/approval.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { BankStatementLine, BankStatementLineSchema } from '../banking/schemas/bank-statement-line.schema';
import { GstFiling, GstFilingSchema } from '../gst/schemas/gst-filing.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';

const TODAY = '2026-11-06';
const orgId = new Types.ObjectId();
const ORG = String(orgId);
const userId = new Types.ObjectId();
const USER = String(userId);
const amounts = (total: number) => ({ taxableValue: total, cgst: 0, sgst: 0, igst: 0, cess: 0, total });

let moduleRef: TestingModule;
let svc: NotificationsService;
const raw = (name: string) => moduleRef.get<Model<unknown>>(getModelToken(name)).collection;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: User.name, schema: UserSchema },
        { name: Organization.name, schema: OrganizationSchema },
        { name: Document.name, schema: DocumentSchema },
        { name: ProposedEntry.name, schema: ProposedEntrySchema },
        { name: ApprovalRequest.name, schema: ApprovalRequestSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
        { name: GstFiling.name, schema: GstFilingSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
      ]),
    ],
    // No TdsService: TDS dates have their own tests; the rest stands without it.
    providers: [NotificationsService],
  }).compile();
  svc = moduleRef.get(NotificationsService);

  const at = (d: string) => new Date(`${d}T10:00:00+05:30`);
  // The GSTIN as onboarding saves it: in the org's settings, not on the org.
  await raw(Organization.name).insertOne({ _id: orgId, name: 'Bell Test Traders' });
  await raw(OrgSettings.name).insertOne({ orgId: ORG, gstin: '27AABCA4321K1ZW' });
  await raw(User.name).insertOne({ _id: userId, email: `bell-${USER}@example.com`, name: 'Bell Tester', notificationsSeenAt: null });
  await raw(ProposedEntry.name).insertMany([
    { orgId: ORG, status: 'proposed', vendorName: 'Shree Ganesh Stationers', createdAt: at('2026-11-05') },
    { orgId: ORG, status: 'proposed', vendorName: 'Hotel Annapurna Veg', createdAt: at('2026-11-06') },
    { orgId: ORG, status: 'approved', vendorName: 'Done Already', createdAt: at('2026-11-06') },
  ]);
  await raw(Document.name).insertOne({ orgId: ORG, status: 'FAILED', enteredAs: null, originalName: 'scan.jpg', failureReason: 'The AI service has no credit left.', updatedAt: at('2026-11-04') });
  await raw(SalesInvoice.name).insertMany([
    { orgId: ORG, status: 'posted', dueDate: '2026-10-20', amountsPaise: amounts(1_46_320_00), amountPaidPaise: 0 },
    { orgId: ORG, status: 'paid', dueDate: '2026-10-01', amountsPaise: amounts(50_000_00) },
  ]);
  await raw(PurchaseBill.name).insertOne({ orgId: ORG, status: 'posted', dueDate: '2026-11-09', amountsPaise: amounts(25_000_00), amountPaidPaise: 0 });
  await raw(BankStatementLine.name).insertOne({ orgId: ORG, matchStatus: 'unmatched', date: '2026-11-03', description: 'UPI/DR/ZOMATO', debitPaise: 46200, creditPaise: 0, createdAt: at('2026-11-03') });
  await raw(ApprovalRequest.name).insertMany([
    { orgId: ORG, status: 'pending', makerId: 'someone-else', approverRoles: [UserRole.COMPANY_ADMIN], summary: 'Bill ST/0418 from Sunrise Traders, ₹60,000', approvals: [], createdAt: at('2026-11-06') },
    { orgId: ORG, status: 'pending', makerId: USER, approverRoles: [], summary: 'My own payment', approvals: [], createdAt: at('2026-11-06') },
  ]);
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

describe('NotificationsService', () => {
  it('lists what needs attention, worked out from the books', async () => {
    const { items, unread } = await svc.list(USER, ORG, UserRole.COMPANY_ADMIN, TODAY);
    const byKind = Object.fromEntries(items.map((n) => [n.kind, n]));
    expect(byKind.review.title).toBe('2 entries waiting for review');
    expect(byKind.review.body).toMatch(/Hotel Annapurna Veg/);
    expect(byKind.documents_failed.body).toMatch(/no credit left/);
    expect(byKind.overdue_invoices.title).toBe('₹1.46 L overdue from customers');
    expect(byKind.bills_due.title).toBe('₹25,000 of bills due this week');
    expect(byKind.bank_unmatched.title).toBe('1 bank line to match');
    // October's GSTR-1 (11th) and GSTR-3B (20th): only the one due within the week.
    expect(items.filter((n) => n.kind === 'gst_due').map((n) => n.title)).toEqual(['GSTR-1 for October 2026 is due 11 Nov']);
    // One approval: the other is this person's own.
    expect(byKind.approvals.title).toBe('1 approval waiting for you');
    expect(unread).toBe(items.length);
    expect(items.every((n) => n.href.startsWith('/'))).toBe(true);
  });

  it('opening the list marks it read; something newer is unread again', async () => {
    await svc.markSeen(USER);
    const after = await svc.list(USER, ORG, UserRole.COMPANY_ADMIN, TODAY);
    expect(after.unread).toBe(0);
    await raw(ProposedEntry.name).insertOne({ orgId: ORG, status: 'proposed', vendorName: 'Fresh Vendor', createdAt: new Date(Date.now() + 60_000) });
    const fresh = await svc.list(USER, ORG, UserRole.COMPANY_ADMIN, TODAY);
    expect(fresh.unread).toBe(1);
    expect(fresh.items[0]).toMatchObject({ kind: 'review', unread: true, title: '3 entries waiting for review' });
  });

  it('shows each role only what it can act on', async () => {
    const auditor = await svc.list(USER, ORG, UserRole.AUDITOR, TODAY);
    expect(auditor.items.map((n) => n.kind)).not.toContain('review');
    expect(auditor.items.map((n) => n.kind)).not.toContain('bills_due');
    // The admin-only approval is not offered to an accountant.
    const accountant = await svc.list(USER, ORG, UserRole.ACCOUNTANT, TODAY);
    expect(accountant.items.map((n) => n.kind)).not.toContain('approvals');
  });
});
