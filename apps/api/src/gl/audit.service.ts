import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';

export interface AuditEntry {
  orgId: string;
  /** e.g. 'SalesInvoice', 'BankStatementLine' */
  entityType: string;
  entityId: string;
  /** What happened, as a verb: 'CREATE', 'POST', 'PAY', 'MATCH' … */
  action: string;
  performedBy: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: Record<string, unknown>;
}

/**
 * The one way business code writes to the audit trail (Invariant 6).
 *
 * Pass the session of the transaction making the change, so the record and the
 * change commit together — or not at all.
 */
@Injectable()
export class AuditService {
  constructor(@InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>) {}

  async record(entry: AuditEntry, session?: ClientSession): Promise<void> {
    await this.auditLogModel.create(
      [
        {
          ...entry,
          entityId: String(entry.entityId),
          before: entry.before ?? null,
          after: entry.after ?? null,
        },
      ],
      { session },
    );
  }
}
