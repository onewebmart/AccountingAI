import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChecklistItemStatus,
  ComplianceStatus,
  ConversationStatus,
  DocumentRequestStatus,
  LeadStage,
  MessageDirection,
  MessageStatus,
  PracticeInvoiceStatus,
} from '@ai-accounting/shared';
import { Organization, OrganizationDocument } from '../../tenancy/schemas/organization.schema';
import { ComplianceItem, ComplianceItemDocument } from '../schemas/compliance-item.schema';
import { DocumentRequest, DocumentRequestDocument } from '../schemas/document-request.schema';
import { PracticeInvoice, PracticeInvoiceDocument } from '../schemas/practice-invoice.schema';
import { Lead, LeadDocument } from '../schemas/lead.schema';
import { Conversation, ConversationDocument } from '../schemas/conversation.schema';
import { CrmMessage, CrmMessageDocument } from '../schemas/crm-message.schema';

/**
 * The dashboard read model.
 *
 * Every number here is computed from the collections the earlier phases write.
 * That is why this phase came last: a tile built before its source module
 * exists can only be hardcoded, and a hardcoded tile on a dashboard is worse
 * than no tile — it looks like a fact.
 */
export interface DashboardSummary {
  clients: {
    total: number;
    /** Added since the start of this calendar month. */
    addedThisMonth: number;
  };
  deadlines: {
    pending: number;
    /** Falling due within seven days. */
    urgent: number;
    /** Already past due and unfiled. */
    overdue: number;
    upcoming: {
      complianceType: string;
      periodLabel: string;
      dueDate: string;
      daysLeft: number;
      clientsPending: number;
    }[];
  };
  fees: {
    /** All figures are integer paise (Invariant 1). */
    billedPaise: number;
    collectedPaise: number;
    outstandingPaise: number;
    /** Clients with at least one invoice past its due date. */
    clientsOverdue: number;
  };
  documents: {
    openRequests: number;
    itemsOutstanding: number;
    /** Received but not yet checked by a human — the amber pile. */
    awaitingVerification: number;
  };
  leads: {
    active: number;
    pipelineValuePaise: number;
    won: number;
    lost: number;
  };
  agent: {
    inboundTotal: number;
    autoRepliedTotal: number;
    autoResolveRate: number;
    escalatedOpen: number;
    /** Outbound messages the CRM has sent, of any kind. */
    messagesSent: number;
  };
  recentActivity: {
    clientName: string;
    summary: string;
    at: string;
  }[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Organization.name) private orgModel: Model<OrganizationDocument>,
    @InjectModel(ComplianceItem.name) private complianceModel: Model<ComplianceItemDocument>,
    @InjectModel(DocumentRequest.name) private requestModel: Model<DocumentRequestDocument>,
    @InjectModel(PracticeInvoice.name) private invoiceModel: Model<PracticeInvoiceDocument>,
    @InjectModel(Lead.name) private leadModel: Model<LeadDocument>,
    @InjectModel(Conversation.name) private conversationModel: Model<ConversationDocument>,
    @InjectModel(CrmMessage.name) private messageModel: Model<CrmMessageDocument>,
  ) {}

  async summary(firmId: string, today = todayIso()): Promise<DashboardSummary> {
    const firmObjectId = new Types.ObjectId(firmId);
    const monthStart = `${today.slice(0, 7)}-01`;

    // Organization is the tenant root and carries no firm scope of its own, so
    // client queries filter by firmId explicitly. Everything else is
    // firm-scoped by the isolation plugin.
    const [
      clientTotal,
      clientsAdded,
      complianceItems,
      requests,
      invoices,
      leads,
      conversations,
      messagesSent,
    ] = await Promise.all([
      this.orgModel.countDocuments({ firmId: firmObjectId, isActive: true }).exec(),
      this.orgModel
        .countDocuments({ firmId: firmObjectId, createdAt: { $gte: new Date(`${monthStart}T00:00:00Z`) } })
        .exec(),
      this.complianceModel.find({ status: ComplianceStatus.PENDING }).sort({ dueDate: 1 }).exec(),
      this.requestModel.find({ status: DocumentRequestStatus.OPEN }).exec(),
      this.invoiceModel.find({ status: { $ne: PracticeInvoiceStatus.CANCELLED } }).exec(),
      this.leadModel.find({}).exec(),
      this.conversationModel.find({}).exec(),
      this.messageModel
        .countDocuments({ direction: MessageDirection.OUTBOUND, status: MessageStatus.SENT })
        .exec(),
    ]);

    return {
      clients: { total: clientTotal, addedThisMonth: clientsAdded },
      deadlines: this.deadlines(complianceItems, today),
      fees: this.fees(invoices, today),
      documents: this.documents(requests),
      leads: this.leads(leads),
      agent: this.agent(conversations, messagesSent),
      recentActivity: await this.recentActivity(),
    };
  }

  private deadlines(items: ComplianceItemDocument[], today: string) {
    let urgent = 0;
    let overdue = 0;

    // Group by obligation and period, the way the deadline list reads.
    const groups = new Map<
      string,
      { complianceType: string; periodLabel: string; dueDate: string; clientsPending: number }
    >();

    for (const item of items) {
      const days = daysBetween(today, item.dueDate);
      if (days < 0) overdue++;
      else if (days <= 7) urgent++;

      // Only surface what is still ahead; overdue work belongs in its own list.
      if (days < 0) continue;

      const key = `${item.complianceType}|${item.periodKey}`;
      const existing = groups.get(key);
      if (existing) {
        existing.clientsPending++;
      } else {
        groups.set(key, {
          complianceType: item.complianceType,
          periodLabel: item.periodLabel,
          dueDate: item.dueDate,
          clientsPending: 1,
        });
      }
    }

    const upcoming = [...groups.values()]
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 5)
      .map((g) => ({ ...g, daysLeft: daysBetween(today, g.dueDate) }));

    return { pending: items.length, urgent, overdue, upcoming };
  }

  private fees(invoices: PracticeInvoiceDocument[], today: string) {
    let billedPaise = 0;
    let collectedPaise = 0;
    let outstandingPaise = 0;
    const overdueClients = new Set<string>();

    for (const invoice of invoices) {
      // A draft has not been sent to anyone, so it is not billed yet.
      if (invoice.status === PracticeInvoiceStatus.DRAFT) continue;

      billedPaise += invoice.totalPaise;
      collectedPaise += invoice.paidPaise;

      const balance = invoice.totalPaise - invoice.paidPaise;
      if (balance <= 0) continue;

      outstandingPaise += balance;
      if (daysBetween(invoice.dueDate, today) > 0) {
        overdueClients.add(invoice.clientOrgId.toString());
      }
    }

    return { billedPaise, collectedPaise, outstandingPaise, clientsOverdue: overdueClients.size };
  }

  private documents(requests: DocumentRequestDocument[]) {
    let itemsOutstanding = 0;
    let awaitingVerification = 0;

    for (const request of requests) {
      for (const item of request.items) {
        if (item.status === ChecklistItemStatus.PENDING) itemsOutstanding++;
        if (item.status === ChecklistItemStatus.RECEIVED) awaitingVerification++;
      }
    }

    return { openRequests: requests.length, itemsOutstanding, awaitingVerification };
  }

  private leads(leads: LeadDocument[]) {
    const activeStages = [LeadStage.NEW, LeadStage.QUALIFYING, LeadStage.PROPOSAL_SENT];
    const active = leads.filter((l) => activeStages.includes(l.stage));

    return {
      active: active.length,
      pipelineValuePaise: active.reduce((sum, l) => sum + (l.estimatedValuePaise ?? 0), 0),
      won: leads.filter((l) => l.stage === LeadStage.WON).length,
      lost: leads.filter((l) => l.stage === LeadStage.LOST).length,
    };
  }

  private agent(conversations: ConversationDocument[], messagesSent: number) {
    let inboundTotal = 0;
    let autoRepliedTotal = 0;
    let escalatedOpen = 0;

    for (const c of conversations) {
      inboundTotal += c.inboundCount;
      autoRepliedTotal += c.autoRepliedCount;
      if (c.status === ConversationStatus.ESCALATED) escalatedOpen++;
    }

    return {
      inboundTotal,
      autoRepliedTotal,
      autoResolveRate:
        inboundTotal === 0 ? 0 : Math.round((autoRepliedTotal / inboundTotal) * 100),
      escalatedOpen,
      messagesSent,
    };
  }

  /** The most recent things that happened, newest first. */
  private async recentActivity(): Promise<DashboardSummary['recentActivity']> {
    const messages = await this.messageModel
      .find({ direction: MessageDirection.OUTBOUND })
      .sort({ createdAt: -1 })
      .limit(8)
      .exec();

    return messages.map((m) => ({
      clientName: m.recipientName ?? m.recipientAddress,
      summary: this.describe(m),
      at: (m.sentAt ?? (m.get('createdAt') as Date)).toISOString(),
    }));
  }

  /**
   * Plain-language description of a send.
   *
   * The template alone is not enough: agent replies and escalation notices both
   * go out as GENERIC, so what actually distinguishes them is the cause. Falling
   * back to "Message sent" for those would make the busiest module on the
   * dashboard the least legible one.
   */
  private describe(message: CrmMessageDocument): string {
    switch (message.templateKey) {
      case 'DOCUMENT_REMINDER':
        return 'Chased missing documents';
      case 'COMPLIANCE_DEADLINE':
        return 'Reminded about a filing deadline';
      case 'INVOICE_DUE':
        return 'Reminded about an invoice';
      case 'INVOICE_OVERDUE':
        return 'Chased an overdue invoice';
      case 'LEAD_FOLLOW_UP':
        return 'Followed up on a proposal';
      default:
        break;
    }

    if (message.cause?.type === 'conversation') return 'Answered a client question';
    return 'Message sent';
  }
}
