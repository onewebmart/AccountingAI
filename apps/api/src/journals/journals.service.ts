import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { JournalStatus, VoucherType } from '@ai-accounting/shared';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { LedgerAccount, LedgerAccountDocument } from '../gl/schemas/ledger-account.schema';
import { Counter, CounterDocument } from '../gl/schemas/counter.schema';
import { financialYearOf } from '../gl/posting.service';
import { withOrg } from '../database/tenant.plugin';

export interface JournalListItem {
  _id: string;
  voucherNumber: string;
  voucherType: string;
  date: string;
  description: string;
  totalDebitPaise: number;
  totalCreditPaise: number;
  status: string;
  financialYear: string;
  reversedBy?: string;
  /** The reversal entry's id, beside its number. */
  reversedById?: string;
  /** On a reversal: the voucher it cancels. */
  reverses?: { id: string; voucherNumber: string } | null;
  /** Reference# and the person's own Journal#, on manual journals. */
  reference: string | null;
  journalNumber: string | null;
  /** The reversal date set when it was posted, and whether it waited for that date. */
  autoReverse: { on: string; publishOnDate: boolean } | null;
  lines: Array<{
    accountId: string;
    accountName: string;
    description: string;
    debitPaise: number;
    creditPaise: number;
    projectId: string | null;
    contact: { kind: 'customer' | 'vendor'; id: string; name: string } | null;
  }>;
}

/** Tally-style voucher prefixes, e.g. PUR/2025-26/0001. */
const VOUCHER_PREFIX: Record<VoucherType, string> = {
  [VoucherType.PURCHASE]: 'PUR',
  [VoucherType.SALES]: 'SAL',
  [VoucherType.RECEIPT]: 'RCT',
  [VoucherType.PAYMENT]: 'PMT',
  [VoucherType.CONTRA]: 'CTR',
  [VoucherType.JOURNAL]: 'JNL',
  [VoucherType.CREDIT_NOTE]: 'CRN',
  [VoucherType.DEBIT_NOTE]: 'DBN',
};

export function formatVoucherNumber(
  type: VoucherType,
  financialYear: string,
  seq: number,
): string {
  return `${VOUCHER_PREFIX[type] ?? 'JNL'}/${financialYear}/${String(seq).padStart(4, '0')}`;
}

export interface ListJournalsFilter {
  voucherType?: VoucherType;
  financialYear?: string;
  from?: string;
  to?: string;
  limit?: number;
}

@Injectable()
export class JournalsService {
  constructor(
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
    @InjectModel(LedgerAccount.name)
    private accountModel: Model<LedgerAccountDocument>,
    @InjectModel(Counter.name) private counterModel: Model<CounterDocument>,
  ) {}

  async list(orgId: string, filter: ListJournalsFilter = {}): Promise<JournalListItem[]> {
    const query: Record<string, unknown> = {};
    if (filter.voucherType) query.voucherType = filter.voucherType;
    if (filter.financialYear) query.financialYear = filter.financialYear;
    if (filter.from || filter.to) {
      const range: Record<string, string> = {};
      if (filter.from) range.$gte = filter.from;
      if (filter.to) range.$lte = filter.to;
      query.date = range;
    }

    const journals = await withOrg(orgId, () =>
      this.journalModel
        .find(query)
        .sort({ date: -1, voucherNumber: -1 })
        .limit(filter.limit ?? 200)
        .exec(),
    );

    const accountNames = await this.accountNameMap(orgId);
    const reversedByMap = await this.reversedByMap(orgId, journals);
    const reversesMap = await this.reversesMap(orgId, journals);

    return journals.map((j) => this.toListItem(j, accountNames, reversedByMap, reversesMap));
  }

