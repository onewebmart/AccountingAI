import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { DocumentStatus, MatchStatus, StatementStatus, VoucherType } from '@ai-accounting/shared';
import { AuditService } from '../gl/audit.service';
import { Document as UploadedDocument, DocumentDocument } from './schemas/document.schema';
import { DocumentFolder, DocumentFolderDocument } from './schemas/document-folder.schema';
import { Attachment, AttachmentDocument } from '../attachments/schemas/attachment.schema';
import { ProposedEntry, ProposedEntryDocument } from '../proposals/schemas/proposed-entry.schema';
import { User, UserDocument } from '../tenancy/schemas/user.schema';
import { BankStatement, BankStatementDocument } from '../banking/schemas/bank-statement.schema';
import { BankAccount, BankAccountDocument } from '../banking/schemas/bank-account.schema';
import { BankStatementLine, BankStatementLineDocument } from '../banking/schemas/bank-statement-line.schema';

// ── What the Documents area shows ─────────────────────────────────────────

/** PDF, a photo, a spreadsheet, Word or text: the "Filter by file type" choices. */
export type FileKind = 'pdf' | 'image' | 'spreadsheet' | 'document' | 'other';

/** Where a file is in its life, in the words the page shows. */
export type LibraryStage = 'reading' | 'ready' | 'posted' | 'entered' | 'imported' | 'reconciled' | 'rejected' | 'duplicate' | 'failed' | 'attached';

/** What a file became, or where it waits: the "Associated to" column. */
export interface AssociatedTo {
  /** record: a bill, invoice, expense, voucher or party; statement: a statement in Banking; review: waiting in Review; duplicate: the same file as another; rejected: turned down in Review. */
  kind: 'record' | 'statement' | 'review' | 'duplicate' | 'rejected';
  /** "Bill SGP/1342", "Journal JNL/2026-27/0004", "Bank statement · HDFC Bank ··1234 · 42 lines". */
  label: string;
  entityType: string | null;
  entityId: string | null;
  /** A statement's bank account, for the link to its reconciliation. */
  bankAccountId?: string | null;
}

/** Who brought a file in: a person by name, or the email address or WhatsApp number it was sent from. */
export interface Uploader {
  channel: 'upload' | 'email' | 'whatsapp';
  name: string | null;
  from: string | null;
}

export interface LibraryRow {
  /** 'd:<id>' for an upload, 'a:<id>' for a file attached to a record. */
  key: string;
  id: string;
  kind: 'upload' | 'attachment';
  fileName: string;
  mimeType: string;
  fileKind: FileKind;
  sizeBytes: number;
  stage: LibraryStage;
  /** The pipeline's own status for an upload; 'ATTACHED' for an attachment. */
  status: string;
  documentType: string | null;
  vendor: string | null;
  invoiceNumber: string | null;
  /** Integer paise, as read. */
  totalAmountPaise: number | null;
  proposalId: string | null;
  failureReason: string | null;
  enteredAs: { entityType: string; entityId: string; label: string } | null;
  uploadedAt: Date;
  uploadedBy: Uploader;
  associatedTo: AssociatedTo | null;
  folder: { id: string; name: string } | null;
}

export interface FolderRow {
  id: string;
  name: string;
  /** Uploads and attached files filed in it. */
  count: number;
  createdAt: Date;
}

export interface StatementRow {
  key: string;
  documentId: string;
  fileName: string;
  uploadedAt: Date;
  uploadedBy: Uploader;
  stage: 'reading' | 'imported' | 'reconciled' | 'failed';
  failureReason: string | null;
  /** What the import noticed: a layout read by AI and checked against the balances, rows skipped. */
  warnings: string[];
  statementId: string | null;
  bankAccount: { id: string; name: string; bankName: string | null; last4: string | null } | null;
  periodStart: string | null;
  periodEnd: string | null;
  linesImported: number;
  /** Matched to an entry, by the matcher or a person, and not yet confirmed. */
  matched: number;
  /** Confirmed: the line is in the books. */
  confirmed: number;
  unmatched: number;
  /** Set aside by a person (a duplicate line). */
  excluded: number;
}

/** GET /documents/pipeline: the document pipeline at a glance, for the dashboard. */
export interface DocumentPipeline {
  /** Every upload the books have. */
  total: number;
  /** Being read now. */
  reading: number;
  /** Read, waiting in Review. */
  readyForReview: number;
  /** The AI could not read them and nobody has entered them yet; the commonest reasons first. */
  couldNotRead: { count: number; reasons: Array<{ reason: string; count: number }> };
  /** The same file as one uploaded before, waiting for a person to decide. */
  duplicates: number;
  /** What the Inbox holds for a person: reading, couldn't read, duplicates. */
  waiting: number;
  /** Became a record: approved in Review and posted, or entered by hand with Add to. India time. */
  entered: { today: number; thisWeek: number };
}

// ── Helpers ────────────────────────────────────────────────────────────────

const READING = [DocumentStatus.UPLOADED, DocumentStatus.CLASSIFYING, DocumentStatus.EXTRACTING];
const MAX_MOVE = 200;
const IST_MS = 330 * 60_000;

