import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { DocumentStatus, MatchStatus, ProposedEntryStatus, VoucherType } from '@ai-accounting/shared';
import { ProposedEntry, ProposedEntryDocument } from './schemas/proposed-entry.schema';
import { ExtractedDocument, ExtractedDocumentDocument } from '../extraction/schemas/extracted-document.schema';
import { Document as UploadedDocument, DocumentDocument } from '../documents/schemas/document.schema';
import { PostingService } from '../gl/posting.service';
import { AuditService } from '../gl/audit.service';
import { AccountsService } from '../gl/accounts.service';
import { SystemAccountKey } from '../gl/schemas/ledger-account.schema';
import { LearningService } from './learning.service';
import { SubledgerSyncService } from './subledger-sync.service';
import { ExpenseCategorizerService } from './categorisation/expense-categorizer.service';
import { withOrg } from '../database/tenant.plugin';
import { dueDateFromTerms } from '../extraction/invoice-checks';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { BankStatementLine, BankStatementLineDocument } from '../banking/schemas/bank-statement-line.schema';
import { TdsSection, defaultTdsRateBps, tdsOn } from '../gl/tds';

export interface ApproveInput {
  proposalId: string;
  orgId: string;
  actorId: string;
  /** Override the AI-suggested lines with human-confirmed ones (optional). */
  lines?: Array<{
    accountId: string;
    accountName: string;
    debitPaise: number;
    creditPaise: number;
    description?: string;
  }>;
}

export interface RejectInput {
  proposalId: string;
  orgId: string;
  actorId: string;
  reason?: string;
}

/** Compute Indian financial year string from a date or invoice date string. */
function getFY(dateStr: string | null | undefined): string {
  const parsed = dateStr ? new Date(dateStr) : null;
  // An unreadable invoice date must not poison the financial year — fall back to
  // today so the entry still posts into a real, gapless voucher sequence.
  const d = parsed && !isNaN(parsed.getTime()) ? parsed : new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // 1–12
  return m >= 4 ? `${y}-${(y + 1).toString().slice(-2)}` : `${y - 1}-${y.toString().slice(-2)}`;
}

interface SuggestedLineDraft {
  accountName: string;
  accountCode: string | null;
  accountId: Types.ObjectId;
  debitPaise: number;
  creditPaise: number;
  confidence: number;
  isAiSuggested: boolean;
}

/** Map extracted documentType to VoucherType for the journal. */
/** Document types whose main account is worth remembering per party. */
const LEARNABLE = new Set(['purchase_invoice', 'bill', 'receipt', 'bank_payment', 'bank_receipt']);

function toVoucherType(docType: string): VoucherType {
  switch (docType) {
    // A bill is a supplier's invoice by another name and is booked like one.
    case 'purchase_invoice':
    case 'bill':             return VoucherType.PURCHASE;
    case 'sales_invoice':    return VoucherType.SALES;
    // A receipt is proof the business PAID for something: money out, booked
    // Dr expense / Cr bank. It used to post as a RECEIPT voucher (money in),
    // which bank matching then paired with a deposit.
    case 'receipt':          return VoucherType.PAYMENT;
    // Bank lines filed straight to an account, with no bill or invoice behind them.
    case 'bank_payment':     return VoucherType.PAYMENT;
    case 'bank_receipt':     return VoucherType.RECEIPT;
    default:                 return VoucherType.JOURNAL;
  }
}

@Injectable()
export class ProposalsService {
  private readonly logger = new Logger(ProposalsService.name);

  constructor(
    @InjectModel(ProposedEntry.name) private proposalModel: Model<ProposedEntryDocument>,
    @InjectModel(ExtractedDocument.name) private extractedModel: Model<ExtractedDocumentDocument>,
    @InjectModel(UploadedDocument.name) private documentModel: Model<DocumentDocument>,
    // Read-only: a known vendor's TDS section shapes the suggested lines.
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    // A bank-line proposal matches its line when approved.
    @InjectModel(BankStatementLine.name) private bankLineModel: Model<BankStatementLineDocument>,
    private postingService: PostingService,
    private learningService: LearningService,
    private accountsService: AccountsService,
    private subledgerSync: SubledgerSyncService,
    private auditService: AuditService,
    private categorizer: ExpenseCategorizerService,
  ) {}

