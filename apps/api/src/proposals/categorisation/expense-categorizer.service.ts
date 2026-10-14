import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccountType } from '@ai-accounting/shared';
import { LedgerAccount, LedgerAccountDocument, SystemAccountKey } from '../../gl/schemas/ledger-account.schema';
import { AccountsService } from '../../gl/accounts.service';
import { LearningService } from '../learning.service';
import { CATEGORY_MODEL, CategoryModel } from './category-model';
import { CategoryKind, ruleFor } from './category-rules';

export interface CategoryInput {
  kind: CategoryKind;
  partyName?: string | null;
  narration?: string | null;
  lines?: Array<{ description?: string | null; hsnSac?: string | null }>;
  amountPaise: number;
}

export interface CategorySuggestion {
  accountId: string;
  accountCode: string;
  accountName: string;
  /** 0–1. An AI pick is never above 0.8: a person confirms it. */
  confidence: number;
  /** learned: a person filed this party here before. rule: an HSN/SAC code or keyword. ai: the model. default: nothing fit. */
  source: 'learned' | 'rule' | 'ai' | 'default';
  reason: string;
}

/** The most the model's own confidence can count for. */
const AI_CEILING = 0.8;

/** Accounts never offered as a category: they are the plumbing of postings. */
const NOT_A_CATEGORY = new Set<string>([
  SystemAccountKey.ROUND_OFF,
  SystemAccountKey.BANK,
  SystemAccountKey.CASH,
  SystemAccountKey.ACCOUNTS_PAYABLE,
  SystemAccountKey.ACCOUNTS_RECEIVABLE,
  SystemAccountKey.SALES_REVENUE,
]);

/**
 * Picks the account a cost (or a stray bank receipt) belongs in.
 *
 * It tries, in order: where a person filed this party before; a rule an
 * HSN/SAC code or the narration makes plain; the model, choosing only from
 * this org's own accounts; and last, Purchases for a bill or Suspense for a
 * bank line. Every answer carries its source and reason, so the reviewer sees
 * why — and nothing it suggests is posted until a person approves it.
 */
@Injectable()
export class ExpenseCategorizerService {
  private readonly logger = new Logger(ExpenseCategorizerService.name);

  constructor(
    @InjectModel(LedgerAccount.name) private accountModel: Model<LedgerAccountDocument>,
    private accounts: AccountsService,
    private learning: LearningService,
    @Inject(CATEGORY_MODEL) private model: CategoryModel,
  ) {}

  async suggest(orgId: string, input: CategoryInput): Promise<CategorySuggestion> {
    const chart = await this.candidates(orgId, input.kind);
    const byId = new Map(chart.map((a) => [a._id.toString(), a]));
    const pick = (a: (typeof chart)[number], confidence: number, source: CategorySuggestion['source'], reason: string): CategorySuggestion => ({
      accountId: a._id.toString(),
      accountCode: a.code,
      accountName: a.name,
      confidence,
      source,
      reason,
    });

    // 1. A person's past choice for this party.
    if (input.partyName) {
      const learned = await this.learning.getMapping(orgId, input.partyName);
      const account = learned && byId.get(learned.ledgerAccountId);
      if (account) return pick(account, 0.9, 'learned', `You filed ${input.partyName} under ${account.name} before`);
    }

    // 2. A rule the codes or words make plain — if this org has that account.
    const hit = ruleFor(input);
    if (hit) {
      const account =
        chart.find((a) => a.code === hit.code && a.name.toLowerCase() === hit.name.toLowerCase()) ??
        chart.find((a) => a.name.toLowerCase() === hit.name.toLowerCase());
      if (account) return pick(account, hit.confidence, 'rule', hit.reason);
    }

    // 3. The model, choosing from this org's accounts only.
    if (this.model.available && (input.partyName || input.narration || input.lines?.some((l) => l.description))) {
      try {
        const choice = await this.model.choose({
          kind: input.kind,
          partyName: input.partyName ?? null,
          narration: input.narration ?? null,
          lines: (input.lines ?? []).map((l) => ({ description: l.description ?? null, hsnSac: l.hsnSac ?? null })),
          amountPaise: input.amountPaise,
          accounts: chart.map((a) => ({ code: a.code, name: a.name })),
        });
        const account = choice && chart.find((a) => a.code === choice.code);
        if (choice && account) {
          const confidence = Math.max(0.1, Math.min(AI_CEILING, choice.confidence));
          return pick(account, confidence, 'ai', choice.reason);
        }
        if (choice) this.logger.warn(`Model chose ${choice.code}, which is not an account of org ${orgId}`);
      } catch (err) {
        // The model is a nice-to-have; the proposal still gets a safe default.
        this.logger.warn(`Category model failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 4. Nothing fit.
    const fallbackKey = input.kind === 'bill' ? SystemAccountKey.PURCHASE_EXPENSE : SystemAccountKey.SUSPENSE;
    const fallback = await this.accounts.resolveSystemAccount(orgId, fallbackKey);
    return {
      accountId: fallback._id.toString(),
      accountCode: fallback.code,
      accountName: fallback.name,
      confidence: input.kind === 'bill' ? 0.3 : 0.2,
      source: 'default',
      reason: input.kind === 'bill' ? 'No rule or past choice fits; check the account' : 'Unrecognised; choose the account',
    };
  }

  /**
   * Accounts this kind of transaction may be filed under: expenses (and
   * fixed assets, for a bill) going out, income coming in, and Suspense.
   */
  private async candidates(orgId: string, kind: CategoryKind) {
    await this.accounts.seedDefaults(orgId);
    const types =
      kind === 'deposit' ? [AccountType.INCOME] : kind === 'bill' ? [AccountType.EXPENSE, AccountType.ASSETS] : [AccountType.EXPENSE];
    const all = await this.accountModel
      .find({ orgId, isGroup: false, isActive: { $ne: false }, type: { $in: [...types, AccountType.EXPENSE] } })
      .sort({ code: 1 })
      .lean()
      .exec();
    return all.filter((a) => {
      if (a.systemKey && NOT_A_CATEGORY.has(a.systemKey)) return false;
      if (a.type === AccountType.ASSETS) return kind === 'bill' && !a.systemKey && a.code.startsWith('15'); // fixed assets only
      if (a.type === AccountType.EXPENSE) return kind !== 'deposit' || a.systemKey === SystemAccountKey.SUSPENSE;
      return types.includes(a.type);
    });
  }
}
