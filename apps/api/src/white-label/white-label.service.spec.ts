/**
 * Phase 18 Integration Tests — WhiteLabelService.
 *
 * Done when:
 *  ✓ getWhiteLabelConfig: returns firm document with whiteLabelConfig
 *  ✓ updateWhiteLabelConfig: logoUrl and accentColor persisted
 *  ✓ updateWhiteLabelConfig: customDomain persisted
 *  ✓ updateWhiteLabelConfig: clientPortalEnabled toggled
 *  ✓ updateWhiteLabelConfig: emits AuditLog with action=white_label_update
 *  ✓ resolveByDomain: finds firm by its customDomain
 *  ✓ resolveByDomain: returns null for an unknown domain
 *  ✓ getClients: returns only orgs belonging to this firm (CA firm sees own brand; clients isolated)
 *  ✓ getClients: Firm A clients not visible from Firm B (tenant isolation)
 *  ✓ addClient: creates org under firm and emits audit log
 *  ✓ addClient: newly created org is returned by getClients
 *  ✓ getClientSummaries: returns empty array when firm has no clients
 *  ✓ getClientSummaries: pendingReviewCount reflects PROPOSED entries
 *  ✓ getClientSummaries: overdueApCount reflects POSTED bills past due date
 *  ✓ getClientSummaries: includes gstDueDays for each client
 *  ✓ getClientSummaries: client with no proposals/bills returns 0 counts
 *  ✓ FirmAdminGuard: allows FIRM_ADMIN role
 *  ✓ FirmAdminGuard: blocks FIRM_ADMIN whose token carries no firmId
 *  ✓ FirmAdminGuard: blocks COMPANY_ADMIN
 *  ✓ FirmAdminGuard: blocks PLATFORM_SUPER_ADMIN
 */
import 'reflect-metadata';
import mongoose, { Types, Model } from 'mongoose';
import { testMongoUri } from '../test-utils/mongo';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import configuration from '../config/configuration';
import { WhiteLabelService } from './white-label.service';
import { FirmAdminGuard } from './white-label.guard';
import { Firm, FirmSchema, FirmDocument } from '../tenancy/schemas/firm.schema';
import { Organization, OrganizationSchema, OrganizationDocument } from '../tenancy/schemas/organization.schema';
import { ProposedEntry, ProposedEntrySchema, ProposedEntryDocument } from '../proposals/schemas/proposed-entry.schema';
import { PurchaseBill, PurchaseBillSchema, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { AuditLog, AuditLogSchema, AuditLogDocument } from '../gl/schemas/audit-log.schema';
import { BillStatus, ProposedEntryStatus, UserRole, VoucherType } from '@ai-accounting/shared';

const ACTOR_ID = new Types.ObjectId().toString();
const TODAY = '2025-03-25';

let moduleRef: TestingModule;
let svc: WhiteLabelService;
let firmModel: Model<FirmDocument>;
let orgModel: Model<OrganizationDocument>;
let proposalModel: Model<ProposedEntryDocument>;
let billModel: Model<PurchaseBillDocument>;
let auditLogModel: Model<AuditLogDocument>;

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {

  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: Firm.name, schema: FirmSchema },
        { name: Organization.name, schema: OrganizationSchema },
        { name: ProposedEntry.name, schema: ProposedEntrySchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
      ]),
    ],
    providers: [WhiteLabelService, FirmAdminGuard],
  }).compile();

  svc = moduleRef.get(WhiteLabelService);
  firmModel = moduleRef.get(getModelToken(Firm.name));
  orgModel = moduleRef.get(getModelToken(Organization.name));
  proposalModel = moduleRef.get(getModelToken(ProposedEntry.name));
  billModel = moduleRef.get(getModelToken(PurchaseBill.name));
  auditLogModel = moduleRef.get(getModelToken(AuditLog.name));
});

afterAll(async () => {
  await moduleRef.close();
});

