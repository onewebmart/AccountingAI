/**
 * Integration tests — editing the chart of accounts.
 *
 *  ✓ Rename, recode and move an account under another group of its type, audited
 *  ✓ Refused: a duplicate name or code, a group of another type, a group under its own sub-group
 *  ✓ Deactivation: refused for system accounts, groups with live children, and accounts with a balance
 *  ✓ Nothing posts to a deactivated account or a group; a reversal still can
 *  ✓ Reactivating opens it again
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { AccountType, VoucherType } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { AccountsService } from './accounts.service';
import { PostingService } from './posting.service';
import { AuditService } from './audit.service';
import { Journal, JournalSchema } from './schemas/journal.schema';
import { Counter, CounterSchema } from './schemas/counter.schema';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema, SystemAccountKey } from './schemas/ledger-account.schema';
import { PeriodLock, PeriodLockSchema } from './schemas/period-lock.schema';

const ACTOR = new Types.ObjectId().toString();

let moduleRef: TestingModule;
let accounts: AccountsService;
let posting: PostingService;
let audit: Model<{ entityId: string; action: string; before: Record<string, unknown>; after: Record<string, unknown> }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: PeriodLock.name, schema: PeriodLockSchema },
      ]),
    ],
    providers: [AccountsService, PostingService, AuditService],
  }).compile();
  accounts = moduleRef.get(AccountsService);
  posting = moduleRef.get(PostingService);
  audit = moduleRef.get(getModelToken(AuditLog.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

async function org() {
  const orgId = new Types.ObjectId().toString();
  await accounts.seedDefaults(orgId);
  const chart = await accounts.list(orgId);
  const byCode = (code: string) => chart.find((a) => a.code === code)!;
  return { orgId, byCode };
}

const journal = (orgId: string, debit: string, credit: string, paise = 50000) => ({
  orgId,
  voucherType: VoucherType.JOURNAL,
  financialYear: '2026-27',
  date: '2026-10-01',
  postedBy: ACTOR,
  lines: [
    { accountId: debit, description: 'test', debitPaise: paise, creditPaise: 0 },
    { accountId: credit, description: 'test', debitPaise: 0, creditPaise: paise },
  ],
});

describe('editing accounts', () => {
  it('renames, recodes and moves an account, and audits it', async () => {
    const { orgId, byCode } = await org();
    const group = await accounts.create({ orgId, actorId: ACTOR, name: 'Admin Expenses', type: AccountType.EXPENSE, isGroup: true });
    const software = await accounts.create({ orgId, actorId: ACTOR, name: 'Software', type: AccountType.EXPENSE });

    const moved = await accounts.update(orgId, ACTOR, String(software._id), { name: 'Software subscriptions', code: '6555', parentId: String(group._id) });
    expect(moved).toMatchObject({ name: 'Software subscriptions', code: '6555', parentId: String(group._id), isActive: true });

    const entry = await audit.findOne({ orgId, entityId: String(software._id), action: 'UPDATE' }).lean().exec();
    expect(entry).toMatchObject({ before: { name: 'Software', parentId: null }, after: { name: 'Software subscriptions', code: '6555' } });

    // A system account can be renamed: postings find it by its key, not its name.
    const bank = await accounts.update(orgId, ACTOR, byCode('1100')._id, { name: 'HDFC Current A/c' });
    expect(bank.name).toBe('HDFC Current A/c');
    expect((await accounts.resolveSystemAccount(orgId, SystemAccountKey.BANK))._id.toString()).toBe(byCode('1100')._id);
  });

  it('refuses a duplicate, a group of another type, or a loop', async () => {
    const { orgId, byCode } = await org();
    const a = await accounts.create({ orgId, actorId: ACTOR, name: 'Travel', type: AccountType.EXPENSE });
    await expect(accounts.update(orgId, ACTOR, String(a._id), { name: 'bank accounts' })).rejects.toThrow(/already called "Bank Accounts"/);
    await expect(accounts.update(orgId, ACTOR, String(a._id), { code: '1100' })).rejects.toThrow(/already in use by Bank Accounts/);
    await expect(accounts.update(orgId, ACTOR, String(a._id), { parentId: byCode('1000')._id })).rejects.toThrow('This is an expense account, so it can only go under an expense group.');
    await expect(accounts.update(orgId, ACTOR, String(a._id), { parentId: byCode('1100')._id })).rejects.toThrow(/only be moved under a group/);

    const outer = await accounts.create({ orgId, actorId: ACTOR, name: 'Outer', type: AccountType.EXPENSE, isGroup: true });
    const inner = await accounts.create({ orgId, actorId: ACTOR, name: 'Inner', type: AccountType.EXPENSE, isGroup: true, parentId: String(outer._id) });
    await expect(accounts.update(orgId, ACTOR, String(outer._id), { parentId: String(inner._id) })).rejects.toThrow(/own sub-groups/);
  });

  it('deactivates only what nothing depends on, and closes it to postings', async () => {
    const { orgId, byCode } = await org();
    const bankId = byCode('1100')._id;
    await expect(accounts.update(orgId, ACTOR, bankId, { isActive: false })).rejects.toThrow(/books depend on/);

    const group = await accounts.create({ orgId, actorId: ACTOR, name: 'Events', type: AccountType.EXPENSE, isGroup: true });
    const stalls = await accounts.create({ orgId, actorId: ACTOR, name: 'Trade fair stalls', type: AccountType.EXPENSE, parentId: String(group._id) });
    await expect(accounts.update(orgId, ACTOR, String(group._id), { isActive: false })).rejects.toThrow(/Move or deactivate the 1 account under Events/);

    // A balance must be moved out first.
    const spend = await posting.post(journal(orgId, String(stalls._id), bankId));
    await expect(accounts.update(orgId, ACTOR, String(stalls._id), { isActive: false })).rejects.toThrow(/balance of 500\.00 Dr/);
    await posting.reverse(String(spend._id), ACTOR);

    const off = await accounts.update(orgId, ACTOR, String(stalls._id), { isActive: false });
    expect(off.isActive).toBe(false);
    expect(await audit.countDocuments({ orgId, entityId: String(stalls._id), action: 'DEACTIVATE' })).toBe(1);

    await expect(posting.post(journal(orgId, String(stalls._id), bankId))).rejects.toThrow(/Trade fair stalls is deactivated/);
    await expect(posting.post(journal(orgId, String(group._id), bankId))).rejects.toThrow(/Events is a group/);

    await accounts.update(orgId, ACTOR, String(stalls._id), { isActive: true });
    await expect(posting.post(journal(orgId, String(stalls._id), bankId))).resolves.toBeDefined();
  });

  it('still reverses an entry on an account deactivated since', async () => {
    const { orgId, byCode } = await org();
    const old = await accounts.create({ orgId, actorId: ACTOR, name: 'Old project costs', type: AccountType.EXPENSE });
    const first = await posting.post(journal(orgId, String(old._id), byCode('1100')._id));
    const back = await posting.post(journal(orgId, byCode('1100')._id, String(old._id)));
    await accounts.update(orgId, ACTOR, String(old._id), { isActive: false });
    await expect(posting.reverse(String(first._id), ACTOR)).resolves.toBeDefined();
    expect(back).toBeDefined();
  });
});
