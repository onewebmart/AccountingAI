import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import { AccountType } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { LedgerAccount, LedgerAccountDocument } from '../gl/schemas/ledger-account.schema';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { AiSuggestion, AiSuggestionDocument } from '../ai-suggestions/schemas/ai-suggestion.schema';
import { UsageMeterService } from '../ocr/usage-meter.service';
import { Item, ItemDocument } from './schemas/item.schema';
import { HsnGuess, ITEM_GST_RATES, ItemKind, UQC_CODES, hsnProblem, nameKey, ruleGuess } from './hsn';
import { HSN_MODEL, HsnModel, readHsnAnswer } from './hsn-model';

export const HSN_QUEUE = 'hsn-suggestions';

export interface ItemInput {
  name?: string;
  code?: string | null;
  kind?: ItemKind;
  hsnSac?: string | null;
  uqc?: string;
  gstRatePct?: number | null;
  salePricePaise?: number | null;
  purchasePricePaise?: number | null;
  incomeAccountId?: string | null;
  expenseAccountId?: string | null;
  description?: string | null;
  trackStock?: boolean;
  reorderLevel?: number | null;
  reorderQty?: number | null;
  /** Set when the person took a suggestion; otherwise a typed code is the person's own. */
  hsnSource?: { by: 'history' | 'rule' | 'model'; reason?: string | null; confidence?: number | null } | null;
}

export interface LineIn {
  description: string;
  hsnSac?: string | null;
  qty?: number;
  ratePaise: number;
  amountPaise: number;
  taxRatePct?: number;
  itemId?: string | null;
  uqc?: string | null;
}

export type ResolvedLine = Omit<LineIn, 'itemId'> & { itemId: Types.ObjectId | null; uqc: string | null; accountId: Types.ObjectId | null };

export interface HsnSuggestionView {
  id: string | null;
  status: 'done' | 'queued' | 'none' | 'failed';
  suggestion: (HsnGuess & { source: 'history' | 'rule' | 'model'; confidence: number }) | null;
  message: string | null;
}