/** The start of today and of this week (Monday) in India, as instants. */
export function indiaDayAndWeekStart(now = new Date()): { today: Date; week: Date } {
  const ist = new Date(now.getTime() + IST_MS);
  const dayStart = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_MS;
  const sinceMonday = (ist.getUTCDay() + 6) % 7;
  return { today: new Date(dayStart), week: new Date(dayStart - sinceMonday * 86_400_000) };
}

export function fileKindOf(mimeType: string, fileName: string): FileKind {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mimeType.startsWith('image/') || /^(jpe?g|png|webp|tiff?|heic|heif)$/.test(ext)) return 'image';
  if (/spreadsheet|ms-excel|csv/.test(mimeType) || /^(xlsx?|csv)$/.test(ext)) return 'spreadsheet';
  if (/wordprocessing|msword|^text\/|rtf/.test(mimeType) || /^(docx?|txt|md|rtf)$/.test(ext)) return 'document';
  return 'other';
}

/** Tally-style voucher numbers, as journals.service formats them: PUR/2026-27/0003. */
const VOUCHER_PREFIX: Record<string, string> = {
  [VoucherType.PURCHASE]: 'PUR',
  [VoucherType.SALES]: 'SAL',
  [VoucherType.RECEIPT]: 'RCT',
  [VoucherType.PAYMENT]: 'PMT',
  [VoucherType.CONTRA]: 'CTR',
  [VoucherType.JOURNAL]: 'JNL',
  [VoucherType.CREDIT_NOTE]: 'CRN',
  [VoucherType.DEBIT_NOTE]: 'DBN',
};
function voucherNumber(j: { voucherType?: string; financialYear?: string; voucherNumber?: number }): string | null {
  if (!j.financialYear || typeof j.voucherNumber !== 'number') return null;
  return `${VOUCHER_PREFIX[j.voucherType ?? ''] ?? 'JNL'}/${j.financialYear}/${String(j.voucherNumber).padStart(4, '0')}`;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** How each kind of record a file can be kept against reads in "Associated to". */
const RECORDS: Record<string, { noun: string; select: string; number: (r: Record<string, unknown>) => string | null }> = {
  SalesInvoice: { noun: 'Invoice', select: 'invoiceNumber', number: (r) => text(r.invoiceNumber) },
  PurchaseBill: { noun: 'Bill', select: 'billNumber', number: (r) => text(r.billNumber) },
  Journal: { noun: 'Journal', select: 'voucherType financialYear voucherNumber', number: (r) => voucherNumber(r as { voucherType?: string; financialYear?: string; voucherNumber?: number }) },
  PartyPayment: { noun: 'Payment', select: 'number', number: (r) => text(r.number) },
  Customer: { noun: 'Customer', select: 'name', number: (r) => text(r.name) },
  Vendor: { noun: 'Vendor', select: 'name', number: (r) => text(r.name) },
  ExpenseClaim: { noun: 'Expense claim', select: 'number', number: (r) => text(r.number) },
  DirectExpense: { noun: 'Expense', select: 'number', number: (r) => text(r.number) },
  PurchaseOrder: { noun: 'Purchase order', select: 'number', number: (r) => text(r.number) },
  Quote: { noun: 'Quote', select: 'number', number: (r) => text(r.number) },
  SalesOrder: { noun: 'Sales order', select: 'number', number: (r) => text(r.number) },
  DebitNote: { noun: 'Vendor credit', select: 'noteNumber', number: (r) => text(r.noteNumber) },
};

interface ImportSheet { kind?: string; rowsRead?: number; rowsImported?: number; proposalsCreated?: number; statementId?: string | null; warnings?: string[] }
interface ImportSummary { kind?: string; sheets?: ImportSheet[]; totalRowsImported?: number; totalProposals?: number }

const summaryOf = (d: { importSummary?: unknown }): ImportSummary | null =>
  d.importSummary && typeof d.importSummary === 'object' ? (d.importSummary as ImportSummary) : null;
const statementSheets = (d: { importSummary?: unknown }) => (summaryOf(d)?.sheets ?? []).filter((s) => s.kind === 'bank_statement');
const isStatement = (d: { importSummary?: unknown; type?: string }) => summaryOf(d)?.kind === 'bank_statement' || statementSheets(d).length > 0;

type LeanUpload = UploadedDocument & { _id: Types.ObjectId; createdAt: Date };
type LeanFile = Attachment & { _id: Types.ObjectId; createdAt: Date };
type IdLike = Types.ObjectId | { toString(): string } | string | null | undefined;
const sid = (v: IdLike) => (v == null ? '' : String(v));
const oid = (v: string) => new Types.ObjectId(v);

/** A folder name as kept: trimmed, single spaces, no control characters. */
function cleanName(raw: unknown): string {
  const name = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!name) throw new BadRequestException('Give the folder a name.');
  if (name.length > 60) throw new BadRequestException('Keep the folder name to 60 characters.');
  return name;
}
const isDuplicateKey = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;

