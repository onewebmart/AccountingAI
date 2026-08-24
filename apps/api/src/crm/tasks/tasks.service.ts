import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TaskPriority, TaskStatus } from '@ai-accounting/shared';
import { Task, TaskDocument } from '../schemas/task.schema';
import { Organization, OrganizationDocument } from '../../tenancy/schemas/organization.schema';
import { AuditLog, AuditLogDocument } from '../../gl/schemas/audit-log.schema';

export interface CreateTaskInput {
  firmId: string;
  title: string;
  description?: string;
  clientOrgId?: string;
  assignedTo?: string;
  assigneeName?: string;
  priority?: TaskPriority;
  dueDate?: string;
  createdBy: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  assignedTo?: string;
  assigneeName?: string;
  priority?: TaskPriority;
  dueDate?: string | null;
}

export interface TaskSummary {
  open: number;
  overdue: number;
  dueToday: number;
  completedThisWeek: number;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Tasks that still need doing. */
const OPEN_STATUSES = [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED];

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private taskModel: Model<TaskDocument>,
    @InjectModel(Organization.name) private orgModel: Model<OrganizationDocument>,
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
  ) {}

  async create(input: CreateTaskInput): Promise<TaskDocument> {
    let clientName: string | undefined;

    if (input.clientOrgId) {
      const client = await this.orgModel.findById(input.clientOrgId).exec();
      // Organization is the tenant root and carries no firm scope of its own,
      // so the link is checked explicitly — the same guard used elsewhere.
      if (!client || client.firmId?.toString() !== input.firmId) {
        throw new NotFoundException('Client not found');
      }
      clientName = client.name;
    }

    return this.taskModel.create({
      firmId: new Types.ObjectId(input.firmId),
      title: input.title,
      description: input.description,
      clientOrgId: input.clientOrgId ? new Types.ObjectId(input.clientOrgId) : undefined,
      clientName,
      assignedTo: input.assignedTo,
      assigneeName: input.assigneeName,
      priority: input.priority ?? TaskPriority.NORMAL,
      dueDate: input.dueDate,
      status: TaskStatus.TODO,
      createdBy: input.createdBy,
    });
  }

  async list(
    filter: { status?: TaskStatus; assignedTo?: string; clientOrgId?: string } = {},
  ): Promise<TaskDocument[]> {
    const query: Record<string, unknown> = {};
    if (filter.status) query.status = filter.status;
    if (filter.assignedTo) query.assignedTo = filter.assignedTo;
    if (filter.clientOrgId) query.clientOrgId = new Types.ObjectId(filter.clientOrgId);

    const tasks = await this.taskModel.find(query).exec();

    // Sorted in memory, for two reasons. MongoDB orders missing fields BEFORE
    // values on an ascending sort, which would put undated tasks at the top —
    // the opposite of useful, since no due date is not urgent. And aggregation,
    // the DB-side way to express this, is not covered by the firm isolation
    // plugin, so keeping the read as find() keeps the scoping guarantee.
    return tasks.sort((a, b) => {
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      const aCreated = a.get('createdAt') as Date;
      const bCreated = b.get('createdAt') as Date;
      return bCreated.getTime() - aCreated.getTime();
    });
  }

  async findById(id: string): Promise<TaskDocument> {
    const task = await this.taskModel.findById(id).exec();
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async update(id: string, input: UpdateTaskInput, actorId: string): Promise<TaskDocument> {
    const task = await this.findById(id);

    if (input.title !== undefined) task.title = input.title;
    if (input.description !== undefined) task.description = input.description;
    if (input.assignedTo !== undefined) task.assignedTo = input.assignedTo;
    if (input.assigneeName !== undefined) task.assigneeName = input.assigneeName;
    if (input.priority !== undefined) task.priority = input.priority;
    // null clears the date; undefined leaves it alone.
    if (input.dueDate !== undefined) task.dueDate = input.dueDate ?? undefined;

    await task.save();

    await this.audit(task, 'task_updated', actorId, {});
    return task;
  }

  /**
   * Moves a task between statuses.
   *
   * Re-opening a done task is allowed — work comes back, and forcing someone to
   * create a duplicate would lose its history.
   */
  async changeStatus(id: string, status: TaskStatus, actorId: string): Promise<TaskDocument> {
    const task = await this.findById(id);
    const from = task.status;

    if (from === status) return task;

    task.status = status;

    if (status === TaskStatus.DONE) {
      task.completedAt = new Date();
      task.completedBy = actorId;
    } else {
      task.completedAt = undefined;
      task.completedBy = undefined;
    }

    await task.save();

    await this.audit(task, 'task_status_changed', actorId, { from, to: status });
    return task;
  }

  async remove(id: string, actorId: string): Promise<void> {
    const task = await this.findById(id);
    await this.audit(task, 'task_deleted', actorId, { title: task.title });
    await this.taskModel.deleteOne({ _id: task._id }).exec();
  }

  /** Counts for the board header. */
  async summary(today = todayIso()): Promise<TaskSummary> {
    const tasks = await this.taskModel.find({}).exec();

    const weekAgo = new Date();
    weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);

    let open = 0;
    let overdue = 0;
    let dueToday = 0;
    let completedThisWeek = 0;

    for (const task of tasks) {
      if (OPEN_STATUSES.includes(task.status)) {
        open++;
        if (task.dueDate && task.dueDate < today) overdue++;
        if (task.dueDate === today) dueToday++;
      }
      if (task.status === TaskStatus.DONE && task.completedAt && task.completedAt >= weekAgo) {
        completedThisWeek++;
      }
    }

    return { open, overdue, dueToday, completedThisWeek };
  }

  private async audit(
    task: TaskDocument,
    action: string,
    actorId: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogModel.create({
      orgId: task.clientOrgId?.toString() ?? task.firmId.toString(),
      entityType: 'CrmTask',
      entityId: task._id.toString(),
      action,
      performedBy: actorId,
      meta: { firmId: task.firmId.toString(), ...meta },
    });
  }
}
