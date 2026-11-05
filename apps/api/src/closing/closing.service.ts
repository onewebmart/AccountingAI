import { Optional, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  AccountType,
  BillStatus,
  InvoiceStatus,
  JournalStatus,
  MatchStatus,
  ProposedEntryStatus,
  VoucherType,
} from '@ai-accounting/shared';
import { PeriodLock, PeriodLockDocument } from '../gl/schemas/period-lock.schema';
import { ClosingRun, ClosingRunDocument } from './schemas/closing-run.schema';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';
import { LedgerAccount, LedgerAccountDocument, SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { ProposedEntry, ProposedEntryDocument } from '../proposals/schemas/proposed-entry.schema';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { BankStatementLine, BankStatementLineDocument } from '../banking/schemas/bank-statement-line.schema';
import { AccountsService } from '../gl/accounts.service';
import { PostingService } from '../gl/posting.service';
import { AuditService } from '../gl/audit.service';
import { classifyAccount, financialYearRange } from '../reports/reports.service';
import { rupees } from '../gl/note-amounts';
import { withOrg } from '../database/tenant.plugin';

export interface ChecklistItem {
  key: string;
  label: string;
  count: number;
  /** Where in the app to deal with it. */
  href: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Closing the books: locking a period so nothing more is posted into it, and
 * closing a financial year — moving its income and expense into retained
 * earnings and locking it.
 *
 * Every step is a deliberate human action (Invariant 4) and is audited.
 */
import { AssetsService } from '../month-end/assets.service';
@Injectable()
export class ClosingService {
  private readonly logger = new Logger(ClosingService.name);

  constructor(
    @InjectModel(PeriodLock.name) private lockModel: Model<PeriodLockDocument>,
    @InjectModel(ClosingRun.name) private runModel: Model<ClosingRunDocument>,
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
    @InjectModel(LedgerAccount.name) private accountModel: Model<LedgerAccountDocument>,
    @InjectModel(ProposedEntry.name) private proposalModel: Model<ProposedEntryDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(BankStatementLine.name) private lineModel: Model<BankStatementLineDocument>,
    private accountsService: AccountsService,
    private postingService: PostingService,
    private auditService: AuditService,
    // Optional so specs that build this by hand need not wire the asset register.
    @Optional() private assets?: AssetsService,
  ) {}

  async status(orgId: string) {
    const [lock, years] = await Promise.all([
      this.lockModel.findOne({ orgId }).lean().exec(),
      withOrg(orgId, () => this.runModel.find().sort({ financialYear: -1 }).lean().exec()),
    ]);
    return {
      lockedThrough: lock?.lockedThrough ?? null,
      history: (lock?.history ?? []).slice(-10).reverse(),
      years,
    };
  }

  /**
   * What is still open on or before `through` — the things to deal with before
   * locking it. Locking does not require an empty list; it is a checklist.
   */
  async checklist(orgId: string, through: string): Promise<{ through: string; items: ChecklistItem[]; ready: boolean }> {
    if (!ISO_DATE.test(through)) throw new BadRequestException('through must be a date like 2026-09-30');
    const [proposals, invoices, bills, unmatched, unconfirmed] = await Promise.all([
      withOrg(orgId, () =>
        this.proposalModel
          .countDocuments({ status: ProposedEntryStatus.PROPOSED, $or: [{ invoiceDate: { $lte: through } }, { invoiceDate: null }] })
          .exec(),
      ),
      withOrg(orgId, () =>
        this.invoiceModel.countDocuments({ status: { $in: [InvoiceStatus.DRAFT, InvoiceStatus.SENT] }, invoiceDate: { $lte: through } }).exec(),
      ),
      withOrg(orgId, () => this.billModel.countDocuments({ status: BillStatus.DRAFT, billDate: { $lte: through } }).exec()),
      withOrg(orgId, () =>
        this.lineModel.countDocuments({ matchStatus: MatchStatus.UNMATCHED, excluded: { $ne: true }, date: { $lte: through } }).exec(),
      ),
      withOrg(orgId, () =>
        this.lineModel
          .countDocuments({
            matchStatus: { $in: [MatchStatus.AUTO_MATCHED, MatchStatus.MANUALLY_MATCHED] },
            excluded: { $ne: true },
            date: { $lte: through },
          })
          .exec(),
      ),
    ]);
    const items: ChecklistItem[] = [
      { key: 'proposals', label: 'Documents waiting for review', count: proposals, href: '/review' },
      { key: 'invoices', label: 'Sales invoices not yet posted', count: invoices, href: '/sales/invoices' },
      { key: 'bills', label: 'Purchase bills not yet posted', count: bills, href: '/purchases/bills' },
      { key: 'bank-unmatched', label: 'Bank lines not in the books', count: unmatched, href: '/banking' },
      { key: 'bank-unconfirmed', label: 'Bank matches waiting to be confirmed', count: unconfirmed, href: '/banking' },
    ];
    if (this.assets) {
      const register = await this.assets.list(orgId, through);
      items.push({ key: 'depreciation', label: 'Assets with depreciation not booked to this date', count: register.filter((a) => a.dueToDatePaise > 0).length, href: '/month-end' });
    }
    return { through, items, ready: items.every((i) => i.count === 0) };
  }

  /**
   * Lock the books through a date (or unlock with null). Nothing dated on or
   * before it can be posted. A closed year stays locked: lowering the lock
   * below a closed year's end means reopening that year.
   */
  async setLock(orgId: string, actorId: string, lockedThrough: string | null, reason?: string | null): Promise<{ lockedThrough: string | null }> {
    if (lockedThrough !== null) {
      if (!ISO_DATE.test(lockedThrough)) throw new BadRequestException('lockedThrough must be a date like 2026-09-30');
      if (lockedThrough > today()) throw new BadRequestException('The books cannot be locked past today');
    }
    const lastClosedEnd = await this.lastClosedYearEnd(orgId);
    if (lastClosedEnd && (lockedThrough === null || lockedThrough < lastClosedEnd)) {
      throw new BadRequestException(
        `The books are closed through ${lastClosedEnd}. Reopen that year to unlock anything before it.`,
      );
    }
    await this.writeLock(orgId, actorId, lockedThrough, reason ?? null);
    return { lockedThrough };
  }

  /**
   * Close a financial year: one JOURNAL entry dated 31 March moves each income
   * and expense account's balance for the year to Retained Earnings, then the
   * books lock through that date — all in one transaction.
   *
   * The entry is flagged as closing, so the year's own P&L and trial balance
   * still show what happened in it; the balance sheet and ledgers include it.
   */
  async closeYear(orgId: string, actorId: string, financialYear: string): Promise<ClosingRunDocument> {
    const { end } = financialYearRange(financialYear);
    if (today() <= end) {
      throw new BadRequestException(`FY ${financialYear} runs until ${end}; it can be closed from the day after`);
    }
    const existing = await withOrg(orgId, () => this.runModel.findOne({ financialYear }).exec());
    if (existing?.status === 'closed') throw new BadRequestException(`FY ${financialYear} is already closed`);

    return this.postingService.inTransaction(async (session) => {
      const { lines, netIncomePaise } = await this.closingLines(orgId, financialYear, session);
      let journalId: Types.ObjectId | null = null;
      if (lines.length > 0) {
        const journal = await this.postingService.post(
          {
            orgId,
            voucherType: VoucherType.JOURNAL,
            financialYear,
            date: end,
            narration:
              `Year-end close FY ${financialYear}: ` +
              (netIncomePaise >= 0 ? `profit of ${rupees(netIncomePaise)}` : `loss of ${rupees(-netIncomePaise)}`) +
              ' to retained earnings',
            postedBy: actorId,
            isClosingEntry: true,
            lines,
          },
          session,
        );
        journalId = journal._id;
      }

      const run = await withOrg(orgId, () =>
        this.runModel
          .findOneAndUpdate(
            { orgId, financialYear },
            {
              $set: {
                status: 'closed',
                journalId,
                netIncomePaise,
                closedBy: actorId,
                closedAt: new Date(),
                reopenedBy: null,
                reopenedAt: null,
              },
            },
            { upsert: true, new: true, session },
          )
          .exec(),
      );

      const lock = await this.lockModel.findOne({ orgId }).session(session).lean().exec();
      if (!lock?.lockedThrough || lock.lockedThrough < end) {
        await this.writeLock(orgId, actorId, end, `Year-end close FY ${financialYear}`, session);
      }

      await this.auditService.record(
        {
          orgId,
          entityType: 'FinancialYear',
          entityId: financialYear,
          action: 'CLOSE',
          performedBy: actorId,
          after: { netIncomePaise, journalId: journalId ? String(journalId) : null, lockedThrough: end },
        },
        session,
      );
      this.logger.log(`FY ${financialYear} closed for org ${orgId}: ${rupees(netIncomePaise)} to retained earnings`);
      return run!;
    });
  }

  /**
   * Reopen the most recently closed year: undo its closing entry (dated the
   * same 31 March, so the year still nets to zero) and lift the lock back to
   * the year before.
   */
  async reopenYear(orgId: string, actorId: string, financialYear: string): Promise<ClosingRunDocument> {
    const run = await withOrg(orgId, () => this.runModel.findOne({ financialYear }).exec());
    if (run?.status !== 'closed') throw new BadRequestException(`FY ${financialYear} is not closed`);
    const later = await withOrg(orgId, () =>
      this.runModel.findOne({ status: 'closed', financialYear: { $gt: financialYear } }).sort({ financialYear: 1 }).lean().exec(),
    );
    if (later) throw new BadRequestException(`FY ${later.financialYear} is closed too — reopen it first`);

    const { end } = financialYearRange(financialYear);
    const previous = await withOrg(orgId, () =>
      this.runModel.findOne({ status: 'closed', financialYear: { $lt: financialYear } }).sort({ financialYear: -1 }).lean().exec(),
    );
    const newLock = previous ? financialYearRange(previous.financialYear).end : null;

    return this.postingService.inTransaction(async (session) => {
      await this.writeLock(orgId, actorId, newLock, `Reopened FY ${financialYear}`, session);

      if (run.journalId) {
        const closing = await withOrg(orgId, () => this.journalModel.findById(run.journalId).session(session).lean().exec());
        await this.postingService.post(
          {
            orgId,
            voucherType: VoucherType.JOURNAL,
            financialYear,
            date: end,
            narration: `Reopening FY ${financialYear}: year-end close reversed`,
            postedBy: actorId,
            isClosingEntry: true,
            reversalOf: String(run.journalId),
            lines: closing!.lines.map((l) => ({
              accountId: String(l.accountId),
              description: l.description,
              debitPaise: l.creditPaise,
              creditPaise: l.debitPaise,
            })),
          },
          session,
        );
      }

      const reopened = await withOrg(orgId, () =>
        this.runModel
          .findOneAndUpdate(
            { _id: run._id, status: 'closed' },
            { $set: { status: 'reopened', reopenedBy: actorId, reopenedAt: new Date() } },
            { new: true, session },
          )
          .exec(),
      );
      if (!reopened) throw new BadRequestException(`FY ${financialYear} changed while being reopened — try again`);

      await this.auditService.record(
        {
          orgId,
          entityType: 'FinancialYear',
          entityId: financialYear,
          action: 'REOPEN',
          performedBy: actorId,
          before: { status: 'closed', lockedThrough: end },
          after: { status: 'reopened', lockedThrough: newLock },
        },
        session,
      );
      return reopened;
    });
  }

  /** Each income and expense account's balance for the year, reversed, net to retained earnings. */
  private async closingLines(orgId: string, financialYear: string, session: ClientSession) {
    const [journals, accounts, retained] = await Promise.all([
      withOrg(orgId, () =>
        this.journalModel
          .find({ financialYear, status: JournalStatus.POSTED, isClosingEntry: { $ne: true } })
          .session(session)
          .lean()
          .exec(),
      ),
      withOrg(orgId, () => this.accountModel.find().select('name type').session(session).lean().exec()),
      this.accountsService.resolveSystemAccount(orgId, SystemAccountKey.RETAINED_EARNINGS),
    ]);
    const typeOf = new Map(accounts.map((a) => [String(a._id), a.type as AccountType]));

    const net = new Map<string, { name: string; paise: number }>();
    for (const j of journals) {
      for (const l of j.lines) {
        const id = String(l.accountId);
        const type = typeOf.get(id) ?? classifyAccount(l.description ?? '');
        if (type !== AccountType.INCOME && type !== AccountType.EXPENSE) continue;
        const entry = net.get(id) ?? { name: l.description || 'Account', paise: 0 };
        entry.paise += l.debitPaise - l.creditPaise;
        net.set(id, entry);
      }
    }

    const lines: Array<{ accountId: string; description: string; debitPaise: number; creditPaise: number }> = [];
    for (const [accountId, { name, paise }] of net) {
      if (paise === 0) continue;
      // Reverse the balance: an expense's debit is credited, income's credit debited.
      lines.push({ accountId, description: name, debitPaise: paise < 0 ? -paise : 0, creditPaise: paise > 0 ? paise : 0 });
    }
    // Income is credit-balanced, so profit is minus the sum of the nets.
    const netIncomePaise = -[...net.values()].reduce((s, e) => s + e.paise, 0);
    if (lines.length > 0 && netIncomePaise !== 0) {
      lines.push({
        accountId: retained._id.toString(),
        description: retained.name,
        debitPaise: netIncomePaise < 0 ? -netIncomePaise : 0,
        creditPaise: netIncomePaise > 0 ? netIncomePaise : 0,
      });
    }
    return { lines, netIncomePaise };
  }

  private async lastClosedYearEnd(orgId: string): Promise<string | null> {
    const last = await withOrg(orgId, () =>
      this.runModel.findOne({ status: 'closed' }).sort({ financialYear: -1 }).lean().exec(),
    );
    return last ? financialYearRange(last.financialYear).end : null;
  }

  private async writeLock(
    orgId: string,
    actorId: string,
    lockedThrough: string | null,
    reason: string | null,
    session?: ClientSession,
  ): Promise<void> {
    const before = await this.lockModel.findOne({ orgId }).session(session ?? null).lean().exec();
    await this.lockModel
      .updateOne(
        { orgId },
        {
          $set: { lockedThrough },
          $push: { history: { lockedThrough, changedBy: actorId, changedAt: new Date(), reason } },
        },
        { upsert: true, session },
      )
      .exec();
    await this.auditService.record(
      {
        orgId,
        entityType: 'PeriodLock',
        entityId: orgId,
        action: lockedThrough ? 'LOCK' : 'UNLOCK',
        performedBy: actorId,
        before: { lockedThrough: before?.lockedThrough ?? null },
        after: { lockedThrough, reason },
      },
      session,
    );
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
