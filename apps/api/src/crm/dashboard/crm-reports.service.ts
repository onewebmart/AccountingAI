import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ComplianceStatus,
  ConversationStatus,
  LeadStage,
  PracticeInvoiceStatus,
} from '@ai-accounting/shared';
import { Organization, OrganizationDocument } from '../../tenancy/schemas/organization.schema';
import { ComplianceItem, ComplianceItemDocument } from '../schemas/compliance-item.schema';
import { PracticeInvoice, PracticeInvoiceDocument } from '../schemas/practice-invoice.schema';
import { Lead, LeadDocument } from '../schemas/lead.schema';
import { Conversation, ConversationDocument } from '../schemas/conversation.schema';

/** Minutes of a person's time each automated action stands in for. */
const MINUTES_SAVED = {
  /** Drafting and sending a reminder by hand. */
  reminder: 4,
  /** Reading a client question and typing a reply. */
  agentReply: 6,
  /** Reading an enquiry and forming a first view. */
  leadQualification: 10,
} as const;

export interface MonthlyPoint {
  /** YYYY-MM. */
  month: string;
  label: string;
}

export interface CrmReports {
  /** Billed and collected per month, integer paise. */
  revenueTrend: (MonthlyPoint & { billedPaise: number; collectedPaise: number })[];
  /** Clients on the books at the end of each month. */
  clientGrowth: (MonthlyPoint & { added: number; cumulative: number })[];
  compliance: {
    /** Percentage of due obligations actually filed. */
    completionRate: number;
    filed: number;
    pending: number;
    overdue: number;
    byType: { complianceType: string; filed: number; pending: number }[];
  };
  leads: {
    /** Percentage of decided leads that were won. */
    conversionRate: number;
    won: number;
    lost: number;
    openPipelineValuePaise: number;
    bySource: { source: string; count: number; wonCount: number }[];
  };
  automation: {
    remindersSent: number;
    agentReplies: number;
    leadsQualified: number;
    /**
     * Estimated staff hours saved. An estimate, and labelled as one in the UI —
     * the per-action minutes are an assumption, not a measurement.
     */
    estimatedHoursSaved: number;
  };
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** The last `count` months ending at `today`, oldest first. */
function recentMonths(today: string, count: number): MonthlyPoint[] {
  const [year, month] = today.slice(0, 7).split('-').map(Number);
  const out: MonthlyPoint[] = [];

  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    const m = d.getUTCMonth();
    const y = d.getUTCFullYear();
    out.push({
      month: `${y}-${String(m + 1).padStart(2, '0')}`,
      label: `${MONTH_NAMES[m]} ${y}`,
    });
  }

  return out;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

@Injectable()
export class CrmReportsService {
  constructor(
    @InjectModel(Organization.name) private orgModel: Model<OrganizationDocument>,
    @InjectModel(ComplianceItem.name) private complianceModel: Model<ComplianceItemDocument>,
    @InjectModel(PracticeInvoice.name) private invoiceModel: Model<PracticeInvoiceDocument>,
    @InjectModel(Lead.name) private leadModel: Model<LeadDocument>,
    @InjectModel(Conversation.name) private conversationModel: Model<ConversationDocument>,
  ) {}

  async build(firmId: string, today = todayIso(), months = 6): Promise<CrmReports> {
    const window = recentMonths(today, months);

    const [invoices, clients, complianceItems, leads, conversations] = await Promise.all([
      this.invoiceModel.find({ status: { $ne: PracticeInvoiceStatus.CANCELLED } }).exec(),
      this.orgModel.find({ firmId: new Types.ObjectId(firmId) }).exec(),
      this.complianceModel.find({}).exec(),
      this.leadModel.find({}).exec(),
      this.conversationModel.find({}).exec(),
    ]);

    return {
      revenueTrend: this.revenueTrend(invoices, window),
      clientGrowth: this.clientGrowth(clients, window),
      compliance: this.compliance(complianceItems, today),
      leads: this.leadReport(leads),
      automation: this.automation(complianceItems, conversations, leads),
    };
  }

