import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BillStatus, Permission, UserRole, hasPermission } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { AuditLog } from '../gl/schemas/audit-log.schema';
import { PurchaseBill, PurchaseBillDocument } from '../purchase/schemas/purchase-bill.schema';
import { ApprovalDocType, ApprovalPolicy, ApprovalPolicyDocument, ApprovalRequest, ApprovalRequestDocument } from './schemas/approval.schema';
import { RiskFacts, scoreRisk } from './risk';

/** Posts what a request is for, once it is approved; returns what it made. */
export type Executor = (orgId: string, actorId: string, request: ApprovalRequestDocument) => Promise<string>;

export interface GateInput {
  orgId: string;
  docType: ApprovalDocType;
  /** The draft, when there is one; payments and vouchers have none. */
  docId: string | null;
  /** For those: what to post once approved, with the executor's kind. */
  payload?: Record<string, unknown> & { kind: string };
  summary: string;
  amountPaise: number;
  makerId: string | null;
  actorId: string;
  actorRole: string;
  facts: RiskFacts;
}

/** Thrown when a posting needs approval first: the request is made, and says why. */
export class ApprovalNeeded extends ConflictException {
  constructor(message: string, requestId: string) {
    super({ statusCode: 409, message, approvalRequestId: requestId });
  }
}

/**
 * Approval policies and maker-checker. A policy that applies holds a
 * posting until enough people (not the one who made it) have approved;
 * the last approval can be the posting itself (Approve & post). With no
 * policy for a kind of document, nothing changes. AI never approves: the
 * risk score only decides whether one approver is enough.
 */
