import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChecklistItemStatus,
  DocumentRequestStatus,
  DocumentType,
  FirmService,
  MessageChannel,
  MessageTemplateKey,
} from '@ai-accounting/shared';
import {
  DocumentRequest,
  DocumentRequestDocument,
} from '../schemas/document-request.schema';
import { Organization, OrganizationDocument } from '../../tenancy/schemas/organization.schema';
import { Firm, FirmDocument } from '../../tenancy/schemas/firm.schema';
import { AuditLog, AuditLogDocument } from '../../gl/schemas/audit-log.schema';
import { MessagingService } from '../messaging/messaging.service';
import { withFirm } from '../../database/tenant.plugin';
import {
  CHECKLIST_TEMPLATES,
  matchDocumentToItem,
  templateForService,
} from './checklist-templates';

export interface CreateRequestInput {
  firmId: string;
  clientOrgId: string;
  service: FirmService;
  dueDate: string;
  /** Overrides the template's default wording. */
  purpose?: string;
  complianceItemId?: string;
}

export interface RequestProgress {
  total: number;
  received: number;
  verified: number;
  /** Percentage of items that are at least RECEIVED. */
  percent: number;
  missingLabels: string[];
}

export interface RemindResult {
  remindersQueued: number;
  skippedComplete: number;
  skippedNoContact: number;
}

