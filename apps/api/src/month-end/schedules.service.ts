import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccountType } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { AccountsService } from '../gl/accounts.service';
import { LedgerAccount, LedgerAccountDocument, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { allocate } from '../gst/gst-returns';
import { AdjustmentSchedule, AdjustmentScheduleDocument } from './schemas/adjustment-schedule.schema';
import { AdjustmentsService, nextPeriod, periodEnd } from './adjustments.service';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface ScheduleInput {
  kind: 'accrual' | 'prepaid';
  name: string;
  expenseAccountId: string;
  amountPaise: number;
  startPeriod: string;
  months: number;
  note?: string | null;
}

/** The months a schedule covers: its start, for its length. */
export function schedulePeriods(s: { startPeriod: string; months: number }): string[] {
  const out: string[] = [];
  let p = s.startPeriod;
  for (let i = 0; i < s.months; i++, p = nextPeriod(p)) out.push(p);
  return out;
}

/** A prepaid's share for each month: equal, to the paise, adding back to the whole. */
export function prepaidShares(totalPaise: number, months: number): number[] {
  return allocate(totalPaise, Array.from({ length: months }, () => 1));
}

/** Accruals and prepaids: each month, one entry drafted into the review queue. */
@Injectable()
export class SchedulesService {
  constructor(
    @InjectModel(AdjustmentSchedule.name) private scheduleModel: Model<AdjustmentScheduleDocument>,
    @InjectModel(LedgerAccount.name) private accountModel: Model<LedgerAccountDocument>,
    private accounts: AccountsService,
    private adjustments: AdjustmentsService,
    private audit: AuditService,
  ) {}

  async list(orgId: string): Promise<Array<Record<string, unknown> & { drafted: Array<{ period: string | null | undefined; status: string; proposalId: string }> }>> {
    const schedules = await this.scheduleModel.find({ orgId }).sort({ createdAt: -1 }).lean().exec();
    return Promise.all(
      schedules.map(async (s) => {
        const drafted = await this.adjustments.live(orgId, s.kind, String(s._id));
        return { ...s, drafted: drafted.map((p) => ({ period: p.adjustment?.period, status: p.status, proposalId: String(p._id) })) };
      }),
    );
  }

  async create(orgId: string, actorId: string, input: ScheduleInput) {
    if (!input.name?.trim()) throw new BadRequestException('Name the schedule, like "Office rent accrual".');
    if (!PERIOD.test(input.startPeriod ?? '')) throw new BadRequestException('startPeriod is a month like 2026-11.');
    if (!Number.isInteger(input.months) || input.months < 1 || input.months > 120) throw new BadRequestException('months is from 1 to 120.');
    if (!Number.isInteger(input.amountPaise) || input.amountPaise < 1) throw new BadRequestException('The amount is whole paise, more than nothing.');
    if (input.kind === 'prepaid' && input.amountPaise < input.months) throw new BadRequestException('The amount is too small to spread over that many months.');
    const account = Types.ObjectId.isValid(input.expenseAccountId) ? await this.accountModel.findOne({ _id: input.expenseAccountId, orgId }).lean().exec() : null;
    if (!account || account.isGroup || !account.isActive || account.type !== AccountType.EXPENSE) throw new BadRequestException('Pick an active expense account.');
    const schedule = await this.scheduleModel.create({ orgId, ...input, name: input.name.trim(), note: input.note?.trim() || null, expenseAccountId: account._id, status: 'active', createdBy: actorId });
    await this.audit.record({ orgId, entityType: 'AdjustmentSchedule', entityId: schedule._id.toString(), action: 'CREATE', performedBy: actorId, after: { kind: input.kind, name: schedule.name, amountPaise: input.amountPaise, startPeriod: input.startPeriod, months: input.months } });
    return schedule;
  }

  async stop(orgId: string, actorId: string, id: string) {
    const schedule = Types.ObjectId.isValid(id) ? await this.scheduleModel.findOne({ _id: id, orgId }).exec() : null;
    if (!schedule) throw new NotFoundException('Schedule not found');
    if (schedule.status === 'stopped') return schedule;
    schedule.status = 'stopped';
    await schedule.save();
    await this.audit.record({ orgId, entityType: 'AdjustmentSchedule', entityId: id, action: 'STOP', performedBy: actorId, before: { status: 'active' }, after: { status: 'stopped' } });
    return schedule;
  }

  /**
   * Draft every active schedule's entry for each month up to `through`
   * that has none yet. Already drafted, approved or in review, is left be.
   */
  async draftDue(orgId: string, actorId: string, through: string): Promise<{ drafted: number }> {
    if (!PERIOD.test(through)) throw new BadRequestException('through is a month like 2026-11.');
    const schedules = await this.scheduleModel.find({ orgId, status: 'active', startPeriod: { $lte: through } }).exec();
    let drafted = 0;
    for (const s of schedules) {
      const periods = schedulePeriods(s);
      const shares = s.kind === 'prepaid' ? prepaidShares(s.amountPaise, s.months) : null;
      const done = new Set((await this.adjustments.live(orgId, s.kind, String(s._id))).map((p) => p.adjustment?.period));
      for (const [i, period] of periods.entries()) {
        if (period > through || done.has(period)) continue;
        try {
          await this.draftOne(orgId, actorId, s, period, shares ? shares[i] : s.amountPaise, i + 1, periods.length);
          drafted++;
        } catch (err) {
          if (!(err instanceof ConflictException)) throw err;
        }
      }
    }
    return { drafted };
  }

  private async draftOne(orgId: string, actorId: string, s: AdjustmentScheduleDocument, period: string, amountPaise: number, n: number, of: number) {
    const key = s.kind === 'accrual' ? SystemAccountKey.ACCRUED_EXPENSES : SystemAccountKey.PREPAID_EXPENSES;
    const other = await this.accounts.resolveSystemAccount(orgId, key);
    const expense = String(s.expenseAccountId);
    return this.adjustments.propose({
      orgId,
      actorId,
      kind: s.kind,
      refId: String(s._id),
      period,
      date: periodEnd(period),
      narration: s.kind === 'accrual' ? `${s.name}: accrued for ${period}` : `${s.name}: ${period}'s share (${n} of ${of})`,
      reason:
        s.kind === 'accrual'
          ? `The ${s.name} schedule: the month's expense, booked before its bill comes. It reverses on the 1st of the next month, when the bill is booked.`
          : `The ${s.name} schedule: month ${n} of ${of} of an amount paid ahead.`,
      lines: [
        { accountId: expense, debitPaise: amountPaise, creditPaise: 0 },
        { accountId: String(other._id), debitPaise: 0, creditPaise: amountPaise },
      ],
      reverseOn: s.kind === 'accrual' ? `${nextPeriod(period)}-01` : null,
      unique: true,
    });
  }
}
