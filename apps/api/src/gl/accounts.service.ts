import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AuditService } from './audit.service';
import { Model, Types } from 'mongoose';
import { AccountType, JournalStatus } from '@ai-accounting/shared';
import {
  LedgerAccount,
  LedgerAccountDocument,
  SystemAccountKey,
} from './schemas/ledger-account.schema';
import { Journal, JournalDocument } from './schemas/journal.schema';
import { withOrg } from '../database/tenant.plugin';

export interface AccountListItem {
  _id: string;
  name: string;
  code: string;
  type: AccountType;
  parentId: string | null;
  isGroup: boolean;
  isSystem: boolean;
  systemKey?: string;
  /** False once deactivated: kept for history, closed to new postings. */
  isActive: boolean;
  balancePaise: number;
}

/** Only the fields given change. */
export interface UpdateAccountInput {
  name?: string;
  code?: string;
  /** A group of the same type, or null for top level. */
  parentId?: string | null;
  isActive?: boolean;
}

export interface CreateAccountInput {
  orgId: string;
  /** Who created it, for the audit trail. */
  actorId?: string;
  name: string;
  type: AccountType;
  code?: string;
  parentId?: string | null;
  isGroup?: boolean;
}

/**
 * Default chart of accounts seeded for every new organisation.
 * Codes follow the conventional Indian SME layout: 1xxx assets, 2xxx liabilities,
 * 3xxx capital, 4xxx income, 5xxx expenses.
 */
interface SeedNode {
  code: string;
  name: string;
  type: AccountType;
  isGroup?: boolean;
  systemKey?: SystemAccountKey;
  children?: SeedNode[];
}

