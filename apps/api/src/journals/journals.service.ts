import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { JournalStatus, VoucherType } from '@ai-accounting/shared';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { LedgerAccount, LedgerAccountDocument } from '../gl/schemas/ledger-account.schema';
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
  lines: Array<{
    accountId: string;
    accountName: string;
    description: string;
    debitPaise: number;
    creditPaise: number;
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

    // A reversal points back at its original via reversalOf; build the inverse
    // lookup so the original row can show which voucher reversed it.
    const reversedByMap = new Map<string, string>();
    for (const j of journals) {
      if (j.reversalOf) {
        reversedByMap.set(
          j.reversalOf.toString(),
          formatVoucherNumber(j.voucherType, j.financialYear, j.voucherNumber),
        );
      }
    }

    return journals.map((j) => this.toListItem(j, accountNames, reversedByMap));
  }

  async findOne(orgId: string, id: string): Promise<JournalListItem> {
    const journal = await withOrg(orgId, () => this.journalModel.findById(id).exec());
    if (!journal) throw new NotFoundException('Voucher not found.');
    const accountNames = await this.accountNameMap(orgId);
    return this.toListItem(journal, accountNames, new Map());
  }

  private toListItem(
    j: JournalDocument,
    accountNames: Map<string, string>,
    reversedByMap: Map<string, string>,
  ): JournalListItem {
    const totalDebitPaise = j.lines.reduce((s, l) => s + l.debitPaise, 0);
    const totalCreditPaise = j.lines.reduce((s, l) => s + l.creditPaise, 0);

    return {
      _id: j._id.toString(),
      voucherNumber: formatVoucherNumber(j.voucherType, j.financialYear, j.voucherNumber),
      voucherType: j.voucherType.toLowerCase(),
      date: j.date,
      description: j.narration ?? '—',
      totalDebitPaise,
      totalCreditPaise,
      status: j.status,
      financialYear: j.financialYear,
      reversedBy: reversedByMap.get(j._id.toString()),
      lines: j.lines.map((l) => ({
        accountId: l.accountId?.toString() ?? '',
        accountName: accountNames.get(l.accountId?.toString() ?? '') ?? l.description ?? 'Unmapped',
        description: l.description ?? '',
        debitPaise: l.debitPaise,
        creditPaise: l.creditPaise,
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
