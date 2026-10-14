import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditService } from '../gl/audit.service';
import { ReconciliationService } from '../banking/reconciliation.service';
import { BankStatementLine, BankStatementLineDocument } from '../banking/schemas/bank-statement-line.schema';
import { todayIst } from '../automation/schedule';
import { BANK_FEED_PROVIDER, BankFeedProvider } from './provider';
import { MockAccountAggregator } from './mock-aa.provider';
import { BankFeedConsent, BankFeedConsentDocument } from './schemas/bank-feed-consent.schema';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** India's AA handles: a mobile number or name, then @ and the aggregator. */
const VUA = /^[A-Za-z0-9._-]{3,64}@[A-Za-z0-9.-]{2,32}$/;
/** The furthest back a first pull reaches. */
const MAX_HISTORY_DAYS = 365;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface SyncResult {
  accounts: Array<{ maskedAccountNumber: string; imported: number; skipped: number; through: string | null; error: string | null }>;
}

/**
 * Bank feeds: transactions pulled from the bank through an Account
 * Aggregator, straight into reconciliation, instead of a statement downloaded
 * and uploaded by hand.
 *
 * Each pull asks for the days after the last one. The bank's own transaction
 * id is kept on the line with a unique index, so a pull that overlaps an
 * earlier one, or an uploaded statement for the same days, adds nothing
 * twice. Feeds write bank lines only, never the ledger: matching and
 * confirming them is unchanged.
 */
@Injectable()
export class BankFeedsService {
  private readonly logger = new Logger(BankFeedsService.name);

  constructor(
    @InjectModel(BankFeedConsent.name) private consentModel: Model<BankFeedConsentDocument>,
    @InjectModel(BankStatementLine.name) private lineModel: Model<BankStatementLineDocument>,
    @Inject(BANK_FEED_PROVIDER) private provider: BankFeedProvider,
    private reconciliation: ReconciliationService,
    private audit: AuditService,
  ) {}

  async list(orgId: string) {
    const consents = await this.consentModel.find({ orgId }).sort({ createdAt: -1 }).lean().exec();
    return {
      provider: this.provider.name,
      isMock: this.provider.isMock,
      consents: consents.map((c) => ({
        _id: c._id.toString(),
        customerVua: c.customerVua,
        status: c.status,
        fromDate: c.fromDate,
        redirectUrl: c.status === 'PENDING' ? c.redirectUrl : null,
        lastSyncedAt: c.lastSyncedAt,
        accounts: c.accounts.map((a) => ({
          maskedAccountNumber: a.maskedAccountNumber,
          fipName: a.fipName,
          bankAccountId: a.bankAccountId?.toString() ?? null,
          syncedThrough: a.syncedThrough,
          lastError: a.lastError,
        })),
      })),
    };
  }

  /** Ask the customer's consent; they approve it in their AA app at the URL returned. */
  async requestConsent(orgId: string, actorId: string, input: { customerVua: string; fromDate?: string }, today = todayIst()) {
    const vua = input.customerVua?.trim();
    if (!VUA.test(vua ?? '')) throw new BadRequestException('Enter the AA handle, like 9876543210@onemoney.');
    const earliest = addDays(today, -MAX_HISTORY_DAYS);
    const fromDate = input.fromDate ?? addDays(today, -90);
    if (!DATE.test(fromDate) || fromDate > today) throw new BadRequestException('fromDate must be a past date like 2026-04-01');
    if (fromDate < earliest) throw new BadRequestException(`A feed reaches back at most a year, to ${earliest}.`);

    const { consentHandle, redirectUrl } = await this.provider.createConsent({ customerVua: vua, fromDate, toDate: today });
    const consent = await this.consentModel.create({
      orgId, provider: this.provider.name, consentHandle, customerVua: vua, fromDate, redirectUrl, createdBy: actorId,
    });
    await this.audit.record({
      orgId, entityType: 'BankFeedConsent', entityId: consent._id.toString(), action: 'CREATE', performedBy: actorId,
      after: { provider: this.provider.name, customerVua: vua, fromDate },
    });
    return { _id: consent._id.toString(), status: consent.status, redirectUrl };
  }

  /**
   * Asks the aggregator where the consent stands. Once active, each account it
   * covers is tied to one of our bank accounts, by its masked number.
   */
  async refresh(orgId: string, id: string) {
    const consent = await this.find(orgId, id);
    const { status, accounts } = await this.provider.consentStatus(consent.consentHandle);
    const before = consent.status;
    consent.status = status;
    for (const account of accounts) {
      if (consent.accounts.some((a) => a.linkRef === account.linkRef)) continue;
      const bank = await this.reconciliation.resolveAccountForStatement(orgId, {
        accountNumber: account.maskedAccountNumber,
        bankName: account.fipName,
      });
      consent.accounts.push({ ...account, bankAccountId: bank._id, syncedThrough: null, lastError: null });
    }
    await consent.save();
    if (before !== status) {
      await this.audit.record({
        orgId, entityType: 'BankFeedConsent', entityId: id, action: 'STATUS', performedBy: 'system:bank-feeds',
        before: { status: before }, after: { status, accounts: consent.accounts.length },
      });
    }
    return consent;
  }

