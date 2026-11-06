import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import { AccountType, JournalStatus } from '@ai-accounting/shared';
import { AiSuggestion, AiSuggestionDocument } from '../ai-suggestions/schemas/ai-suggestion.schema';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { LedgerAccount, LedgerAccountDocument, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { UsageMeterService } from '../ocr/usage-meter.service';
import { todayIst } from '../automation/schedule';
import { ManagementReportsService, Range } from './management.service';
import { ReportCatalogService, ReportKey } from './report-catalog.service';
import { MONTH, averageDays, bucketOf, fyMonths, monthEnd, monthLabel, plAmount, rangeLabel, shiftMonth, monthsBetween } from './management';
import { Fact, NarrativeInput, PlFigures, narrativeFacts, narrativePrompt, readNarrative, ruleNarrative } from './narrative';
import { SUGGESTED, ToolCall, answerPrompt, parseQuestion, planPrompt, readAnswer, readPlan, ruleAnswer } from './ask';
import { ReportTable } from './report-table';
import { REPORT_MODEL, ReportModel } from './report-model';
import { aiFailureReason } from '../common/ai-failure';

export const REPORT_AI_QUEUE = 'report-ai';
/** The model's own word is checked, but a person still reads it: never shown as certain. */
const MODEL_CONFIDENCE = 0.8;
const daysAgo = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** Which report an answer came from, so the page can open it. */
const REPORT_OF: Record<ToolCall['tool'], (c: ToolCall) => ReportKey> = {
  profit_and_loss: () => 'comparison',
  expenses: () => 'expenses',
  account: () => 'pl_monthly',
  sales: (c) => (c.args.by === 'item' ? 'sales_by_item' : c.args.by === 'month' ? 'sales_by_month' : 'sales_by_customer'),
  purchases: (c) => (c.args.by === 'item' ? 'purchases_by_item' : c.args.by === 'month' ? 'purchases_by_month' : 'purchases_by_vendor'),
  receivables: () => 'receivables',
  payables: () => 'payables',
  gst: () => 'gst_summary',
  budget: () => 'budget_vs_actual',
  cash: () => 'balance_sheet',
};

/**
 * The monthly narrative and Ask your books. Figures always come from the
 * report services; the model, when there is one, picks a report and words
 * the answer, in a BullMQ job, and its words are kept only if every figure
 * in them is one the reports computed. Both are advice: ai_suggestions
 * records that change nothing in the books.
 */
@Injectable()
export class ReportAiService {
  constructor(
    @InjectModel(AiSuggestion.name) private suggestionModel: Model<AiSuggestionDocument>,
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
    @InjectModel(LedgerAccount.name) private accountModel: Model<LedgerAccountDocument>,
    @InjectQueue(REPORT_AI_QUEUE) private queue: Queue,
    @Inject(REPORT_MODEL) private model: ReportModel,
    private management: ManagementReportsService,
    private catalog: ReportCatalogService,
    private usageMeter: UsageMeterService,
  ) {}

  // ── The monthly narrative ─────────────────────────────────────────────

  /** The figures the narrative may use, all computed from the books. */
  async narrativeInput(orgId: string, period: string, today = todayIst()): Promise<NarrativeInput> {
    if (!MONTH.test(period ?? '')) throw new BadRequestException('period is a month like 2026-10.');
    const accounts = await this.management.accounts(orgId);
    const pl = async (m: string): Promise<PlFigures> => {
      const byAccount = new Map<string, { name: string; amount: number }>();
      let income = 0;
      let expenses = 0;
      for (const n of await this.management.monthNets(orgId, { from: m, to: m })) {
        const a = accounts.get(n.accountId);
        if (!a || (a.type !== AccountType.INCOME && a.type !== AccountType.EXPENSE)) continue;
        const v = plAmount(a.type, n.net);
        if (a.type === AccountType.INCOME) income += v;
        else expenses += v;
        byAccount.set(a.id, { name: a.name, amount: (byAccount.get(a.id)?.amount ?? 0) + v });
      }
      return { income, expenses, byAccount };
    };
    const asOf = monthEnd(period) < today ? monthEnd(period) : today;
    const [current, previous, lastYear, owed, owing, cashEnd, cashBefore] = await Promise.all([
      pl(period), pl(shiftMonth(period, -1)), pl(shiftMonth(period, -12)),
      this.management.ageingFacts(orgId, 'receivables', asOf), this.management.ageingFacts(orgId, 'payables', asOf),
      this.cashOn(orgId, monthEnd(period)), this.cashOn(orgId, monthEnd(shiftMonth(period, -1))),
    ]);

    const buckets = owed.open.map((d) => ({ owed: d.owedPaise, b: bucketOf(d.dueDate, d.date, asOf) }));
    // Late: recent payments (90 days) came at least ten days, and a quarter, slower than this customer's usual.
    const latePayers: NarrativeInput['latePayers'] = [];
    for (const partyId of new Set(owed.paid.map((p) => p.partyId))) {
      const mine = owed.paid.filter((p) => p.partyId === partyId && p.paidOn <= asOf);
      const recent = mine.filter((p) => p.paidOn > daysAgo(asOf, 90));
      const usual = mine.filter((p) => p.paidOn <= daysAgo(asOf, 90));
      const r = averageDays(recent);
      const u = averageDays(usual);
      if (r !== null && u !== null && usual.length >= 2 && r >= u + 10 && r >= u * 1.25) latePayers.push({ name: owed.names.get(partyId) ?? 'A customer', recentDays: r, usualDays: u });
    }
    latePayers.sort((a, b) => b.recentDays - b.usualDays - (a.recentDays - a.usualDays));
    return {
      period, current, previous, lastYear,
      receivables: {
        owedPaise: buckets.reduce((s, x) => s + x.owed, 0),
        overduePaise: buckets.filter((x) => x.b > 0).reduce((s, x) => s + x.owed, 0),
        over90Paise: buckets.filter((x) => x.b === 4).reduce((s, x) => s + x.owed, 0),
      },
      payables: { overduePaise: owing.open.filter((d) => bucketOf(d.dueDate, d.date, asOf) > 0).reduce((s, d) => s + d.owedPaise, 0) },
      latePayers,
      cash: { endPaise: cashEnd, previousEndPaise: cashBefore },
    };
  }

  /** Bank and cash on the books at a date. */
  private async cashOn(orgId: string, date: string): Promise<number> {
    const ids = (await this.accountModel.find({ orgId, systemKey: { $in: [SystemAccountKey.BANK, SystemAccountKey.CASH] } }, { _id: 1 }).lean().exec()).map((a) => a._id);
    if (!ids.length) return 0;
    const [row] = await this.journalModel
      .aggregate<{ net: number }>([
        { $match: { orgId, status: JournalStatus.POSTED, date: { $lte: date }, 'lines.accountId': { $in: ids } } },
        { $unwind: '$lines' },
        { $match: { 'lines.accountId': { $in: ids } } },
        { $group: { _id: null, net: { $sum: { $subtract: ['$lines.debitPaise', '$lines.creditPaise'] } } } },
      ])
      .exec();
    return row?.net ?? 0;
  }

  /** The month in words: the rules' at once, the model's when its job is done. */
  async requestNarrative(orgId: string, actorId: string, period: string) {
    const facts = narrativeFacts(await this.narrativeInput(orgId, period));
    const rule = ruleNarrative(facts);
    const queued = this.model.available && facts.length > 0;
    const s = await this.suggestionModel.create({
      orgId, kind: 'narrative', status: queued ? 'queued' : facts.length ? 'done' : 'none', requestedBy: actorId,
      input: { period, facts: facts.map((f) => ({ id: f.id, text: f.text, figures: f.figures, weight: f.weight })) },
      result: { sentences: rule, dropped: 0 }, source: 'rule', confidence: 1,
      reason: facts.length ? 'Written by the rules from the books.' : `No income or expenses posted for ${monthLabel(period)} yet, so there is nothing to sum up.`,
    });
    if (queued) await this.queue.add('narrative', { orgId, suggestionId: s._id.toString() }, { attempts: 2, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 100 });
    return this.narrativeView(s.toObject());
  }

  async runNarrative(orgId: string, suggestionId: string) {
    const s = await this.suggestionModel.findOne({ _id: suggestionId, orgId, kind: 'narrative' }).exec();
    if (!s || s.status !== 'queued') return;
    const { period, facts } = s.input as { period: string; facts: Fact[] };
    let answer: Awaited<ReturnType<ReportModel['json']>>;
    try {
      answer = await this.model.json(narrativePrompt(period, facts));
    } catch (err) {
      // The AI is down or out of credit: the rules' words stand, and the card stops waiting.
      s.set({ status: 'done', reason: `${aiFailureReason(err)} Meanwhile the rules' words are shown.` });
      await s.save();
      return;
    }
    if (answer) await this.usageMeter.recordAiTokens(orgId, answer.tokensIn, answer.tokensOut);
    const read = answer ? readNarrative(answer.raw, facts) : { sentences: [], dropped: 0 };
    // Two checked sentences or more, or the rules' words stand.
    if (read.sentences.length >= 2) {
      s.set({ status: 'done', source: 'model', confidence: MODEL_CONFIDENCE, result: { sentences: read.sentences, dropped: read.dropped }, reason: 'Worded by AI from the figures below; every figure checked against them.' });
    } else {
      s.set({ status: 'done', reason: read.dropped ? 'The AI wrote figures the books do not have, so the rules\' words are shown.' : 'Written by the rules from the books.' });
    }
    await s.save();
  }

  async latestNarrative(orgId: string, period: string) {
    if (!MONTH.test(period ?? '')) throw new BadRequestException('period is a month like 2026-10.');
    const s = await this.suggestionModel.findOne({ orgId, kind: 'narrative', 'input.period': period }).sort({ createdAt: -1 }).lean().exec();
    return s ? this.narrativeView(s) : null;
  }

  async narrative(orgId: string, id: string) {
    const s = Types.ObjectId.isValid(id) ? await this.suggestionModel.findOne({ _id: id, orgId, kind: 'narrative' }).lean().exec() : null;
    if (!s) throw new NotFoundException('Not found');
    return this.narrativeView(s);
  }

  private narrativeView(s: { _id: unknown; status: string; input: Record<string, unknown>; result: Record<string, unknown> | null; source: string | null; confidence: number | null; reason: string | null }) {
    const input = s.input as { period: string; facts: Fact[] };
    return {
      id: String(s._id), status: s.status, period: input.period, source: s.source, confidence: s.confidence, reason: s.reason,
      sentences: ((s.result as { sentences?: string[] } | null)?.sentences ?? []) as string[],
      facts: input.facts.map((f) => ({ id: f.id, text: f.text })),
    };
  }

  // ── Ask your books ────────────────────────────────────────────────────

  private async accountNames(orgId: string) {
    return (await this.accountModel.find({ orgId, isGroup: false, isActive: true }, { name: 1 }).lean().exec()).map((a) => a.name);
  }

  /** One read-only report for a tool call; nothing else is reachable from a question. */
  async runTool(orgId: string, call: ToolCall): Promise<{ table: ReportTable; report: { key: ReportKey; from?: string; to?: string } }> {
    const m = this.management;
    const range: Range = call.args.from && call.args.to ? m.range(call.args.from, call.args.to) : m.range();
    const report = { key: REPORT_OF[call.tool](call), from: range.from, to: range.to };
    switch (call.tool) {
      case 'profit_and_loss': return { table: await m.comparison(orgId, range), report };
      case 'expenses': return { table: await m.expenses(orgId, range), report };
      case 'sales': return { table: await (call.args.by === 'item' ? m.byItem(orgId, 'sales', range) : call.args.by === 'month' ? m.byMonth(orgId, 'sales', range) : m.byParty(orgId, 'sales', range)), report };
      case 'purchases': return { table: await (call.args.by === 'item' ? m.byItem(orgId, 'purchases', range) : call.args.by === 'month' ? m.byMonth(orgId, 'purchases', range) : m.byParty(orgId, 'purchases', range)), report };
      case 'receivables': return { table: await m.ageing(orgId, 'receivables'), report: { key: report.key } };
      case 'payables': return { table: await m.ageing(orgId, 'payables'), report: { key: report.key } };
      case 'gst': return { table: await m.gst(orgId, range), report };
      case 'budget': return { table: await m.budgetVsActual(orgId, fyMonths(todayIst().slice(0, 7)).fy), report: { key: report.key } };
      case 'cash': return { table: await this.catalog.run(orgId, 'balance_sheet'), report: { key: report.key } };
      case 'account': return { table: await this.accountTable(orgId, call.args.account ?? '', range), report };
    }
  }

  private async accountTable(orgId: string, name: string, range: Range): Promise<ReportTable> {
    const accounts = await this.management.accounts(orgId);
    const a = [...accounts.values()].find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!a) throw new BadRequestException(`No account called ${name}.`);
    const months = monthsBetween(range.from, range.to);
    const nets = (await this.management.monthNets(orgId, range)).filter((n) => n.accountId === a.id);
    const by = new Map(nets.map((n) => [n.month, n.net]));
    // Income and liabilities read credit-positive, the rest debit-positive.
    const sign = [AccountType.INCOME, AccountType.LIABILITIES, AccountType.CAPITAL].includes(a.type) ? -1 : 1;
    const values = months.map((mo) => sign * (by.get(mo) ?? 0));
    return {
      key: 'account', title: a.name, subtitle: rangeLabel(range.from, range.to),
      columns: [{ key: 'month', label: 'Month', kind: 'text' }, { key: 'amount', label: 'Amount', kind: 'money' }],
      rows: [...months.map((mo, i) => ({ cells: [monthLabel(mo), values[i]] as Array<string | number | null> })), { cells: ['Total', values.reduce((s, v) => s + v, 0)], style: 'grand' }],
      notes: ['Movement on the account in each month, from posted journals.'],
    };
  }

  async ask(orgId: string, actorId: string, question: string) {
    const q = (question ?? '').trim();
    if (q.length < 3 || q.length > 500) throw new BadRequestException('Ask in a few words, up to 500 characters.');
    const names = await this.accountNames(orgId);
    const call = parseQuestion(q, todayIst(), names);
    if (call) {
      const { table, report } = await this.runTool(orgId, call);
      const { answer, rows } = ruleAnswer(call, table);
      const s = await this.suggestionModel.create({ orgId, kind: 'ask', status: 'done', source: 'rule', confidence: 1, requestedBy: actorId, input: { question: q }, result: { call, answer, rows, table, report }, reason: 'Answered from the report below by the rules.' });
      return this.askView(s.toObject());
    }
    if (!this.model.available) {
      const s = await this.suggestionModel.create({ orgId, kind: 'ask', status: 'none', requestedBy: actorId, input: { question: q }, result: null, reason: `I can answer questions like: ${SUGGESTED.join(' ')}` });
      return this.askView(s.toObject());
    }
    const s = await this.suggestionModel.create({ orgId, kind: 'ask', status: 'queued', requestedBy: actorId, input: { question: q }, result: null });
    await this.queue.add('ask', { orgId, suggestionId: s._id.toString() }, { attempts: 2, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 100 });
    return this.askView(s.toObject());
  }

  async runAsk(orgId: string, suggestionId: string) {
    const s = await this.suggestionModel.findOne({ _id: suggestionId, orgId, kind: 'ask' }).exec();
    if (!s || s.status !== 'queued') return;
    try {
      await this.answerWithModel(orgId, s);
    } catch (err) {
      // A model error must not leave the question waiting for ever: say why, so it can be asked again.
      s.set({ status: 'failed', reason: aiFailureReason(err) });
      await s.save();
    }
  }

  private async answerWithModel(orgId: string, s: AiSuggestionDocument) {
    const question = String((s.input as { question: string }).question);
    const names = await this.accountNames(orgId);
    const today = todayIst();
    const plan = await this.model.json(planPrompt(question, today, names), 200);
    if (plan) await this.usageMeter.recordAiTokens(orgId, plan.tokensIn, plan.tokensOut);
    const call = plan ? readPlan(plan.raw, names, today) : null;
    if (!call) {
      s.set({ status: 'none', reason: `None of the reports answers that. Try: ${SUGGESTED.slice(0, 3).join(' ')}` });
      await s.save();
      return;
    }
    const { table, report } = await this.runTool(orgId, call);
    const said = await this.model.json(answerPrompt(question, table), 400);
    if (said) await this.usageMeter.recordAiTokens(orgId, said.tokensIn, said.tokensOut);
    const read = said ? readAnswer(said.raw, table) : null;
    if (read) {
      s.set({ status: 'done', source: 'model', confidence: MODEL_CONFIDENCE, result: { call, ...read, table, report }, reason: 'AI picked the report and worded the answer; every figure is in the rows it cites.' });
    } else {
      s.set({ status: 'done', source: 'rule', confidence: 1, result: { call, ...ruleAnswer(call, table), table, report }, reason: said ? 'The AI\'s wording carried figures not in the report, so the rules answered from it.' : 'Answered from the report below by the rules.' });
    }
    await s.save();
  }

  async answer(orgId: string, id: string) {
    const s = Types.ObjectId.isValid(id) ? await this.suggestionModel.findOne({ _id: id, orgId, kind: 'ask' }).lean().exec() : null;
    if (!s) throw new NotFoundException('Not found');
    return this.askView(s);
  }

  /** The last questions asked, newest first. */
  async recentQuestions(orgId: string): Promise<Array<Record<string, unknown>>> {
    const rows = await this.suggestionModel.find({ orgId, kind: 'ask' }, { input: 1, status: 1, createdAt: 1 }).sort({ createdAt: -1, _id: -1 }).limit(10).lean().exec();
    return rows.map((r) => ({ id: String(r._id), question: (r.input as { question?: string }).question ?? '', status: r.status }));
  }

  private askView(s: { _id: unknown; status: string; input: Record<string, unknown>; result: Record<string, unknown> | null; source: string | null; confidence: number | null; reason: string | null }) {
    const r = s.result as { answer?: string; rows?: number[]; table?: ReportTable; report?: unknown } | null;
    return {
      id: String(s._id), status: s.status, question: String(s.input.question ?? ''), source: s.source, confidence: s.confidence, reason: s.reason,
      answer: r?.answer ?? null, rows: r?.rows ?? [], table: r?.table ?? null, report: r?.report ?? null,
    };
  }
}