  /**
   * Map an extracted document onto balanced journal lines that reference the org's
   * real chart of accounts, so an approved proposal posts against actual ledgers
   * rather than dangling account ids.
   */
  private async buildSuggestedLines(
    orgId: string,
    extracted: ExtractedDocumentDocument,
    tds: { section: string; rateBps: number; amountPaise: number } | null = null,
  ): Promise<SuggestedLineDraft[]> {
    const a = extracted.amountsPaise;
    const conf = a.confidence;
    const lines: SuggestedLineDraft[] = [];

    const add = async (
      key: SystemAccountKey,
      debitPaise: number,
      creditPaise: number,
      confidence = conf,
    ) => {
      if (debitPaise === 0 && creditPaise === 0) return;
      const account = await this.accountsService.resolveSystemAccount(orgId, key);
      lines.push({
        accountName: account.name,
        accountCode: account.code,
        accountId: account._id,
        debitPaise,
        creditPaise,
        confidence,
        isAiSuggested: true,
      });
    };

    if (extracted.documentType === 'purchase_invoice' || extracted.documentType === 'bill') {
      await add(SystemAccountKey.PURCHASE_EXPENSE, a.taxableValue, 0);
      await add(SystemAccountKey.GST_INPUT_CGST, a.cgst, 0);
      await add(SystemAccountKey.GST_INPUT_SGST, a.sgst, 0);
      await add(SystemAccountKey.GST_INPUT_IGST, a.igst, 0);
      await add(SystemAccountKey.GST_INPUT_CESS, a.cess, 0);
      // The vendor is owed the printed total. Crediting the sum of the parts
      // instead made a misread total vanish; now any difference lands on a
      // visible Round Off line, and extraction has already flagged anything
      // larger than rounding.
      const tax = a.cgst + a.sgst + a.igst + a.cess;
      const parts = a.taxableValue + tax;
      const withheld = tds?.amountPaise ?? 0;
      if (extracted.isReverseCharge) {
        // Reverse charge: the vendor is owed the taxable value; the tax is ours
        // to pay the government, with input credit taken above.
        await add(SystemAccountKey.ACCOUNTS_PAYABLE, 0, a.taxableValue - withheld);
        await add(SystemAccountKey.RCM_GST_PAYABLE, 0, tax);
      } else {
        await add(SystemAccountKey.ACCOUNTS_PAYABLE, 0, (a.total > 0 ? a.total : parts) - withheld);
      }
      // TDS under the vendor's section, withheld from what they are paid.
      await add(SystemAccountKey.TDS_PAYABLE, 0, withheld);
      return this.balance(orgId, lines);
    }

    if (extracted.documentType === 'sales_invoice') {
      await add(SystemAccountKey.ACCOUNTS_RECEIVABLE, a.total, 0);
      await add(SystemAccountKey.SALES_REVENUE, 0, a.taxableValue);
      await add(SystemAccountKey.GST_OUTPUT_CGST, 0, a.cgst);
      await add(SystemAccountKey.GST_OUTPUT_SGST, 0, a.sgst);
      await add(SystemAccountKey.GST_OUTPUT_IGST, 0, a.igst);
      await add(SystemAccountKey.GST_OUTPUT_CESS, 0, a.cess);
      return this.balance(orgId, lines);
    }

    // Receipts and anything unclassified: a cash/bank movement the reviewer retargets.
    await add(SystemAccountKey.PURCHASE_EXPENSE, a.total, 0, 0.3);
    await add(SystemAccountKey.BANK, 0, a.total, 0.3);
    return this.balance(orgId, lines);
  }

  /**
   * Absorb any rounding difference into Round Off so the proposal can never fail
   * the balance check at approval time (Invariant 2).
   */
  private async balance(
    orgId: string,
    lines: SuggestedLineDraft[],
  ): Promise<SuggestedLineDraft[]> {
    const debit = lines.reduce((s, l) => s + l.debitPaise, 0);
    const credit = lines.reduce((s, l) => s + l.creditPaise, 0);
    if (debit === credit || lines.length === 0) return lines;

    const diff = debit - credit;
    const roundOff = await this.accountsService.resolveSystemAccount(
      orgId,
      SystemAccountKey.ROUND_OFF,
    );
    lines.push({
      accountName: roundOff.name,
      accountCode: roundOff.code,
      accountId: roundOff._id,
      debitPaise: diff < 0 ? Math.abs(diff) : 0,
      creditPaise: diff > 0 ? diff : 0,
      confidence: 0.5,
      isAiSuggested: true,
    });
    return lines;
  }

