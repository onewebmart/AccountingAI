/**
 * Practice invoices & collections — Phase 6 acceptance criteria.
 *
 * Done when: an invoice issues with a gapless number and its reminder ladder
 * queues correctly.
 *
 * Invariant 7 is the headline here — numbering must stay gapless per firm and
 * financial year, including when invoices are raised concurrently. Invariant 1
 * (integer paise) is asserted on every money path.
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import {
  FirmService,
  MessageTemplateKey,
  PracticeInvoiceStatus,
  ReminderRung,
} from '@ai-accounting/shared';
import { withFirm } from '../../database/tenant.plugin';
import { CrmMessage, CrmMessageSchema, CrmMessageDocument } from '../schemas/crm-message.schema';
import {
  PracticeInvoice,
  PracticeInvoiceSchema,
  PracticeInvoiceDocument,
} from '../schemas/practice-invoice.schema';
import { Counter, CounterSchema, CounterDocument } from '../../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema, AuditLogDocument } from '../../gl/schemas/audit-log.schema';
import {
  Organization,
  OrganizationSchema,
  OrganizationDocument,
} from '../../tenancy/schemas/organization.schema';
import { Firm, FirmSchema, FirmDocument } from '../../tenancy/schemas/firm.schema';
import { MessagingService, CRM_MESSAGING_QUEUE } from '../messaging/messaging.service';
import { PracticeInvoiceService, financialYearForDate } from './practice-invoice.service';

const FIRM_ID = new Types.ObjectId();
const ACTOR = new Types.ObjectId().toString();
const TODAY = '2026-08-20';

let replSet: MongoMemoryReplSet;
let moduleRef: TestingModule;
let invoices: PracticeInvoiceService;
let invoiceModel: Model<PracticeInvoiceDocument>;
let orgModel: Model<OrganizationDocument>;
let messageModel: Model<CrmMessageDocument>;
let auditModel: Model<AuditLogDocument>;
let counterModel: Model<CounterDocument>;
let client: OrganizationDocument;

const fakeQueue = { add: jest.fn() };

async function seedClient(over: Record<string, unknown> = {}) {
  return orgModel.create({
    firmId: FIRM_ID,
    name: 'Kumar Constructions',
    isActive: true,
    whatsappNumber: '9123456780',
    contactName: 'Anil Kumar',
    ...over,
  });
}

function raise(over: Record<string, unknown> = {}) {
  return withFirm(FIRM_ID.toString(), () =>
    invoices.create({
      firmId: FIRM_ID.toString(),
      clientOrgId: client._id.toString(),
      issueDate: '2026-08-01',
      dueDate: '2026-08-20',
      lines: [
        { description: 'GST filing — August', service: FirmService.GST_FILING, amountPaise: 4_800_000 },
      ],
      ...over,
    }),
  );
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  moduleRef = await Test.createTestingModule({
    imports: [
      MongooseModule.forRoot(replSet.getUri()),
      MongooseModule.forFeature([
        { name: CrmMessage.name, schema: CrmMessageSchema },
        { name: PracticeInvoice.name, schema: PracticeInvoiceSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: Organization.name, schema: OrganizationSchema },
        { name: Firm.name, schema: FirmSchema },
      ]),
    ],
    providers: [
      PracticeInvoiceService,
      MessagingService,
      { provide: getQueueToken(CRM_MESSAGING_QUEUE), useValue: fakeQueue },
    ],
  }).compile();

  invoices = moduleRef.get(PracticeInvoiceService);
  invoiceModel = moduleRef.get(getModelToken(PracticeInvoice.name));
  orgModel = moduleRef.get(getModelToken(Organization.name));
  messageModel = moduleRef.get(getModelToken(CrmMessage.name));
  auditModel = moduleRef.get(getModelToken(AuditLog.name));
  counterModel = moduleRef.get(getModelToken(Counter.name));

  const firmModel = moduleRef.get<Model<FirmDocument>>(getModelToken(Firm.name));
  await firmModel.create({ _id: FIRM_ID, name: 'Sharma & Associates', slug: 'sharma-inv' });

  await invoiceModel.syncIndexes();
}, 90_000);

beforeEach(async () => {
  jest.clearAllMocks();
  await invoiceModel.deleteMany({}).exec();
  await messageModel.deleteMany({}).exec();
  await auditModel.deleteMany({}).exec();
  await orgModel.deleteMany({}).exec();
  // Use the app's own connection — the global mongoose.connection is not it.
  await counterModel.deleteMany({}).exec();
  client = await seedClient();
});

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
  await replSet.stop();
});

describe('financialYearForDate', () => {
  it('runs April to March', () => {
    expect(financialYearForDate('2026-08-01')).toBe('FY2026-27');
    expect(financialYearForDate('2026-03-31')).toBe('FY2025-26');
    expect(financialYearForDate('2026-04-01')).toBe('FY2026-27');
  });
});

describe('gapless numbering (Invariant 7)', () => {
  it('numbers sequentially from 1 within a financial year', async () => {
    const a = await raise();
    const b = await raise();
    const c = await raise();

    expect([a.sequence, b.sequence, c.sequence]).toEqual([1, 2, 3]);
    expect(a.invoiceNumber).toBe('INV-2026-27-0001');
    expect(c.invoiceNumber).toBe('INV-2026-27-0003');
    expect(a.financialYear).toBe('FY2026-27');
  });

  it('leaves no gaps when invoices are raised concurrently', async () => {
    // The counter $inc shares a transaction with the insert, so racing
    // requests must still produce a contiguous run.
    const created = await Promise.all(Array.from({ length: 10 }, () => raise()));

    const sequences = created.map((i) => i.sequence).sort((x, y) => x - y);
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(created.map((i) => i.invoiceNumber)).size).toBe(10);
  });

  it('restarts the sequence in a new financial year', async () => {
    await raise();
    const nextYear = await raise({ issueDate: '2027-04-05', dueDate: '2027-05-05' });

    expect(nextYear.financialYear).toBe('FY2027-28');
    expect(nextYear.sequence).toBe(1);
    expect(nextYear.invoiceNumber).toBe('INV-2027-28-0001');
  });

  it('does not reuse the number of a cancelled invoice', async () => {
    const first = await raise();
    await withFirm(FIRM_ID.toString(), () => invoices.cancel(first._id.toString(), ACTOR));
    const second = await raise();

    // Gapless means no gaps in the sequence, not that every number stays live.
    expect(second.sequence).toBe(2);
  });
});

describe('create', () => {
  it('sums lines into an integer-paise total', async () => {
    const invoice = await raise({
      lines: [
        { description: 'GST filing', amountPaise: 4_800_000 },
        { description: 'TDS return', amountPaise: 1_200_000 },
      ],
    });

    expect(invoice.totalPaise).toBe(6_000_000);
    expect(Number.isInteger(invoice.totalPaise)).toBe(true);
    expect(invoice.status).toBe(PracticeInvoiceStatus.DRAFT);
  });

  it('rejects a fractional line amount (Invariant 1)', async () => {
    await expect(
      raise({ lines: [{ description: 'Half a paisa', amountPaise: 100.5 }] }),
    ).rejects.toThrow(/integer number of paise/i);
  });

  it('rejects an invoice with no lines', async () => {
    await expect(raise({ lines: [] })).rejects.toThrow(/at least one line/i);
  });

  it('rejects a due date before the issue date', async () => {
    await expect(raise({ issueDate: '2026-08-10', dueDate: '2026-08-01' })).rejects.toThrow(
      /cannot fall due before/i,
    );
  });

  it('refuses a client belonging to another firm', async () => {
    const other = await orgModel.create({
      firmId: new Types.ObjectId(),
      name: 'Someone Else Ltd',
      isActive: true,
    });

    await expect(
      withFirm(FIRM_ID.toString(), () =>
        invoices.create({
          firmId: FIRM_ID.toString(),
          clientOrgId: other._id.toString(),
          issueDate: '2026-08-01',
          dueDate: '2026-08-20',
          lines: [{ description: 'x', amountPaise: 100 }],
        }),
      ),
    ).rejects.toThrow(/not found/i);
  });
});

describe('payments', () => {
  it('records a part payment and reflects it in the status', async () => {
    const invoice = await raise();
    const id = invoice._id.toString();
    await withFirm(FIRM_ID.toString(), () => invoices.issue(id, ACTOR));

    const paid = await withFirm(FIRM_ID.toString(), () =>
      invoices.recordPayment(id, { amountPaise: 2_000_000, receivedOn: TODAY, actorId: ACTOR }),
    );

    expect(paid.paidPaise).toBe(2_000_000);
    expect(paid.status).toBe(PracticeInvoiceStatus.PARTIALLY_PAID);
  });

  it('marks an invoice PAID once settled in full', async () => {
    const invoice = await raise();
    const id = invoice._id.toString();
    await withFirm(FIRM_ID.toString(), () => invoices.issue(id, ACTOR));

    const paid = await withFirm(FIRM_ID.toString(), () =>
      invoices.recordPayment(id, { amountPaise: 4_800_000, receivedOn: TODAY, actorId: ACTOR }),
    );

    expect(paid.status).toBe(PracticeInvoiceStatus.PAID);
  });

  it('refuses an overpayment rather than absorbing it', async () => {
    const invoice = await raise();
    const id = invoice._id.toString();
    await withFirm(FIRM_ID.toString(), () => invoices.issue(id, ACTOR));

    await expect(
      withFirm(FIRM_ID.toString(), () =>
        invoices.recordPayment(id, { amountPaise: 5_000_000, receivedOn: TODAY, actorId: ACTOR }),
      ),
    ).rejects.toThrow(/exceeds/i);
  });

  it('refuses payment against a draft', async () => {
    const invoice = await raise();
    await expect(
      withFirm(FIRM_ID.toString(), () =>
        invoices.recordPayment(invoice._id.toString(), {
          amountPaise: 100,
          receivedOn: TODAY,
          actorId: ACTOR,
        }),
      ),
    ).rejects.toThrow(/Issue the invoice/i);
  });

  it('refuses to cancel an invoice that has been part paid', async () => {
    const invoice = await raise();
    const id = invoice._id.toString();
    await withFirm(FIRM_ID.toString(), () => invoices.issue(id, ACTOR));
    await withFirm(FIRM_ID.toString(), () =>
      invoices.recordPayment(id, { amountPaise: 100, receivedOn: TODAY, actorId: ACTOR }),
    );

    await expect(
      withFirm(FIRM_ID.toString(), () => invoices.cancel(id, ACTOR)),
    ).rejects.toThrow(/credit note/i);
  });
});

describe('ageing', () => {
  it('buckets outstanding balances by how late they are', async () => {
    // Issue each one 30 days before it falls due — an invoice cannot be dated
    // after its own due date, which the service rightly refuses.
    const mk = async (issueDate: string, dueDate: string, amountPaise: number) => {
      const inv = await raise({ issueDate, dueDate, lines: [{ description: 'Fees', amountPaise }] });
      await withFirm(FIRM_ID.toString(), () => invoices.issue(inv._id.toString(), ACTOR));
      return inv;
    };

    await mk('2026-08-30', '2026-09-30', 1_000_000); // not yet due at TODAY
    await mk('2026-07-10', '2026-08-10', 2_000_000); // 10 days late
    await mk('2026-05-01', '2026-06-01', 3_000_000); // 80 days late
    await mk('2025-12-01', '2026-01-01', 4_000_000); // way over 90

    const summary = await withFirm(FIRM_ID.toString(), () => invoices.ageing(TODAY));

    expect(summary.buckets.notYetDuePaise).toBe(1_000_000);
    expect(summary.buckets.days0to30Paise).toBe(2_000_000);
    expect(summary.buckets.days61to90Paise).toBe(3_000_000);
    expect(summary.buckets.over90Paise).toBe(4_000_000);
    expect(summary.outstandingPaise).toBe(10_000_000);
  });

  it('excludes drafts — they are not receivables yet', async () => {
    await raise(); // left as DRAFT
    const summary = await withFirm(FIRM_ID.toString(), () => invoices.ageing(TODAY));
    expect(summary.totalBilledPaise).toBe(0);
    expect(summary.outstandingPaise).toBe(0);
  });
});

describe('collection ladder', () => {
  /** Issues an invoice dated a month before it falls due. */
  async function issued(dueDate: string) {
    const issueDate = new Date(`${dueDate}T00:00:00Z`);
    issueDate.setUTCDate(issueDate.getUTCDate() - 30);
    const invoice = await raise({ issueDate: issueDate.toISOString().slice(0, 10), dueDate });
    await withFirm(FIRM_ID.toString(), () => invoices.issue(invoice._id.toString(), ACTOR));
    return invoice;
  }

  it('sends a polite reminder 7 days before the due date', async () => {
    await issued('2026-08-27'); // TODAY + 7

    const run = await withFirm(FIRM_ID.toString(), () =>
      invoices.runCollections(FIRM_ID.toString(), TODAY),
    );

    expect(run.remindersQueued).toBe(1);
    const message = await messageModel.findOne({}).exec();
    expect(message!.templateKey).toBe(MessageTemplateKey.INVOICE_DUE);
    expect(message!.body).not.toMatch(/\{\{/);
  });

  it('names services readably, not as enum constants', async () => {
    await issued('2026-08-27');

    await withFirm(FIRM_ID.toString(), () => invoices.runCollections(FIRM_ID.toString(), TODAY));

    const message = await messageModel.findOne({}).exec();
    // A client reading this should see "GST filing", never GST_FILING.
    expect(message!.body).toContain('GST filing');
    expect(message!.body).not.toContain('GST_FILING');
  });

  it('switches to the overdue template once late', async () => {
    await issued('2026-08-13'); // TODAY - 7

    await withFirm(FIRM_ID.toString(), () => invoices.runCollections(FIRM_ID.toString(), TODAY));

    const message = await messageModel.findOne({}).exec();
    expect(message!.templateKey).toBe(MessageTemplateKey.INVOICE_OVERDUE);
    expect(message!.body).toContain('7');
  });

  it('climbs each rung at most once', async () => {
    const invoice = await issued('2026-08-27');
    const id = invoice._id.toString();

    await withFirm(FIRM_ID.toString(), () => invoices.runCollections(FIRM_ID.toString(), TODAY));
    const second = await withFirm(FIRM_ID.toString(), () =>
      invoices.runCollections(FIRM_ID.toString(), TODAY),
    );

    expect(second.remindersQueued).toBe(0);
    const saved = await invoiceModel.findById(id).exec();
    expect(saved!.remindersSent.map((r) => r.rung)).toEqual([ReminderRung.BEFORE_DUE]);
  });

  it('fires nothing between rungs', async () => {
    await issued('2026-08-24'); // TODAY + 4 — not a rung

    const run = await withFirm(FIRM_ID.toString(), () =>
      invoices.runCollections(FIRM_ID.toString(), TODAY),
    );

    expect(run.remindersQueued).toBe(0);
  });

  it('flags for legal escalation past the last rung, without sending a threat', async () => {
    await issued('2026-07-01'); // ~50 days late

    const run = await withFirm(FIRM_ID.toString(), () =>
      invoices.runCollections(FIRM_ID.toString(), TODAY),
    );

    expect(run.escalated).toBe(1);
    // Escalation is a flag for a human — no automated legal message goes out.
    expect(run.remindersQueued).toBe(0);

    const saved = await invoiceModel.findOne({}).exec();
    expect(saved!.status).toBe(PracticeInvoiceStatus.LEGAL_NOTICE);
  });

  it('stops chasing an invoice once it is paid', async () => {
    const invoice = await issued('2026-08-27');
    const id = invoice._id.toString();
    await withFirm(FIRM_ID.toString(), () =>
      invoices.recordPayment(id, { amountPaise: 4_800_000, receivedOn: TODAY, actorId: ACTOR }),
    );

    const run = await withFirm(FIRM_ID.toString(), () =>
      invoices.runCollections(FIRM_ID.toString(), TODAY),
    );

    expect(run.remindersQueued).toBe(0);
  });

  it('chases only the balance still outstanding, not the original total', async () => {
    const invoice = await issued('2026-08-13');
    const id = invoice._id.toString();
    await withFirm(FIRM_ID.toString(), () =>
      invoices.recordPayment(id, { amountPaise: 3_800_000, receivedOn: TODAY, actorId: ACTOR }),
    );

    await withFirm(FIRM_ID.toString(), () => invoices.runCollections(FIRM_ID.toString(), TODAY));

    const message = await messageModel.findOne({}).exec();
    // ₹10,000 remains of a ₹48,000 invoice.
    expect(message!.body).toContain('10,000');
    expect(message!.body).not.toContain('48,000');
  });
});
