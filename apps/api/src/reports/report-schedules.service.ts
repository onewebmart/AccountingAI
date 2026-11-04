import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditService } from '../gl/audit.service';
import { MailerService } from '../mail/mailer.service';
import { withOrg } from '../database/tenant.plugin';
import { todayIst } from '../automation/schedule';
import { CATALOG, REPORT_KEYS, RelativePeriod, ReportCatalogService, resolvePeriod } from './report-catalog.service';
import { ReportSchedule, ReportScheduleDocument } from './schemas/report-schedule.schema';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PERIODS: RelativePeriod[] = ['last_month', 'this_month', 'last_quarter', 'this_fy', 'last_fy'];
export const PERIOD_LABEL: Record<RelativePeriod, string> = {
  last_month: 'Last month',
  this_month: 'This month so far',
  last_quarter: 'Last quarter',
  this_fy: 'This financial year so far',
  last_fy: 'Last financial year',
};

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The first day after `after` the schedule falls on. Monthly: that day of
 * the month (up to the 28th, so every month has it). Weekly: 1 Monday to
 * 7 Sunday.
 */
export function nextRun(frequency: 'monthly' | 'weekly', day: number, after: string): string {
  if (frequency === 'weekly') {
    const want = day % 7; // getUTCDay: Sunday is 0
    for (let d = addDays(after, 1); ; d = addDays(d, 1)) if (new Date(`${d}T00:00:00Z`).getUTCDay() === want) return d;
  }
  const sameMonth = `${after.slice(0, 7)}-${String(day).padStart(2, '0')}`;
  if (sameMonth > after) return sameMonth;
  const [y, m] = after.split('-').map(Number);
  return `${new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)}-${String(day).padStart(2, '0')}`;
}

/** Reports emailed as PDFs on a rhythm, sent by the daily sweep. */
@Injectable()
export class ReportSchedulesService {
  private readonly logger = new Logger(ReportSchedulesService.name);

  constructor(
    @InjectModel(ReportSchedule.name) private model: Model<ReportScheduleDocument>,
    private catalog: ReportCatalogService,
    private mailer: MailerService,
    private audit: AuditService,
  ) {}

  async list(orgId: string): Promise<Array<Record<string, unknown>>> {
    const rows = await this.model.find({ orgId }).sort({ active: -1, createdAt: -1 }).lean().exec();
    return rows.map((s) => ({
      id: String(s._id), report: s.report, title: CATALOG[s.report as keyof typeof CATALOG]?.title ?? s.report, period: s.period, periodLabel: PERIOD_LABEL[s.period as RelativePeriod],
      frequency: s.frequency, day: s.day, recipients: s.recipients, nextRunOn: s.nextRunOn, lastSentOn: s.lastSentOn, lastError: s.lastError, active: s.active,
    }));
  }

  async create(orgId: string, actorId: string, input: { report: string; period?: RelativePeriod; frequency: 'monthly' | 'weekly'; day: number; recipients: string[] }) {
    if (!(REPORT_KEYS as readonly string[]).includes(input.report)) throw new BadRequestException('Pick a report.');
    const period = input.period ?? 'last_month';
    if (!PERIODS.includes(period)) throw new BadRequestException('Pick a period.');
    const max = input.frequency === 'weekly' ? 7 : 28;
    if (!Number.isInteger(input.day) || input.day < 1 || input.day > max) throw new BadRequestException(input.frequency === 'weekly' ? 'Pick a weekday, 1 Monday to 7 Sunday.' : 'Pick a day from 1 to 28, so every month has it.');
    const recipients = [...new Set((input.recipients ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean))];
    if (!recipients.length || recipients.length > 10 || recipients.some((r) => !EMAIL.test(r))) throw new BadRequestException('Give one to ten email addresses.');
    const s = await this.model.create({ orgId, report: input.report, period, frequency: input.frequency, day: input.day, recipients, nextRunOn: nextRun(input.frequency, input.day, todayIst()), createdBy: actorId });
    await this.audit.record({ orgId, entityType: 'ReportSchedule', entityId: s._id.toString(), action: 'CREATE', performedBy: actorId, after: { report: s.report, period, frequency: s.frequency, day: s.day, recipients } });
    return s;
  }