afterEach(async () => {
  await firmModel.deleteMany({});
  await orgModel.deleteMany({});
  await proposalModel.deleteMany({});
  await billModel.deleteMany({});
  await auditLogModel.deleteMany({});
});

// ── Helpers ────────────────────────────────────────────────────────────────────

async function createFirm(name: string, slug: string): Promise<FirmDocument> {
  return firmModel.create({ name, slug, whiteLabelConfig: { clientPortalEnabled: false } });
}

async function createOrg(firmId: string | Types.ObjectId, name: string): Promise<OrganizationDocument> {
  return orgModel.create({ name, firmId: new Types.ObjectId(firmId.toString()) });
}

async function createProposal(orgId: string, status = ProposedEntryStatus.PROPOSED) {
  return proposalModel.create({
    orgId,
    documentId: null,
    extractedDocumentId: null,
    sourceType: 'document',
    gstr2bLineId: null,
    status,
    documentType: 'invoice',
    vendorName: null,
    vendorGstin: null,
    invoiceNumber: null,
    invoiceDate: null,
    amountsPaise: { taxableValue: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0, total: 118000 },
    confidenceOverall: 0.9,
    fieldConfidence: { vendor: 0.9, invoiceNumber: 0.9, invoiceDate: 0.9, amounts: 0.9 },
    rawWarnings: [],
    suggestedLines: [],
    financialYear: '2025-26',
    voucherType: VoucherType.SALES,
    date: '2025-03-10',
    narration: 'Test proposal',
  });
}

async function createOverdueBill(orgId: string, dueDate: string, totalPaise: number) {
  return billModel.create({
    orgId,
    vendorId: new Types.ObjectId(),
    billDate: '2025-02-01',
    dueDate,
    status: BillStatus.POSTED,
    amountsPaise: { taxableValue: totalPaise, cgst: 0, sgst: 0, igst: 0, cess: 0, total: totalPaise },
    lineItems: [],
    financialYear: '2025-26',
  });
}

// ── 1. White-label config ──────────────────────────────────────────────────────

describe('getWhiteLabelConfig', () => {
  it('returns firm document with whiteLabelConfig', async () => {
    const firm = await createFirm('Kapoor & Associates', 'kapoor');
    const result = await svc.getWhiteLabelConfig(firm._id.toString());
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Kapoor & Associates');
    expect(result!.whiteLabelConfig).toBeDefined();
  });
});

describe('updateWhiteLabelConfig', () => {
  it('persists logoUrl and accentColor', async () => {
    const firm = await createFirm('Sharma CAs', 'sharma-cas');
    const firmId = firm._id.toString();

    const updated = await svc.updateWhiteLabelConfig(firmId, {
      logoUrl: 'https://cdn.sharmacas.in/logo.png',
      accentColor: '#2563EB',
    }, ACTOR_ID);

    expect(updated.whiteLabelConfig.logoUrl).toBe('https://cdn.sharmacas.in/logo.png');
    expect(updated.whiteLabelConfig.accentColor).toBe('#2563EB');
  });

  it('persists customDomain', async () => {
    const firm = await createFirm('Verma & Co', 'verma-co');
    const firmId = firm._id.toString();

    const updated = await svc.updateWhiteLabelConfig(firmId, {
      customDomain: 'accounting.vermaco.in',
    }, ACTOR_ID);

    expect(updated.whiteLabelConfig.customDomain).toBe('accounting.vermaco.in');
  });

  it('can enable clientPortalEnabled', async () => {
    const firm = await createFirm('Gupta Firm', 'gupta');
    const firmId = firm._id.toString();

    const updated = await svc.updateWhiteLabelConfig(firmId, {
      clientPortalEnabled: true,
    }, ACTOR_ID);

    expect(updated.whiteLabelConfig.clientPortalEnabled).toBe(true);
  });

  it('emits AuditLog with action=white_label_update', async () => {
    const firm = await createFirm('Audit Test Firm', 'audit-test');
    await svc.updateWhiteLabelConfig(firm._id.toString(), { logoUrl: 'https://x.com/logo.png' }, ACTOR_ID);

    const log = await auditLogModel.findOne({ action: 'white_label_update' }).exec();
    expect(log).not.toBeNull();
    expect(log!.performedBy).toBe(ACTOR_ID);
  });
});

