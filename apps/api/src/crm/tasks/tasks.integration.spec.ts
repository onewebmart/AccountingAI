/**
 * Tasks — Phase 9 acceptance criteria.
 *
 * The team's own work list: assign, prioritise, move, complete. Deliberately
 * thin, because the structured obligations already live as compliance items and
 * document requests — duplicating them here would give two places to mark the
 * same thing done.
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { TaskPriority, TaskStatus } from '@ai-accounting/shared';
import { testMongoUri } from '../../test-utils/mongo';
import { withFirm } from '../../database/tenant.plugin';
import { Task, TaskSchema, TaskDocument } from '../schemas/task.schema';
import { AuditLog, AuditLogSchema, AuditLogDocument } from '../../gl/schemas/audit-log.schema';
import {
  Organization,
  OrganizationSchema,
  OrganizationDocument,
} from '../../tenancy/schemas/organization.schema';
import { TasksService } from './tasks.service';

const FIRM_ID = new Types.ObjectId();
const OTHER_FIRM = new Types.ObjectId();
const ACTOR = new Types.ObjectId().toString();
const TODAY = '2026-08-20';

let moduleRef: TestingModule;
let tasks: TasksService;
let taskModel: Model<TaskDocument>;
let orgModel: Model<OrganizationDocument>;
let auditModel: Model<AuditLogDocument>;

const inFirm = <T>(fn: () => Promise<T>) => withFirm(FIRM_ID.toString(), fn);

function create(over: Record<string, unknown> = {}) {
  return inFirm(() =>
    tasks.create({
      firmId: FIRM_ID.toString(),
      title: 'Chase Mehta for bank statement',
      createdBy: ACTOR,
      ...over,
    }),
  );
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: Task.name, schema: TaskSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: Organization.name, schema: OrganizationSchema },
      ]),
    ],
    providers: [TasksService],
  }).compile();

  tasks = moduleRef.get(TasksService);
  taskModel = moduleRef.get(getModelToken(Task.name));
  orgModel = moduleRef.get(getModelToken(Organization.name));
  auditModel = moduleRef.get(getModelToken(AuditLog.name));
}, 60_000);

beforeEach(async () => {
  await taskModel.deleteMany({}).exec();
  await orgModel.deleteMany({}).exec();
  await auditModel.deleteMany({}).exec();
});

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

describe('create', () => {
  it('starts a task at TODO with normal priority', async () => {
    const task = await create();
    expect(task.status).toBe(TaskStatus.TODO);
    expect(task.priority).toBe(TaskPriority.NORMAL);
    expect(task.createdBy).toBe(ACTOR);
  });

  it('denormalises the client name when one is linked', async () => {
    const client = await orgModel.create({
      firmId: FIRM_ID,
      name: 'Mehta Textiles',
      isActive: true,
    });

    const task = await create({ clientOrgId: client._id.toString() });
    expect(task.clientName).toBe('Mehta Textiles');
  });

  it('refuses a client belonging to another firm', async () => {
    const other = await orgModel.create({
      firmId: OTHER_FIRM,
      name: 'Someone Else',
      isActive: true,
    });

    await expect(create({ clientOrgId: other._id.toString() })).rejects.toThrow(/not found/i);
  });

  it('allows a task with no client — plenty of firm work is internal', async () => {
    const task = await create({ title: 'Renew the office DSC' });
    expect(task.clientOrgId).toBeUndefined();
  });
});

describe('status changes', () => {
  it('stamps who completed it and when', async () => {
    const task = await create();

    const done = await inFirm(() =>
      tasks.changeStatus(task._id.toString(), TaskStatus.DONE, ACTOR),
    );

    expect(done.status).toBe(TaskStatus.DONE);
    expect(done.completedBy).toBe(ACTOR);
    expect(done.completedAt).toBeInstanceOf(Date);
  });

  it('clears the completion stamp when work is re-opened', async () => {
    const task = await create();
    const id = task._id.toString();

    await inFirm(() => tasks.changeStatus(id, TaskStatus.DONE, ACTOR));
    // Work comes back. Forcing a duplicate task would lose the history.
    const reopened = await inFirm(() => tasks.changeStatus(id, TaskStatus.IN_PROGRESS, ACTOR));

    expect(reopened.status).toBe(TaskStatus.IN_PROGRESS);
    expect(reopened.completedAt).toBeUndefined();
    expect(reopened.completedBy).toBeUndefined();
  });

  it('is a no-op when the status is unchanged', async () => {
    const task = await create();
    await inFirm(() => tasks.changeStatus(task._id.toString(), TaskStatus.TODO, ACTOR));

    const audits = await auditModel.countDocuments({ action: 'task_status_changed' }).exec();
    expect(audits).toBe(0);
  });

  it('writes an audit entry naming the transition', async () => {
    const task = await create();
    await inFirm(() => tasks.changeStatus(task._id.toString(), TaskStatus.BLOCKED, ACTOR));

    const audit = await auditModel.findOne({ action: 'task_status_changed' }).exec();
    expect(audit!.meta).toEqual(
      expect.objectContaining({ from: TaskStatus.TODO, to: TaskStatus.BLOCKED }),
    );
  });
});

describe('update', () => {
  it('clears a due date when explicitly set to null', async () => {
    const task = await create({ dueDate: '2026-08-25' });

    const updated = await inFirm(() =>
      tasks.update(task._id.toString(), { dueDate: null }, ACTOR),
    );

    expect(updated.dueDate).toBeUndefined();
  });

  it('leaves fields alone when they are not supplied', async () => {
    const task = await create({ dueDate: '2026-08-25', priority: TaskPriority.HIGH });

    const updated = await inFirm(() =>
      tasks.update(task._id.toString(), { title: 'Renamed' }, ACTOR),
    );

    expect(updated.title).toBe('Renamed');
    expect(updated.dueDate).toBe('2026-08-25');
    expect(updated.priority).toBe(TaskPriority.HIGH);
  });
});

describe('list', () => {
  it('sorts undated tasks last — no due date is not urgent', async () => {
    await create({ title: 'No date' });
    await create({ title: 'Due soon', dueDate: '2026-08-21' });

    const all = await inFirm(() => tasks.list());
    expect(all[0].title).toBe('Due soon');
  });

  it('filters by assignee', async () => {
    await create({ title: 'Mine', assignedTo: 'user-a' });
    await create({ title: 'Theirs', assignedTo: 'user-b' });

    const mine = await inFirm(() => tasks.list({ assignedTo: 'user-a' }));
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe('Mine');
  });
});

describe('summary', () => {
  it('counts open, overdue and due-today separately', async () => {
    await create({ title: 'Overdue', dueDate: '2026-08-01' });
    await create({ title: 'Today', dueDate: TODAY });
    await create({ title: 'Later', dueDate: '2026-09-30' });

    const done = await create({ title: 'Finished' });
    await inFirm(() => tasks.changeStatus(done._id.toString(), TaskStatus.DONE, ACTOR));

    const summary = await inFirm(() => tasks.summary(TODAY));

    expect(summary.open).toBe(3);
    expect(summary.overdue).toBe(1);
    expect(summary.dueToday).toBe(1);
    expect(summary.completedThisWeek).toBe(1);
  });

  it('returns zeroes for a firm with no tasks', async () => {
    const summary = await inFirm(() => tasks.summary(TODAY));
    expect(summary).toEqual({ open: 0, overdue: 0, dueToday: 0, completedThisWeek: 0 });
  });
});

describe('firm isolation', () => {
  it('never lists another firm’s tasks', async () => {
    await create({ title: 'Ours' });
    await withFirm(OTHER_FIRM.toString(), () =>
      tasks.create({ firmId: OTHER_FIRM.toString(), title: 'Theirs', createdBy: ACTOR }),
    );

    const ours = await inFirm(() => tasks.list());
    expect(ours).toHaveLength(1);
    expect(ours[0].title).toBe('Ours');
  });
});
