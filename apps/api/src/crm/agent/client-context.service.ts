import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChecklistItemStatus,
  ComplianceStatus,
  DocumentRequestStatus,
  PracticeInvoiceStatus,
} from '@ai-accounting/shared';
import { Organization, OrganizationDocument } from '../../tenancy/schemas/organization.schema';
import { ComplianceItem, ComplianceItemDocument } from '../schemas/compliance-item.schema';
import { DocumentRequest, DocumentRequestDocument } from '../schemas/document-request.schema';
import {
  PracticeInvoice,
  PracticeInvoiceDocument,
} from '../schemas/practice-invoice.schema';

/**
 * What the agent is allowed to know about a client when it answers them.
 *
 * Everything here is a fact already in the database. The agent is told to
 * answer only from this block, which is what stops it inventing a deadline or
 * a document status — the failure mode that would actually hurt a client.
 */
export interface ClientContext {
  clientName: string;
  /** The person to greet. Addressing someone by their company name reads oddly. */
  contactName?: string;
  gstin?: string;
  pan?: string;
  /** Next statutory deadline, soonest first. */
  nextDeadlines: { name: string; period: string; dueDate: string }[];
  /** Documents the firm is still waiting for. */
  pendingDocuments: { purpose: string; dueDate: string; missing: string[] }[];
  /** Whether anything is unpaid — deliberately WITHOUT amounts (see below). */
  hasOutstandingInvoice: boolean;
}

function formatDate(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

@Injectable()
export class ClientContextService {
  constructor(
    @InjectModel(Organization.name) private orgModel: Model<OrganizationDocument>,
    @InjectModel(ComplianceItem.name) private complianceModel: Model<ComplianceItemDocument>,
    @InjectModel(DocumentRequest.name) private requestModel: Model<DocumentRequestDocument>,
    @InjectModel(PracticeInvoice.name) private invoiceModel: Model<PracticeInvoiceDocument>,
  ) {}

  async forClient(clientOrgId: string): Promise<ClientContext | null> {
    const org = await this.orgModel.findById(clientOrgId).exec();
    if (!org) return null;

    const orgId = new Types.ObjectId(clientOrgId);
    const today = new Date().toISOString().slice(0, 10);

    const [deadlines, requests, unpaidCount] = await Promise.all([
      this.complianceModel
        .find({ clientOrgId: orgId, status: ComplianceStatus.PENDING, dueDate: { $gte: today } })
        .sort({ dueDate: 1 })
        .limit(3)
        .exec(),
      this.requestModel
        .find({ clientOrgId: orgId, status: DocumentRequestStatus.OPEN })
        .sort({ dueDate: 1 })
        .limit(3)
        .exec(),
      this.invoiceModel
        .countDocuments({
          clientOrgId: orgId,
          status: {
            $in: [
              PracticeInvoiceStatus.SENT,
              PracticeInvoiceStatus.PARTIALLY_PAID,
              PracticeInvoiceStatus.OVERDUE,
              PracticeInvoiceStatus.LEGAL_NOTICE,
            ],
          },
        })
        .exec(),
    ]);

    return {
      clientName: org.name,
      contactName: org.contactName,
      gstin: org.gstin,
      pan: org.pan,
      nextDeadlines: deadlines.map((d) => ({
        name: d.complianceType,
        period: d.periodLabel,
        dueDate: formatDate(d.dueDate),
      })),
      pendingDocuments: requests.map((r) => ({
        purpose: r.purpose,
        dueDate: formatDate(r.dueDate),
        missing: r.items
          .filter((i) => i.status === ChecklistItemStatus.PENDING)
          .map((i) => i.label),
      })),
      // Deliberately a boolean, not an amount. Money questions escalate to a
      // human, so the agent has no business quoting a balance — and cannot
      // leak one even if a client asks cleverly.
      hasOutstandingInvoice: unpaidCount > 0,
    };
  }

  /** Renders the context as the grounding block handed to the model. */
  static toPromptBlock(context: ClientContext): string {
    const lines: string[] = [`Client organisation: ${context.clientName}`];

    // The greeting should name the person, not the company.
    lines.push(
      context.contactName
        ? `Contact person (greet them by this name): ${context.contactName}`
        : 'Contact person: not recorded — greet them without a name',
    );

    if (context.gstin) lines.push(`GSTIN: ${context.gstin}`);
    if (context.pan) lines.push(`PAN: ${context.pan}`);

    if (context.nextDeadlines.length) {
      lines.push('Upcoming filing deadlines:');
      for (const d of context.nextDeadlines) {
        lines.push(`  - ${d.name} for ${d.period}, due ${d.dueDate}`);
      }
    } else {
      lines.push('Upcoming filing deadlines: none recorded');
    }

    if (context.pendingDocuments.length) {
      lines.push('Documents the firm is still waiting for:');
      for (const r of context.pendingDocuments) {
        const missing = r.missing.length ? r.missing.join(', ') : 'none';
        lines.push(`  - For ${r.purpose} (needed by ${r.dueDate}): ${missing}`);
      }
    } else {
      lines.push('Documents outstanding: none');
    }

    lines.push(
      context.hasOutstandingInvoice
        ? 'The client has at least one unpaid invoice. Do NOT discuss amounts — refer any money question to the CA.'
        : 'The client has no unpaid invoices.',
    );

    return lines.join('\n');
  }
}