// ── 2. Domain resolution ───────────────────────────────────────────────────────

describe('resolveByDomain', () => {
  it('finds firm by customDomain', async () => {
    const firm = await createFirm('Domain Firm', 'domain-firm');
    await svc.updateWhiteLabelConfig(firm._id.toString(), { customDomain: 'portal.myfirm.in' }, ACTOR_ID);

    const found = await svc.resolveByDomain('portal.myfirm.in');
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Domain Firm');
  });

  it('returns null for unknown domain', async () => {
    const result = await svc.resolveByDomain('unknown.notexist.com');
    expect(result).toBeNull();
  });
});

// ── 3. Client management ───────────────────────────────────────────────────────

describe('getClients', () => {
  it('returns only orgs belonging to the firm — CA firm sees own clients', async () => {
    const firmA = await createFirm('Firm A', 'firm-a');
    const firmB = await createFirm('Firm B', 'firm-b');

    await createOrg(firmA._id, 'Client 1 of A');
    await createOrg(firmA._id, 'Client 2 of A');
    await createOrg(firmB._id, 'Client 1 of B');

    const clientsA = await svc.getClients(firmA._id.toString());
    expect(clientsA.length).toBe(2);
    expect(clientsA.every((c) => c.firmId!.toString() === firmA._id.toString())).toBe(true);
  });

  it('Firm B clients are not visible to Firm A (tenant isolation)', async () => {
    const firmA = await createFirm('Isolated A', 'isolated-a');
    const firmB = await createFirm('Isolated B', 'isolated-b');

    await createOrg(firmB._id, 'Firm B Only Org');

    const clientsA = await svc.getClients(firmA._id.toString());
    expect(clientsA.length).toBe(0);
  });

  it('returns empty array when firm has no clients', async () => {
    const firm = await createFirm('Empty Firm', 'empty-firm');
    const clients = await svc.getClients(firm._id.toString());
    expect(clients).toEqual([]);
  });
});

describe('addClient', () => {
  it('creates org under the firm and emits audit log', async () => {
    const firm = await createFirm('Add Test Firm', 'add-test');
    const firmId = firm._id.toString();

    const org = await svc.addClient(firmId, { name: 'New Client Co' }, ACTOR_ID);
    expect(org.firmId!.toString()).toBe(firmId);
    expect(org.name).toBe('New Client Co');

    const log = await auditLogModel.findOne({ action: 'client_added' }).exec();
    expect(log).not.toBeNull();
  });

  it('newly created client appears in getClients', async () => {
    const firm = await createFirm('Appear Firm', 'appear-firm');
    await svc.addClient(firm._id.toString(), { name: 'Appear Corp' }, ACTOR_ID);

    const clients = await svc.getClients(firm._id.toString());
    expect(clients.some((c) => c.name === 'Appear Corp')).toBe(true);
  });
});

// ── 4. Client summaries ────────────────────────────────────────────────────────