function formatDateForClient(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Progress over a request's checklist. RECEIVED counts as collected. */
export function progressOf(request: DocumentRequestDocument): RequestProgress {
  const total = request.items.length;
  const received = request.items.filter(
    (i) => i.status === ChecklistItemStatus.RECEIVED || i.status === ChecklistItemStatus.VERIFIED,
  ).length;
  const verified = request.items.filter((i) => i.status === ChecklistItemStatus.VERIFIED).length;

  return {
    total,
    received,
    verified,
    percent: total === 0 ? 0 : Math.round((received / total) * 100),
    missingLabels: request.items
      .filter((i) => i.status === ChecklistItemStatus.PENDING)
      .map((i) => i.label),
  };
}

@Injectable()
export class DocumentRequestService {
  private readonly logger = new Logger(DocumentRequestService.name);

  constructor(
    @InjectModel(DocumentRequest.name) private requestModel: Model<DocumentRequestDocument>,
    @InjectModel(Organization.name) private orgModel: Model<OrganizationDocument>,
    @InjectModel(Firm.name) private firmModel: Model<FirmDocument>,
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
    private messaging: MessagingService,
  ) {}

  /** Builds a request from the checklist template for a service. */
  async create(input: CreateRequestInput): Promise<DocumentRequestDocument> {
    const template = templateForService(input.service);
    if (!template) {
      throw new BadRequestException(`No document checklist defined for ${input.service}`);
    }

    const client = await this.orgModel.findById(input.clientOrgId).exec();
    if (!client) throw new NotFoundException('Client not found');

    // Organization is the tenant root, so it carries no firm scope of its own —
    // findById would happily return another firm's client. Check the link
    // explicitly, or a firm admin could open a request against someone else's
    // client and then chase them for documents.
    if (client.firmId?.toString() !== input.firmId) {
      throw new NotFoundException('Client not found');
    }

    return this.requestModel.create({
      firmId: new Types.ObjectId(input.firmId),
      clientOrgId: client._id,
      clientName: client.name,
      purpose: input.purpose ?? template.purpose,
      dueDate: input.dueDate,
      complianceItemId: input.complianceItemId
        ? new Types.ObjectId(input.complianceItemId)
        : undefined,
      items: template.items.map((i) => ({
        key: i.key,
        label: i.label,
        status: ChecklistItemStatus.PENDING,
        autoMatched: false,
      })),
      status: DocumentRequestStatus.OPEN,
    });
  }

  async list(filter: { status?: DocumentRequestStatus } = {}): Promise<DocumentRequestDocument[]> {
    const query: Record<string, unknown> = {};
    if (filter.status) query.status = filter.status;
    return this.requestModel.find(query).sort({ dueDate: 1 }).exec();
  }

  async findById(id: string): Promise<DocumentRequestDocument> {
    const request = await this.requestModel.findById(id).exec();
    if (!request) throw new NotFoundException('Document request not found');
    return request;
  }

  /**
   * Attach an upload to a checklist item.
   *
   * `autoMatched` distinguishes a machine guess from a person's choice: an
   * automatic match lands on RECEIVED and waits for a human, which is the
   * Invariant 4 shape applied to document collection.
   */
  async attachDocument(
    requestId: string,
    itemKey: string,
    documentId: string,
    documentName: string,
    opts: { autoMatched: boolean; actorId: string },
  ): Promise<DocumentRequestDocument> {
    const request = await this.findById(requestId);
    const item = request.items.find((i) => i.key === itemKey);
    if (!item) throw new NotFoundException(`Checklist item "${itemKey}" not found`);

    item.status = ChecklistItemStatus.RECEIVED;
    item.documentId = new Types.ObjectId(documentId);
    item.documentName = documentName;
    item.autoMatched = opts.autoMatched;
    item.receivedAt = new Date();

    this.refreshStatus(request);
    await request.save();

    await this.auditLogModel.create({
      orgId: request.clientOrgId.toString(),
      entityType: 'DocumentRequest',
      entityId: requestId,
      action: 'document_received',
      performedBy: opts.actorId,
      meta: {
        firmId: request.firmId.toString(),
        itemKey,
        documentId,
        autoMatched: opts.autoMatched,
      },
    });

    return request;
  }

  /** Human confirmation that a received document is the right one. */
  async verifyItem(
    requestId: string,
    itemKey: string,
    actorId: string,
  ): Promise<DocumentRequestDocument> {
    const request = await this.findById(requestId);
    const item = request.items.find((i) => i.key === itemKey);
    if (!item) throw new NotFoundException(`Checklist item "${itemKey}" not found`);

    if (item.status === ChecklistItemStatus.PENDING) {
      throw new BadRequestException(
        `"${item.label}" has not been received yet — attach a document before verifying it.`,
      );
    }

    item.status = ChecklistItemStatus.VERIFIED;
    item.verifiedAt = new Date();
    item.verifiedBy = actorId;

    this.refreshStatus(request);
    await request.save();

    await this.auditLogModel.create({
      orgId: request.clientOrgId.toString(),
      entityType: 'DocumentRequest',
      entityId: requestId,
      action: 'document_verified',
      performedBy: actorId,
      meta: { firmId: request.firmId.toString(), itemKey },
    });

    return request;
  }

  /**
   * Called when a client's upload finishes processing: looks for an open
   * request on that org with a matching outstanding item.
   *
   * Best-effort by design — no match is a normal outcome, not an error, and it
   * must never disturb the accounting pipeline that called it.
   */
  async tryAutoMatch(
    orgId: string,
    documentId: string,
    fileName: string,
    documentType?: DocumentType | null,
  ): Promise<{ matched: boolean; requestId?: string; itemKey?: string }> {
    // The upload arrives in the client org's context, which has no firm scope,
    // so read the request outside firm scoping and re-enter it to write.
    const requests = await this.requestModel
      .find({ clientOrgId: new Types.ObjectId(orgId), status: DocumentRequestStatus.OPEN })
      .sort({ dueDate: 1 })
      .exec();

    for (const request of requests) {
      const outstanding = request.items.filter((i) => i.status === ChecklistItemStatus.PENDING);
      if (outstanding.length === 0) continue;

      // Only consider template items that are still outstanding on this request.
      const template = CHECKLIST_TEMPLATES.flatMap((t) => t.items).filter((t) =>
        outstanding.some((o) => o.key === t.key),
      );

      const key = matchDocumentToItem(template, fileName, documentType);
      if (!key) continue;

      const firmId = request.firmId.toString();
      await withFirm(firmId, () =>
        this.attachDocument(request._id.toString(), key, documentId, fileName, {
          autoMatched: true,
          actorId: 'system:auto-match',
        }),
      );

      this.logger.log(
        `Document ${documentId} (${fileName}) auto-matched to "${key}" on request ${request._id.toString()}`,
      );
      return { matched: true, requestId: request._id.toString(), itemKey: key };
    }

    return { matched: false };
  }

  /**
   * Chase outstanding documents. A request with nothing missing is skipped
   * rather than sending a client a reminder listing no documents.
   */
  async sendReminders(
    firmId: string,
    requestIds?: string[],
  ): Promise<RemindResult> {
    const firm = await this.firmModel.findById(firmId).exec();
    const firmName = firm?.name ?? 'your CA firm';

    const query: Record<string, unknown> = { status: DocumentRequestStatus.OPEN };
    if (requestIds?.length) {
      query._id = { $in: requestIds.map((id) => new Types.ObjectId(id)) };
    }

    const requests = await this.requestModel.find(query).exec();

    let remindersQueued = 0;
    let skippedComplete = 0;
    let skippedNoContact = 0;

    for (const request of requests) {
      const progress = progressOf(request);
      if (progress.missingLabels.length === 0) {
        skippedComplete++;
        continue;
      }

      const client = await this.orgModel.findById(request.clientOrgId).exec();
      const whatsapp = client?.whatsappNumber;
      const email = client?.contactEmail;
      const channel = whatsapp ? MessageChannel.WHATSAPP : MessageChannel.EMAIL;
      const address = whatsapp ?? email;

      if (!address) {
        skippedNoContact++;
        this.logger.warn(
          `Client ${request.clientName} has no WhatsApp number or email — cannot chase documents`,
        );
        continue;
      }

      const message = await this.messaging.enqueue({
        firmId,
        channel,
        templateKey: MessageTemplateKey.DOCUMENT_REMINDER,
        recipientAddress: address,
        recipientName: client?.contactName ?? request.clientName,
        clientOrgId: request.clientOrgId.toString(),
        cause: { type: 'documentRequest', id: request._id.toString() },
        variables: {
          clientName: client?.contactName ?? request.clientName,
          purpose: request.purpose,
          documentList: progress.missingLabels.map((l) => `• ${l}`).join('\n'),
          dueDate: formatDateForClient(request.dueDate),
          firmName,
        },
      });

      request.remindersSent.push({
        messageId: message._id,
        sentAt: new Date(),
        missingKeys: request.items
          .filter((i) => i.status === ChecklistItemStatus.PENDING)
          .map((i) => i.key),
      });
      await request.save();

      remindersQueued++;
    }

    return { remindersQueued, skippedComplete, skippedNoContact };
  }

  /** A request is complete once every item is at least received. */
  private refreshStatus(request: DocumentRequestDocument): void {
    const allIn = request.items.every((i) => i.status !== ChecklistItemStatus.PENDING);
    request.status = allIn ? DocumentRequestStatus.COMPLETE : DocumentRequestStatus.OPEN;
  }
}
