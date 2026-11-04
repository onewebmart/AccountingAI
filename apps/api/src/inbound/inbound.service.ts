import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import { DocumentStatus } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { withOrg } from '../database/tenant.plugin';
import { DocumentsService } from '../documents/documents.service';
import { MAX_SIZE_BYTES, isAcceptedFile, rejectionMessage } from '../documents/accepted-files';
import { OrgSettings, OrgSettingsDocument } from '../org-settings/schemas/org-settings.schema';
import { Vendor, VendorDocument } from '../purchase/schemas/vendor.schema';
import { OrgMembership, OrgMembershipDocument } from '../tenancy/schemas/org-membership.schema';
import { User, UserDocument } from '../tenancy/schemas/user.schema';
import { InboundMessage, InboundMessageDocument } from './schemas/inbound-message.schema';
import { InboundEmail, looksLikeSignatureImage } from './email-payload';
import { LINK_CODE_LENGTH, filesInWebhook, linkRequestsInWebhook, normalisePhone } from './whatsapp';
import { WHATSAPP_MEDIA, WhatsAppMediaFetcher } from './whatsapp-media';

export interface InboundFile {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  /** Embedded in the body rather than attached (email only). */
  contentId?: string | null;
}

const LINK_CODE_TTL_MS = 15 * 60_000;
const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no l, o, 0, 1: read aloud without mistakes
const newToken = () =>
  Array.from(randomBytes(10))
    .map((b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length])
    .join('');

/**
 * Bills and receipts sent in rather than uploaded: by email to the org's own
 * address, or by WhatsApp from a linked number. Each file the pipeline can
 * read becomes an ordinary upload, so it is read, proposed and waits for a
 * person in the review queue like any other; nothing sent in posts anything.
 */
