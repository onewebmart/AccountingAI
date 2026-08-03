import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
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
  balancePaise: number;
}

export interface CreateAccountInput {
  orgId: string;
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
      { code: '2300', name: 'TDS Payable', type: AccountType.LIABILITIES },
    ],
  },
  {
    code: '3000',
    name: 'Capital Account',
    type: AccountType.CAPITAL,
    isGroup: true,
    children: [
      { code: '3100', name: "Owner's Capital", type: AccountType.CAPITAL },
      { code: '3200', name: 'Retained Earnings', type: AccountType.CAPITAL },
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

    return this.accountModel.create({
      orgId,
      name: name.trim(),
      code,
      type,
      parentId: parentId ? new Types.ObjectId(parentId) : null,
      isGroup: input.isGroup ?? false,
      isSystem: false,
    });
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