  async setActive(orgId: string, actorId: string, id: string, active: boolean) {
    const s = Types.ObjectId.isValid(id) ? await this.model.findOne({ _id: id, orgId }).exec() : null;
    if (!s) throw new NotFoundException('No such schedule.');
    s.active = active;
    if (active) s.nextRunOn = nextRun(s.frequency, s.day, todayIst());
    await s.save();
    await this.audit.record({ orgId, entityType: 'ReportSchedule', entityId: id, action: active ? 'RESUME' : 'STOP', performedBy: actorId, after: { active } });
    return s;
  }

  /** Send it now, to check how it looks; the rhythm is unchanged. */
  async sendNow(orgId: string, actorId: string, id: string) {
    const s = Types.ObjectId.isValid(id) ? await this.model.findOne({ _id: id, orgId }).exec() : null;
    if (!s) throw new NotFoundException('No such schedule.');
    await this.send(s, todayIst(), actorId);
    return { sent: true, to: s.recipients };
  }

  private async send(s: ReportScheduleDocument, today: string, actorId: string) {
    if (!this.mailer.configured) throw new BadRequestException('No mail server is set up, so reports cannot be emailed yet.');
    const p = resolvePeriod(s.period as RelativePeriod, today);
    const { filename, buffer, table } = await this.catalog.pdf(s.orgId, s.report, p);
    const org = await this.catalog.org(s.orgId);
    const bottom = table.rows.filter((r) => r.style === 'grand').pop();
    await this.mailer.send({
      to: s.recipients.join(', '),
      fromName: org.name,
      subject: `${table.title}: ${table.subtitle}`,
      text: [
        `${table.title} for ${org.name}, ${table.subtitle}, is attached as a PDF.`,
        bottom ? `\n${bottom.cells[0]}: see the last line of the report.` : '',
        ...table.notes.map((n) => `\n${n}`),
        `\n\nSent ${s.frequency === 'weekly' ? 'every week' : 'every month'} because a schedule asks for it. Stop it from the Reports page.`,
      ].join(''),
      attachments: [{ filename, content: buffer, contentType: 'application/pdf' }],
    });
    s.lastSentOn = today;
    s.lastError = null;
    await s.save();
    await this.audit.record({ orgId: s.orgId, entityType: 'ReportSchedule', entityId: s._id.toString(), action: 'SEND_REPORT', performedBy: actorId, after: { report: s.report, period: p, to: s.recipients } });
  }

  /**
   * Every schedule due by today, org by org. A system job across orgs, so
   * each org's run is wrapped in withOrg(), the explicit case Invariant 5
   * allows. One failure is recorded on its schedule and the rest still go.
   */
  async runDue(today = todayIst()): Promise<{ sent: number; failed: number }> {
    const orgIds: string[] = await this.model.distinct('orgId', { active: true, nextRunOn: { $lte: today } }).exec();
    let sent = 0;
    let failed = 0;
    for (const orgId of orgIds) {
      await withOrg(orgId, async () => {
        const due = await this.model.find({ orgId, active: true, nextRunOn: { $lte: today } }).exec();
        for (const s of due) {
          try {
            await this.send(s, today, 'system:report-schedule');
            sent++;
          } catch (err) {
            failed++;
            s.lastError = err instanceof Error ? err.message.slice(0, 300) : 'Could not send';
            this.logger.warn(`Report schedule ${s._id} for org ${orgId} failed: ${s.lastError}`);
          }
          // A missed day is not sent twice: the next run is after today.
          s.nextRunOn = nextRun(s.frequency, s.day, today);
          await s.save();
        }
      });
    }
    return { sent, failed };
  }
}