/**
 * The Documents area: every file in the books in one list, each with what
 * it became; folders to file them in; the bank statements that came in; and
 * the reading pipeline at a glance for the dashboard.
 *
 * It reads the books and files documents in folders. It never posts and
 * never changes what a document became: filing is the only write, and every
 * one is audited in the same transaction as the change.
 */
@Injectable()
export class DocumentLibraryService {
  constructor(
    @InjectModel(UploadedDocument.name) private documentModel: Model<DocumentDocument>,
    @InjectModel(DocumentFolder.name) private folderModel: Model<DocumentFolderDocument>,
    @InjectModel(Attachment.name) private attachmentModel: Model<AttachmentDocument>,
    @InjectModel(ProposedEntry.name) private proposalModel: Model<ProposedEntryDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(BankStatement.name) private statementModel: Model<BankStatementDocument>,
    @InjectModel(BankAccount.name) private bankAccountModel: Model<BankAccountDocument>,
    @InjectModel(BankStatementLine.name) private lineModel: Model<BankStatementLineDocument>,
    @InjectConnection() private connection: Connection,
    private audit: AuditService,
  ) {}

  // ── Folders ──────────────────────────────────────────────────────────────

  async listFolders(orgId: string): Promise<FolderRow[]> {
    const folders = await this.folderModel.find({ orgId }).sort({ nameKey: 1 }).lean().exec();
    if (!folders.length) return [];
    const ids = folders.map((f) => f._id);
    const [docs, files] = await Promise.all([
      this.documentModel.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { orgId, folderId: { $in: ids } } }, { $group: { _id: '$folderId', n: { $sum: 1 } } }]).exec(),
      this.attachmentModel.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { orgId, folderId: { $in: ids }, removedAt: null } }, { $group: { _id: '$folderId', n: { $sum: 1 } } }]).exec(),
    ]);
    const count = new Map<string, number>();
    for (const c of [...docs, ...files]) count.set(sid(c._id), (count.get(sid(c._id)) ?? 0) + c.n);
    return folders.map((f) => ({ id: sid(f._id), name: f.name, count: count.get(sid(f._id)) ?? 0, createdAt: (f as unknown as { createdAt: Date }).createdAt }));
  }

  async createFolder(orgId: string, actorId: string, rawName: string): Promise<FolderRow> {
    const name = cleanName(rawName);
    const nameKey = name.toLowerCase();
    if (await this.folderModel.exists({ orgId, nameKey }).exec()) throw new ConflictException(`There is already a folder called ${name}.`);
    try {
      const folder = await this.tx(async (session) => {
        const [created] = await this.folderModel.create([{ orgId, name, nameKey, createdBy: actorId }], { session });
        await this.audit.record({ orgId, entityType: 'DocumentFolder', entityId: sid(created._id), action: 'CREATE', performedBy: actorId, after: { name } }, session);
        return created;
      });
      return { id: sid(folder._id), name: folder.name, count: 0, createdAt: (folder as unknown as { createdAt: Date }).createdAt };
    } catch (e) {
      if (isDuplicateKey(e)) throw new ConflictException(`There is already a folder called ${name}.`);
      throw e;
    }
  }

  async renameFolder(orgId: string, actorId: string, id: string, rawName: string): Promise<FolderRow> {
    const folder = await this.findFolder(orgId, id);
    const name = cleanName(rawName);
    const nameKey = name.toLowerCase();
    if (name !== folder.name) {
      if (nameKey !== folder.nameKey && (await this.folderModel.exists({ orgId, nameKey }).exec())) {
        throw new ConflictException(`There is already a folder called ${name}.`);
      }
      try {
        await this.tx(async (session) => {
          await this.folderModel.updateOne({ _id: folder._id, orgId }, { $set: { name, nameKey } }, { session }).exec();
          await this.audit.record({ orgId, entityType: 'DocumentFolder', entityId: id, action: 'RENAME', performedBy: actorId, before: { name: folder.name }, after: { name } }, session);
        });
      } catch (e) {
        if (isDuplicateKey(e)) throw new ConflictException(`There is already a folder called ${name}.`);
        throw e;
      }
    }
    return (await this.listFolders(orgId)).find((f) => f.id === id)!;
  }

  /** Deletes the folder; its files move to no folder, each move audited. The files themselves stay. */
  async deleteFolder(orgId: string, actorId: string, id: string): Promise<{ deleted: true; filesMoved: number }> {
    const folder = await this.findFolder(orgId, id);
    const filesMoved = await this.tx(async (session) => {
      const [docs, files] = await Promise.all([
        this.documentModel.find({ orgId, folderId: folder._id }).select('_id').session(session).lean().exec(),
        this.attachmentModel.find({ orgId, folderId: folder._id }).select('_id').session(session).lean().exec(),
      ]);
      await this.documentModel.updateMany({ orgId, folderId: folder._id }, { $set: { folderId: null } }, { session }).exec();
      await this.attachmentModel.updateMany({ orgId, folderId: folder._id }, { $set: { folderId: null } }, { session }).exec();
      await this.folderModel.deleteOne({ _id: folder._id, orgId }, { session }).exec();
      const before = { folderId: id, folder: folder.name };
      const after = { folderId: null, folder: null, reason: `Folder ${folder.name} deleted` };
      for (const d of docs) await this.audit.record({ orgId, entityType: 'Document', entityId: sid(d._id), action: 'MOVE', performedBy: actorId, before, after }, session);
      for (const f of files) await this.audit.record({ orgId, entityType: 'Attachment', entityId: sid(f._id), action: 'MOVE', performedBy: actorId, before, after }, session);
      await this.audit.record({ orgId, entityType: 'DocumentFolder', entityId: id, action: 'DELETE', performedBy: actorId, before: { name: folder.name, files: docs.length + files.length }, after: null }, session);
      return docs.length + files.length;
    });
    return { deleted: true, filesMoved };
  }

  /** Files uploads and attached files in a folder, or in none (folderId null). Only what moves is changed and audited. */
  async move(
    orgId: string,
    actorId: string,
    items: Array<{ kind: 'document' | 'attachment'; id: string }>,
    folderId: string | null,
  ): Promise<{ moved: number; folder: { id: string; name: string } | null }> {
    if (!items.length) throw new BadRequestException('Pick at least one file to move.');
    if (items.length > MAX_MOVE) throw new BadRequestException(`Move at most ${MAX_MOVE} files at a time.`);
    for (const it of items) if (!Types.ObjectId.isValid(it.id)) throw new NotFoundException('File not found');
    const target = folderId ? await this.findFolder(orgId, folderId) : null;
    const docIds = [...new Set(items.filter((i) => i.kind === 'document').map((i) => i.id))];
    const fileIds = [...new Set(items.filter((i) => i.kind === 'attachment').map((i) => i.id))];
    const names = new Map((await this.folderModel.find({ orgId }).select('name').lean().exec()).map((f) => [sid(f._id), f.name]));
    const targetId = target ? sid(target._id) : '';

    const moved = await this.tx(async (session) => {
      const [docs, files] = await Promise.all([
        docIds.length ? this.documentModel.find({ orgId, _id: { $in: docIds.map(oid) } }).select('folderId').session(session).lean().exec() : [],
        fileIds.length ? this.attachmentModel.find({ orgId, _id: { $in: fileIds.map(oid) }, removedAt: null }).select('folderId').session(session).lean().exec() : [],
      ]);
      if (docs.length !== docIds.length || files.length !== fileIds.length) throw new NotFoundException('Some of those files were not found.');
      const set = { $set: { folderId: target?._id ?? null } };
      const docsToMove = docs.filter((d) => sid(d.folderId as IdLike) !== targetId);
      const filesToMove = files.filter((f) => sid(f.folderId) !== targetId);
      if (docsToMove.length) await this.documentModel.updateMany({ orgId, _id: { $in: docsToMove.map((d) => d._id) } }, set, { session }).exec();
      if (filesToMove.length) await this.attachmentModel.updateMany({ orgId, _id: { $in: filesToMove.map((f) => f._id) } }, set, { session }).exec();
      const after = { folderId: target ? targetId : null, folder: target?.name ?? null };
      const before = (from: IdLike) => ({ folderId: sid(from) || null, folder: names.get(sid(from)) ?? null });
      for (const d of docsToMove) await this.audit.record({ orgId, entityType: 'Document', entityId: sid(d._id), action: 'MOVE', performedBy: actorId, before: before(d.folderId as IdLike), after }, session);
      for (const f of filesToMove) await this.audit.record({ orgId, entityType: 'Attachment', entityId: sid(f._id), action: 'MOVE', performedBy: actorId, before: before(f.folderId), after }, session);
      return docsToMove.length + filesToMove.length;
    });
    return { moved, folder: target ? { id: targetId, name: target.name } : null };
  }

  // ── All documents ────────────────────────────────────────────────────────

  /**
   * Uploads and files attached to records, newest first, each with what it
   * became, who brought it in and its folder. folderId: a folder's id,
   * 'none' for files in no folder, or nothing for every file.
   *
   * A scan entered by hand is kept against its record as an attachment of
   * the same stored file; that copy is left out here, as the upload's row
   * already says what it became.
   */
  async library(orgId: string, opts: { folderId?: string | null; limit?: number } = {}): Promise<{ data: LibraryRow[]; truncated: boolean }> {
    const limit = Math.min(Math.max(Math.floor(opts.limit ?? 200), 1), 500);
    let folder: Types.ObjectId | null | undefined;
    if (opts.folderId === 'none') folder = null;
    else if (opts.folderId) folder = (await this.findFolder(orgId, opts.folderId))._id;
    const inFolder = folder === undefined ? {} : { folderId: folder };

    const [docs, files] = await Promise.all([
      this.documentModel.find({ orgId, ...inFolder }).sort({ createdAt: -1 }).limit(limit + 1).lean().exec() as unknown as Promise<LeanUpload[]>,
      this.attachmentModel
        .find({ orgId, removedAt: null, storageKey: { $regex: '/attachments/' }, ...inFolder })
        .sort({ createdAt: -1 })
        .limit(limit + 1)
        .lean()
        .exec() as unknown as Promise<LeanFile[]>,
    ]);

    const folderNames = new Map((await this.folderModel.find({ orgId }).select('name').lean().exec()).map((f) => [sid(f._id), f.name]));
    const users = await this.userNames([...docs.map((d) => sid(d.uploadedBy as IdLike)), ...files.map((f) => f.uploadedBy)]);
    const [uploadRows, fileRows] = await Promise.all([this.uploadRows(orgId, docs, users, folderNames), this.fileRows(orgId, files, users, folderNames)]);

    const all = [...uploadRows, ...fileRows].sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
    return { data: all.slice(0, limit), truncated: all.length > limit || docs.length > limit || files.length > limit };
  }

  private async uploadRows(orgId: string, docs: LeanUpload[], users: Map<string, string>, folderNames: Map<string, string>): Promise<LibraryRow[]> {
    if (!docs.length) return [];
    const ids = docs.map((d) => d._id);
    const proposals = await this.proposalModel
      .find({ orgId, documentId: { $in: ids } })
      .select('documentId status journalId vendorName invoiceNumber amountsPaise documentType')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    const proposalOf = new Map<string, (typeof proposals)[number]>();
    for (const p of proposals) if (!proposalOf.has(sid(p.documentId as IdLike))) proposalOf.set(sid(p.documentId as IdLike), p);

    // Posted from Review: the bill or invoice it became, or failing that its voucher.
    const approved = docs.filter((d) => d.status === DocumentStatus.APPROVED && !d.enteredAs);
    const approvedIds = approved.map((d) => d._id);
    const [bills, invoices] = await Promise.all([
      this.findIn<{ billNumber?: string | null; sourceDocumentId?: unknown }>('PurchaseBill', { orgId, sourceDocumentId: { $in: approvedIds } }, 'billNumber sourceDocumentId'),
      this.findIn<{ invoiceNumber?: string | null; sourceDocumentId?: unknown }>('SalesInvoice', { orgId, sourceDocumentId: { $in: approvedIds } }, 'invoiceNumber sourceDocumentId'),
    ]);
    const billOf = new Map(bills.map((b) => [sid(b.sourceDocumentId as IdLike), b]));
    const invoiceOf = new Map(invoices.map((i) => [sid(i.sourceDocumentId as IdLike), i]));
    const journalIds = approved.map((d) => proposalOf.get(sid(d._id))?.journalId).filter((j): j is Types.ObjectId => !!j);
    const journals = await this.findIn<{ voucherType?: string; financialYear?: string; voucherNumber?: number }>('Journal', { orgId, _id: { $in: journalIds } }, 'voucherType financialYear voucherNumber');
    const journalOf = new Map(journals.map((j) => [sid(j._id), j]));

    // Statements: the bank account each went to.
    const statementIds = docs.flatMap((d) => statementSheets(d).map((s) => s.statementId).filter((s): s is string => !!s && Types.ObjectId.isValid(s)));
    const statements = statementIds.length ? await this.statementModel.find({ orgId, _id: { $in: statementIds.map(oid) } }).select('bankAccountId status').lean().exec() : [];
    const statementOf = new Map(statements.map((s) => [sid(s._id), s]));
    const accounts = await this.accountsById(orgId, statements.map((s) => s.bankAccountId));

    // Duplicates name the file they repeat.
    const originalIds = docs.map((d) => d.duplicateOf).filter(Boolean) as unknown as Types.ObjectId[];
    const originals = originalIds.length ? await this.documentModel.find({ orgId, _id: { $in: originalIds } }).select('originalName').lean().exec() : [];
    const originalName = new Map(originals.map((o) => [sid(o._id), o.originalName]));

    return docs.map((d): LibraryRow => {
      const id = sid(d._id);
      const p = proposalOf.get(id);
      const summary = summaryOf(d);
      const sheet = statementSheets(d).find((s) => s.statementId) ?? null;
      const statement = sheet?.statementId ? statementOf.get(sheet.statementId) : undefined;
      let stage: LibraryStage;
      let associatedTo: AssociatedTo | null = null;

      if (d.enteredAs) {
        stage = 'entered';
        associatedTo = { kind: 'record', label: d.enteredAs.label, entityType: d.enteredAs.entityType, entityId: d.enteredAs.entityId };
      } else if (READING.includes(d.status)) {
        stage = 'reading';
      } else if (statement) {
        stage = d.status === DocumentStatus.FAILED ? 'failed' : statement.status === StatementStatus.RECONCILED ? 'reconciled' : 'imported';
        const account = accounts.get(sid(statement.bankAccountId));
        const lines = sheet?.rowsImported ?? 0;
        associatedTo = {
          kind: 'statement',
          label: ['Bank statement', account ? accountLabel(account) : null, `${lines} ${lines === 1 ? 'line' : 'lines'}`].filter(Boolean).join(' · '),
          entityType: 'BankStatement',
          entityId: sheet!.statementId!,
          bankAccountId: sid(statement.bankAccountId),
        };
      } else if (d.status === DocumentStatus.FAILED) {
        stage = 'failed';
      } else if (d.status === DocumentStatus.DUPLICATE) {
        stage = 'duplicate';
        const original = sid(d.duplicateOf as IdLike);
        associatedTo = { kind: 'duplicate', label: `Same file as ${originalName.get(original) ?? 'an earlier upload'}`, entityType: 'Document', entityId: original || null };
      } else if (d.status === DocumentStatus.APPROVED) {
        stage = 'posted';
        const bill = billOf.get(id);
        const invoice = invoiceOf.get(id);
        const journal = p?.journalId ? journalOf.get(sid(p.journalId)) : undefined;
        if (bill) associatedTo = { kind: 'record', label: bill.billNumber ? `Bill ${bill.billNumber}` : 'Bill', entityType: 'PurchaseBill', entityId: sid(bill._id) };
        else if (invoice) associatedTo = { kind: 'record', label: invoice.invoiceNumber ? `Invoice ${invoice.invoiceNumber}` : 'Invoice', entityType: 'SalesInvoice', entityId: sid(invoice._id) };
        else if (journal) associatedTo = { kind: 'record', label: `Journal ${voucherNumber(journal) ?? ''}`.trim(), entityType: 'Journal', entityId: sid(journal._id) };
      } else if (d.status === DocumentStatus.REJECTED) {
        stage = 'rejected';
        associatedTo = { kind: 'rejected', label: 'Rejected in Review', entityType: null, entityId: null };
      } else if (summary && (summary.totalProposals ?? 0) === 0 && (summary.totalRowsImported ?? 0) > 0) {
        // A spreadsheet whose rows went straight in, nothing proposed.
        stage = 'imported';
        associatedTo = { kind: 'record', label: `${summary.totalRowsImported} rows imported`, entityType: null, entityId: null };
      } else {
        stage = 'ready';
        const n = summary?.totalProposals ?? 0;
        associatedTo = { kind: 'review', label: n > 1 ? `${n} entries waiting in Review` : 'Waiting in Review', entityType: 'ProposedEntry', entityId: p ? sid(p._id) : null };
      }

      return {
        key: `d:${id}`,
        id,
        kind: 'upload',
        fileName: d.originalName,
        mimeType: d.mimeType,
        fileKind: fileKindOf(d.mimeType, d.originalName),
        sizeBytes: d.sizeBytes,
        stage,
        status: d.status,
        documentType: p?.documentType ?? d.type ?? (statement ? 'bank_statement' : null),
        vendor: p?.vendorName ?? null,
        invoiceNumber: p?.invoiceNumber ?? null,
        totalAmountPaise: p?.amountsPaise?.total ?? null,
        proposalId: p ? sid(p._id) : null,
        failureReason: d.status === DocumentStatus.FAILED ? d.failureReason ?? 'The document could not be read.' : null,
        enteredAs: d.enteredAs ? { entityType: d.enteredAs.entityType, entityId: d.enteredAs.entityId, label: d.enteredAs.label } : null,
        uploadedAt: d.createdAt,
        uploadedBy: this.uploader(d, users),
        associatedTo,
        folder: this.folderOf(d.folderId as IdLike, folderNames),
      };
    });
  }

  private async fileRows(orgId: string, files: LeanFile[], users: Map<string, string>, folderNames: Map<string, string>): Promise<LibraryRow[]> {
    if (!files.length) return [];
    const labels = await this.recordLabels(orgId, files.map((f) => ({ entityType: f.entityType, entityId: sid(f.entityId) })));
    return files.map((f): LibraryRow => {
      const id = sid(f._id);
      const ref = `${f.entityType}:${sid(f.entityId)}`;
      return {
        key: `a:${id}`,
        id,
        kind: 'attachment',
        fileName: f.fileName,
        mimeType: f.mimeType,
        fileKind: fileKindOf(f.mimeType, f.fileName),
        sizeBytes: f.sizeBytes,
        stage: 'attached',
        status: 'ATTACHED',
        documentType: null,
        vendor: null,
        invoiceNumber: null,
        totalAmountPaise: null,
        proposalId: null,
        failureReason: null,
        enteredAs: null,
        uploadedAt: f.createdAt,
        uploadedBy: { channel: 'upload', name: users.get(f.uploadedBy) ?? null, from: null },
        associatedTo: { kind: 'record', label: labels.get(ref) ?? RECORDS[f.entityType]?.noun ?? f.entityType, entityType: f.entityType, entityId: sid(f.entityId) },
        folder: this.folderOf(f.folderId, folderNames),
      };
    });
  }

  // ── Bank statements ──────────────────────────────────────────────────────

  /** Every upload that was a bank statement: its account, period, and how far its lines are reconciled. */
  async statements(orgId: string): Promise<StatementRow[]> {
    const docs = (await this.documentModel
      .find({ orgId, $or: [{ 'importSummary.kind': 'bank_statement' }, { 'importSummary.sheets.kind': 'bank_statement' }, { type: 'bank_statement' }] })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean()
      .exec()) as unknown as LeanUpload[];
    if (!docs.length) return [];

    const statementIds = [...new Set(docs.flatMap((d) => statementSheets(d).map((s) => s.statementId).filter((s): s is string => !!s && Types.ObjectId.isValid(s))))];
    const statements = statementIds.length ? await this.statementModel.find({ orgId, _id: { $in: statementIds.map(oid) } }).lean().exec() : [];
    const statementOf = new Map(statements.map((s) => [sid(s._id), s]));
    const accounts = await this.accountsById(orgId, statements.map((s) => s.bankAccountId));
    const counts = statements.length
      ? await this.lineModel
          .aggregate<{ _id: { s: Types.ObjectId; m: MatchStatus; x: boolean }; n: number }>([
            { $match: { orgId, statementId: { $in: statements.map((s) => s._id) } } },
            { $group: { _id: { s: '$statementId', m: '$matchStatus', x: '$excluded' }, n: { $sum: 1 } } },
          ])
          .exec()
      : [];
    const tally = new Map<string, { matched: number; confirmed: number; unmatched: number; excluded: number; total: number }>();
    for (const c of counts) {
      const t = tally.get(sid(c._id.s)) ?? { matched: 0, confirmed: 0, unmatched: 0, excluded: 0, total: 0 };
      t.total += c.n;
      if (c._id.x) t.excluded += c.n;
      else if (c._id.m === MatchStatus.CONFIRMED) t.confirmed += c.n;
      else if (c._id.m === MatchStatus.UNMATCHED) t.unmatched += c.n;
      else t.matched += c.n;
      tally.set(sid(c._id.s), t);
    }
    const users = await this.userNames(docs.map((d) => sid(d.uploadedBy as IdLike)));

    const rows: StatementRow[] = [];
    for (const d of docs) {
      const base = {
        documentId: sid(d._id),
        fileName: d.originalName,
        uploadedAt: d.createdAt,
        uploadedBy: this.uploader(d, users),
      };
      const sheets = statementSheets(d);
      const imported = sheets.filter((s) => s.statementId && statementOf.has(s.statementId));
      if (!imported.length) {
        rows.push({
          ...base,
          key: `d:${base.documentId}`,
          stage: READING.includes(d.status) ? 'reading' : 'failed',
          failureReason: d.status === DocumentStatus.FAILED ? d.failureReason ?? 'The statement could not be read.' : READING.includes(d.status) ? null : 'No lines were imported from this statement.',
          warnings: sheets.flatMap((s) => s.warnings ?? []).slice(0, 3),
          statementId: null,
          bankAccount: null,
          periodStart: null,
          periodEnd: null,
          linesImported: 0,
          matched: 0,
          confirmed: 0,
          unmatched: 0,
          excluded: 0,
        });
        continue;
      }
      for (const s of imported) {
        const st = statementOf.get(s.statementId!)!;
        const account = accounts.get(sid(st.bankAccountId));
        const t = tally.get(sid(st._id)) ?? { matched: 0, confirmed: 0, unmatched: 0, excluded: 0, total: 0 };
        rows.push({
          ...base,
          key: `d:${base.documentId}:${sid(st._id)}`,
          stage: st.status === StatementStatus.RECONCILED ? 'reconciled' : 'imported',
          failureReason: null,
          warnings: (s.warnings ?? []).slice(0, 3),
          statementId: sid(st._id),
          bankAccount: account ? { id: sid(account._id), name: account.name, bankName: account.bankName ?? null, last4: account.accountNumber ? account.accountNumber.slice(-4) : null } : null,
          periodStart: st.periodStart,
          periodEnd: st.periodEnd,
          linesImported: t.total || s.rowsImported || st.totalLines || 0,
          matched: t.matched,
          confirmed: t.confirmed,
          unmatched: t.unmatched,
          excluded: t.excluded,
        });
      }
    }
    return rows;
  }

  // ── The pipeline at a glance ─────────────────────────────────────────────

  /** Counts only, from indexed fields: cheap enough for the dashboard to ask on every visit. */
  async pipeline(orgId: string, now = new Date()): Promise<DocumentPipeline> {
    const { today, week } = indiaDayAndWeekStart(now);
    const notEntered = { enteredAs: null };
    const [total, reading, ready, duplicates, failedGroups, byHandToday, byHandWeek, postedToday, postedWeek] = await Promise.all([
      this.documentModel.countDocuments({ orgId }).exec(),
      this.documentModel.countDocuments({ orgId, status: { $in: READING } }).exec(),
      this.documentModel
        // A spreadsheet or statement whose rows went straight in has nothing waiting in Review.
        .countDocuments({
          orgId,
          status: { $in: [DocumentStatus.EXTRACTED, DocumentStatus.PROPOSED] },
          ...notEntered,
          $or: [{ importSummary: null }, { 'importSummary.totalProposals': { $gt: 0 } }],
        })
        .exec(),
      this.documentModel.countDocuments({ orgId, status: DocumentStatus.DUPLICATE, ...notEntered }).exec(),
      this.documentModel
        .aggregate<{ _id: string | null; n: number }>([
          { $match: { orgId, status: DocumentStatus.FAILED, enteredAs: null } },
          { $group: { _id: '$failureReason', n: { $sum: 1 } } },
          { $sort: { n: -1 } },
        ])
        .exec(),
      this.documentModel.countDocuments({ orgId, 'enteredAs.at': { $gte: today } }).exec(),
      this.documentModel.countDocuments({ orgId, 'enteredAs.at': { $gte: week } }).exec(),
      this.proposalModel.distinct('documentId', { orgId, documentId: { $ne: null }, status: 'approved', updatedAt: { $gte: today } }).exec(),
      this.proposalModel.distinct('documentId', { orgId, documentId: { $ne: null }, status: 'approved', updatedAt: { $gte: week } }).exec(),
    ]);
    const failed = failedGroups.reduce((s, g) => s + g.n, 0);
    return {
      total,
      reading,
      readyForReview: ready,
      couldNotRead: {
        count: failed,
        reasons: failedGroups.slice(0, 3).map((g) => ({ reason: (g._id ?? 'The document could not be read.').slice(0, 240), count: g.n })),
      },
      duplicates,
      waiting: reading + failed + duplicates,
      entered: { today: byHandToday + postedToday.length, thisWeek: byHandWeek + postedWeek.length },
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async findFolder(orgId: string, id: string): Promise<DocumentFolderDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Folder not found');
    const folder = await this.folderModel.findOne({ _id: id, orgId }).exec();
    if (!folder) throw new NotFoundException('Folder not found');
    return folder;
  }

  private folderOf(id: IdLike, names: Map<string, string>): { id: string; name: string } | null {
    const key = sid(id);
    return key && names.has(key) ? { id: key, name: names.get(key)! } : null;
  }

  private uploader(d: LeanUpload, users: Map<string, string>): Uploader {
    const channel = d.source?.channel ?? 'upload';
    if (channel !== 'upload') return { channel, name: null, from: d.source?.from ?? null };
    return { channel, name: users.get(sid(d.uploadedBy as IdLike)) ?? null, from: null };
  }

  /** Users are not tenant-scoped: looked up by id only, for their name. */
  private async userNames(ids: string[]): Promise<Map<string, string>> {
    const valid = [...new Set(ids)].filter((id) => /^[a-f0-9]{24}$/i.test(id));
    if (!valid.length) return new Map();
    const users = await this.userModel.find({ _id: { $in: valid.map(oid) } }).select('name email').lean().exec();
    return new Map(users.map((u) => [sid(u._id), u.name || u.email]));
  }

  private async accountsById(orgId: string, ids: IdLike[]) {
    const unique = [...new Set(ids.map(sid).filter((id) => Types.ObjectId.isValid(id)))];
    if (!unique.length) return new Map<string, BankAccount & { _id: Types.ObjectId }>();
    const accounts = await this.bankAccountModel.find({ orgId, _id: { $in: unique.map(oid) } }).select('name bankName accountNumber').lean().exec();
    return new Map(accounts.map((a) => [sid(a._id), a as BankAccount & { _id: Types.ObjectId }]));
  }

  /**
   * Rows of a model another module owns, read by name off the connection so
   * this module neither registers nor writes to it. A model that is not
   * registered (a slimmed test module) reads as no rows.
   */
  private async findIn<T>(modelName: string, filter: Record<string, unknown>, select: string): Promise<Array<T & { _id: Types.ObjectId }>> {
    const model = this.connection.models[modelName] as Model<T> | undefined;
    const ids = filter._id as { $in?: unknown[] } | undefined;
    const sources = filter.sourceDocumentId as { $in?: unknown[] } | undefined;
    if (!model || (ids && !ids.$in?.length) || (sources && !sources.$in?.length)) return [];
    return (await model.find(filter).select(select).lean().exec()) as unknown as Array<T & { _id: Types.ObjectId }>;
  }

  /** "Bill SGP/1342", "Customer Rao Traders": each record a file is kept against, by type and id. */
  private async recordLabels(orgId: string, refs: Array<{ entityType: string; entityId: string }>): Promise<Map<string, string>> {
    const byType = new Map<string, Set<string>>();
    for (const r of refs) if (RECORDS[r.entityType] && Types.ObjectId.isValid(r.entityId)) byType.set(r.entityType, (byType.get(r.entityType) ?? new Set()).add(r.entityId));
    const out = new Map<string, string>();
    await Promise.all(
      [...byType].map(async ([type, ids]) => {
        const spec = RECORDS[type];
        const rows = await this.findIn<Record<string, unknown>>(type, { orgId, _id: { $in: [...ids].map(oid) } }, spec.select);
        for (const r of rows) {
          const n = spec.number(r);
          out.set(`${type}:${sid(r._id)}`, n ? `${spec.noun} ${n}` : spec.noun);
        }
      }),
    );
    return out;
  }

  private async tx<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let out: T | undefined;
      await session.withTransaction(async () => {
        out = await fn(session);
      });
      return out as T;
    } finally {
      await session.endSession();
    }
  }
}

/** "HDFC Bank ··1234". */
function accountLabel(a: { name: string; bankName?: string | null; accountNumber?: string | null }): string {
  const name = a.bankName?.trim() || a.name;
  return a.accountNumber ? `${name} ··${a.accountNumber.slice(-4)}` : name;
}