@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);
  private readonly executors = new Map<string, Executor>();

  constructor(
    @InjectModel(ApprovalPolicy.name) private policyModel: Model<ApprovalPolicyDocument>,
    @InjectModel(ApprovalRequest.name) private requestModel: Model<ApprovalRequestDocument>,
    @InjectModel(PurchaseBill.name) private billModel: Model<PurchaseBillDocument>,
    @InjectModel(AuditLog.name) private auditModel: Model<AuditLog>,
    private audit: AuditService,
  ) {}

  /** Each module says how to post its documents once approved: 'bill', or a payload's kind. */
  register(kind: string, executor: Executor) {
    this.executors.set(kind, executor);
  }

  // ── Policies ──────────────────────────────────────────────────────────────

  async listPolicies(orgId: string) {
    return this.policyModel.find({ orgId }).sort({ docType: 1, minAmountPaise: 1 }).lean().exec();
  }

  async createPolicy(orgId: string, actorId: string, input: { name: string; docType: ApprovalDocType; minAmountPaise?: number; newVendorOnly?: boolean; approvalsRequired?: 1 | 2; approverRoles?: string[] }) {
    if (!input.name?.trim()) throw new BadRequestException('Name the policy.');
    if (input.newVendorOnly && input.docType !== 'bill') throw new BadRequestException('"New vendors only" applies to bills.');
    const roles = (input.approverRoles ?? []).filter((r) => (Object.values(UserRole) as string[]).includes(r));
    const policy = await this.policyModel.create({ orgId, name: input.name.trim(), docType: input.docType, minAmountPaise: input.minAmountPaise ?? 0, newVendorOnly: !!input.newVendorOnly, approvalsRequired: input.approvalsRequired ?? 1, approverRoles: roles, active: true, createdBy: actorId });
    await this.audit.record({ orgId, entityType: 'ApprovalPolicy', entityId: policy._id.toString(), action: 'CREATE', performedBy: actorId, after: { name: policy.name, docType: policy.docType, minAmountPaise: policy.minAmountPaise, approvalsRequired: policy.approvalsRequired } });
    return policy;
  }

  async setPolicyActive(orgId: string, actorId: string, id: string, active: boolean) {
    const policy = Types.ObjectId.isValid(id) ? await this.policyModel.findOne({ _id: id, orgId }).exec() : null;
    if (!policy) throw new NotFoundException('Policy not found');
    policy.active = active;
    await policy.save();
    await this.audit.record({ orgId, entityType: 'ApprovalPolicy', entityId: id, action: active ? 'ENABLE' : 'DISABLE', performedBy: actorId, after: { active } });
    return policy;
  }

  // ── The gate ──────────────────────────────────────────────────────────────

  /**
   * Called just before a person's posting. Returns when it may go ahead;
   * throws ApprovalNeeded, having made or advanced the request, when not.
   */
  async gate(g: GateInput): Promise<void> {
    const policies = (await this.policyModel.find({ orgId: g.orgId, docType: g.docType, active: true, minAmountPaise: { $lte: g.amountPaise } }).lean().exec()).filter(
      (p) => !p.newVendorOnly || g.facts.firstFromVendor,
    );
    if (policies.length === 0) return;

    if (g.docId) {
      const done = await this.requestModel.findOne({ orgId: g.orgId, docType: g.docType, docId: g.docId, status: 'approved' }).exec();
      if (done) return; // approved earlier: posting it now is what approval was for
    }
    const risk = scoreRisk(g.facts);
    const required = (risk.level === 'high' ? 2 : Math.max(...policies.map((p) => p.approvalsRequired))) as 1 | 2;
    const roles = [...new Set(policies.flatMap((p) => p.approverRoles))];

    let request = g.docId ? await this.requestModel.findOne({ orgId: g.orgId, docType: g.docType, docId: g.docId, status: 'pending' }).exec() : null;
    if (!request) {
      request = await this.requestModel.create({
        orgId: g.orgId, docType: g.docType, docId: g.docId, payload: g.payload ?? null, summary: g.summary, amountPaise: g.amountPaise, makerId: g.makerId,
        required, approverRoles: roles, policyNames: policies.map((p) => p.name), risk, approvals: [], status: 'pending',
      });
      await this.audit.record({ orgId: g.orgId, entityType: 'ApprovalRequest', entityId: request._id.toString(), action: 'REQUEST', performedBy: g.actorId, after: { docType: g.docType, docId: g.docId, amountPaise: g.amountPaise, required, risk: risk.level } });
    }

    // The poster's own approval, when they may give it, counts: Approve & post.
    const mayApprove = this.mayApprove(request, g.actorId, g.actorRole);
    if (mayApprove === true && !request.approvals.some((a) => a.userId === g.actorId)) {
      request.approvals.push({ userId: g.actorId, role: g.actorRole, at: new Date(), note: null });
      if (request.approvals.length >= request.required) {
        request.status = 'approved';
        request.postedAt = new Date();
        await request.save();
        await this.audit.record({ orgId: g.orgId, entityType: 'ApprovalRequest', entityId: request._id.toString(), action: 'APPROVE', performedBy: g.actorId, after: { approvals: request.approvals.length, postedBy: g.actorId } });
        return;
      }
      await request.save();
      await this.audit.record({ orgId: g.orgId, entityType: 'ApprovalRequest', entityId: request._id.toString(), action: 'APPROVE', performedBy: g.actorId, after: { approvals: request.approvals.length } });
    }
    const left = request.required - request.approvals.length;
    const why = mayApprove === true ? '' : ` ${mayApprove}`;
    throw new ApprovalNeeded(`Sent for approval: ${left} more ${left === 1 ? 'approval is' : 'approvals are'} needed (${request.policyNames.join(', ')}${risk.level === 'high' ? '; high risk' : ''}).${why}`, request._id.toString());
  }

  /** Risk facts for a vendor's bill: first bill, bank change, usual amount, a likely duplicate. */
  async billFacts(orgId: string, bill: { _id: Types.ObjectId; vendorId: Types.ObjectId; billNumber: string | null; billDate: string; amountsPaise: { total: number } }): Promise<RiskFacts> {
    const others = await this.billModel
      .find({ orgId, vendorId: bill.vendorId, _id: { $ne: bill._id }, status: { $in: [BillStatus.POSTED, BillStatus.PAID] } }, { billNumber: 1, billDate: 1, amountsPaise: 1 })
      .sort({ billDate: -1 })
      .limit(50)
      .lean()
      .exec();
    const near = (d: string) => Math.abs(Date.parse(`${d}T00:00:00Z`) - Date.parse(`${bill.billDate}T00:00:00Z`)) <= 7 * 86_400_000;
    const sameNumber = bill.billNumber ? others.find((o) => o.billNumber?.trim().toLowerCase() === bill.billNumber!.trim().toLowerCase()) : undefined;
    const sameAmount = others.find((o) => o.amountsPaise.total === bill.amountsPaise.total && near(o.billDate));
    const change = await this.auditModel
      .findOne({ orgId, entityType: 'Vendor', entityId: String(bill.vendorId), action: 'UPDATE_BANK_ACCOUNT' })
      .sort({ createdAt: -1, _id: -1 })
      .lean()
      .exec();
    const changedAt = change ? new Date((change as { createdAt?: Date }).createdAt ?? Date.now()) : null;
    return {
      date: bill.billDate,
      amountPaise: bill.amountsPaise.total,
      firstFromVendor: others.length === 0,
      bankChangedDaysAgo: changedAt ? Math.floor((Date.now() - changedAt.getTime()) / 86_400_000) : null,
      usualPaise: others.length >= 3 ? Math.round(others.reduce((s, o) => s + o.amountsPaise.total, 0) / others.length) : null,
      possibleDuplicate: sameNumber ? `Bill ${sameNumber.billNumber} from this vendor is already in the books (${sameNumber.billDate}).` : sameAmount ? `The same amount from this vendor on ${sameAmount.billDate}.` : null,
    };
  }

  // ── Requests ──────────────────────────────────────────────────────────────

  async list(orgId: string, status?: 'pending' | 'approved' | 'rejected') {
    return this.requestModel.find({ orgId, ...(status ? { status } : {}) }).sort({ createdAt: -1 }).limit(200).lean().exec();
  }

  async approve(orgId: string, actorId: string, actorRole: string, id: string, note?: string | null) {
    const request = await this.request(orgId, id);
    if (request.status !== 'pending') throw new BadRequestException(`This request is ${request.status}.`);
    const may = this.mayApprove(request, actorId, actorRole);
    if (may !== true) throw new ForbiddenException(may);
    if (request.approvals.some((a) => a.userId === actorId)) throw new BadRequestException('You have approved this already; it needs someone else.');
    const claimed = await this.requestModel.findOneAndUpdate(
      { _id: request._id, orgId, status: 'pending', 'approvals.userId': { $ne: actorId }, $expr: { $eq: [{ $size: '$approvals' }, request.approvals.length] } },
      { $push: { approvals: { userId: actorId, role: actorRole, at: new Date(), note: note?.trim() || null } } },
      { new: true },
    ).exec();
    if (!claimed) throw new ConflictException('Someone approved it just now: reload.');
    await this.audit.record({ orgId, entityType: 'ApprovalRequest', entityId: id, action: 'APPROVE', performedBy: actorId, after: { approvals: claimed.approvals.length, note: note ?? null } });
    if (claimed.approvals.length < claimed.required) return { request: claimed, posted: false };

    claimed.status = 'approved';
    await claimed.save();
    // The last approval posts it, in the approver's name.
    const kind = String(claimed.payload?.kind ?? claimed.docType);
    const executor = this.executors.get(kind);
    if (!executor) return { request: claimed, posted: false };
    try {
      const result = await executor(orgId, actorId, claimed);
      claimed.set({ postedAt: new Date(), result, lastError: null });
      await claimed.save();
      return { request: claimed, posted: true };
    } catch (err) {
      claimed.lastError = err instanceof Error ? err.message : String(err);
      await claimed.save();
      this.logger.warn(`Approved request ${id} could not post: ${claimed.lastError}`);
      return { request: claimed, posted: false };
    }
  }

  async reject(orgId: string, actorId: string, actorRole: string, id: string, reason: string) {
    const request = await this.request(orgId, id);
    if (request.status !== 'pending') throw new BadRequestException(`This request is ${request.status}.`);
    const may = this.mayApprove(request, actorId, actorRole);
    if (may !== true) throw new ForbiddenException(may);
    if (!reason?.trim()) throw new BadRequestException('Say why, so the maker can fix it.');
    request.set({ status: 'rejected', rejectedBy: actorId, rejectionReason: reason.trim() });
    await request.save();
    await this.audit.record({ orgId, entityType: 'ApprovalRequest', entityId: id, action: 'REJECT', performedBy: actorId, after: { reason: reason.trim() } });
    return request;
  }

  /** True, or why not. */
  private mayApprove(request: ApprovalRequest, actorId: string, role: string): true | string {
    if (request.makerId && request.makerId === actorId) return 'You made it, so someone else must approve it.';
    const allowed = request.approverRoles.length ? request.approverRoles.includes(role) : hasPermission(role as UserRole, Permission.APPROVE_PROPOSAL);
    return allowed ? true : 'Your role cannot approve it.';
  }

  private async request(orgId: string, id: string) {
    const r = Types.ObjectId.isValid(id) ? await this.requestModel.findOne({ _id: id, orgId }).exec() : null;
    if (!r) throw new NotFoundException('Approval request not found');
    return r;
  }
}