  /** Create a ProposedEntry from an ExtractedDocument. Called by the processor after extraction. */
  async createFromExtracted(
    extractedDocId: string,
    orgId: string,
  ): Promise<ProposedEntryDocument> {
    const extracted = await withOrg(orgId, () =>
      this.extractedModel.findById(extractedDocId).exec(),
    );
    if (!extracted) throw new NotFoundException('ExtractedDocument not found');

    const isPurchase = extracted.documentType === 'purchase_invoice' || extracted.documentType === 'bill';
    const tds = isPurchase ? await this.vendorTds(orgId, extracted) : null;
    const suggestedLines = await this.buildSuggestedLines(orgId, extracted, tds);

    // File the main cost under the right account: a past choice for this
    // vendor, an HSN/SAC or keyword rule, or the model — not always Purchases.
    // It is a suggestion like every other line; the reviewer approves it.
    let category: ProposedEntry['category'] = null;
    if (isPurchase || extracted.documentType === 'receipt') {
      // Primary expense line: largest debit that is not a GST line.
      const primaryIdx = suggestedLines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => l.debitPaise > 0 && !l.accountName.toLowerCase().includes('gst'))
        .sort((a, b) => b.l.debitPaise - a.l.debitPaise)[0]?.i;
      if (primaryIdx !== undefined) {
        const pick = await this.categorizer.suggest(orgId, {
          kind: 'bill',
          partyName: extracted.vendor?.name ?? null,
          lines: (extracted.lineItems ?? []).map((l) => ({ description: l.description, hsnSac: l.hsnSac })),
          amountPaise: suggestedLines[primaryIdx].debitPaise,
        });
        const line = suggestedLines[primaryIdx];
        line.accountName = pick.accountName;
        line.accountCode = pick.accountCode;
        line.accountId = new Types.ObjectId(pick.accountId);
        line.confidence = pick.confidence;
        line.isAiSuggested = pick.source !== 'learned';
        category = { source: pick.source, reason: pick.reason, accountName: pick.accountName, confidence: pick.confidence };
      }
    }

    const fy = getFY(extracted.invoiceDate?.value);

    const proposal = await this.proposalModel.create({
      orgId,
      documentId: extracted.documentId,
      extractedDocumentId: extracted._id,
      status: ProposedEntryStatus.PROPOSED,
      documentType: extracted.documentType,
      vendorName: extracted.vendor?.name ?? null,
      vendorGstin: extracted.vendor?.gstin ?? null,
      invoiceNumber: extracted.invoiceNumber?.value ?? null,
      invoiceDate: extracted.invoiceDate?.value ?? null,
      dueDate:
        extracted.dueDate?.value ??
        dueDateFromTerms(extracted.invoiceDate?.value ?? null, extracted.paymentTerms ?? null),
      paymentTerms: extracted.paymentTerms ?? null,
      isReverseCharge: isPurchase && !!extracted.isReverseCharge,
      tds,
      amountsPaise: extracted.amountsPaise,
      confidenceOverall: extracted.confidenceOverall,
      fieldConfidence: {
        vendor: extracted.vendor?.confidence ?? extracted.confidenceOverall,
        invoiceNumber: extracted.invoiceNumber?.confidence ?? extracted.confidenceOverall,
        invoiceDate: extracted.invoiceDate?.confidence ?? extracted.confidenceOverall,
        amounts: extracted.amountsPaise?.confidence ?? extracted.confidenceOverall,
      },
      rawWarnings: extracted.rawWarnings ?? [],
      suggestedLines,
      category,
      financialYear: fy,
    });

