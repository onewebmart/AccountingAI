import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccountType, MatchStatus, VoucherType } from '@ai-accounting/shared';
import { AccountsService } from '../gl/accounts.service';
import { AuditService } from '../gl/audit.service';
import { financialYearOf, PostingService } from '../gl/posting.service';
import { LedgerAccount, LedgerAccountDocument, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { BankAccount, BankAccountDocument } from './schemas/bank-account.schema';
import { BankStatementLine, BankStatementLineDocument } from './schemas/bank-statement-line.schema';
import { withOrg } from '../database/tenant.plugin';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** How far apart the two halves of a transfer between our own accounts may be dated. */
const PAIR_DAYS = 2;
/** Cash taken out of, or paid into, the bank, as narrations say it. */
const CASH_OUT = /\b(ATM|ATW|NWD|CASH ?WDL|CASH WITHDRAWAL|CASH WD|SELF CHQ|SELF CHEQUE|BY SELF|TO SELF)\b/i;
const CASH_IN = /\b(CASH DEP|CASH DEPOSIT|BY CASH|CDM|CASH CREDIT BY)\b/i;
/** Asset ledgers that hold money, beside the Bank and Cash ones the chart starts with. */
const MONEY_NAME = /\b(bank|cash|petty|wallet|imprest|current a\/?c|savings a\/?c)\b/i;

export interface MoneyLedger {
  _id: string;
  name: string;
  code: string;
  kind: 'bank' | 'cash' | 'other';
}

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amountPaise: number;
  date: string;
  narration?: string | null;
  /** The bank statement line this transfer accounts for, if it came from one. */
  bankLineId?: string | null;
}

export type TransferSuggestion =
  | {
      kind: 'between_accounts';
      lineId: string;
      otherLineId: string;
      date: string;
      amountPaise: number;
      fromBank: string;
      toBank: string;
      reason: string;
    }
  | {
      kind: 'cash_withdrawal' | 'cash_deposit';
      lineId: string;
      date: string;
      amountPaise: number;
      bank: string;
      reason: string;
    };

const days = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * Money moving between the business's own accounts.
 *
 * Every bank account shares one "Bank Accounts" ledger, so a transfer from
 * one bank account to another changes nothing in the books. Its two
 * statement lines only need pairing, so each counts as reconciled. Money
 * between the bank and cash in hand is a contra voucher (Bank and Cash are
 * separate ledgers), posted when a person records it, and matched to the
 * statement line it came from.
 */
@Injectable()
export class TransfersService {
  constructor(
    @InjectModel(LedgerAccount.name) private ledgerModel: Model<LedgerAccountDocument>,
    @InjectModel(BankAccount.name) private bankAccountModel: Model<BankAccountDocument>,
    @InjectModel(BankStatementLine.name) private lineModel: Model<BankStatementLineDocument>,
    private accounts: AccountsService,
    private posting: PostingService,
    private audit: AuditService,
  ) {}

  /** The ledgers money can move between: Bank, Cash, and any asset ledger named like one. */
  async moneyLedgers(orgId: string): Promise<MoneyLedger[]> {
    const sys = await this.accounts.resolveSystemAccounts(orgId, [SystemAccountKey.BANK, SystemAccountKey.CASH]);
    const bank = sys.get(SystemAccountKey.BANK)!;
    const cash = sys.get(SystemAccountKey.CASH)!;
    const others = await this.ledgerModel
      .find({
        orgId,
        type: AccountType.ASSETS,
        isGroup: false,
        isActive: { $ne: false },
        systemKey: { $exists: false },
        _id: { $nin: [bank._id, cash._id] },
      })
      .lean()
      .exec();
    return [
      { _id: bank._id.toString(), name: bank.name, code: bank.code, kind: 'bank' as const },
      { _id: cash._id.toString(), name: cash.name, code: cash.code, kind: 'cash' as const },
      ...others
        .filter((a) => MONEY_NAME.test(a.name))
        .map((a) => ({ _id: a._id.toString(), name: a.name, code: a.code, kind: 'other' as const })),
    ];
  }

  /**
   * Post a contra voucher moving money from one money ledger to another.
   * Given a statement line, the voucher is matched to it in the same
   * transaction, and must move what the line moved, in its direction.
   */
  async record(orgId: string, actorId: string, input: TransferInput) {
    if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) throw new BadRequestException('The amount must be whole paise, above zero.');
    if (!DATE.test(input.date ?? '')) throw new BadRequestException('date must be a date like 2026-10-14');
    if (input.fromAccountId === input.toAccountId) throw new BadRequestException('Choose two different accounts.');
    const ledgers = await this.moneyLedgers(orgId);
    const from = ledgers.find((l) => l._id === input.fromAccountId);
    const to = ledgers.find((l) => l._id === input.toAccountId);
    if (!from || !to) throw new BadRequestException('A transfer moves money between bank and cash ledgers only.');

