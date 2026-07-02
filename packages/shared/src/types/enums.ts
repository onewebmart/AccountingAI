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