const DEFAULT_COA: SeedNode[] = [
  {
    code: '1000',
    name: 'Current Assets',
    type: AccountType.ASSETS,
    isGroup: true,
    children: [
      { code: '1100', name: 'Bank Accounts', type: AccountType.ASSETS, systemKey: SystemAccountKey.BANK },
      { code: '1110', name: 'Cash in Hand', type: AccountType.ASSETS, systemKey: SystemAccountKey.CASH },
      { code: '1120', name: 'Payment Gateway Clearing', type: AccountType.ASSETS, systemKey: SystemAccountKey.PAYMENT_GATEWAY },
      {
        code: '1200',
        name: 'Accounts Receivable',
        type: AccountType.ASSETS,
        systemKey: SystemAccountKey.ACCOUNTS_RECEIVABLE,
      },
      {
        code: '1300',
        name: 'Input CGST',
        type: AccountType.ASSETS,
        systemKey: SystemAccountKey.GST_INPUT_CGST,
      },
      {
        code: '1310',
        name: 'Input SGST',
        type: AccountType.ASSETS,
        systemKey: SystemAccountKey.GST_INPUT_SGST,
      },
      {
        code: '1320',
        name: 'Input IGST',
        type: AccountType.ASSETS,
        systemKey: SystemAccountKey.GST_INPUT_IGST,
      },
      {
        code: '1330',
        name: 'Input Cess',
        type: AccountType.ASSETS,
        systemKey: SystemAccountKey.GST_INPUT_CESS,
      },
      {
        code: '1400',
        name: 'TDS Receivable',
        type: AccountType.ASSETS,
        systemKey: SystemAccountKey.TDS_RECEIVABLE,
      },
      { code: '1410', name: 'Advances to Vendors', type: AccountType.ASSETS, systemKey: SystemAccountKey.VENDOR_ADVANCES },
      { code: '1420', name: 'Prepaid Expenses', type: AccountType.ASSETS, systemKey: SystemAccountKey.PREPAID_EXPENSES },
    ],
  },
  {
    code: '1500',
    name: 'Fixed Assets',
    type: AccountType.ASSETS,
    isGroup: true,
    children: [
      { code: '1510', name: 'Office Equipment', type: AccountType.ASSETS },
      { code: '1520', name: 'Furniture & Fixtures', type: AccountType.ASSETS },
      { code: '1530', name: 'Computers & IT Equipment', type: AccountType.ASSETS },
      { code: '1590', name: 'Accumulated Depreciation', type: AccountType.ASSETS, systemKey: SystemAccountKey.ACCUMULATED_DEPRECIATION },
    ],
  },
  {
    code: '2000',
    name: 'Current Liabilities',
    type: AccountType.LIABILITIES,
    isGroup: true,
    children: [
      {
        code: '2100',
        name: 'Accounts Payable',
        type: AccountType.LIABILITIES,
        systemKey: SystemAccountKey.ACCOUNTS_PAYABLE,
      },
      {
        code: '2200',
        name: 'Output CGST',
        type: AccountType.LIABILITIES,
        systemKey: SystemAccountKey.GST_OUTPUT_CGST,
      },
      {
        code: '2210',
        name: 'Output SGST',
        type: AccountType.LIABILITIES,
        systemKey: SystemAccountKey.GST_OUTPUT_SGST,
      },
      {
        code: '2220',
        name: 'Output IGST',
        type: AccountType.LIABILITIES,
        systemKey: SystemAccountKey.GST_OUTPUT_IGST,
      },
      {
        code: '2230',
        name: 'Output Cess',
        type: AccountType.LIABILITIES,
        systemKey: SystemAccountKey.GST_OUTPUT_CESS,
      },
      {
        code: '2240',
        name: 'GST Payable (Reverse Charge)',
        type: AccountType.LIABILITIES,
        systemKey: SystemAccountKey.RCM_GST_PAYABLE,
      },
      { code: '2300', name: 'TDS Payable', type: AccountType.LIABILITIES, systemKey: SystemAccountKey.TDS_PAYABLE },
      { code: '2310', name: 'Advances from Customers', type: AccountType.LIABILITIES, systemKey: SystemAccountKey.CUSTOMER_ADVANCES },
      { code: '2320', name: 'Accrued Expenses', type: AccountType.LIABILITIES, systemKey: SystemAccountKey.ACCRUED_EXPENSES },
      { code: '2330', name: 'Employee Reimbursements Payable', type: AccountType.LIABILITIES, systemKey: SystemAccountKey.EMPLOYEE_PAYABLE },
    ],
  },
  {
    code: '3000',
    name: 'Capital Account',
    type: AccountType.CAPITAL,
    isGroup: true,
    children: [
      { code: '3100', name: "Owner's Capital", type: AccountType.CAPITAL },
      { code: '3200', name: 'Retained Earnings', type: AccountType.CAPITAL, systemKey: SystemAccountKey.RETAINED_EARNINGS },
    ],
  },
  {
    code: '4000',
    name: 'Revenue',
    type: AccountType.INCOME,
    isGroup: true,
    children: [
      {
        code: '4100',
        name: 'Sales Revenue',
        type: AccountType.INCOME,
        systemKey: SystemAccountKey.SALES_REVENUE,
      },
      { code: '4200', name: 'Service Revenue', type: AccountType.INCOME },
      { code: '4900', name: 'Other Income', type: AccountType.INCOME },
      { code: '4910', name: 'Gain on Sale of Assets', type: AccountType.INCOME, systemKey: SystemAccountKey.ASSET_DISPOSAL_GAIN },
    ],
  },
  {
    code: '5000',
    name: 'Direct Expenses',
    type: AccountType.EXPENSE,
    isGroup: true,
    children: [
      {
        code: '5100',
        name: 'Purchases',
        type: AccountType.EXPENSE,
        systemKey: SystemAccountKey.PURCHASE_EXPENSE,
      },
      { code: '5200', name: 'Freight & Carriage', type: AccountType.EXPENSE },
    ],
  },
  {
    code: '6000',
    name: 'Indirect Expenses',
    type: AccountType.EXPENSE,
    isGroup: true,
    children: [
      { code: '6100', name: 'Rent', type: AccountType.EXPENSE },
      { code: '6110', name: 'Salaries & Wages', type: AccountType.EXPENSE },
      { code: '6120', name: 'Electricity & Utilities', type: AccountType.EXPENSE },
      { code: '6130', name: 'Telephone & Internet', type: AccountType.EXPENSE },
      { code: '6140', name: 'Travelling & Conveyance', type: AccountType.EXPENSE },
      { code: '6150', name: 'Professional Fees', type: AccountType.EXPENSE },
      { code: '6160', name: 'Repairs & Maintenance', type: AccountType.EXPENSE },
      { code: '6170', name: 'Office & Stationery', type: AccountType.EXPENSE },
      { code: '6180', name: 'Advertising & Marketing', type: AccountType.EXPENSE },
      { code: '6190', name: 'Bank Charges', type: AccountType.EXPENSE },
      { code: '6195', name: 'Depreciation', type: AccountType.EXPENSE, systemKey: SystemAccountKey.DEPRECIATION },
      { code: '6196', name: 'Loss on Sale of Assets', type: AccountType.EXPENSE, systemKey: SystemAccountKey.ASSET_DISPOSAL_LOSS },
      { code: '6900', name: 'Miscellaneous Expenses', type: AccountType.EXPENSE },
      { code: '6990', name: 'Round Off', type: AccountType.EXPENSE, systemKey: SystemAccountKey.ROUND_OFF },
      { code: '6999', name: 'Suspense', type: AccountType.EXPENSE, systemKey: SystemAccountKey.SUSPENSE },
    ],
  },
];

