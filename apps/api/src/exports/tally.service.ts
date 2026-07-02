import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TallySyncStatus, JournalStatus, VoucherType } from '@ai-accounting/shared';
import { TallySyncRecord, TallySyncRecordDocument } from './schemas/tally-sync-record.schema';
import { Journal, JournalDocument } from '../gl/schemas/journal.schema';

// ── Tally voucher-type name mapping ───────────────────────────────────────────

const TALLY_VOUCHER_TYPE: Record<VoucherType, string> = {
  [VoucherType.PURCHASE]: 'Purchase',
  [VoucherType.SALES]: 'Sales',
  [VoucherType.RECEIPT]: 'Receipt',
  [VoucherType.PAYMENT]: 'Payment',
  [VoucherType.CONTRA]: 'Contra',
  [VoucherType.JOURNAL]: 'Journal',
  [VoucherType.CREDIT_NOTE]: 'Credit Note',
  [VoucherType.DEBIT_NOTE]: 'Debit Note',
};

// ── Tally XML generation ──────────────────────────────────────────────────────

/**
 * Generate Tally-compatible XML for a single voucher.
 *
 * Tally sign convention:
 *   AMOUNT positive  = credit (money in or liability increase)
 *   AMOUNT negative  = debit  (money out or asset increase)
 *   ISDEEMEDPOSITIVE = "Yes" when the entry is a debit (AMOUNT is negative).
 *
 * The GUID is embedded so Tally ignores re-imports with the same GUID —
 * this is the idempotency mechanism.
 */
