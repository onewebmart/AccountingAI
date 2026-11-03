/**
 * Integration tests — transfers between our own accounts.
 *
 *  ✓ Money ledgers: Bank, Cash, and asset ledgers named like them; not a deposit
 *  ✓ Cash withdrawn is a contra voucher (Cash Dr, Bank Cr); from a statement line it
 *    must go the line's way and amount, and confirms the line
 *  ✓ Two of our bank accounts' lines pair as one transfer, with no voucher; unpairing undoes it
 *  ✓ Suggestions find both kinds; auto-match pairs a hand-posted contra with its line
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { AccountType, MatchStatus, VoucherType } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { TransfersService } from './transfers.service';
import { ReconciliationService } from './reconciliation.service';
import { PostingService } from '../gl/posting.service';
import { AuditService } from '../gl/audit.service';
import { AccountsService } from '../gl/accounts.service';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { PurchaseBillsService } from '../purchase/purchase-bills.service';
import { BankAccount, BankAccountSchema } from './schemas/bank-account.schema';
import { BankStatement, BankStatementSchema } from './schemas/bank-statement.schema';
import { BankStatementLine, BankStatementLineSchema } from './schemas/bank-statement-line.schema';
import { Journal, JournalSchema } from '../gl/schemas/journal.schema';
import { Counter, CounterSchema } from '../gl/schemas/counter.schema';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { LedgerAccount, LedgerAccountSchema, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { SalesInvoice, SalesInvoiceSchema } from '../sales/schemas/sales-invoice.schema';
import { Customer, CustomerSchema } from '../sales/schemas/customer.schema';
import { PurchaseBill, PurchaseBillSchema } from '../purchase/schemas/purchase-bill.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';

const ACTOR = new Types.ObjectId().toString();

let moduleRef: TestingModule;
let transfers: TransfersService;
let recon: ReconciliationService;
let accounts: AccountsService;
let lines: Model<{ matchStatus: MatchStatus; matchedJournalId: Types.ObjectId | null; transferLineId: Types.ObjectId | null }>;
let journals: Model<{ voucherType: string; narration: string; lines: Array<{ accountId: Types.ObjectId; debitPaise: number; creditPaise: number }> }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: BankAccount.name, schema: BankAccountSchema },
        { name: BankStatement.name, schema: BankStatementSchema },
        { name: BankStatementLine.name, schema: BankStatementLineSchema },
        { name: Journal.name, schema: JournalSchema },
        { name: Counter.name, schema: CounterSchema },
        { name: AuditLog.name, schema: AuditLogSchema },
        { name: LedgerAccount.name, schema: LedgerAccountSchema },
        { name: SalesInvoice.name, schema: SalesInvoiceSchema },
        { name: Customer.name, schema: CustomerSchema },
        { name: PurchaseBill.name, schema: PurchaseBillSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: ProposedEntry.name, schema: ProposedEntrySchema },
      ]),
    ],
    providers: [TransfersService, ReconciliationService, PostingService, AuditService, AccountsService, SalesInvoicesService, PurchaseBillsService],
  }).compile();
  transfers = moduleRef.get(TransfersService);
  recon = moduleRef.get(ReconciliationService);
  accounts = moduleRef.get(AccountsService);
  lines = moduleRef.get(getModelToken(BankStatementLine.name));
  journals = moduleRef.get(getModelToken(Journal.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

/** An org with two bank accounts, each with a statement. */
async function seed() {
  const orgId = new Types.ObjectId().toString();
  const sys = await accounts.resolveSystemAccounts(orgId, [SystemAccountKey.BANK, SystemAccountKey.CASH]);
  const hdfc = await recon.createAccount({ orgId, name: 'HDFC Current', bankName: 'HDFC Bank', accountNumber: '50100000001234' });
  const icici = await recon.createAccount({ orgId, name: 'ICICI Savings', bankName: 'ICICI Bank', accountNumber: '000100005678' });
  const statement = (bankAccountId: string, rows: Array<{ date: string; description: string; out?: number; in?: number }>) =>
    recon.importStatement({
      orgId,
      bankAccountId,
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      openingBalancePaise: 10000000,
      closingBalancePaise: 10000000 + rows.reduce((s, r) => s + (r.in ?? 0) - (r.out ?? 0), 0),
      lines: rows.map((r) => ({ date: r.date, description: r.description, debitPaise: r.out ?? 0, creditPaise: r.in ?? 0 })),
    });
  return { orgId, bank: sys.get(SystemAccountKey.BANK)!._id.toString(), cash: sys.get(SystemAccountKey.CASH)!._id.toString(), hdfc, icici, statement };
}

const lineOf = async (statementId: unknown, description: string) =>
  (await lines.findOne({ statementId, description }).lean().exec()) as unknown as { _id: Types.ObjectId };

