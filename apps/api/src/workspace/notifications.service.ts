import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BillStatus, DocumentStatus, InvoiceStatus, MatchStatus, Permission, ProposedEntryStatus, UserRole, hasPermission } from '@ai-accounting/shared';
import { User, UserDocument } from '../tenancy/schemas/user.schema';
import { Organization, OrganizationDocument } from '../tenancy/schemas/organization.schema';
import { Document, DocumentDocument } from '../documents/schemas/document.schema';
import { ProposedEntry, ProposedEntryDocument } from '../proposals/schemas/proposed-entry.schema';
import { ApprovalRequest, ApprovalRequestDocument } from '../approvals/schemas/approval.schema';
import { SalesInvoice, SalesInvoiceDocument } from '../sales/schemas/sales-invoice.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { BankStatementLine, BankStatementLineDocument } from '../banking/schemas/bank-statement-line.schema';
import { GstFiling, GstFilingDocument } from '../gst/schemas/gst-filing.schema';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import { outstandingPaise } from '../gl/schemas/settlement.schema';
import { TdsService } from '../tds/tds.service';
import { todayIst } from '../automation/schedule';

export type NotificationTone = 'pending' | 'error' | 'info';

export interface Notification {
  /** Stable for the same thing, so the list keeps its order and keys. */
  key: string;
  kind: 'review' | 'approvals' | 'documents_failed' | 'overdue_invoices' | 'bills_due' | 'tds_due' | 'gst_due' | 'bank_unmatched';
  tone: NotificationTone;
  title: string;
  body: string;
  /** Where clicking it goes. */
  href: string;
  /** When it became something to look at: unread when after the person last opened the list. */
  at: string;
  unread: boolean;
}

/** Due dates within this many days are worth saying. */
const SOON_DAYS = 7;