    return this.posting.inTransaction(async (session) => {
      let line: BankStatementLineDocument | null = null;
      if (input.bankLineId) {
        line = await this.lineModel.findOne({ _id: input.bankLineId, orgId }).session(session).exec();
        if (!line) throw new NotFoundException('Bank statement line not found');
        if (line.excluded || line.matchStatus !== MatchStatus.UNMATCHED) {
          throw new BadRequestException('This bank line is already matched or set aside.');
        }
        const outOfBank = line.debitPaise > 0;
        const bankSide = outOfBank ? from : to;
        if (bankSide.kind !== 'bank') {
          throw new BadRequestException(outOfBank ? 'This line is money out of the bank, so the transfer must be from the bank.' : 'This line is money into the bank, so the transfer must be to the bank.');
        }
        const moved = outOfBank ? line.debitPaise : line.creditPaise;
        if (moved !== input.amountPaise) throw new BadRequestException(`The bank line is for ${(moved / 100).toFixed(2)}; the transfer must be the same.`);
      }

      const narration =
        input.narration?.trim() ||
        (to.kind === 'cash' && from.kind === 'bank' ? 'Cash withdrawn from bank' : from.kind === 'cash' && to.kind === 'bank' ? 'Cash deposited into bank' : `Transfer from ${from.name} to ${to.name}`);
      const journal = await this.posting.post(
        {
          orgId,
          voucherType: VoucherType.CONTRA,
          financialYear: financialYearOf(input.date),
          date: input.date,
          narration,
          postedBy: actorId,
          lines: [
            { accountId: to._id, description: narration, debitPaise: input.amountPaise, creditPaise: 0 },
            { accountId: from._id, description: narration, debitPaise: 0, creditPaise: input.amountPaise },
          ],
        },
        session,
      );

      if (line) {
        const claimed = await this.lineModel
          .findOneAndUpdate(
            { _id: line._id, orgId, matchStatus: MatchStatus.UNMATCHED },
            { $set: { matchStatus: MatchStatus.CONFIRMED, matchedJournalId: journal._id } },
            { session, new: true },
          )
          .exec();
        if (!claimed) throw new BadRequestException('This bank line was matched in the meantime.');
        await this.audit.record(
          {
            orgId, entityType: 'BankStatementLine', entityId: line._id.toString(), action: 'CONFIRM_TRANSFER', performedBy: actorId,
            before: { matchStatus: MatchStatus.UNMATCHED }, after: { matchStatus: MatchStatus.CONFIRMED, matchedJournalId: journal._id.toString() },
          },
          session,
        );
      }
      return { journalId: journal._id.toString(), voucherNumber: journal.voucherNumber };
    });
  }

  /**
   * Two statement lines, money out of one of our bank accounts and the same
   * amount into another, are one transfer. Both count as in the books, with
   * no voucher: they are on the same ledger, which did not change.
   */
  async pair(orgId: string, actorId: string, lineId: string, otherLineId: string) {
    if (!Types.ObjectId.isValid(lineId) || !Types.ObjectId.isValid(otherLineId) || lineId === otherLineId) {
      throw new BadRequestException('Choose two different bank lines.');
    }
    const lines = await withOrg(orgId, () => this.lineModel.find({ _id: { $in: [lineId, otherLineId] } }).exec());
    if (lines.length !== 2) throw new NotFoundException('Bank statement line not found');
    const out = lines.find((l) => l.debitPaise > 0);
    const into = lines.find((l) => l.creditPaise > 0);
    if (!out || !into) throw new BadRequestException('A transfer is money out of one account and into another.');
    if (out.bankAccountId.equals(into.bankAccountId)) throw new BadRequestException('Both lines are on the same bank account.');
    if (out.debitPaise !== into.creditPaise) throw new BadRequestException('The two lines are for different amounts.');
    if (days(out.date, into.date) > 7) throw new BadRequestException('The two lines are more than a week apart.');
    if (lines.some((l) => l.excluded || l.matchStatus !== MatchStatus.UNMATCHED)) {
      throw new BadRequestException('One of the lines is already matched or set aside.');
    }

    await this.posting.inTransaction(async (session) => {
      for (const [line, other] of [[out, into], [into, out]] as const) {
        const done = await this.lineModel
          .findOneAndUpdate(
            { _id: line._id, orgId, matchStatus: MatchStatus.UNMATCHED },
            { $set: { matchStatus: MatchStatus.CONFIRMED, transferLineId: other._id } },
            { session },
          )
          .exec();
        if (!done) throw new BadRequestException('One of the lines was matched in the meantime.');
        await this.audit.record(
          {
            orgId, entityType: 'BankStatementLine', entityId: line._id.toString(), action: 'PAIR_TRANSFER', performedBy: actorId,
            before: { matchStatus: MatchStatus.UNMATCHED }, after: { matchStatus: MatchStatus.CONFIRMED, transferLineId: other._id.toString() },
          },
          session,
        );
      }
    });
    return { paired: [out._id.toString(), into._id.toString()] };
  }

  /** Undo a pairing: both halves go back to unmatched. */
  async unpair(orgId: string, actorId: string, lineId: string) {
    const line = await withOrg(orgId, () => this.lineModel.findById(lineId).exec());
    if (!line?.transferLineId) throw new BadRequestException('This line is not paired as a transfer.');
    await this.posting.inTransaction(async (session) => {
      for (const id of [line._id, line.transferLineId!]) {
        await this.lineModel
          .updateOne({ _id: id, orgId }, { $set: { matchStatus: MatchStatus.UNMATCHED, transferLineId: null } }, { session })
          .exec();
        await this.audit.record(
          {
            orgId, entityType: 'BankStatementLine', entityId: id.toString(), action: 'UNPAIR_TRANSFER', performedBy: actorId,
            before: { matchStatus: MatchStatus.CONFIRMED }, after: { matchStatus: MatchStatus.UNMATCHED },
          },
          session,
        );
      }
    });
    return { unpaired: [line._id.toString(), line.transferLineId.toString()] };
  }

  /**
   * Lines that look like transfers, for a person to confirm: the same amount
   * out of one of our accounts and into another within two days, and cash
   * taken out of or paid into the bank. Suggestions only; nothing changes.
   */
  async suggestions(orgId: string): Promise<TransferSuggestion[]> {
    const lines = await withOrg(orgId, () =>
      this.lineModel.find({ matchStatus: MatchStatus.UNMATCHED, excluded: { $ne: true } }).sort({ date: 1 }).lean().exec(),
    );
    const banks = await withOrg(orgId, () => this.bankAccountModel.find().lean().exec());
    const bankName = new Map(banks.map((b) => [b._id.toString(), `${b.bankName ?? b.name}${b.accountNumber ? ` ··${b.accountNumber.slice(-4)}` : ''}`]));
    const name = (id: Types.ObjectId) => bankName.get(id.toString()) ?? 'Bank account';

    const out: TransferSuggestion[] = [];
    const used = new Set<string>();
    if (banks.length > 1) {
      for (const debit of lines.filter((l) => l.debitPaise > 0)) {
        const credit = lines.find(
          (c) =>
            c.creditPaise === debit.debitPaise &&
            !used.has(c._id.toString()) &&
            !c.bankAccountId.equals(debit.bankAccountId) &&
            days(c.date, debit.date) <= PAIR_DAYS,
        );
        if (!credit) continue;
        used.add(credit._id.toString());
        used.add(debit._id.toString());
        out.push({
          kind: 'between_accounts',
          lineId: debit._id.toString(),
          otherLineId: credit._id.toString(),
          date: debit.date,
          amountPaise: debit.debitPaise,
          fromBank: name(debit.bankAccountId),
          toBank: name(credit.bankAccountId),
          reason: `${(debit.debitPaise / 100).toLocaleString('en-IN')} left ${name(debit.bankAccountId)} on ${debit.date} and the same arrived in ${name(credit.bankAccountId)} on ${credit.date}`,
        });
      }
    }
    for (const l of lines) {
      if (used.has(l._id.toString())) continue;
      if (l.debitPaise > 0 && CASH_OUT.test(l.description)) {
        out.push({ kind: 'cash_withdrawal', lineId: l._id.toString(), date: l.date, amountPaise: l.debitPaise, bank: name(l.bankAccountId), reason: `"${l.description}" reads as cash taken out` });
      } else if (l.creditPaise > 0 && CASH_IN.test(l.description)) {
        out.push({ kind: 'cash_deposit', lineId: l._id.toString(), date: l.date, amountPaise: l.creditPaise, bank: name(l.bankAccountId), reason: `"${l.description}" reads as cash paid in` });
      }
    }
    return out;
  }
}