describe('getClientSummaries', () => {
  it('returns empty array when firm has no clients', async () => {
    const firm = await createFirm('No Clients', 'no-clients');
    const summaries = await svc.getClientSummaries(firm._id.toString(), TODAY);
    expect(summaries).toEqual([]);
  });

  it('pendingReviewCount reflects PROPOSED entries for each client', async () => {
    const firm = await createFirm('Review Firm', 'review-firm');
    const org = await createOrg(firm._id, 'Client With Proposals');
    const orgId = (org as unknown as { _id: { toString(): string } })._id.toString();

    // 3 PROPOSED entries
    await createProposal(orgId, ProposedEntryStatus.PROPOSED);
    await createProposal(orgId, ProposedEntryStatus.PROPOSED);
    await createProposal(orgId, ProposedEntryStatus.PROPOSED);
    // 1 already APPROVED — should not count
    await createProposal(orgId, ProposedEntryStatus.APPROVED);

    const summaries = await svc.getClientSummaries(firm._id.toString(), TODAY);
    const summary = summaries.find((s) => s.orgId === orgId)!;
    expect(summary.pendingReviewCount).toBe(3);
  });

  it('overdueApCount reflects POSTED bills past due date', async () => {
    const firm = await createFirm('AP Firm', 'ap-firm');
    const org = await createOrg(firm._id, 'Client With Overdue');
    const orgId = (org as unknown as { _id: { toString(): string } })._id.toString();

    // 2 overdue bills
    await createOverdueBill(orgId, '2025-03-01', 100000);
    await createOverdueBill(orgId, '2025-03-15', 200000);
    // 1 not yet due — should not count
    await createOverdueBill(orgId, '2025-04-10', 50000);

    const summaries = await svc.getClientSummaries(firm._id.toString(), TODAY);
    const summary = summaries.find((s) => s.orgId === orgId)!;
    expect(summary.overdueApCount).toBe(2);
  });

  it('client with no proposals or bills returns zero counts', async () => {
    const firm = await createFirm('Clean Firm', 'clean-firm');
    const org = await createOrg(firm._id, 'Clean Client');
    const orgId = (org as unknown as { _id: { toString(): string } })._id.toString();

    const summaries = await svc.getClientSummaries(firm._id.toString(), TODAY);
    const summary = summaries.find((s) => s.orgId === orgId)!;
    expect(summary.pendingReviewCount).toBe(0);
    expect(summary.overdueApCount).toBe(0);
  });

  it('includes gstDueDays for every client', async () => {
    const firm = await createFirm('GST Firm', 'gst-firm');
    await createOrg(firm._id, 'GST Client');

    const summaries = await svc.getClientSummaries(firm._id.toString(), TODAY);
    expect(summaries[0].gstDueDays).toBeGreaterThanOrEqual(0);
  });
});

// ── 5. FirmAdminGuard ─────────────────────────────────────────────────────────

describe('FirmAdminGuard', () => {
  let guard: FirmAdminGuard;

  beforeAll(() => { guard = moduleRef.get(FirmAdminGuard); });

  const SOME_FIRM_ID = new Types.ObjectId().toString();

  function ctxWith(user: Record<string, unknown> | undefined): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  function ctx(role: string): ExecutionContext {
    return ctxWith({ role, firmId: SOME_FIRM_ID });
  }

  it('allows FIRM_ADMIN', () => {
    expect(guard.canActivate(ctx(UserRole.FIRM_ADMIN))).toBe(true);
  });

  it('blocks FIRM_ADMIN whose token carries no firmId', () => {
    // Downstream controllers scope by req.user.firmId. If it were undefined,
    // `new Types.ObjectId(undefined)` mints a random id and the route returns an
    // empty set instead of failing — a silent wrong answer. Must be a hard 403.
    expect(() => guard.canActivate(ctxWith({ role: UserRole.FIRM_ADMIN }))).toThrow(
      ForbiddenException,
    );
  });

  it('blocks COMPANY_ADMIN', () => {
    expect(() => guard.canActivate(ctx(UserRole.COMPANY_ADMIN))).toThrow(ForbiddenException);
  });

  it('blocks PLATFORM_SUPER_ADMIN', () => {
    expect(() => guard.canActivate(ctx(UserRole.PLATFORM_SUPER_ADMIN))).toThrow(ForbiddenException);
  });

  it('blocks request with no user', () => {
    const emptyCtx = {
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(emptyCtx)).toThrow(ForbiddenException);
  });
});
