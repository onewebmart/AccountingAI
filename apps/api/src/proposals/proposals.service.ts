import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProposedEntryStatus, VoucherType } from '@ai-accounting/shared';
import { ProposedEntry, ProposedEntryDocument } from './schemas/proposed-entry.schema';
import { ExtractedDocument, ExtractedDocumentDocument } from '../extraction/schemas/extracted-document.schema';
import { PostingService } from '../gl/posting.service';
import { LearningService } from './learning.service';
import { withOrg } from '../database/tenant.plugin';

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
  const d = dateStr ? new Date(dateStr) : new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // 1–12
  return m >= 4 ? `${y}-${(y + 1).toString().slice(-2)}` : `${y - 1}-${y.toString().slice(-2)}`;
}

/** Map extracted document type + amounts to balanced, human-readable journal lines. */
function buildSuggestedLines(extracted: ExtractedDocumentDocument) {
  const a = extracted.amountsPaise;
  const gstTotal = a.cgst + a.sgst + a.igst + a.cess;
  const conf = a.confidence;

  if (extracted.documentType === 'purchase_invoice' || extracted.documentType === 'bill') {
    const lines = [
      {
        accountName: 'Purchase / Expense Account',
        accountCode: null,
        accountId: new Types.ObjectId(),
        debitPaise: a.taxableValue,
        creditPaise: 0,
        confidence: conf,
        isAiSuggested: true,
      },
    ];
    if (gstTotal > 0) {
      lines.push({
        accountName: 'GST Input Tax Credit',
        accountCode: null,
        accountId: new Types.ObjectId(),
        debitPaise: gstTotal,
        creditPaise: 0,
        confidence: conf,
        isAiSuggested: true,
      });
    }
    lines.push({
      accountName: 'Accounts Payable',
      accountCode: null,
      accountId: new Types.ObjectId(),
      debitPaise: 0,
      creditPaise: a.taxableValue + gstTotal,
      confidence: conf,
      isAiSuggested: true,
    });
    return lines;
  }

  if (extracted.documentType === 'sales_invoice') {
    const lines = [
      {
        accountName: 'Accounts Receivable',
        accountCode: null,
        accountId: new Types.ObjectId(),
        debitPaise: a.total,
        creditPaise: 0,
        confidence: conf,
        isAiSuggested: true,
      },
      {
        accountName: 'Sales / Revenue Account',
        accountCode: null,
        accountId: new Types.ObjectId(),
        debitPaise: 0,
        creditPaise: a.taxableValue,
        confidence: conf,
        isAiSuggested: true,
      },
    ];
    if (gstTotal > 0) {
      lines.push({
        accountName: 'GST Output Tax',
        accountCode: null,
        accountId: new Types.ObjectId(),
        debitPaise: 0,
        creditPaise: gstTotal,
        confidence: conf,
        isAiSuggested: true,
      });
    }
    return lines;
  }

  // Fallback for receipt, bank_statement, etc. — single debit/credit, needs human input
  return [
    {
      accountName: 'Expense / Asset Account',
      accountCode: null,
      accountId: new Types.ObjectId(),
      debitPaise: a.total,
      creditPaise: 0,
      confidence: 0.3,
      isAiSuggested: true,
    },
    {
      accountName: 'Bank / Cash Account',
      accountCode: null,
      accountId: new Types.ObjectId(),
      debitPaise: 0,
      creditPaise: a.total,
      confidence: 0.3,
      isAiSuggested: true,
    },
  ];
}

/** Map extracted documentType to VoucherType for the journal. */
function toVoucherType(docType: string): VoucherType {
  switch (docType) {
    case 'purchase_invoice': return VoucherType.PURCHASE;
    case 'sales_invoice':    return VoucherType.SALES;
    case 'receipt':          return VoucherType.RECEIPT;
    default:                 return VoucherType.JOURNAL;
  }
}

@Injectable()
export class ProposalsService {
  private readonly logger = new Logger(ProposalsService.name);

  constructor(
    @InjectModel(ProposedEntry.name) private proposalModel: Model<ProposedEntryDocument>,
    @InjectModel(ExtractedDocument.name) private extractedModel: Model<ExtractedDocumentDocument>,
    private postingService: PostingService,
    private learningService: LearningService,
  ) {}

  /** Create a ProposedEntry from an ExtractedDocument. Called by the processor after extraction. */
  async createFromExtracted(
    extractedDocId: string,
    orgId: string,
  ): Promise<ProposedEntryDocument> {
    const extracted = await withOrg(orgId, () =>
      this.extractedModel.findById(extractedDocId).exec(),
    );
    if (!extracted) throw new NotFoundException('ExtractedDocument not found');

    const suggestedLines = buildSuggestedLines(extracted);

    // Apply learned vendor mapping to the primary expense debit line if one exists.
    if (extracted.vendor?.name) {
      const learned = await this.learningService.getMapping(orgId, extracted.vendor.name);
      if (learned) {
        // Primary expense line: largest debit that is not a GST line.
        const primaryIdx = suggestedLines
          .map((l, i) => ({ l, i }))
          .filter(({ l }) => l.debitPaise > 0 && !l.accountName.toLowerCase().includes('gst'))
          .sort((a, b) => b.l.debitPaise - a.l.debitPaise)[0]?.i;

        if (primaryIdx !== undefined) {
          suggestedLines[primaryIdx].accountName = learned.accountName;
          suggestedLines[primaryIdx].accountId = Types.ObjectId.isValid(learned.ledgerAccountId)
            ? new Types.ObjectId(learned.ledgerAccountId)
            : suggestedLines[primaryIdx].accountId;
          suggestedLines[primaryIdx].isAiSuggested = false;
        }
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

    // When the human provides override lines, learn the expense account for this vendor.
    if (overrideLines && proposal.vendorName) {
      const expenseDebit = overrideLines
        .filter((l) => l.debitPaise > 0 && !l.accountName.toLowerCase().includes('gst'))
        .sort((a, b) => b.debitPaise - a.debitPaise)[0];

      if (expenseDebit) {
        await this.learningService.upsertMapping(
          orgId,
          proposal.vendorName,
          expenseDebit.accountId,
          expenseDebit.accountName,
        );
      }
    }

    // PostingService.post() is the single writer to the ledger (Invariant 4)
    const journal = await this.postingService.post({
      orgId,
      voucherType: toVoucherType(proposal.documentType),
      financialYear: proposal.financialYear,
      date: proposal.invoiceDate ?? new Date().toISOString().slice(0, 10),
      narration: `${proposal.documentType.replace(/_/g, ' ')} — ${proposal.vendorName ?? 'Unknown vendor'} — ${proposal.invoiceNumber ?? 'No ref'}`,
      postedBy: actorId,
      lines: linesToPost,
    });

    const updated = await this.proposalModel
      .findByIdAndUpdate(
        proposalId,
        { $set: { status: ProposedEntryStatus.APPROVED, journalId: journal._id, approvedBy: actorId } },
        { new: true },
      )
      .exec();

    this.logger.log(
      `Proposal ${proposalId} approved by ${actorId} → Journal ${journal._id}`,
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

    const updated = await this.proposalModel
      .findByIdAndUpdate(
        proposalId,
        {
          $set: {
            status: ProposedEntryStatus.REJECTED,
            rejectedBy: actorId,
            rejectionReason: reason ?? null,
          },
        },
        { new: true },
      )
      .exec();

    this.logger.log(`Proposal ${proposalId} rejected by ${actorId}`);
    return updated!;
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