/** Asset and expense accounts increase on the debit side; the rest increase on credit. */
function isDebitPositive(type: AccountType): boolean {
  return type === AccountType.ASSETS || type === AccountType.EXPENSE;
}

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    @InjectModel(LedgerAccount.name)
    private accountModel: Model<LedgerAccountDocument>,
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
    private auditService: AuditService,
  ) {}

  /**
   * Create the default chart of accounts for an org. Idempotent — if any account
   * already exists for the org this is a no-op, so it is safe to call on every login.
   */
  async seedDefaults(orgId: string): Promise<number> {
    const existing = await withOrg(orgId, () =>
      this.accountModel.countDocuments({}).exec(),
    );
    if (existing > 0) return 0;

    let created = 0;
    for (const group of DEFAULT_COA) {
      const parent = await this.accountModel.create({
        orgId,
        name: group.name,
        code: group.code,
        type: group.type,
        parentId: null,
        isGroup: group.isGroup ?? true,
        isSystem: true,
        systemKey: group.systemKey,
      });
      created++;

      for (const child of group.children ?? []) {
        await this.accountModel.create({
          orgId,
          name: child.name,
          code: child.code,
          type: child.type,
          parentId: parent._id,
          isGroup: false,
          isSystem: true,
          systemKey: child.systemKey,
        });
        created++;
      }
    }

    this.logger.log(`Seeded ${created} default ledger accounts for org ${orgId}`);
    return created;
  }

  /**
   * Add any system account the default chart now has but this org's chart
   * predates. seedDefaults does nothing once an org has accounts, so without
   * this a new system account (TDS Receivable, say) would be missing for every
   * existing business and every posting that needs it would fail.
   *
   * An account already sitting at the default code with the default name is
   * adopted rather than duplicated — older charts had TDS Payable and Retained
   * Earnings, just without a system key.
   */
  async ensureSystemAccounts(orgId: string): Promise<number> {
    let added = 0;
    for (const group of DEFAULT_COA) {
      for (const node of [group, ...(group.children ?? [])]) {
        if (!node.systemKey) continue;
        const has = await withOrg(orgId, () => this.accountModel.exists({ systemKey: node.systemKey }).exec());
        if (has) continue;

        const sameSlot = await withOrg(orgId, () =>
          this.accountModel.findOne({ code: node.code, name: node.name, systemKey: { $exists: false } }).exec(),
        );
        if (sameSlot) {
          await withOrg(orgId, () =>
            this.accountModel.updateOne({ _id: sameSlot._id }, { $set: { systemKey: node.systemKey, isSystem: true } }).exec(),
          );
          added++;
          continue;
        }

        const parent =
          node === group
            ? null
            : await withOrg(orgId, () => this.accountModel.findOne({ code: group.code, isGroup: true }).exec());
        const code = await this.freeCode(orgId, node.code);
        await this.accountModel.create({
          orgId,
          name: node.name,
          code,
          type: node.type,
          parentId: parent?._id ?? null,
          isGroup: node === group ? (group.isGroup ?? true) : false,
          isSystem: true,
          systemKey: node.systemKey,
        });
        added++;
      }
    }
    if (added) this.logger.log(`Added ${added} missing system account(s) for org ${orgId}`);
    return added;
  }

  /** `preferred`, or the next code after it nobody holds. */
  private async freeCode(orgId: string, preferred: string): Promise<string> {
    for (let n = Number(preferred); n < Number(preferred) + 100; n++) {
      const code = String(n);
      const taken = await withOrg(orgId, () => this.accountModel.exists({ code }).exec());
      if (!taken) return code;
    }
    throw new Error(`No free account code near ${preferred}`);
  }

  /** Resolve a system account by its stable key, seeding the chart first if needed. */
  async resolveSystemAccount(
    orgId: string,
    key: SystemAccountKey,
  ): Promise<LedgerAccountDocument> {
    let account = await withOrg(orgId, () =>
      this.accountModel.findOne({ systemKey: key }).exec(),
    );

    if (!account) {
      await this.seedDefaults(orgId);
      await this.ensureSystemAccounts(orgId);
      account = await withOrg(orgId, () =>
        this.accountModel.findOne({ systemKey: key }).exec(),
      );
    }

    if (!account) {
      throw new NotFoundException(`System account "${key}" is not configured for this org.`);
    }
    return account;
  }

  /**
   * Resolve several system accounts at once.
   *
   * Not the same as calling resolveSystemAccount in a Promise.all: on an org
   * whose chart has not been seeded yet, every one of those calls would find
   * nothing and start its own seed, and the concurrent inserts collide on the
   * unique (orgId, code) index. Whichever seed lost the race then re-read an
   * only partly written chart and reported the account missing — on the org's
   * very first posting, which is exactly when nothing is seeded.
   *
   * Seeding once up front and then reading every key in a single query removes
   * the race and the round trips together.
   */
  async resolveSystemAccounts(
    orgId: string,
    keys: SystemAccountKey[],
  ): Promise<Map<SystemAccountKey, LedgerAccountDocument>> {
    const unique = [...new Set(keys)];

    const load = async () => {
      const accounts = await withOrg(orgId, () =>
        this.accountModel.find({ systemKey: { $in: unique } }).exec(),
      );
      return new Map(accounts.map((a) => [a.systemKey as SystemAccountKey, a]));
    };

    let found = await load();
    if (found.size < unique.length) {
      await this.seedDefaults(orgId);
      found = await load();
    }
    if (found.size < unique.length) {
      // An org seeded before these system accounts existed.
      await this.ensureSystemAccounts(orgId);
      found = await load();
    }

    const missing = unique.filter((k) => !found.has(k));
    if (missing.length > 0) {
      throw new NotFoundException(
        `System account${missing.length > 1 ? 's' : ''} ${missing.join(', ')} not configured for this org.`,
      );
    }
    return found;
  }

  /** Names of this org's accounts by id, for journal line descriptions. */
  async namesOf(orgId: string, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const accounts = await withOrg(orgId, () => this.accountModel.find({ _id: { $in: ids } }, { name: 1 }).lean().exec());
    return new Map(accounts.map((a) => [String(a._id), a.name]));
  }

  /**
   * Find the best posting account for a free-text expense/income description.
   * Used by the AI proposal builder to map "Zomato — food delivery" onto a real
   * ledger account instead of inventing one. Falls back to the given system key.
   */
  async findByNameOrFallback(
    orgId: string,
    name: string | null | undefined,
    fallback: SystemAccountKey,
  ): Promise<LedgerAccountDocument> {
    if (name && name.trim()) {
      const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = await withOrg(orgId, () =>
        this.accountModel
          .findOne({ isGroup: false, isActive: true, name: new RegExp(`^${escaped}$`, 'i') })
          .exec(),
      );
      if (match) return match;
    }
    return this.resolveSystemAccount(orgId, fallback);
  }

  /** All accounts for the org with running balances derived from posted journals. */
  async list(orgId: string): Promise<AccountListItem[]> {
    await this.seedDefaults(orgId);

    const accounts = await withOrg(orgId, () =>
      this.accountModel.find({}).sort({ code: 1 }).exec(),
    );

    const balances = await this.balancesByAccount(orgId);

    // Roll child balances up into their parent group so group rows show a total.
    const own = new Map<string, number>();
    for (const a of accounts) {
      const id = a._id.toString();
      const raw = balances.get(id) ?? 0;
      own.set(id, isDebitPositive(a.type) ? raw : -raw);
    }

    const rolled = new Map(own);
    for (const a of accounts) {
      const parentId = a.parentId?.toString();
      if (!parentId) continue;
      rolled.set(parentId, (rolled.get(parentId) ?? 0) + (own.get(a._id.toString()) ?? 0));
    }

    return accounts.map((a) => ({
      _id: a._id.toString(),
      name: a.name,
      code: a.code,
      type: a.type,
      parentId: a.parentId ? a.parentId.toString() : null,
      isGroup: a.isGroup,
      isSystem: a.isSystem,
      systemKey: a.systemKey,
      isActive: a.isActive !== false,
      balancePaise: rolled.get(a._id.toString()) ?? 0,
    }));
  }

  /** Net (debit − credit) paise per account across all posted journals. */
  private async balancesByAccount(orgId: string): Promise<Map<string, number>> {
    const rows = await this.journalModel
      .aggregate<{ _id: Types.ObjectId; net: number }>([
        { $match: { orgId, status: JournalStatus.POSTED } },
        { $unwind: '$lines' },
        {
          $group: {
            _id: '$lines.accountId',
            net: { $sum: { $subtract: ['$lines.debitPaise', '$lines.creditPaise'] } },
          },
        },
      ])
      .exec();

    return new Map(rows.map((r) => [r._id?.toString(), r.net]));
  }

  async create(input: CreateAccountInput): Promise<LedgerAccountDocument> {
    const { orgId, name, type, parentId } = input;

    if (parentId && !Types.ObjectId.isValid(parentId)) {
      throw new BadRequestException('Invalid parent account.');
    }

    const code = input.code?.trim() || (await this.nextCodeForType(orgId, type));

    const clash = await withOrg(orgId, () => this.accountModel.findOne({ code }).exec());
    if (clash) throw new BadRequestException(`Account code "${code}" is already in use.`);

    const account = await this.accountModel.create({
      orgId,
      name: name.trim(),
      code,
      type,
      parentId: parentId ? new Types.ObjectId(parentId) : null,
      isGroup: input.isGroup ?? false,
      isSystem: false,
    });
    await this.auditService.record({
      orgId,
      entityType: 'LedgerAccount',
      entityId: account._id.toString(),
      action: 'CREATE',
      performedBy: input.actorId ?? 'unknown',
      after: { name: account.name, code: account.code, type: account.type },
    });
    return account;
  }

  /**
   * Rename, recode, move under another group, or deactivate an account.
   *
   * The type never changes: it decides which statement every past entry on
   * the account appears in. A deactivated account keeps its history and
   * still shows in reports, but nothing new can be posted to it. A system
   * account (Bank, GST, Receivables…) can be renamed and moved, but not
   * deactivated: postings depend on it.
   */
  async update(orgId: string, actorId: string, id: string, input: UpdateAccountInput): Promise<AccountListItem> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Account not found.');
    const account = await withOrg(orgId, () => this.accountModel.findById(id).exec());
    if (!account) throw new NotFoundException('Account not found.');
    const set: Record<string, unknown> = {};

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('Account name is required.');
      if (name.length > 120) throw new BadRequestException('The name can be at most 120 characters.');
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const twin = await withOrg(orgId, () =>
        this.accountModel.findOne({ _id: { $ne: account._id }, isGroup: account.isGroup, name: new RegExp(`^${escaped}$`, 'i') }).exec(),
      );
      if (twin) throw new BadRequestException(`Another ${account.isGroup ? 'group' : 'account'} is already called "${twin.name}" (${twin.code}).`);
      set.name = name;
    }

    if (input.code !== undefined) {
      const code = input.code.trim();
      if (!/^[A-Za-z0-9.-]{1,12}$/.test(code)) throw new BadRequestException('A code is 1 to 12 letters, digits, dots or dashes.');
      const clash = await withOrg(orgId, () => this.accountModel.findOne({ _id: { $ne: account._id }, code }).exec());
      if (clash) throw new BadRequestException(`Account code "${code}" is already in use by ${clash.name}.`);
      set.code = code;
    }

    if (input.parentId !== undefined) {
      const parentId = input.parentId;
      if (parentId === null) {
        set.parentId = null;
      } else {
        if (!Types.ObjectId.isValid(parentId)) throw new BadRequestException('Invalid parent group.');
        const parent = await withOrg(orgId, () => this.accountModel.findById(parentId).exec());
        if (!parent || !parent.isGroup) throw new BadRequestException('An account can only be moved under a group.');
        if (parent.type !== account.type) {
          const kind = { ASSETS: 'an asset', LIABILITIES: 'a liability', INCOME: 'an income', EXPENSE: 'an expense', CAPITAL: 'a capital' }[account.type];
          throw new BadRequestException(`This is ${kind} account, so it can only go under ${kind} group.`);
        }
        // A group cannot go under itself or one of its own sub-groups.
        for (let at: typeof parent | null = parent, depth = 0; at && depth < 50; depth++) {
          if (at._id.equals(account._id)) throw new BadRequestException('A group cannot be moved under itself or one of its own sub-groups.');
          const up: Types.ObjectId | null = (at.parentId as unknown as Types.ObjectId | null) ?? null;
          at = up ? await withOrg(orgId, () => this.accountModel.findById(up).exec()) : null;
        }
        set.parentId = parent._id;
      }
    }

    if (input.isActive !== undefined && input.isActive !== account.isActive) {
      if (!input.isActive) {
        if (account.isSystem || account.systemKey) {
          throw new BadRequestException(`${account.name} is one the books depend on, so it cannot be deactivated. Rename it instead.`);
        }
        const children = await withOrg(orgId, () => this.accountModel.countDocuments({ parentId: account._id, isActive: { $ne: false } }).exec());
        if (children > 0) throw new BadRequestException(`Move or deactivate the ${children} account${children === 1 ? '' : 's'} under ${account.name} first.`);
        const balance = (await this.balancesByAccount(orgId)).get(account._id.toString()) ?? 0;
        if (balance !== 0) {
          throw new BadRequestException(
            `${account.name} has a balance of ${(Math.abs(balance) / 100).toFixed(2)} ${balance > 0 ? 'Dr' : 'Cr'}. Move it to another account with a journal first.`,
          );
        }
      }
      set.isActive = input.isActive;
    }

    const changed = Object.keys(set).filter((k) => String(set[k]) !== String((account as unknown as Record<string, unknown>)[k] ?? null));
    if (changed.length > 0) {
      await withOrg(orgId, () => this.accountModel.updateOne({ _id: account._id }, { $set: set }).exec());
      await this.auditService.record({
        orgId,
        entityType: 'LedgerAccount',
        entityId: id,
        action: set.isActive === false && changed.includes('isActive') ? 'DEACTIVATE' : set.isActive === true && changed.includes('isActive') ? 'REACTIVATE' : 'UPDATE',
        performedBy: actorId,
        before: Object.fromEntries(changed.map((k) => [k, (account as unknown as Record<string, unknown>)[k] ?? null])),
        after: Object.fromEntries(changed.map((k) => [k, set[k]])),
      });
    }
    return (await this.list(orgId)).find((a) => a._id === id)!;
  }

  /** Next free code in the block that belongs to this account type. */
  private async nextCodeForType(orgId: string, type: AccountType): Promise<string> {
    const base: Record<AccountType, number> = {
      [AccountType.ASSETS]: 1000,
      [AccountType.LIABILITIES]: 2000,
      [AccountType.CAPITAL]: 3000,
      [AccountType.INCOME]: 4000,
      [AccountType.EXPENSE]: 6000,
    };
    const start = base[type];

    const used = await withOrg(orgId, () =>
      this.accountModel.find({ type }).select('code').exec(),
    );
    const taken = new Set(used.map((a) => a.code));

    for (let n = start + 1; n < start + 1000; n++) {
      const candidate = String(n);
      if (!taken.has(candidate)) return candidate;
    }
    throw new BadRequestException(`No free account code left in the ${type} range.`);
  }
}