/** A rule is a good start, not certainty: shown as such. */
const RULE_CONFIDENCE = 0.7;
/** The org's own past choice for the same item is the strongest signal there is. */
const HISTORY_CONFIDENCE = 0.9;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class ItemsService {
  constructor(
    @InjectModel(Item.name) private itemModel: Model<ItemDocument>,
    @InjectModel(LedgerAccount.name) private accountModel: Model<LedgerAccountDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(AiSuggestion.name) private suggestionModel: Model<AiSuggestionDocument>,
    @InjectQueue(HSN_QUEUE) private queue: Queue,
    @Inject(HSN_MODEL) private model: HsnModel,
    private usageMeter: UsageMeterService,
    private audit: AuditService,
  ) {}

  async list(orgId: string, opts: { q?: string; includeArchived?: boolean } = {}) {
    const filter: Record<string, unknown> = { orgId };
    if (!opts.includeArchived) filter.isActive = true;
    if (opts.q?.trim()) filter.$or = [{ nameKey: new RegExp(escape(nameKey(opts.q)), 'i') }, { code: new RegExp(`^${escape(opts.q.trim())}`, 'i') }, { hsnSac: new RegExp(`^${escape(opts.q.trim())}`) }];
    return this.itemModel.find(filter).sort({ name: 1 }).limit(500).lean().exec();
  }

  async findById(orgId: string, id: string): Promise<ItemDocument> {
    const item = Types.ObjectId.isValid(id) ? await this.itemModel.findOne({ _id: id, orgId }).exec() : null;
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  async create(orgId: string, actorId: string, input: ItemInput) {
    if (!input.name?.trim()) throw new BadRequestException('Give the item a name.');
    if (!input.kind) throw new BadRequestException('Say whether it is goods or a service.');
    const fields = await this.checked(orgId, input, input.kind);
    try {
      const item = await this.itemModel.create({ orgId, ...fields });
      await this.audit.record({ orgId, entityType: 'Item', entityId: item._id.toString(), action: 'CREATE', performedBy: actorId, after: this.snapshot(item) });
      return item;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictException(`An item called "${input.name.trim()}" already exists.`);
      throw err;
    }
  }

  async update(orgId: string, actorId: string, id: string, input: ItemInput) {
    const item = await this.findById(orgId, id);
    const before = this.snapshot(item);
    const fields = await this.checked(orgId, { ...this.inputOf(item), ...input, hsnSource: input.hsnSac === undefined ? undefined : input.hsnSource }, input.kind ?? item.kind);
    // A code the person typed over a suggestion is theirs now.
    if (input.hsnSac === undefined) delete (fields as Partial<typeof fields>).hsnSource;
    item.set(fields);
    try {
      await item.save();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new ConflictException(`An item called "${fields.name}" already exists.`);
      throw err;
    }
    await this.audit.record({ orgId, entityType: 'Item', entityId: id, action: 'UPDATE', performedBy: actorId, before, after: this.snapshot(item) });
    return item;
  }

  /** Archived items stay on the documents that used them, and can no longer be picked. */
  async setActive(orgId: string, actorId: string, id: string, isActive: boolean) {
    const item = await this.findById(orgId, id);
    if (item.isActive === isActive) return item;
    item.isActive = isActive;
    await item.save();
    await this.audit.record({ orgId, entityType: 'Item', entityId: id, action: isActive ? 'RESTORE' : 'ARCHIVE', performedBy: actorId, before: { isActive: !isActive }, after: { isActive } });
    return item;
  }

  /**
   * Invoice and bill lines that name an item take its HSN/SAC, unit, rate and
   * account where the line leaves them out. What the line says wins: the
   * amounts were worked out from it, so a rate is never changed under them.
   */
  async resolveLines(orgId: string, lines: LineIn[] | undefined, side: 'sale' | 'purchase'): Promise<ResolvedLine[]> {
    if (!lines?.length) return [];
    const ids = [...new Set(lines.map((l) => l.itemId).filter((id): id is string => !!id))];
    for (const id of ids) if (!Types.ObjectId.isValid(id)) throw new BadRequestException(`No such item: ${id}`);
    const items = ids.length ? await this.itemModel.find({ orgId, _id: { $in: ids } }).lean().exec() : [];
    const byId = new Map(items.map((i) => [String(i._id), i]));
    return lines.map((l) => {
      if (!l.itemId) return { ...l, itemId: null, uqc: l.uqc ?? null, accountId: null };
      const item = byId.get(l.itemId);
      if (!item) throw new BadRequestException(`No such item: ${l.itemId}`);
      if (!item.isActive) throw new BadRequestException(`${item.name} is archived. Restore it, or pick another item.`);
      return {
        ...l,
        hsnSac: l.hsnSac ?? item.hsnSac,
        uqc: l.uqc ?? item.uqc,
        taxRatePct: l.taxRatePct ?? item.gstRatePct ?? undefined,
        itemId: item._id as Types.ObjectId,
        accountId: (side === 'sale' ? item.incomeAccountId : item.expenseAccountId) ?? null,
      };
    });
  }

  /**
   * An HSN/SAC code for an item: what this org used before for the same
   * thing, else a rule, else the model in a background job. The person
   * always decides; nothing here saves a code.
   */
  async suggestHsn(orgId: string, actorId: string, input: { name: string; description?: string | null; kind?: ItemKind | null }): Promise<HsnSuggestionView> {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Give the item a name first.');
    const kind = input.kind ?? null;

    const past = await this.fromHistory(orgId, name, kind);
    if (past) return { id: null, status: 'done', suggestion: past, message: null };

    const rule = ruleGuess([name, input.description].filter(Boolean).join(' '));
    if (rule && (!kind || rule.kind === kind)) return { id: null, status: 'done', suggestion: { ...rule, source: 'rule', confidence: RULE_CONFIDENCE }, message: null };

    if (!this.model.available) {
      return { id: null, status: 'none', suggestion: null, message: 'No rule knows this item, and AI suggestions are not set up. Enter the code from the vendor bill or the GST portal.' };
    }
    const suggestion = await this.suggestionModel.create({ orgId, kind: 'hsn', status: 'queued', input: { name, description: input.description ?? null, kind }, requestedBy: actorId });
    await this.queue.add('hsn', { orgId, suggestionId: suggestion._id.toString() }, { attempts: 2, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true, removeOnFail: 100 });
    return { id: suggestion._id.toString(), status: 'queued', suggestion: null, message: null };
  }

  async suggestion(orgId: string, id: string): Promise<HsnSuggestionView> {
    const s = Types.ObjectId.isValid(id) ? await this.suggestionModel.findOne({ _id: id, orgId, kind: 'hsn' }).lean().exec() : null;
    if (!s) throw new NotFoundException('Suggestion not found');
    const result = s.result as (HsnGuess & { confidence: number }) | null;
    return {
      id,
      status: s.status,
      suggestion: s.status === 'done' && result ? { ...result, source: 'model', confidence: result.confidence } : null,
      message: s.status === 'none' ? s.reason : s.status === 'failed' ? 'The suggestion could not be made. Enter the code yourself, or try again.' : null,
    };
  }

  /** The job: ask the model, check what it says, keep it as advice. */
  async runModel(orgId: string, suggestionId: string): Promise<void> {
    const s = await this.suggestionModel.findOne({ _id: suggestionId, orgId, kind: 'hsn' }).exec();
    if (!s || s.status !== 'queued') return;
    const input = s.input as { name: string; description: string | null; kind: ItemKind | null };
    try {
      const answer = await this.model.ask(input);
      if (answer) await this.usageMeter.recordAiTokens(orgId, answer.tokensIn, answer.tokensOut);
      const guess = answer ? readHsnAnswer(answer.raw, input.kind) : null;
      if (guess) {
        const { confidence, reason, ...result } = guess;
        s.set({ status: 'done', source: 'model', result: { ...result, reason, confidence }, confidence, reason });
      } else {
        s.set({ status: 'none', reason: 'The AI could not give a valid code for this item. Enter the code from the vendor bill or the GST portal.' });
      }
      await s.save();
    } catch (err) {
      s.set({ status: 'failed', reason: err instanceof Error ? err.message.slice(0, 300) : String(err) });
      await s.save();
      throw err;
    }
  }

  /** Lines this org has already filed under a code, for an item of the same name. */
  private async fromHistory(orgId: string, name: string, kind: ItemKind | null): Promise<HsnSuggestionView['suggestion']> {
    const pattern = new RegExp(`^\\s*${escape(name.trim()).replace(/\s+/g, '\\s+')}\\s*$`, 'i');
    const pipeline = [
      { $match: { orgId, 'lineItems.description': pattern } },
      { $unwind: '$lineItems' },
      { $match: { 'lineItems.description': pattern, 'lineItems.hsnSac': { $nin: [null, ''] } } },
      { $group: { _id: { hsn: '$lineItems.hsnSac', rate: '$lineItems.taxRatePct' }, n: { $sum: 1 } } },
    ];
    const [sales, purchases] = await Promise.all([
      this.invoiceModel.aggregate<{ _id: { hsn: string; rate: number | null }; n: number }>(pipeline).exec(),
      this.billModel.aggregate<{ _id: { hsn: string; rate: number | null }; n: number }>(pipeline).exec(),
    ]);
    const counts = new Map<string, { hsn: string; rate: number | null; n: number }>();
    for (const row of [...sales, ...purchases]) {
      const key = `${row._id.hsn}|${row._id.rate}`;
      const c = counts.get(key) ?? { hsn: row._id.hsn.trim(), rate: row._id.rate ?? null, n: 0 };
      c.n += row.n;
      counts.set(key, c);
    }
    const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
    if (!best) return null;
    const bestKind: ItemKind = best.hsn.startsWith('99') ? 'service' : 'goods';
    if ((kind && bestKind !== kind) || hsnProblem(best.hsn, bestKind)) return null;
    const rate = best.rate !== null && (ITEM_GST_RATES as readonly number[]).includes(best.rate) ? best.rate : null;
    return {
      hsnSac: best.hsn,
      kind: bestKind,
      gstRatePct: rate,
      uqc: bestKind === 'service' ? 'NA' : 'NOS',
      reason: `Used on ${best.n} earlier ${best.n === 1 ? 'line' : 'lines'} for "${name}" in your books`,
      source: 'history',
      confidence: HISTORY_CONFIDENCE,
    };
  }

  private async checked(orgId: string, input: ItemInput, kind: ItemKind) {
    const name = input.name?.trim() ?? '';
    if (!name) throw new BadRequestException('Give the item a name.');
    const hsnSac = input.hsnSac?.replace(/\s/g, '') || null;
    if (hsnSac) {
      const problem = hsnProblem(hsnSac, kind);
      if (problem) throw new BadRequestException(problem);
    }
    const uqc = (input.uqc ?? (kind === 'service' ? 'NA' : 'NOS')).toUpperCase();
    if (!(UQC_CODES as readonly string[]).includes(uqc)) throw new BadRequestException(`${uqc} is not a GST unit code.`);
    if (kind === 'service' && uqc !== 'NA') throw new BadRequestException('A service has no unit of measure: its unit is NA.');
    if (kind === 'goods' && uqc === 'NA') throw new BadRequestException('Goods need a unit, such as NOS, KGS or LTR.');
    const rate = input.gstRatePct ?? null;
    if (rate !== null && !(ITEM_GST_RATES as readonly number[]).includes(rate)) throw new BadRequestException(`GST is charged at ${ITEM_GST_RATES.join(', ')}%; ${rate}% is not a slab.`);
    for (const [label, v] of [['Sale price', input.salePricePaise], ['Purchase price', input.purchasePricePaise]] as const) {
      if (v !== null && v !== undefined && !(Number.isInteger(v) && v >= 0)) throw new BadRequestException(`${label} must be a whole number of paise, not negative.`);
    }
    const incomeAccountId = await this.checkedAccount(orgId, input.incomeAccountId, [AccountType.INCOME], 'income');
    const expenseAccountId = await this.checkedAccount(orgId, input.expenseAccountId, [AccountType.EXPENSE, AccountType.ASSETS], 'expense or asset');
    return {
      name,
      nameKey: nameKey(name),
      code: input.code?.trim() || null,
      kind,
      hsnSac,
      hsnSource: hsnSac ? (input.hsnSource ? { by: input.hsnSource.by, reason: input.hsnSource.reason ?? null, confidence: input.hsnSource.confidence ?? null } : { by: 'person' as const, reason: null, confidence: null }) : null,
      uqc,
      gstRatePct: rate,
      salePricePaise: input.salePricePaise ?? null,
      purchasePricePaise: input.purchasePricePaise ?? null,
      incomeAccountId,
      expenseAccountId,
      description: input.description?.trim() || null,
      trackStock: kind === 'goods' && input.trackStock !== false,
      reorderLevel: kind === 'goods' && input.reorderLevel != null && input.reorderLevel >= 0 ? input.reorderLevel : null,
      reorderQty: kind === 'goods' && input.reorderQty != null && input.reorderQty > 0 ? input.reorderQty : null,
    };
  }

  private async checkedAccount(orgId: string, id: string | null | undefined, types: AccountType[], label: string): Promise<Types.ObjectId | null> {
    if (!id) return null;
    const account = Types.ObjectId.isValid(id) ? await this.accountModel.findOne({ _id: id, orgId }).lean().exec() : null;
    if (!account) throw new BadRequestException(`No such ${label} account.`);
    if (account.isGroup) throw new BadRequestException(`${account.name} is a group; pick an account under it.`);
    if (!account.isActive) throw new BadRequestException(`${account.name} is inactive.`);
    if (!types.includes(account.type)) throw new BadRequestException(`${account.name} is not an ${label} account.`);
    return account._id as Types.ObjectId;
  }

  private inputOf(item: ItemDocument): ItemInput {
    return {
      name: item.name,
      code: item.code,
      kind: item.kind,
      hsnSac: item.hsnSac,
      uqc: item.uqc,
      gstRatePct: item.gstRatePct,
      salePricePaise: item.salePricePaise,
      purchasePricePaise: item.purchasePricePaise,
      incomeAccountId: item.incomeAccountId ? String(item.incomeAccountId) : null,
      expenseAccountId: item.expenseAccountId ? String(item.expenseAccountId) : null,
      description: item.description,
      trackStock: item.trackStock,
      reorderLevel: item.reorderLevel,
      reorderQty: item.reorderQty,
      hsnSource: item.hsnSource && item.hsnSource.by !== 'person' ? { by: item.hsnSource.by, reason: item.hsnSource.reason, confidence: item.hsnSource.confidence } : null,
    };
  }

  private snapshot(item: ItemDocument) {
    return {
      name: item.name,
      kind: item.kind,
      hsnSac: item.hsnSac,
      hsnSource: item.hsnSource?.by ?? null,
      uqc: item.uqc,
      gstRatePct: item.gstRatePct,
      salePricePaise: item.salePricePaise,
      purchasePricePaise: item.purchasePricePaise,
      incomeAccountId: item.incomeAccountId ? String(item.incomeAccountId) : null,
      expenseAccountId: item.expenseAccountId ? String(item.expenseAccountId) : null,
      isActive: item.isActive,
    };
  }
}