    this.logger.log(
      `Created ProposedEntry ${proposal._id} for doc ${extracted.documentId} (${extracted.documentType}, fy=${fy})`,
    );
    return proposal;
  }

  async list(
    orgId: string,
    status: ProposedEntryStatus = ProposedEntryStatus.PROPOSED,
  ): Promise<ProposedEntryDocument[]> {
    return withOrg(orgId, () =>
      this.proposalModel.find({ status }).sort({ createdAt: -1 }).limit(100).exec(),
    );
  }

  async findById(id: string, orgId: string): Promise<ProposedEntryDocument | null> {
    return withOrg(orgId, () => this.proposalModel.findById(id).exec());
  }

  /**
   * TDS for a purchase from a vendor already on file with a TDS section —
   * matched by GSTIN, else by name, as the approval will match them.
   */
  private async vendorTds(
    orgId: string,
    extracted: ExtractedDocumentDocument,
  ): Promise<{ section: string; rateBps: number; amountPaise: number } | null> {
    const gstin = extracted.vendor?.gstin?.trim().toUpperCase();
    const name = extracted.vendor?.name?.trim();
    const vendor =
      (gstin ? await withOrg(orgId, () => this.vendorModel.findOne({ gstin }).lean().exec()) : null) ??
      (name
        ? await withOrg(orgId, () =>
            this.vendorModel.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean().exec(),
          )
        : null);
    if (!vendor?.tdsSection) return null;
    const rateBps = vendor.tdsRateBps ?? defaultTdsRateBps(vendor.tdsSection as TdsSection, vendor.pan);
    const amountPaise = tdsOn(extracted.amountsPaise.taxableValue, rateBps);
    return amountPaise > 0 ? { section: vendor.tdsSection, rateBps, amountPaise } : null;
  }

  /** Move the uploaded document to the outcome of its review. */
  private async markDocument(
    proposal: ProposedEntryDocument,
    status: DocumentStatus.APPROVED | DocumentStatus.REJECTED,
    session: ClientSession,
  ): Promise<void> {
    if (!proposal.documentId) return; // GSTR-2B proposals have no upload behind them
    await withOrg(proposal.orgId, () =>
      this.documentModel
        .updateOne({ _id: proposal.documentId }, { $set: { status } }, { session })
        .exec(),
    );
  }

  /** Approve & post — the ONLY path that writes to the ledger. Invariant 4. */
  async approve(input: ApproveInput): Promise<ProposedEntryDocument> {
    const { proposalId, orgId, actorId, lines: overrideLines } = input;

    const proposal = await withOrg(orgId, () =>
      this.proposalModel.findById(proposalId).exec(),
    );
    if (!proposal) throw new NotFoundException('Proposal not found');
    if (proposal.status !== ProposedEntryStatus.PROPOSED) {
      throw new BadRequestException(`Cannot approve a proposal with status "${proposal.status}"`);
    }

    // Build the journal lines — use override if provided (human-corrected), else AI suggestion
    const linesToPost = (overrideLines ?? proposal.suggestedLines.map((l) => ({
      accountId: l.accountId.toString(),
      accountName: l.accountName,
      debitPaise: l.debitPaise,
      creditPaise: l.creditPaise,
    }))).map((l) => ({
      accountId: l.accountId,
      description: l.accountName,
      debitPaise: l.debitPaise,
      creditPaise: l.creditPaise,
    }));

    const { journal, updated, sync } = await this.postingService.inTransaction(async (session) => {
      // Claim PROPOSED → APPROVED before posting, in the same transaction. A
      // double-click, the bulk approve, or a reject racing this one finds
      // nothing left to claim, so the document is posted exactly once.
      const claimed = await withOrg(orgId, () =>
        this.proposalModel
          .findOneAndUpdate(
            { _id: proposalId, status: ProposedEntryStatus.PROPOSED },
            { $set: { status: ProposedEntryStatus.APPROVED, approvedBy: actorId } },
            { session },
          )
          .exec(),
      );
      if (!claimed) throw new BadRequestException('This proposal has already been approved or rejected');

      // PostingService.post() is the single writer to the ledger (Invariant 4)
      const posted = await this.postingService.post(
        {
          orgId,
          voucherType: toVoucherType(proposal.documentType),
          financialYear: proposal.financialYear,
          date: proposal.invoiceDate ?? new Date().toISOString().slice(0, 10),
          narration: `${proposal.documentType.replace(/_/g, ' ')} — ${proposal.vendorName ?? 'Unknown vendor'} — ${proposal.invoiceNumber ?? 'No ref'}`,
          postedBy: actorId,
          lines: linesToPost,
        },
        session,
      );

      const withJournal = await this.proposalModel
        .findByIdAndUpdate(proposalId, { $set: { journalId: posted._id } }, { new: true, session })
        .exec();

      // A bank-line proposal accounts for that line: match it to the voucher
      // in the same transaction, so the line is never in the books twice.
      if (proposal.bankLineId) await this.matchBankLine(proposal, linesToPost, posted._id, session);

      // Mirror the posting into the purchase/sales sub-ledgers so the Purchase,
      // Sales, GST and ageing screens reflect this document without re-entry —
      // in the same transaction, so there is never a journal without its bill.
      // The TDS actually posted — the reviewer may have changed or removed it.
      const tdsAccount = await this.accountsService.resolveSystemAccount(orgId, SystemAccountKey.TDS_PAYABLE);
      const tdsPosted = linesToPost
        .filter((l) => String(l.accountId) === String(tdsAccount._id))
        .reduce((s, l) => s + l.creditPaise - l.debitPaise, 0);
      const mirrored = await this.subledgerSync.syncApprovedProposal(
        proposal,
        posted._id,
        actorId,
        session,
        tdsPosted > 0
          ? { section: proposal.tds?.section ?? 'unspecified', rateBps: proposal.tds?.rateBps ?? 0, amountPaise: tdsPosted }
          : null,
      );

      // The upload itself moves on too; it used to sit at PROPOSED forever.
      await this.markDocument(proposal, DocumentStatus.APPROVED, session);

      await this.auditService.record(
        {
          orgId,
          entityType: 'ProposedEntry',
          entityId: proposalId,
          action: 'APPROVE',
          performedBy: actorId,
          before: { status: ProposedEntryStatus.PROPOSED },
          after: {
            status: ProposedEntryStatus.APPROVED,
            journalId: posted._id.toString(),
            // Whether the human changed the AI's lines before posting.
            editedByReviewer: !!overrideLines,
            billId: mirrored.billId ?? null,
            invoiceId: mirrored.invoiceId ?? null,
          },
        },
        session,
      );

      return { journal: posted, updated: withJournal, sync: mirrored };
    });

    await this.learnFromApproval(proposal, overrideLines);

    this.logger.log(
      `Proposal ${proposalId} approved by ${actorId} → Journal ${journal._id}` +
        (sync.billId ? ` → Bill ${sync.billId}` : '') +
        (sync.invoiceId ? ` → Invoice ${sync.invoiceId}` : ''),
    );
    return updated!;
  }

  async reject(input: RejectInput): Promise<ProposedEntryDocument> {
    const { proposalId, orgId, actorId, reason } = input;

    const proposal = await withOrg(orgId, () =>
      this.proposalModel.findById(proposalId).exec(),
    );
    if (!proposal) throw new NotFoundException('Proposal not found');
    if (proposal.status !== ProposedEntryStatus.PROPOSED) {
      throw new BadRequestException(`Cannot reject a proposal with status "${proposal.status}"`);
    }

    const updated = await this.postingService.inTransaction(async (session) => {
      // Conditional on still being PROPOSED, so a reject racing an approve cannot
      // mark rejected a proposal whose journal has just been posted.
      const claimed = await withOrg(orgId, () =>
        this.proposalModel
          .findOneAndUpdate(
            { _id: proposalId, status: ProposedEntryStatus.PROPOSED },
            {
              $set: {
                status: ProposedEntryStatus.REJECTED,
                rejectedBy: actorId,
                rejectionReason: reason ?? null,
              },
            },
            { new: true, session },
          )
          .exec(),
      );
      if (!claimed) throw new BadRequestException('This proposal has already been approved or rejected');
      await this.markDocument(proposal, DocumentStatus.REJECTED, session);
      await this.auditService.record(
        {
          orgId,
          entityType: 'ProposedEntry',
          entityId: proposalId,
          action: 'REJECT',
          performedBy: actorId,
          before: { status: ProposedEntryStatus.PROPOSED },
          after: { status: ProposedEntryStatus.REJECTED, reason: reason ?? null },
        },
        session,
      );
      return claimed;
    });

    this.logger.log(`Proposal ${proposalId} rejected by ${actorId}`);
    return updated;
  }

  /**
   * Marks the bank line this proposal was made from as matched to its voucher.
   * The bank side of the lines must still be the statement amount: a reviewer
   * may split the account side, but the bank moved what it moved.
   */
  private async matchBankLine(
    proposal: ProposedEntryDocument,
    lines: Array<{ accountId: string; debitPaise: number; creditPaise: number }>,
    journalId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const orgId = proposal.orgId;
    const line = await this.bankLineModel.findOne({ _id: proposal.bankLineId, orgId }).session(session).exec();
    if (!line) throw new BadRequestException('The bank line behind this proposal no longer exists.');
    const bank = await this.accountsService.resolveSystemAccount(orgId, SystemAccountKey.BANK);
    const outgoing = line.debitPaise > 0;
    const bankMoved = lines
      .filter((l) => String(l.accountId) === String(bank._id))
      .reduce((s, l) => s + (outgoing ? l.creditPaise - l.debitPaise : l.debitPaise - l.creditPaise), 0);
    const statement = outgoing ? line.debitPaise : line.creditPaise;
    if (bankMoved !== statement) {
      throw new BadRequestException(
        `The ${bank.name} line must stay ${(statement / 100).toFixed(2)} ${outgoing ? 'credit' : 'debit'}, ` +
          'the amount on the bank statement.',
      );
    }
    const claimed = await this.bankLineModel
      .findOneAndUpdate(
        { _id: line._id, orgId, matchStatus: MatchStatus.UNMATCHED, excluded: { $ne: true } },
        { $set: { matchStatus: MatchStatus.CONFIRMED, matchedJournalId: journalId } },
        { session },
      )
      .exec();
    if (!claimed) {
      throw new BadRequestException('This bank line has been matched or excluded since. Reject this proposal instead.');
    }
  }

  /**
   * Remembers where this party's money goes, for next time. A correction
   * always teaches. Approving the suggestion as it stood teaches only when it
   * was a real categorisation (a rule or the model): waving through the
   * Purchases default says nothing about the vendor.
   */
  private async learnFromApproval(
    proposal: ProposedEntryDocument,
    overrideLines?: Array<{ accountId: string; accountName: string; debitPaise: number; creditPaise: number }>,
  ): Promise<void> {
    if (!proposal.vendorName || !LEARNABLE.has(proposal.documentType)) return;
    const confirmed = proposal.category?.source === 'rule' || proposal.category?.source === 'ai';
    if (!overrideLines && !confirmed) return;

    const lines =
      overrideLines ??
      proposal.suggestedLines.map((l) => ({
        accountId: l.accountId.toString(),
        accountName: l.accountName,
        debitPaise: l.debitPaise,
        creditPaise: l.creditPaise,
      }));
    // Money in is filed on the credit side; everything else on the debit side.
    const main =
      proposal.documentType === 'bank_receipt'
        ? lines.filter((l) => l.creditPaise > 0).sort((a, b) => b.creditPaise - a.creditPaise)[0]
        : lines
            .filter((l) => l.debitPaise > 0 && !l.accountName.toLowerCase().includes('gst'))
            .sort((a, b) => b.debitPaise - a.debitPaise)[0];
    if (!main) return;
    // Suspense is a placeholder, not a category.
    const suspense = await this.accountsService.resolveSystemAccount(proposal.orgId, SystemAccountKey.SUSPENSE);
    if (String(main.accountId) === String(suspense._id)) return;
    await this.learningService.upsertMapping(proposal.orgId, proposal.vendorName, String(main.accountId), main.accountName);
  }

  /** Approve all proposals with confidenceOverall >= threshold. */
  async approveHighConfidence(
    orgId: string,
    actorId: string,
    threshold = 0.9,
  ): Promise<{ approved: number }> {
    const highConf = await withOrg(orgId, () =>
      this.proposalModel
        .find({ status: ProposedEntryStatus.PROPOSED, confidenceOverall: { $gte: threshold } })
        .exec(),
    );

    let approved = 0;
    for (const proposal of highConf) {
      try {
        await this.approve({ proposalId: proposal._id.toString(), orgId, actorId });
        approved++;
      } catch (err) {
        this.logger.warn(`Bulk approve: skipped ${proposal._id}: ${String(err)}`);
      }
    }

    this.logger.log(`Bulk approve: ${approved}/${highConf.length} proposals approved by ${actorId}`);
    return { approved };
  }
}