  /** Pulls each account's new transactions into a statement for reconciliation. */
  async sync(orgId: string, id: string, actorId = 'system:bank-feeds', today = todayIst()): Promise<SyncResult> {
    const consent = await this.refresh(orgId, id);
    if (consent.status !== 'ACTIVE') throw new BadRequestException(`This consent is ${consent.status.toLowerCase()}; there is nothing to pull.`);

    const result: SyncResult = { accounts: [] };
    for (const account of consent.accounts) {
      const fromDate = account.syncedThrough ? addDays(account.syncedThrough, 1) : consent.fromDate;
      const outcome = { maskedAccountNumber: account.maskedAccountNumber, imported: 0, skipped: 0, through: account.syncedThrough, error: null as string | null };
      if (fromDate > today) {
        result.accounts.push(outcome);
        continue;
      }
      try {
        const feed = await this.provider.fetchTransactions({ consentHandle: consent.consentHandle, linkRef: account.linkRef, fromDate, toDate: today });
        const ids = feed.transactions.map((t) => t.txnId);
        const seen = new Set(
          (await this.lineModel.distinct('externalId', { orgId, bankAccountId: account.bankAccountId, externalId: { $in: ids } }).exec()).map(String),
        );
        const fresh = feed.transactions.filter((t) => !seen.has(t.txnId));
        outcome.skipped = feed.transactions.length - fresh.length;
        if (fresh.length > 0) {
          // The statement spans only what it brings in, so its balances are read
          // off those lines; reconciliation compares the books against them.
          const signed = (t: (typeof fresh)[number]) => (t.type === 'CREDIT' ? t.amountPaise : -t.amountPaise);
          const first = fresh[0];
          const opening =
            first.balancePaise !== null ? first.balancePaise - signed(first) : feed.openingBalancePaise ?? 0;
          const closing = fresh[fresh.length - 1].balancePaise ?? opening + fresh.reduce((s, t) => s + signed(t), 0);
          await this.reconciliation.importStatement({
            orgId,
            actorId,
            bankAccountId: String(account.bankAccountId),
            periodStart: fromDate,
            periodEnd: today,
            openingBalancePaise: opening,
            closingBalancePaise: closing,
            lines: fresh.map((t) => ({
              date: t.date,
              description: t.narration,
              reference: t.reference,
              debitPaise: t.type === 'DEBIT' ? t.amountPaise : 0,
              creditPaise: t.type === 'CREDIT' ? t.amountPaise : 0,
              runningBalancePaise: t.balancePaise,
              externalId: t.txnId,
            })),
          });
        }
        outcome.imported = fresh.length;
        outcome.through = today;
        account.syncedThrough = today;
        account.lastError = null;
      } catch (err) {
        outcome.error = err instanceof Error ? err.message : String(err);
        account.lastError = outcome.error;
        this.logger.warn(`Bank feed ${id} account ${account.maskedAccountNumber}: ${outcome.error}`);
      }
      result.accounts.push(outcome);
    }
    consent.lastSyncedAt = new Date();
    consent.markModified('accounts');
    await consent.save();
    await this.audit.record({
      orgId, entityType: 'BankFeedConsent', entityId: id, action: 'SYNC', performedBy: actorId,
      after: { accounts: result.accounts.map((a) => ({ account: a.maskedAccountNumber, imported: a.imported, error: a.error })) },
    });
    return result;
  }

  async revoke(orgId: string, actorId: string, id: string) {
    const consent = await this.find(orgId, id);
    if (consent.status === 'REVOKED') return consent;
    await this.provider.revoke(consent.consentHandle);
    const before = consent.status;
    consent.status = 'REVOKED';
    await consent.save();
    await this.audit.record({ orgId, entityType: 'BankFeedConsent', entityId: id, action: 'REVOKE', performedBy: actorId, before: { status: before }, after: { status: 'REVOKED' } });
    return consent;
  }

  /** The mock aggregator only: stands in for the customer approving in their AA app. */
  async approveMock(orgId: string, id: string) {
    if (!(this.provider instanceof MockAccountAggregator)) {
      throw new BadRequestException('Consents are approved by the customer in their AA app.');
    }
    const consent = await this.find(orgId, id);
    this.provider.approve(consent.consentHandle);
    return this.refresh(orgId, id);
  }

  /** Every active consent, for the daily pull. */
  async activeConsents(): Promise<Array<{ orgId: string; id: string }>> {
    const consents = await this.consentModel.find({ status: 'ACTIVE' }, { orgId: 1 }).lean().exec();
    return consents.map((c) => ({ orgId: c.orgId, id: c._id.toString() }));
  }

  private async find(orgId: string, id: string): Promise<BankFeedConsentDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Bank feed not found');
    const consent = await this.consentModel.findOne({ _id: id, orgId }).exec();
    if (!consent) throw new NotFoundException('Bank feed not found');
    return consent;
  }
}