export function toTallyXml(journal: JournalDocument, tallyGuid: string): string {
  const date = journal.date.replace(/-/g, ''); // YYYYMMDD
  const voucherType = TALLY_VOUCHER_TYPE[journal.voucherType] ?? 'Journal';

  const ledgerEntries = journal.lines
    .map((line) => {
      const isDebit = line.debitPaise > 0;
      const amountRupees = isDebit
        ? -(line.debitPaise / 100)
        : line.creditPaise / 100;
      const isDeemedPositive = isDebit ? 'Yes' : 'No';
      const ledgerName = (line.description || 'Unknown Account').replace(/&/g, '&amp;');

      return `          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${ledgerName}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${isDeemedPositive}</ISDEEMEDPOSITIVE>
            <AMOUNT>${amountRupees.toFixed(2)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>$$SvcCurrentCompany</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="${voucherType}" ACTION="Create">
            <DATE>${date}</DATE>
            <GUID>${tallyGuid}</GUID>
            <NARRATION>${(journal.narration ?? '').replace(/&/g, '&amp;')}</NARRATION>
            <VOUCHERTYPENAME>${voucherType}</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${journal.voucherNumber}</VOUCHERNUMBER>
${ledgerEntries}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ConnectorStatus {
  pendingCount: number;
  syncedCount: number;
  failedCount: number;
  lastSyncedAt: Date | null;
}

@Injectable()
export class TallyService {
  constructor(
    @InjectModel(TallySyncRecord.name) private syncModel: Model<TallySyncRecordDocument>,
    @InjectModel(Journal.name) private journalModel: Model<JournalDocument>,
  ) {}

  /**
   * Enqueue all POSTED journals that don't yet have a sync record.
   * Idempotent: journals already in tally_sync_records are skipped.
   * Returns the number of new records created.
   */
  async enqueue(orgId: string, financialYear: string): Promise<number> {
    const journals = await this.journalModel
      .find({ orgId, financialYear, status: JournalStatus.POSTED })
      .lean()
      .exec() as unknown as (JournalDocument & { _id: Types.ObjectId })[];

    if (!journals.length) return 0;

    const existing = await this.syncModel
      .find({ orgId, journalId: { $in: journals.map((j) => j._id) } })
      .lean()
      .exec();

    const existingIds = new Set(existing.map((r) => r.journalId.toString()));
    const toCreate = journals.filter((j) => !existingIds.has(j._id.toString()));

    if (!toCreate.length) return 0;

    await this.syncModel.insertMany(
      toCreate.map((j) => ({
        orgId,
        journalId: j._id,
        tallyGuid: null,
        status: TallySyncStatus.PENDING,
        syncedAt: null,
        retries: 0,
        errorMessage: null,
      })),
    );

    return toCreate.length;
  }

  /**
   * Return all pending (and failed) sync records with their journal data.
   * This is what the local connector polls.
   */
  async getPendingVouchers(
    orgId: string,
  ): Promise<Array<{ record: TallySyncRecordDocument; journal: JournalDocument }>> {
    const records = await this.syncModel
      .find({ orgId, status: { $in: [TallySyncStatus.PENDING, TallySyncStatus.FAILED] } })
      .lean()
      .exec() as unknown as (TallySyncRecordDocument & { journalId: Types.ObjectId })[];

    const journalIds = records.map((r) => r.journalId);
    const journals = await this.journalModel
      .find({ orgId, _id: { $in: journalIds } })
      .lean()
      .exec() as unknown as (JournalDocument & { _id: Types.ObjectId })[];

    const journalMap = new Map(journals.map((j) => [j._id.toString(), j]));

    return records
      .map((r) => {
        const journal = journalMap.get(r.journalId.toString());
        if (!journal) return null;
        return { record: r as unknown as TallySyncRecordDocument, journal };
      })
      .filter((x): x is { record: TallySyncRecordDocument; journal: JournalDocument } => x !== null);
  }

  /**
   * Mark a journal as successfully synced to Tally.
   * The tallyGuid is what Tally assigned — subsequent imports with the same GUID are no-ops.
   * Idempotent: calling this twice with the same journalId+tallyGuid is safe.
   */
  async markSynced(orgId: string, journalId: string, tallyGuid: string): Promise<TallySyncRecordDocument> {
    const record = await this.syncModel
      .findOneAndUpdate(
        { orgId, journalId: new Types.ObjectId(journalId) },
        {
          $set: {
            status: TallySyncStatus.SYNCED,
            tallyGuid,
            syncedAt: new Date(),
            errorMessage: null,
          },
          $inc: { retries: 1 },
        },
        { new: true },
      )
      .exec();

    if (!record) throw new Error(`No sync record found for journal ${journalId}`);
    return record;
  }

  /**
   * Mark a journal sync as failed, recording the error for retry/diagnostics.
   */
  async markFailed(orgId: string, journalId: string, errorMessage: string): Promise<TallySyncRecordDocument> {
    const record = await this.syncModel
      .findOneAndUpdate(
        { orgId, journalId: new Types.ObjectId(journalId) },
        {
          $set: { status: TallySyncStatus.FAILED, errorMessage },
          $inc: { retries: 1 },
        },
        { new: true },
      )
      .exec();

    if (!record) throw new Error(`No sync record found for journal ${journalId}`);
    return record;
  }

  /**
   * Get the Tally XML for a specific journal (called by the local connector to fetch
   * the voucher payload before posting to Tally's HTTP gateway).
   * A stable GUID is derived from orgId+journalId so it's deterministic across retries.
   */
  async getVoucherXml(orgId: string, journalId: string): Promise<string> {
    const journal = await this.journalModel
      .findOne({ _id: journalId, orgId })
      .lean()
      .exec() as unknown as JournalDocument & { _id: Types.ObjectId } | null;

    if (!journal) throw new Error(`Journal ${journalId} not found`);

    // Deterministic GUID: orgId prefix + journalId — stable across connector retries
    const tallyGuid = `AI-${orgId.slice(-8)}-${journalId}`;
    return toTallyXml(journal, tallyGuid);
  }

  /** Connector status overview for the UI dashboard card. */
  async getStatus(orgId: string): Promise<ConnectorStatus> {
    const [pendingCount, syncedCount, failedCount] = await Promise.all([
      this.syncModel.countDocuments({ orgId, status: TallySyncStatus.PENDING }),
      this.syncModel.countDocuments({ orgId, status: TallySyncStatus.SYNCED }),
      this.syncModel.countDocuments({ orgId, status: TallySyncStatus.FAILED }),
    ]);

    const lastSynced = await this.syncModel
      .findOne({ orgId, status: TallySyncStatus.SYNCED })
      .sort({ syncedAt: -1 })
      .lean()
      .exec();

    return {
      pendingCount,
      syncedCount,
      failedCount,
      lastSyncedAt: lastSynced?.syncedAt ?? null,
    };
  }
}
