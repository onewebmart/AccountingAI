/**
 * The detailed account type: every one maps to a base type, the default
 * chart gets the right ones, accounts saved before it existed derive them,
 * and creating or editing keeps the base type (which every report uses).
 *
 *  ✓ Each detailed type belongs to one base type
 *  ✓ The default chart's accounts and groups get the expected detailed types
 *  ✓ An account saved without one derives the same type from its key, name and group
 *  ✓ Custom accounts derive a sensible type from their names
 *  ✓ Create: the detailed type sets the base type; a mismatch, a group of another type, a long description are refused
 *  ✓ Edit: the type changes within the base type only, never on a system account; watchlist is audited
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { AccountType } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { AccountsService } from './accounts.service';
import { AuditService } from './audit.service';
import { ACCOUNT_SUBTYPES, ACCOUNT_SUBTYPE_KEYS, baseTypeOf, deriveAccountSubtype } from './account-subtypes';
import { isMoneyAccount } from './money-accounts';
import { Journal, JournalSchema } from './schemas/journal.schema';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema, SystemAccountKey } from './schemas/ledger-account.schema';

const ACTOR = new Types.ObjectId().toString();

let moduleRef: TestingModule;
let accounts: AccountsService;
let accountModel: Model<LedgerAccount>;
let audit: Model<{ orgId: string; entityId: string; action: string; after: Record<string, unknown> }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: Journal.name, schema: JournalSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
      ]),
    ],
    providers: [AccountsService, AuditService],
  }).compile();
  accounts = moduleRef.get(AccountsService);
  accountModel = moduleRef.get(getModelToken(LedgerAccount.name));
  audit = moduleRef.get(getModelToken(AuditLog.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

/** The default chart, code → detailed type. */
const EXPECTED: Record<string, string> = {
  '1000': 'other_current_asset', '1100': 'bank', '1110': 'cash', '1120': 'payment_clearing', '1200': 'other_current_asset',
  '1300': 'input_tax', '1310': 'input_tax', '1320': 'input_tax', '1330': 'input_tax', '1400': 'other_current_asset',
  '1410': 'other_current_asset', '1420': 'other_current_asset', '1430': 'stock',
  '1500': 'fixed_asset', '1510': 'fixed_asset', '1520': 'fixed_asset', '1530': 'fixed_asset', '1590': 'fixed_asset',
  '2000': 'other_current_liability', '2100': 'other_current_liability', '2200': 'output_tax', '2210': 'output_tax', '2220': 'output_tax',
  '2230': 'output_tax', '2240': 'output_tax', '2300': 'other_current_liability', '2310': 'other_current_liability',
  '2320': 'other_current_liability', '2330': 'other_current_liability',
  '3000': 'equity', '3100': 'equity', '3200': 'equity',
  '4000': 'income', '4100': 'income', '4200': 'income', '4900': 'other_income', '4910': 'other_income', '4920': 'other_income',
  '5000': 'cost_of_goods_sold', '5100': 'cost_of_goods_sold', '5200': 'cost_of_goods_sold', '5300': 'cost_of_goods_sold',
  '6000': 'expense', '6100': 'expense', '6110': 'expense', '6120': 'expense', '6130': 'expense', '6140': 'expense', '6150': 'expense',
  '6160': 'expense', '6170': 'expense', '6180': 'expense', '6190': 'expense', '6195': 'expense',
  '6196': 'other_expense', '6197': 'other_expense', '6900': 'expense', '6990': 'other_expense', '6999': 'other_expense',
};