  private revenueTrend(invoices: PracticeInvoiceDocument[], window: MonthlyPoint[]) {
    return window.map((point) => {
      let billedPaise = 0;
      let collectedPaise = 0;

      for (const invoice of invoices) {
        if (invoice.status === PracticeInvoiceStatus.DRAFT) continue;

        if (invoice.issueDate.slice(0, 7) === point.month) {
          billedPaise += invoice.totalPaise;
        }
        // Collection is credited to the month the money actually arrived, not
        // the month the invoice was raised.
        for (const payment of invoice.payments) {
          if (payment.receivedOn.slice(0, 7) === point.month) {
            collectedPaise += payment.amountPaise;
          }
        }
      }

      return { ...point, billedPaise, collectedPaise };
    });
  }

  private clientGrowth(clients: OrganizationDocument[], window: MonthlyPoint[]) {
    const createdMonths = clients.map((c) => {
      const created = c.get('createdAt') as Date | undefined;
      return created ? created.toISOString().slice(0, 7) : null;
    });

    let cumulative = 0;
    const firstMonth = window[0]?.month ?? '';

    // Everything predating the window still counts towards the running total.
    for (const month of createdMonths) {
      if (month && month < firstMonth) cumulative++;
    }

    return window.map((point) => {
      const added = createdMonths.filter((m) => m === point.month).length;
      cumulative += added;
      return { ...point, added, cumulative };
    });
  }

  private compliance(items: ComplianceItemDocument[], today: string) {
    const filed = items.filter((i) => i.status === ComplianceStatus.FILED).length;
    const pending = items.filter((i) => i.status === ComplianceStatus.PENDING).length;
    const overdue = items.filter(
      (i) => i.status === ComplianceStatus.PENDING && i.dueDate < today,
    ).length;

    const byTypeMap = new Map<string, { filed: number; pending: number }>();
    for (const item of items) {
      const entry = byTypeMap.get(item.complianceType) ?? { filed: 0, pending: 0 };
      if (item.status === ComplianceStatus.FILED) entry.filed++;
      if (item.status === ComplianceStatus.PENDING) entry.pending++;
      byTypeMap.set(item.complianceType, entry);
    }

    const decided = filed + pending;

    return {
      completionRate: decided === 0 ? 0 : Math.round((filed / decided) * 100),
      filed,
      pending,
      overdue,
      byType: [...byTypeMap.entries()]
        .map(([complianceType, counts]) => ({ complianceType, ...counts }))
        .sort((a, b) => b.filed + b.pending - (a.filed + a.pending)),
    };
  }

  private leadReport(leads: LeadDocument[]) {
    const won = leads.filter((l) => l.stage === LeadStage.WON).length;
    const lost = leads.filter((l) => l.stage === LeadStage.LOST).length;
    const decided = won + lost;

    const openStages = [LeadStage.NEW, LeadStage.QUALIFYING, LeadStage.PROPOSAL_SENT];

    const bySourceMap = new Map<string, { count: number; wonCount: number }>();
    for (const lead of leads) {
      const entry = bySourceMap.get(lead.source) ?? { count: 0, wonCount: 0 };
      entry.count++;
      if (lead.stage === LeadStage.WON) entry.wonCount++;
      bySourceMap.set(lead.source, entry);
    }

    return {
      // Undecided leads are excluded — counting them as losses would understate
      // conversion for a firm that simply has a busy pipeline.
      conversionRate: decided === 0 ? 0 : Math.round((won / decided) * 100),
      won,
      lost,
      openPipelineValuePaise: leads
        .filter((l) => openStages.includes(l.stage))
        .reduce((sum, l) => sum + (l.estimatedValuePaise ?? 0), 0),
      bySource: [...bySourceMap.entries()]
        .map(([source, counts]) => ({ source, ...counts }))
        .sort((a, b) => b.count - a.count),
    };
  }

  private automation(
    items: ComplianceItemDocument[],
    conversations: ConversationDocument[],
    leads: LeadDocument[],
  ) {
    const remindersSent = items.reduce((sum, i) => sum + i.remindersSent.length, 0);
    const agentReplies = conversations.reduce((sum, c) => sum + c.autoRepliedCount, 0);
    const leadsQualified = leads.filter((l) => l.qualification?.ranAt).length;

    const minutes =
      remindersSent * MINUTES_SAVED.reminder +
      agentReplies * MINUTES_SAVED.agentReply +
      leadsQualified * MINUTES_SAVED.leadQualification;

    return {
      remindersSent,
      agentReplies,
      leadsQualified,
      estimatedHoursSaved: Math.round((minutes / 60) * 10) / 10,
    };
  }
}