  async findOne(orgId: string, id: string): Promise<JournalListItem> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Voucher not found.');
    const journal = await withOrg(orgId, () => this.journalModel.findById(id).exec());
    if (!journal) throw new NotFoundException('Voucher not found.');
    const accountNames = await this.accountNameMap(orgId);
    const reversedByMap = await this.reversedByMap(orgId, [journal]);
    const reversesMap = await this.reversesMap(orgId, [journal]);
    return this.toListItem(journal, accountNames, reversedByMap, reversesMap);
  }

  /**
   * original id → voucher number of the reversal that cancels it. A reversal
   * points back at its original via reversalOf; it is looked up by id rather
   * than within the page, because it is dated the day it was made and often
   * falls outside the original's date range or financial year.
   */
  private async reversedByMap(
    orgId: string,
    journals: JournalDocument[],
  ): Promise<Map<string, { id: string; voucherNumber: string }>> {
    if (!journals.length) return new Map();
    const reversals = await withOrg(orgId, () =>
      this.journalModel.find({ reversalOf: { $in: journals.map((j) => j._id) } }).exec(),
    );
    return new Map(
      reversals.map((r) => [
        r.reversalOf!.toString(),
        { id: r._id.toString(), voucherNumber: formatVoucherNumber(r.voucherType, r.financialYear, r.voucherNumber) },
      ]),
    );
  }

  /** The vouchers these reversals cancel: id → number. */
  private async reversesMap(orgId: string, journals: JournalDocument[]): Promise<Map<string, string>> {
    const ids = journals.filter((j) => j.reversalOf).map((j) => j.reversalOf);
    if (!ids.length) return new Map();
    const originals = await withOrg(orgId, () => this.journalModel.find({ _id: { $in: ids } }, { voucherType: 1, financialYear: 1, voucherNumber: 1 }).lean().exec());
    return new Map(originals.map((o) => [String(o._id), formatVoucherNumber(o.voucherType, o.financialYear, o.voucherNumber)]));
  }

  /**
   * The number the next journal will get, for the form to show. Only a
   * preview: the number is allocated when the journal posts, in the same
   * transaction, so the series stays gapless.
   */
  async nextNumber(orgId: string, date: string): Promise<{ voucherNumber: string; financialYear: string }> {
    const financialYear = financialYearOf(date);
    const counter = await this.counterModel.findById(`${orgId}:${VoucherType.JOURNAL}:${financialYear}`).lean().exec();
    return { voucherNumber: formatVoucherNumber(VoucherType.JOURNAL, financialYear, (counter?.seq ?? 0) + 1), financialYear };
  }

  private toListItem(
    j: JournalDocument,
    accountNames: Map<string, string>,
    reversedByMap: Map<string, { id: string; voucherNumber: string }>,
    reversesMap: Map<string, string> = new Map(),
  ): JournalListItem {
    const totalDebitPaise = j.lines.reduce((s, l) => s + l.debitPaise, 0);
    const totalCreditPaise = j.lines.reduce((s, l) => s + l.creditPaise, 0);
    const reversal = reversedByMap.get(j._id.toString());
    const reversedBy = reversal?.voucherNumber;
    const reversesId = j.reversalOf ? String(j.reversalOf) : null;

    return {
      _id: j._id.toString(),
      voucherNumber: formatVoucherNumber(j.voucherType, j.financialYear, j.voucherNumber),
      voucherType: j.voucherType.toLowerCase(),
      date: j.date,
      description: j.narration ?? '—',
      totalDebitPaise,
      totalCreditPaise,
      // A reversed original stays "posted" in the ledger (Invariant 3); it is
      // shown as reversed because a contra entry now cancels it.
      status: reversedBy ? JournalStatus.REVERSED : j.status,
      financialYear: j.financialYear,
      reversedBy,
      reversedById: reversal?.id,
      reverses: reversesId ? { id: reversesId, voucherNumber: reversesMap.get(reversesId) ?? '' } : null,
      reference: j.reference ?? null,
      journalNumber: j.journalNumber ?? null,
      autoReverse: j.autoReverse?.on ? { on: j.autoReverse.on, publishOnDate: j.autoReverse.publishOnDate !== false } : null,
      lines: j.lines.map((l) => ({
        accountId: l.accountId?.toString() ?? '',
        accountName: accountNames.get(l.accountId?.toString() ?? '') ?? l.description ?? 'Unmapped',
        description: l.description ?? '',
        debitPaise: l.debitPaise,
        creditPaise: l.creditPaise,
        projectId: l.projectId ? String(l.projectId) : null,
        contact: l.contact?.id ? { kind: l.contact.kind, id: String(l.contact.id), name: l.contact.name ?? '' } : null,
      })),
    };
  }

  private async accountNameMap(orgId: string): Promise<Map<string, string>> {
    const accounts = await withOrg(orgId, () =>
      this.accountModel.find({}).select('name').exec(),
    );
    return new Map(accounts.map((a) => [a._id.toString(), a.name]));
  }

  /** Day-book style totals used by the dashboard and vouchers header. */
  async summary(orgId: string, financialYear?: string) {
    const match: Record<string, unknown> = { orgId, status: JournalStatus.POSTED };
    if (financialYear) match.financialYear = financialYear;

    const rows = await this.journalModel
      .aggregate<{ _id: VoucherType; count: number; totalPaise: number }>([
        { $match: match },
        {
          $group: {
            _id: '$voucherType',
            count: { $sum: 1 },
            totalPaise: { $sum: { $sum: '$lines.debitPaise' } },
          },
        },
      ])
      .exec();

    return rows.map((r) => ({
      voucherType: String(r._id).toLowerCase(),
      count: r.count,
      totalPaise: r.totalPaise,
    }));
  }

  async exists(orgId: string, id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const found = await withOrg(orgId, () =>
      this.journalModel.countDocuments({ _id: new Types.ObjectId(id) }).exec(),
    );
    return found > 0;
  }
}
