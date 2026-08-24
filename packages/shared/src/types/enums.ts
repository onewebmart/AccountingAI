export enum VoucherType {
  PURCHASE = 'PURCHASE',
  SALES = 'SALES',
  RECEIPT = 'RECEIPT',
  PAYMENT = 'PAYMENT',
  CONTRA = 'CONTRA',
  JOURNAL = 'JOURNAL',
  CREDIT_NOTE = 'CREDIT_NOTE',
  DEBIT_NOTE = 'DEBIT_NOTE',
}

export enum JournalStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  REVERSED = 'reversed',
}

export enum DocumentStatus {
  UPLOADED = 'UPLOADED',
  CLASSIFYING = 'CLASSIFYING',
  EXTRACTING = 'EXTRACTING',
  EXTRACTED = 'EXTRACTED',
  PROPOSED = 'PROPOSED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  DUPLICATE = 'DUPLICATE',
  FAILED = 'FAILED',
}

export enum DocumentType {
  PURCHASE_INVOICE = 'purchase_invoice',
  SALES_INVOICE = 'sales_invoice',
  BANK_STATEMENT = 'bank_statement',
  RECEIPT = 'receipt',
  BILL = 'bill',
}

export enum ProposedEntryStatus {
  PROPOSED = 'proposed',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EDITED = 'edited',
}

export enum UserRole {
  PLATFORM_SUPER_ADMIN = 'PLATFORM_SUPER_ADMIN',
  FIRM_ADMIN = 'FIRM_ADMIN',
  COMPANY_ADMIN = 'COMPANY_ADMIN',
  ACCOUNTANT = 'ACCOUNTANT',
  CA_REVIEWER = 'CA_REVIEWER',
  EMPLOYEE = 'EMPLOYEE',
  AUDITOR = 'AUDITOR',
}

export enum AccountType {
  ASSETS = 'ASSETS',
  LIABILITIES = 'LIABILITIES',
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE',
  CAPITAL = 'CAPITAL',
}

export enum MatchStatus {
  UNMATCHED = 'unmatched',
  AUTO_MATCHED = 'auto_matched',
  MANUALLY_MATCHED = 'manually_matched',
  CONFIRMED = 'confirmed',
}

export enum StatementStatus {
  PENDING = 'pending',
  RECONCILED = 'reconciled',
}

export enum GstReconStatus {
  PENDING = 'pending',
  MATCHED = 'matched',
  MISSING_IN_BOOKS = 'missing_in_books',
  MISSING_IN_2B = 'missing_in_2b',
  MISMATCHED = 'mismatched',
}

export enum GstMismatchType {
  AMOUNT_DIFFERS = 'amount_differs',
  GSTIN_DIFFERS = 'gstin_differs',
}

export enum TallySyncStatus {
  PENDING = 'pending',
  SYNCED = 'synced',
  FAILED = 'failed',
}

export enum BillStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  PAID = 'paid',
}

export enum InvoiceStatus {
  DRAFT = 'draft',
  SENT = 'sent',
  POSTED = 'posted',
  PAID = 'paid',
}

export enum Permission {
  // Journals & posting — the core double-entry actions
  POST_JOURNAL = 'journal:post',
  REVERSE_JOURNAL = 'journal:reverse',
  VIEW_JOURNAL = 'journal:view',

  // Documents
  UPLOAD_DOCUMENT = 'document:upload',
  VIEW_DOCUMENT = 'document:view',

  // Proposed entries (AI suggestions)
  REVIEW_PROPOSAL = 'proposal:review',
  APPROVE_PROPOSAL = 'proposal:approve',

  // Reports
  VIEW_REPORTS = 'report:view',

  // GST / tax
  MANAGE_GST = 'gst:manage',

  // Org administration
  MANAGE_ORG = 'org:manage',
  MANAGE_USERS = 'user:manage',
  MANAGE_COA = 'coa:manage',

  // Audit trail
  VIEW_AUDIT = 'audit:view',

  // Purchase & Sales
  MANAGE_PURCHASE = 'purchase:manage',
  MANAGE_SALES = 'sales:manage',

  // Firm-level (CA firm manages client orgs)
  MANAGE_FIRM = 'firm:manage',

  // Platform super-admin only
  PLATFORM_ADMIN = 'platform:admin',
}

// ── CRM (CA firm practice management) ─────────────────────────────────────────

/**
 * Legal constitution of a firm's client. Decides which statutory filings apply:
 * only companies file ROC returns, only individuals file personal ITR, etc.
 */
export enum ClientType {
  INDIVIDUAL = 'INDIVIDUAL',
  PROPRIETORSHIP = 'PROPRIETORSHIP',
  PARTNERSHIP = 'PARTNERSHIP',
  PRIVATE_LIMITED = 'PRIVATE_LIMITED',
  PUBLIC_LIMITED = 'PUBLIC_LIMITED',
  LLP = 'LLP',
}

/**
 * A service the CA firm provides to a client. Drives which compliance
 * deadlines are generated and which document checklists are requested.
 */
export enum FirmService {
  GST_FILING = 'GST_FILING',
  ITR = 'ITR',
  TDS = 'TDS',
  ROC_MCA = 'ROC_MCA',
  AUDIT = 'AUDIT',
  BOOKKEEPING = 'BOOKKEEPING',
}

/** How a CRM message reaches the client. */
export enum MessageChannel {
  WHATSAPP = 'WHATSAPP',
  EMAIL = 'EMAIL',
}

export enum MessageDirection {
  OUTBOUND = 'OUTBOUND',
  INBOUND = 'INBOUND',
}

export enum MessageStatus {
  /** Accepted onto the queue, not yet handed to a provider. */
  QUEUED = 'QUEUED',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

/**
 * What prompted an outbound message. Lets the outbox be filtered by cause and
 * makes reminder jobs idempotent per (template, entity, client).
 */
export enum MessageTemplateKey {
  DOCUMENT_REMINDER = 'DOCUMENT_REMINDER',
  COMPLIANCE_DEADLINE = 'COMPLIANCE_DEADLINE',
  INVOICE_DUE = 'INVOICE_DUE',
  INVOICE_OVERDUE = 'INVOICE_OVERDUE',
  LEAD_FOLLOW_UP = 'LEAD_FOLLOW_UP',
  GENERIC = 'GENERIC',
}
