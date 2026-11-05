import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Connection, Model, Types } from 'mongoose';
import { AuditService } from '../gl/audit.service';
import { StorageService } from '../documents/storage.service';
import { User, UserDocument } from '../tenancy/schemas/user.schema';
import { ATTACHABLE, AttachableType, Attachment, AttachmentDocument } from './schemas/attachment.schema';

/** What may be attached: documents and images people actually keep. */
const ALLOWED = /\.(pdf|jpe?g|png|webp|heic|heif|tiff?|xlsx?|csv|docx?|txt|eml|msg|zip)$/i;
const MAX_BYTES = 15 * 1024 * 1024;

/** Each attachable record's collection, as its Mongoose model is registered. */
const MODEL: Record<AttachableType, string> = {
  SalesInvoice: 'SalesInvoice',
  PurchaseBill: 'PurchaseBill',
  Journal: 'Journal',
  PartyPayment: 'PartyPayment',
  Customer: 'Customer',
  Vendor: 'Vendor',
  ExpenseClaim: 'ExpenseClaim',
  DirectExpense: 'DirectExpense',
};

/**
 * Files kept against records. The record must be this org's; each file is
 * stored once by its hash, under the org's own prefix, and every attach and
 * remove is audited against the record it belongs to.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    @InjectModel(Attachment.name) private attachmentModel: Model<AttachmentDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectConnection() private connection: Connection,
    private storage: StorageService,
    private audit: AuditService,
  ) {}

  async add(orgId: string, actorId: string, input: { entityType: string; entityId: string; fileName: string; mimeType: string; buffer: Buffer }) {
    const entityType = this.type(input.entityType);
    await this.assertRecord(orgId, entityType, input.entityId);
    const fileName = input.fileName.replace(/[\\/\r\n]/g, '_').slice(0, 200) || 'file';
    if (!ALLOWED.test(fileName)) throw new BadRequestException('Attach a PDF, image, spreadsheet, Word document, text, email or zip file.');
    if (input.buffer.length === 0) throw new BadRequestException('The file is empty.');
    if (input.buffer.length > MAX_BYTES) throw new BadRequestException('Attachments can be at most 15 MB.');

    const sha256 = createHash('sha256').update(input.buffer).digest('hex');
    const ext = fileName.split('.').pop()!.toLowerCase();
    const storageKey = `orgs/${orgId}/attachments/${sha256}.${ext}`;
    if (!(await this.storage.exists(storageKey))) await this.storage.upload(storageKey, input.buffer, input.mimeType || 'application/octet-stream');

    const attachment = await this.attachmentModel.create({
      orgId,
      entityType,
      entityId: new Types.ObjectId(input.entityId),
      fileName,
      mimeType: input.mimeType || 'application/octet-stream',
      sizeBytes: input.buffer.length,
      sha256,
      storageKey,
      uploadedBy: actorId,
    });
    await this.audit.record({
      orgId, entityType, entityId: input.entityId, action: 'ATTACH', performedBy: actorId,
      after: { attachmentId: attachment._id.toString(), fileName, sizeBytes: input.buffer.length, sha256 },
    });
    return this.row(attachment);
  }

  async list(orgId: string, entityType: string, entityId: string) {
    const type = this.type(entityType);
    if (!Types.ObjectId.isValid(entityId)) throw new NotFoundException('Record not found');
    const rows = await this.attachmentModel.find({ orgId, entityType: type, entityId: new Types.ObjectId(entityId), removedAt: null }).sort({ createdAt: -1 }).exec();
    return rows.map((r) => this.row(r));
  }

  /** The latest files kept against any record, for the documents library: each with its record and who added it. */
  async listAll(orgId: string) {
    const rows = await this.attachmentModel.find({ orgId, removedAt: null }).sort({ createdAt: -1 }).limit(300).exec();
    const ids = [...new Set(rows.map((r) => r.uploadedBy))].filter((id) => Types.ObjectId.isValid(id) && id.length === 24);
    const users = ids.length ? await this.userModel.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }, { name: 1, email: 1 }).lean().exec() : [];
    const name = new Map(users.map((u) => [u._id.toString(), u.name || u.email]));
    return rows.map((r) => ({ ...this.row(r), entityType: r.entityType, entityId: String(r.entityId), uploadedByName: name.get(r.uploadedBy) ?? 'Someone' }));
  }

  /** A short-lived link to open the file. */
  async url(orgId: string, id: string) {
    const attachment = await this.find(orgId, id);
    return { url: await this.storage.presignedUrl(attachment.storageKey, 600), fileName: attachment.fileName };
  }

  async remove(orgId: string, actorId: string, id: string) {
    const attachment = await this.find(orgId, id);
    await this.attachmentModel.updateOne({ _id: attachment._id, orgId }, { $set: { removedAt: new Date(), removedBy: actorId } }).exec();
    await this.audit.record({
      orgId, entityType: attachment.entityType, entityId: String(attachment.entityId), action: 'DETACH', performedBy: actorId,
      before: { attachmentId: id, fileName: attachment.fileName },
    });
    return { removed: true };
  }

  private type(entityType: string): AttachableType {
    if (!(ATTACHABLE as readonly string[]).includes(entityType)) throw new BadRequestException(`Files can be attached to ${ATTACHABLE.join(', ')}.`);
    return entityType as AttachableType;
  }

  private async assertRecord(orgId: string, entityType: AttachableType, entityId: string) {
    if (!Types.ObjectId.isValid(entityId)) throw new NotFoundException('Record not found');
    const exists = await this.connection.model(MODEL[entityType]).exists({ _id: new Types.ObjectId(entityId), orgId }).exec();
    if (!exists) throw new NotFoundException('Record not found');
  }

  private async find(orgId: string, id: string): Promise<AttachmentDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Attachment not found');
    const attachment = await this.attachmentModel.findOne({ _id: id, orgId, removedAt: null }).exec();
    if (!attachment) throw new NotFoundException('Attachment not found');
    return attachment;
  }

  private row(a: AttachmentDocument) {
    return {
      id: a._id.toString(),
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      uploadedBy: a.uploadedBy,
      createdAt: (a as unknown as { createdAt: Date }).createdAt,
    };
  }
}