describe('detailed account types', () => {
  it('each belongs to one base type, and there are the nineteen of the list', () => {
    expect(ACCOUNT_SUBTYPE_KEYS).toHaveLength(19);
    const byBase = (t: AccountType) => ACCOUNT_SUBTYPE_KEYS.filter((k) => baseTypeOf(k) === t).map((k) => ACCOUNT_SUBTYPES[k].label);
    expect(byBase(AccountType.ASSETS)).toEqual(['Other Asset', 'Other Current Asset', 'Cash', 'Bank', 'Fixed Asset', 'Stock', 'Payment Clearing', 'Input Tax']);
    expect(byBase(AccountType.LIABILITIES)).toEqual(['Other Current Liability', 'Credit Card', 'Long Term Liability', 'Other Liability', 'Output Tax']);
    expect(byBase(AccountType.CAPITAL)).toEqual(['Equity']);
    expect(byBase(AccountType.INCOME)).toEqual(['Income', 'Other Income']);
    expect(byBase(AccountType.EXPENSE)).toEqual(['Expense', 'Cost of Goods Sold', 'Other Expense']);
  });

  it('gives the default chart the expected types, stored and derived alike', async () => {
    const orgId = new Types.ObjectId().toString();
    const seeded = await accounts.list(orgId);
    expect(Object.fromEntries(seeded.map((a) => [a.code, a.accountType]))).toEqual(EXPECTED);

    // A chart saved before detailed types existed derives the same.
    await accountModel.updateMany({ orgId }, { $unset: { accountType: 1 } }).exec();
    const derived = await accounts.list(orgId);
    expect(Object.fromEntries(derived.map((a) => [a.code, a.accountType]))).toEqual(EXPECTED);
    for (const a of derived) expect(baseTypeOf(a.accountType)).toBe(a.type);
  });

  it('derives a sensible type for custom accounts from their names', () => {
    const d = (name: string, type: AccountType, parent?: string) => deriveAccountSubtype({ name, type }, parent ? { name: parent, type } : null);
    expect(d('HDFC Current A/c', AccountType.ASSETS)).toBe('bank');
    expect(d('Petty Cash', AccountType.ASSETS)).toBe('cash');
    expect(d('Razorpay Clearing', AccountType.ASSETS)).toBe('payment_clearing');
    expect(d('Delivery Van', AccountType.ASSETS, 'Fixed Assets')).toBe('fixed_asset');
    expect(d('Security Deposit - Office', AccountType.ASSETS)).toBe('other_current_asset');
    expect(d('Goodwill', AccountType.ASSETS)).toBe('other_asset');
    expect(d('Corporate Credit Card', AccountType.LIABILITIES)).toBe('credit_card');
    expect(d('Term Loan from SBI', AccountType.LIABILITIES)).toBe('long_term_liability');
    expect(d('Short-term loan from director', AccountType.LIABILITIES)).toBe('other_current_liability');
    expect(d('Salary Payable', AccountType.LIABILITIES)).toBe('other_current_liability');
    expect(d('Interest Received', AccountType.INCOME)).toBe('other_income');
    expect(d('Consulting Fees', AccountType.INCOME)).toBe('income');
    expect(d('Raw Material Purchases', AccountType.EXPENSE)).toBe('cost_of_goods_sold');
    expect(d('Penalty on late filing', AccountType.EXPENSE)).toBe('other_expense');
    expect(d('Software Subscriptions', AccountType.EXPENSE)).toBe('expense');
    // A system key decides, whatever the name says.
    expect(deriveAccountSubtype({ name: 'Cash at HDFC', type: AccountType.ASSETS, systemKey: SystemAccountKey.BANK })).toBe('bank');
    // An asset typed Bank is a money account, whatever its name.
    expect(isMoneyAccount({ name: 'Kotak 4471', type: AccountType.ASSETS, accountType: 'bank' })).toBe(true);
    expect(isMoneyAccount({ name: 'Kotak 4471', type: AccountType.ASSETS, accountType: 'other_current_asset' })).toBe(false);
  });

  it('creates an account from its detailed type, and refuses what does not fit', async () => {
    const orgId = new Types.ObjectId().toString();
    const chart = await accounts.list(orgId);
    const group = (code: string) => chart.find((a) => a.code === code)!._id;

    const card = await accounts.create({ orgId, actorId: ACTOR, name: 'HDFC Business Card', accountType: 'credit_card', parentId: group('2000'), description: 'Card ending 4471', watchlist: true });
    expect(card).toMatchObject({ type: AccountType.LIABILITIES, accountType: 'credit_card', description: 'Card ending 4471', watchlist: true });
    const listed = (await accounts.list(orgId)).find((a) => a._id === String(card._id))!;
    expect(listed).toMatchObject({ accountType: 'credit_card', watchlist: true, parentId: group('2000') });

    // Without a detailed type, it is derived from the name and the group.
    const plain = await accounts.create({ orgId, actorId: ACTOR, name: 'Interest on FD', type: AccountType.INCOME });
    expect(plain.accountType).toBe('other_income');

    await expect(accounts.create({ orgId, actorId: ACTOR, name: 'Mixed', type: AccountType.EXPENSE, accountType: 'bank' })).rejects.toThrow(/not a type of expense account/);
    await expect(accounts.create({ orgId, actorId: ACTOR, name: 'Wrong group', accountType: 'expense', parentId: group('1000') })).rejects.toThrow(/choose a group of the same type/);
    await expect(accounts.create({ orgId, actorId: ACTOR, name: 'Long', accountType: 'expense', description: 'x'.repeat(501) })).rejects.toThrow(/500 characters/);
    await expect(accounts.create({ orgId, actorId: ACTOR, name: 'rent', accountType: 'expense' })).rejects.toThrow(/already called "Rent"/);
  });

  it('changes the type within the base type only, never on a system account, and audits the watchlist', async () => {
    const orgId = new Types.ObjectId().toString();
    const chart = await accounts.list(orgId);
    const repairs = chart.find((a) => a.name === 'Repairs & Maintenance')!;
    const bank = chart.find((a) => a.systemKey === SystemAccountKey.BANK)!;

    await expect(accounts.update(orgId, ACTOR, repairs._id, { accountType: 'cost_of_goods_sold' })).resolves.toMatchObject({ accountType: 'cost_of_goods_sold', type: AccountType.EXPENSE });
    await expect(accounts.update(orgId, ACTOR, repairs._id, { accountType: 'bank' })).rejects.toThrow(/This is an expense account, so it can only become another expense type/);
    await expect(accounts.update(orgId, ACTOR, bank._id, { accountType: 'cash' })).rejects.toThrow(/its type stays bank/);
    await expect(accounts.update(orgId, ACTOR, bank._id, { accountType: 'bank', watchlist: true, description: 'Main current account' })).resolves.toMatchObject({ watchlist: true, description: 'Main current account' });
    await accounts.update(orgId, ACTOR, bank._id, { watchlist: false });

    const trail = await audit.find({ orgId, entityId: bank._id }).sort({ _id: 1 }).lean().exec();
    expect(trail.map((a) => a.action)).toEqual(['UPDATE', 'UNWATCH']);
  });
});