describe('transfers', () => {
  it('offers bank and cash ledgers, and ones named like them', async () => {
    const { orgId } = await seed();
    await accounts.create({ orgId, actorId: ACTOR, name: 'Petty Cash', type: AccountType.ASSETS });
    await accounts.create({ orgId, actorId: ACTOR, name: 'Rent Deposit', type: AccountType.ASSETS });
    expect((await transfers.moneyLedgers(orgId)).map((l) => [l.name, l.kind])).toEqual([
      ['Bank Accounts', 'bank'],
      ['Cash in Hand', 'cash'],
      ['Petty Cash', 'other'],
    ]);
  });

  it('records cash withdrawn as a contra, and confirms the line it came from', async () => {
    const { orgId, bank, cash, hdfc, statement } = await seed();
    const st = await statement(String(hdfc._id), [{ date: '2026-10-05', description: 'ATM WDL MG ROAD 0042', out: 1000000 }]);
    const atm = await lineOf(st._id, 'ATM WDL MG ROAD 0042');

    await expect(transfers.record(orgId, ACTOR, { fromAccountId: cash, toAccountId: bank, amountPaise: 1000000, date: '2026-10-05', bankLineId: String(atm._id) })).rejects.toThrow(
      /must be from the bank/,
    );
    await expect(transfers.record(orgId, ACTOR, { fromAccountId: bank, toAccountId: cash, amountPaise: 900000, date: '2026-10-05', bankLineId: String(atm._id) })).rejects.toThrow(
      /the transfer must be the same/,
    );

    const done = await transfers.record(orgId, ACTOR, { fromAccountId: bank, toAccountId: cash, amountPaise: 1000000, date: '2026-10-05', bankLineId: String(atm._id) });
    const journal = await journals.findById(done.journalId).lean().exec();
    expect(journal).toMatchObject({ voucherType: VoucherType.CONTRA, narration: 'Cash withdrawn from bank' });
    expect(journal!.lines.map((l) => [String(l.accountId), l.debitPaise, l.creditPaise])).toEqual([
      [cash, 1000000, 0],
      [bank, 0, 1000000],
    ]);
    expect(await lines.findById(atm._id).lean().exec()).toMatchObject({ matchStatus: MatchStatus.CONFIRMED, matchedJournalId: new Types.ObjectId(done.journalId) });
    await expect(transfers.record(orgId, ACTOR, { fromAccountId: bank, toAccountId: cash, amountPaise: 1000000, date: '2026-10-05', bankLineId: String(atm._id) })).rejects.toThrow(
      /already matched/,
    );
    await expect(transfers.record(orgId, ACTOR, { fromAccountId: bank, toAccountId: bank, amountPaise: 100, date: '2026-10-05' })).rejects.toThrow(/two different/);
  });

  it('pairs a transfer between two of our accounts with no voucher, and unpairs it', async () => {
    const { orgId, hdfc, icici, statement } = await seed();
    const a = await statement(String(hdfc._id), [{ date: '2026-10-10', description: 'IMPS TO OWN A/C 5678', out: 2500000 }]);
    const b = await statement(String(icici._id), [{ date: '2026-10-11', description: 'IMPS FROM HDFC 1234', in: 2500000 }, { date: '2026-10-11', description: 'Other', in: 100 }]);
    const out = await lineOf(a._id, 'IMPS TO OWN A/C 5678');
    const into = await lineOf(b._id, 'IMPS FROM HDFC 1234');
    const other = await lineOf(b._id, 'Other');

    const suggested = await transfers.suggestions(orgId);
    expect(suggested).toEqual([expect.objectContaining({ kind: 'between_accounts', lineId: String(out._id), otherLineId: String(into._id), fromBank: 'HDFC Bank ··1234', toBank: 'ICICI Bank ··5678' })]);

    await expect(transfers.pair(orgId, ACTOR, String(out._id), String(other._id))).rejects.toThrow(/different amounts/);
    const before = await journals.countDocuments({ orgId });
    await transfers.pair(orgId, ACTOR, String(out._id), String(into._id));
    expect(await journals.countDocuments({ orgId })).toBe(before);
    expect(await lines.findById(out._id).lean().exec()).toMatchObject({ matchStatus: MatchStatus.CONFIRMED, transferLineId: into._id });
    expect(await lines.findById(into._id).lean().exec()).toMatchObject({ matchStatus: MatchStatus.CONFIRMED, transferLineId: out._id });

    const report = await recon.getDiffReport(String(a._id), orgId);
    expect(report.lines[0].matchLabel).toBe('Transfer to ICICI Bank');
    expect(report.differencePaise).toBe(0);

    await transfers.unpair(orgId, ACTOR, String(into._id));
    expect(await lines.findById(out._id).lean().exec()).toMatchObject({ matchStatus: MatchStatus.UNMATCHED, transferLineId: null });
  });

  it('suggests cash movements, and auto-match pairs a hand-posted contra with its line', async () => {
    const { orgId, bank, cash, hdfc, statement } = await seed();
    const st = await statement(String(hdfc._id), [
      { date: '2026-10-07', description: 'CASH DEP MUMBAI BR', in: 300000 },
      { date: '2026-10-08', description: 'NWD-512345XXXX-ATM', out: 200000 },
    ]);
    expect((await transfers.suggestions(orgId)).map((s) => s.kind)).toEqual(['cash_deposit', 'cash_withdrawal']);

    // Recorded from the cash side first, then the statement arrives.
    await transfers.record(orgId, ACTOR, { fromAccountId: cash, toAccountId: bank, amountPaise: 300000, date: '2026-10-07' });
    await recon.autoMatch(String(st._id), orgId, ACTOR);
    expect(await lines.findOne({ statementId: st._id, description: 'CASH DEP MUMBAI BR' }).lean().exec()).toMatchObject({ matchStatus: MatchStatus.AUTO_MATCHED });
    // A contra the other way does not match a deposit.
    expect(await lines.findOne({ statementId: st._id, description: 'NWD-512345XXXX-ATM' }).lean().exec()).toMatchObject({ matchStatus: MatchStatus.UNMATCHED });
  });
});