const rupees = (paise: number) => {
  const r = paise / 100;
  if (r >= 1_00_00_000) return `₹${(r / 1_00_00_000).toFixed(2)} Cr`;
  if (r >= 1_00_000) return `₹${(r / 1_00_000).toFixed(2)} L`;
  return `₹${Math.round(r).toLocaleString('en-IN')}`;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const dayStart = (date: string) => new Date(`${date}T00:00:00+05:30`).toISOString();
const shortDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthName = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** "2026-27" for a date in that financial year. */
const fyOf = (date: string) => {
  const y = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

/**
 * What needs someone's attention in this org, worked out from the books as
 * they are now: entries waiting in Review, approvals, documents the AI could
 * not read, invoices overdue, bills falling due, TDS and GST due dates, bank
 * lines to match. Nothing is stored but when each person last opened the
 * list, so a notification never goes stale: it disappears once dealt with.
 * Each person sees only what their role can act on.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Organization.name) private orgModel: Model<OrganizationDocument>,
    @InjectModel(Document.name) private documentModel: Model<DocumentDocument>,
    @InjectModel(ProposedEntry.name) private proposalModel: Model<ProposedEntryDocument>,
    @InjectModel(ApprovalRequest.name) private approvalModel: Model<ApprovalRequestDocument>,
    @InjectModel(SalesInvoice.name) private invoiceModel: Model<SalesInvoiceDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(BankStatementLine.name) private bankLineModel: Model<BankStatementLineDocument>,
    @InjectModel(GstFiling.name) private filingModel: Model<GstFilingDocument>,
    @InjectModel(OrgSettings.name) private settingsModel: Model<OrgSettingsDocument>,
    @Optional() private tds?: TdsService,
  ) {}

  async list(userId: string, orgId: string, role: string, today = todayIst()): Promise<{ items: Notification[]; unread: number; seenAt: string | null }> {
    const can = (p: Permission) => hasPermission(role as UserRole, p);
    const user = Types.ObjectId.isValid(userId) ? await this.userModel.findById(userId).select('notificationsSeenAt').lean().exec() : null;
    const seenAt = (user as { notificationsSeenAt?: Date | null } | null)?.notificationsSeenAt ?? null;

    const parts = await Promise.all([
      can(Permission.APPROVE_PROPOSAL) || can(Permission.REVIEW_PROPOSAL) ? this.review(orgId) : null,
      this.approvals(orgId, userId, role),
      can(Permission.UPLOAD_DOCUMENT) ? this.failedDocuments(orgId) : null,
      can(Permission.MANAGE_SALES) ? this.overdueInvoices(orgId, today) : null,
      can(Permission.MANAGE_PURCHASE) ? this.billsDue(orgId, today) : null,
      can(Permission.MANAGE_PURCHASE) || can(Permission.MANAGE_GST) ? this.tdsDue(orgId, today) : [],
      can(Permission.MANAGE_GST) ? this.gstDue(orgId, today) : [],
      can(Permission.VIEW_JOURNAL) ? this.bankUnmatched(orgId) : null,
    ]);
    const items = parts
      .flat()
      .filter((n): n is Omit<Notification, 'unread'> => !!n)
      .map((n) => ({ ...n, unread: !seenAt || new Date(n.at) > new Date(seenAt) }))
      // Unread first, then the most recent.
      .sort((a, b) => (a.unread === b.unread ? b.at.localeCompare(a.at) : a.unread ? -1 : 1));
    return { items, unread: items.filter((n) => n.unread).length, seenAt: seenAt ? new Date(seenAt).toISOString() : null };
  }

  /** The person opened the list: everything in it now counts as read. */
  async markSeen(userId: string): Promise<{ seenAt: string }> {
    const now = new Date();
    if (Types.ObjectId.isValid(userId)) await this.userModel.updateOne({ _id: userId }, { $set: { notificationsSeenAt: now } }).exec();
    return { seenAt: now.toISOString() };
  }

  private async review(orgId: string): Promise<Omit<Notification, 'unread'> | null> {
    const [count, latest] = await Promise.all([
      this.proposalModel.countDocuments({ orgId, status: ProposedEntryStatus.PROPOSED }).exec(),
      this.proposalModel.findOne({ orgId, status: ProposedEntryStatus.PROPOSED }).sort({ createdAt: -1 }).select('createdAt vendorName').lean().exec(),
    ]);
    if (!count || !latest) return null;
    const created = (latest as { createdAt?: Date }).createdAt ?? new Date();
    return {
      key: 'review',
      kind: 'review',
      tone: 'pending',
      title: `${plural(count, 'entry', 'entries')} waiting for review`,
      body: latest.vendorName ? `Latest: ${latest.vendorName}. The AI's entries post only when someone approves them.` : "The AI's entries post only when someone approves them.",
      href: '/review',
      at: new Date(created).toISOString(),
    };
  }

  /** Pending approvals this person may give: their role is allowed, and they did not make it. */
  private async approvals(orgId: string, userId: string, role: string): Promise<Omit<Notification, 'unread'> | null> {
    const pending = await this.approvalModel
      .find({ orgId, status: 'pending', makerId: { $ne: userId }, 'approvals.userId': { $ne: userId } })
      .select('approverRoles summary createdAt')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    const mine = pending.filter((p) => !p.approverRoles?.length || p.approverRoles.includes(role));
    if (!mine.length) return null;
    const created = (mine[0] as { createdAt?: Date }).createdAt ?? new Date();
    return {
      key: 'approvals',
      kind: 'approvals',
      tone: 'pending',
      title: `${plural(mine.length, 'approval', 'approvals')} waiting for you`,
      body: `Latest: ${mine[0].summary}`,
      href: '/approvals',
      at: new Date(created).toISOString(),
    };
  }

  private async failedDocuments(orgId: string): Promise<Omit<Notification, 'unread'> | null> {
    const failed = await this.documentModel
      .find({ orgId, status: DocumentStatus.FAILED, enteredAs: null })
      .select('originalName failureReason updatedAt')
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean()
      .exec();
    if (!failed.length) return null;
    const first = failed[0] as { originalName?: string; failureReason?: string | null; updatedAt?: Date };
    return {
      key: 'documents_failed',
      kind: 'documents_failed',
      tone: 'error',
      title: `${plural(failed.length, 'document', 'documents')} could not be read`,
      body: first.failureReason ? `${first.originalName ?? 'A document'}: ${first.failureReason}` : `${first.originalName ?? 'A document'}. Retry it, or enter it by hand with Add to.`,
      href: '/documents',
      at: new Date(first.updatedAt ?? new Date()).toISOString(),
    };
  }

  private async overdueInvoices(orgId: string, today: string): Promise<Omit<Notification, 'unread'> | null> {
    const invoices = await this.invoiceModel
      .find({ orgId, status: { $in: [InvoiceStatus.SENT, InvoiceStatus.POSTED] }, dueDate: { $lt: today } })
      .lean()
      .exec();
    const overdue = invoices.map((i) => ({ i, owed: outstandingPaise(i as Parameters<typeof outstandingPaise>[0]) })).filter((x) => x.owed > 0);
    if (!overdue.length) return null;
    const total = overdue.reduce((s, x) => s + x.owed, 0);
    // New when the latest invoice fell overdue, not every morning.
    const latestDue = overdue.reduce((m, x) => ((x.i.dueDate ?? '') > m ? (x.i.dueDate ?? '') : m), '');
    return {
      key: 'overdue_invoices',
      kind: 'overdue_invoices',
      tone: 'error',
      title: `${rupees(total)} overdue from customers`,
      body: `${plural(overdue.length, 'invoice is', 'invoices are')} past the due date. Send a reminder or record the payment.`,
      href: '/sales/invoices',
      at: dayStart(addDays(latestDue, 1)),
    };
  }

  /** Bills to pay in the next week, and any already late. */
  private async billsDue(orgId: string, today: string): Promise<Omit<Notification, 'unread'> | null> {
    const until = addDays(today, SOON_DAYS);
    const bills = await this.billModel.find({ orgId, status: BillStatus.POSTED, dueDate: { $ne: null, $lte: until } }).lean().exec();
    const owed = bills.map((b) => ({ b, owed: outstandingPaise(b as Parameters<typeof outstandingPaise>[0]) })).filter((x) => x.owed > 0);
    if (!owed.length) return null;
    const late = owed.filter((x) => (x.b.dueDate ?? '') < today);
    const soon = owed.filter((x) => (x.b.dueDate ?? '') >= today);
    const total = owed.reduce((s, x) => s + x.owed, 0);
    const next = soon.reduce((m, x) => (!m || (x.b.dueDate ?? '') < m ? (x.b.dueDate ?? '') : m), '');
    return {
      key: 'bills_due',
      kind: 'bills_due',
      tone: late.length ? 'error' : 'pending',
      title: late.length ? `${rupees(late.reduce((s, x) => s + x.owed, 0))} of bills overdue` : `${rupees(total)} of bills due this week`,
      body: [
        late.length ? `${plural(late.length, 'bill is', 'bills are')} past the due date.` : null,
        soon.length ? `${plural(soon.length, 'bill falls', 'bills fall')} due by ${shortDate(until)}${next ? `, the first on ${shortDate(next)}` : ''}.` : null,
        'Pay them from Payment Runs.',
      ].filter(Boolean).join(' '),
      href: '/purchases/payment-runs',
      // A week before the first due date, or the day the first fell late.
      at: dayStart(late.length ? addDays(late.reduce((m, x) => ((x.b.dueDate ?? '') > m ? (x.b.dueDate ?? '') : m), ''), 1) : addDays(next, -SOON_DAYS)),
    };
  }

  /** TDS deducted and not yet deposited, due by the 7th (30 April for March). */
  private async tdsDue(orgId: string, today: string): Promise<Array<Omit<Notification, 'unread'>>> {
    if (!this.tds) return [];
    const fys = [...new Set([fyOf(today), fyOf(addDays(today, -40))])];
    const months = (await Promise.all(fys.map((fy) => this.tds!.payable(orgId, fy).then((p) => p.months).catch(() => [])))).flat();
    const due = months.filter((m) => m.pendingPaise > 0 && (m.overdue || m.dueDate <= addDays(today, SOON_DAYS)));
    if (!due.length) return [];
    const pending = due.reduce((s, m) => s + m.pendingPaise, 0);
    const late = due.filter((m) => m.overdue);
    const first = due.reduce((a, b) => (a.dueDate <= b.dueDate ? a : b));
    return [{
      key: 'tds_due',
      kind: 'tds_due',
      tone: late.length ? 'error' : 'pending',
      title: late.length ? `TDS of ${rupees(late.reduce((s, m) => s + m.pendingPaise, 0))} is past its due date` : `Deposit TDS of ${rupees(pending)} by ${shortDate(first.dueDate)}`,
      body: late.length
        ? 'Interest runs at 1.5% a month from the due date. Record the challan in TDS once it is paid.'
        : `${due.map((m) => `${m.section} for ${monthName(m.month)}`).join(', ')}. Record the challan in TDS once it is paid.`,
      href: '/tds',
      at: dayStart(late.length ? addDays(first.dueDate, 1) : addDays(first.dueDate, -SOON_DAYS)),
    }];
  }

  /** Last month's GSTR-1 (11th) and GSTR-3B (20th), when not filed here and due within the week or late. */
  private async gstDue(orgId: string, today: string): Promise<Array<Omit<Notification, 'unread'>>> {
    // Registered for GST: the GSTIN in the org's settings (or, for older orgs, on the org).
    const [settings, org] = await Promise.all([
      this.settingsModel.findOne({ orgId }).select('gstin').lean().exec(),
      this.orgModel.findById(orgId).select('gstin').lean().exec().catch(() => null),
    ]);
    if (!settings?.gstin && !(org as { gstin?: string | null } | null)?.gstin) return [];
    const [y, m] = today.split('-').map(Number);
    const period = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const filed = await this.filingModel.find({ orgId, period, status: 'filed' }).select('returnType').lean().exec();
    const done = new Set(filed.map((f) => f.returnType));
    const out: Array<Omit<Notification, 'unread'>> = [];
    for (const [type, day, label] of [['GSTR1', 11, 'GSTR-1'], ['GSTR3B', 20, 'GSTR-3B']] as const) {
      if (done.has(type)) continue;
      const due = `${today.slice(0, 7)}-${String(day).padStart(2, '0')}`;
      if (due > addDays(today, SOON_DAYS)) continue;
      const late = due < today;
      out.push({
        key: `gst_due:${type}:${period}`,
        kind: 'gst_due',
        tone: late ? 'error' : 'pending',
        title: late ? `${label} for ${monthName(period)} was due ${shortDate(due)}` : `${label} for ${monthName(period)} is due ${shortDate(due)}`,
        body: late ? 'Late fees run from the day after the due date. Prepare and file it from GST.' : 'Prepare it from your books in GST and file it before the date.',
        href: '/gst',
        at: dayStart(late ? addDays(due, 1) : addDays(due, -SOON_DAYS)),
      });
    }
    return out;
  }

  private async bankUnmatched(orgId: string): Promise<Omit<Notification, 'unread'> | null> {
    const [count, latest] = await Promise.all([
      this.bankLineModel.countDocuments({ orgId, matchStatus: MatchStatus.UNMATCHED }).exec(),
      this.bankLineModel.findOne({ orgId, matchStatus: MatchStatus.UNMATCHED }).sort({ createdAt: -1 }).select('createdAt').lean().exec(),
    ]);
    if (!count || !latest) return null;
    return {
      key: 'bank_unmatched',
      kind: 'bank_unmatched',
      tone: 'info',
      title: `${plural(count, 'bank line', 'bank lines')} to match`,
      body: 'Match them to invoices, bills or entries in Banking, or send them to Review to categorise.',
      href: '/banking',
      at: new Date((latest as { createdAt?: Date }).createdAt ?? new Date()).toISOString(),
    };
  }
}