@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    @InjectModel(InboundMessage.name) private messageModel: Model<InboundMessageDocument>,
    @InjectModel(OrgSettings.name) private settingsModel: Model<OrgSettingsDocument>,
    @InjectModel(Vendor.name) private vendorModel: Model<VendorDocument>,
    @InjectModel(OrgMembership.name) private membershipModel: Model<OrgMembershipDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private documents: DocumentsService,
    @Inject(WHATSAPP_MEDIA) private media: WhatsAppMediaFetcher,
    private audit: AuditService,
    private config: ConfigService,
  ) {}

  private get domain(): string {
    return (this.config.get<string>('inbound.emailDomain') ?? '').toLowerCase();
  }

  /** The org's address for bills, made on first ask. Null domain: email-in is not set up on this server. */
  async emailAddress(orgId: string) {
    let settings = await this.settingsModel.findOne({ orgId }).exec();
    if (!settings?.inboxToken) {
      try {
        await this.settingsModel.findOneAndUpdate({ orgId, inboxToken: null }, { $set: { inboxToken: newToken() } }, { upsert: true }).exec();
      } catch (err) {
        // Another request made it first.
        if ((err as { code?: number }).code !== 11000) throw err;
      }
      settings = await this.settingsModel.findOne({ orgId }).exec();
    }
    return { address: this.domain ? `bills-${settings!.inboxToken}@${this.domain}` : null, token: settings!.inboxToken!, configured: !!this.domain };
  }

  /** A new address; the old one stops working at once. For when it has leaked to spam. */
  async rotate(orgId: string, actorId: string) {
    const before = await this.settingsModel.findOne({ orgId }).lean().exec();
    await this.settingsModel.updateOne({ orgId }, { $set: { inboxToken: newToken() } }, { upsert: true }).exec();
    await this.audit.record({ orgId, entityType: 'OrgSettings', entityId: orgId, action: 'ROTATE_INBOX_ADDRESS', performedBy: actorId, before: { inboxToken: before?.inboxToken ?? null } });
    return this.emailAddress(orgId);
  }

  /** An email delivered to us. Addresses no org holds are ignored without saying why. */
  async receiveEmail(email: InboundEmail): Promise<{ accepted: number; handled: boolean }> {
    if (!this.domain) return { accepted: 0, handled: false };
    const pattern = new RegExp(`^bills-([a-z0-9]{10})@${this.domain.replace(/[.]/g, '\\.')}$`);
    const token = email.recipients.map((r) => pattern.exec(r)?.[1]).find(Boolean);
    if (!token) return { accepted: 0, handled: false };
    const settings = await this.settingsModel.findOne({ inboxToken: token }, { orgId: 1 }).lean().exec();
    if (!settings) return { accepted: 0, handled: false };

    const messageId =
      email.messageId ??
      createHash('sha256')
        .update(`${email.from}|${email.subject}|${email.attachments.map((a) => createHash('sha256').update(a.buffer).digest('hex')).join(',')}`)
        .digest('hex');
    const message = await this.ingest(settings.orgId, {
      channel: 'email',
      from: email.from,
      fromName: email.fromName,
      subject: email.subject,
      messageId,
      files: email.attachments,
    });
    return { accepted: message.files.filter((f) => f.status === 'accepted').length, handled: true };
  }

  /**
   * Record a message and hand each readable file to the pipeline. A message
   * the provider delivers twice is handled once.
   */
  async ingest(
    orgId: string,
    msg: { channel: 'email' | 'whatsapp'; from: string | null; fromName?: string | null; subject: string | null; messageId: string; files: InboundFile[]; knownSender?: boolean },
  ): Promise<InboundMessageDocument> {
    return withOrg(orgId, async () => {
      const seen = await this.messageModel.findOne({ orgId, channel: msg.channel, messageId: msg.messageId }).exec();
      if (seen) return seen;
      const knownSender = msg.knownSender ?? (await this.isKnownSender(orgId, msg.from));
      let message: InboundMessageDocument;
      try {
        message = await this.messageModel.create({ orgId, channel: msg.channel, from: msg.from, fromName: msg.fromName ?? null, subject: msg.subject, messageId: msg.messageId, knownSender, files: [] });
      } catch (err) {
        if ((err as { code?: number }).code === 11000) return (await this.messageModel.findOne({ orgId, channel: msg.channel, messageId: msg.messageId }).exec())!;
        throw err;
      }

      const files: InboundMessage['files'] = [];
      for (const f of msg.files) {
        if (msg.channel === 'email' && looksLikeSignatureImage({ ...f, contentId: f.contentId ?? null })) {
          files.push({ fileName: f.fileName, status: 'skipped', reason: 'A small image in the email body, like a logo, not a bill.', documentId: null });
          continue;
        }
        if (!isAcceptedFile(f.mimeType, f.fileName)) {
          files.push({ fileName: f.fileName, status: 'rejected', reason: rejectionMessage(f.fileName, f.mimeType), documentId: null });
          continue;
        }
        if (f.buffer.length > MAX_SIZE_BYTES) {
          files.push({ fileName: f.fileName, status: 'rejected', reason: 'Larger than 20 MB.', documentId: null });
          continue;
        }
        try {
          const doc = await this.documents.upload({
            orgId,
            uploadedBy: `system:${msg.channel}-in`,
            originalName: f.fileName,
            mimeType: f.mimeType,
            buffer: f.buffer,
            source: { channel: msg.channel, from: msg.from, subject: msg.subject, messageId: msg.messageId },
          });
          files.push({
            fileName: f.fileName,
            status: doc.status === DocumentStatus.DUPLICATE ? 'duplicate' : 'accepted',
            reason: doc.status === DocumentStatus.DUPLICATE ? 'Already uploaded once; it waits in the Inbox for you to decide.' : null,
            documentId: doc._id as unknown as Types.ObjectId,
          });
        } catch (err) {
          this.logger.warn(`Inbound ${msg.channel} ${msg.messageId}: ${f.fileName} failed: ${err instanceof Error ? err.message : String(err)}`);
          files.push({ fileName: f.fileName, status: 'rejected', reason: 'Could not be stored. Ask the sender to send it again.', documentId: null });
        }
      }
      if (files.length === 0) files.push({ fileName: '(no attachment)', status: 'skipped', reason: 'Nothing was attached.', documentId: null });
      message.files = files;
      await message.save();
      await this.audit.record({
        orgId, entityType: 'InboundMessage', entityId: message._id.toString(), action: 'RECEIVE', performedBy: `system:${msg.channel}-in`,
        after: { from: msg.from, knownSender, accepted: files.filter((x) => x.status === 'accepted').length, files: files.length },
      });
      return message;
    });
  }

  /** WhatsApp: the numbers whose files are filed to this org. */
  async whatsappSenders(orgId: string) {
    const settings = await this.settingsModel.findOne({ orgId }, { whatsappSenders: 1 }).lean().exec();
    return { senders: settings?.whatsappSenders ?? [], configured: this.whatsappConfigured };
  }

  /**
   * A number is linked from the phone itself, never typed in: typing would let
   * one business claim another's number. This issues a short code; sending
   * "LINK <code>" from the phone to the business WhatsApp links that number.
   */
  async whatsappLinkCode(orgId: string, actorId: string) {
    const code = newToken().slice(0, LINK_CODE_LENGTH);
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    await this.settingsModel.updateOne({ orgId }, { $set: { whatsappLinkCode: code, whatsappLinkCodeExpiresAt: expiresAt } }, { upsert: true }).exec();
    await this.audit.record({ orgId, entityType: 'OrgSettings', entityId: orgId, action: 'ISSUE_WHATSAPP_LINK_CODE', performedBy: actorId, after: { expiresAt } });
    return { text: `LINK ${code.toUpperCase()}`, expiresAt, businessNumber: this.config.get<string>('inbound.whatsappBusinessNumber') || null };
  }

  /**
   * "LINK <code>" arrived from a phone. One number files to one business:
   * linking it here takes it from wherever it was before. The code is single-use.
   */
  private async linkByCode(from: string, code: string): Promise<boolean> {
    const matches = await this.settingsModel
      .find({ whatsappLinkCode: code, whatsappLinkCodeExpiresAt: { $gt: new Date() } }, { orgId: 1 })
      .limit(2)
      .lean()
      .exec();
    if (matches.length !== 1) return false;
    const orgId = matches[0].orgId;
    const claimed = await this.settingsModel
      .updateOne({ orgId, whatsappLinkCode: code }, { $addToSet: { whatsappSenders: from }, $set: { whatsappLinkCode: null, whatsappLinkCodeExpiresAt: null } })
      .exec();
    if (claimed.modifiedCount === 0) return false;
    const previous = await this.settingsModel.find({ orgId: { $ne: orgId }, whatsappSenders: from }, { orgId: 1 }).lean().exec();
    if (previous.length) await this.settingsModel.updateMany({ orgId: { $in: previous.map((p) => p.orgId) } }, { $pull: { whatsappSenders: from } }).exec();
    for (const p of previous) {
      await this.audit.record({ orgId: p.orgId, entityType: 'OrgSettings', entityId: p.orgId, action: 'UNLINK_WHATSAPP_SENDER', performedBy: 'system:whatsapp-in', before: { number: from }, after: { reason: 'Linked to another business from the phone' } });
    }
    await this.audit.record({ orgId, entityType: 'OrgSettings', entityId: orgId, action: 'LINK_WHATSAPP_SENDER', performedBy: 'system:whatsapp-in', after: { number: from } });
    return true;
  }

  async unlinkWhatsappSender(orgId: string, actorId: string, phone: string) {
    const number = normalisePhone(phone) ?? phone.replace(/\D/g, '');
    await this.settingsModel.updateOne({ orgId }, { $pull: { whatsappSenders: number } }).exec();
    await this.audit.record({ orgId, entityType: 'OrgSettings', entityId: orgId, action: 'UNLINK_WHATSAPP_SENDER', performedBy: actorId, before: { number } });
    return this.whatsappSenders(orgId);
  }

  get whatsappConfigured(): boolean {
    return !!this.config.get<string>('inbound.whatsappAppSecret') && this.media.configured;
  }

  /**
   * A WhatsApp webhook, already verified. Each document or photo is filed to
   * the one org that linked the sender's number. A number no org linked is
   * not filed: there is no telling whose it is.
   */
  async receiveWhatsapp(body: unknown): Promise<{ linked: number; filed: number; skipped: number }> {
    let linked = 0;
    let filed = 0;
    let skipped = 0;
    // Links first, so a phone that links and sends a bill in one go is filed.
    for (const r of linkRequestsInWebhook(body)) if (await this.linkByCode(r.from, r.code)) linked++;
    for (const m of filesInWebhook(body)) {
      const orgs = await this.settingsModel.find({ whatsappSenders: m.from }, { orgId: 1 }).limit(2).lean().exec();
      if (orgs.length !== 1) {
        this.logger.warn(`WhatsApp ${m.messageId} from ${m.from.slice(0, -4)}XXXX: ${orgs.length ? 'linked to several businesses' : 'not linked'}, not filed`);
        skipped++;
        continue;
      }
      // Meta redelivers until it hears 200: a message already filed is not fetched again.
      if (await this.messageModel.exists({ orgId: orgs[0].orgId, channel: 'whatsapp', messageId: m.messageId }).exec()) continue;
      let file: InboundFile;
      try {
        const media = await this.media.fetch(m.mediaId);
        file = { fileName: m.fileName, mimeType: (m.mimeType || media.mimeType).toLowerCase(), buffer: media.buffer };
      } catch (err) {
        this.logger.warn(`WhatsApp ${m.messageId}: media not fetched: ${err instanceof Error ? err.message : String(err)}`);
        skipped++;
        continue;
      }
      await this.ingest(orgs[0].orgId, { channel: 'whatsapp', from: m.from, fromName: m.fromName, subject: m.caption, messageId: m.messageId, files: [file], knownSender: true });
      filed++;
    }
    return { linked, filed, skipped };
  }

  async list(orgId: string) {
    return this.messageModel.find({ orgId }).sort({ createdAt: -1 }).limit(50).lean().exec();
  }

  /** A team member's address, or a vendor's on file. */
  private async isKnownSender(orgId: string, from: string | null): Promise<boolean> {
    if (!from) return false;
    const email = from.toLowerCase();
    if (await this.vendorModel.exists({ orgId, email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).exec()) return true;
    const members = await this.membershipModel.find({ orgId, isActive: { $ne: false } }, { userId: 1 }).lean().exec();
    if (members.length === 0) return false;
    return !!(await this.userModel.exists({ _id: { $in: members.map((m) => m.userId) }, email }).exec());
  }

  /** Throws when inbound is not configured: the webhook says so rather than accepting mail it cannot place. */
  assertEmailConfigured() {
    if (!this.domain || !this.config.get<string>('inbound.emailSecret')) {
      throw new BadRequestException('Email-in is not set up on this server (INBOUND_EMAIL_DOMAIN, INBOUND_EMAIL_SECRET).');
    }
  }
}
