import { DocumentType, FirmService } from '@ai-accounting/shared';

/**
 * What a CA firm actually asks a client for, per service.
 *
 * Declarative for the same reason as the statutory calendar: a firm's document
 * list changes with practice and season, and that should be an edit to one
 * table rather than a hunt through service code.
 */

export interface ChecklistTemplateItem {
  /** Stable identifier — the handle the API and the auto-matcher use. */
  key: string;
  /** Shown to staff in the UI and to the client in the reminder. */
  label: string;
  /**
   * Filename fragments that suggest this document. Used only to propose a match
   * (→ RECEIVED); a human still verifies. Lower-case, matched as substrings.
   */
  filenameHints: string[];
  /** Extracted document types that satisfy this item outright. */
  documentTypes?: DocumentType[];
}

export interface ChecklistTemplate {
  service: FirmService;
  /** Default purpose text, e.g. the heading on the client card. */
  purpose: string;
  items: ChecklistTemplateItem[];
}

export const CHECKLIST_TEMPLATES: ChecklistTemplate[] = [
  {
    service: FirmService.ITR,
    purpose: 'ITR filing',
    items: [
      { key: 'form_16', label: 'Form 16', filenameHints: ['form16', 'form 16', 'form-16'] },
      { key: 'pan_card', label: 'PAN card', filenameHints: ['pan'] },
      { key: 'aadhaar', label: 'Aadhaar', filenameHints: ['aadhaar', 'aadhar'] },
      {
        key: 'bank_statement',
        label: 'Bank statement',
        filenameHints: ['bank', 'statement', 'passbook'],
        documentTypes: [DocumentType.BANK_STATEMENT],
      },
      {
        key: 'investment_proofs',
        label: 'Investment proofs (80C)',
        filenameHints: ['80c', 'investment', 'lic', 'ppf', 'elss'],
      },
    ],
  },
  {
    service: FirmService.GST_FILING,
    purpose: 'GST filing',
    items: [
      {
        key: 'sales_register',
        label: 'Sales register',
        filenameHints: ['sales', 'outward', 'invoice register'],
        documentTypes: [DocumentType.SALES_INVOICE],
      },
      {
        key: 'purchase_bills',
        label: 'Purchase bills',
        filenameHints: ['purchase', 'inward', 'bill'],
        documentTypes: [DocumentType.PURCHASE_INVOICE],
      },
      {
        key: 'bank_statement',
        label: 'Bank statement',
        filenameHints: ['bank', 'statement', 'passbook'],
        documentTypes: [DocumentType.BANK_STATEMENT],
      },
    ],
  },
  {
    service: FirmService.TDS,
    purpose: 'TDS return',
    items: [
      { key: 'challans', label: 'TDS challans', filenameHints: ['challan', 'itns'] },
      { key: 'deductee_details', label: 'Deductee details', filenameHints: ['deductee', 'deduction'] },
      {
        key: 'salary_register',
        label: 'Salary register',
        filenameHints: ['salary', 'payroll', 'wages'],
      },
    ],
  },
  {
    service: FirmService.ROC_MCA,
    purpose: 'ROC annual filing',
    items: [
      {
        key: 'financial_statements',
        label: 'Financial statements',
        filenameHints: ['balance sheet', 'p&l', 'profit', 'financial'],
      },
      { key: 'board_resolution', label: 'Board resolution', filenameHints: ['resolution', 'board'] },
      { key: 'agm_minutes', label: 'AGM minutes', filenameHints: ['agm', 'minutes'] },
    ],
  },
  {
    service: FirmService.AUDIT,
    purpose: 'Statutory audit',
    items: [
      { key: 'trial_balance', label: 'Trial balance', filenameHints: ['trial balance', 'tb'] },
      { key: 'ledgers', label: 'Ledgers', filenameHints: ['ledger'] },
      {
        key: 'bank_statement',
        label: 'Bank statements',
        filenameHints: ['bank', 'statement'],
        documentTypes: [DocumentType.BANK_STATEMENT],
      },
      { key: 'fixed_asset_register', label: 'Fixed asset register', filenameHints: ['asset', 'far'] },
    ],
  },
  {
    service: FirmService.BOOKKEEPING,
    purpose: 'Bookkeeping',
    items: [
      {
        key: 'bank_statement',
        label: 'Bank statement',
        filenameHints: ['bank', 'statement', 'passbook'],
        documentTypes: [DocumentType.BANK_STATEMENT],
      },
      {
        key: 'purchase_bills',
        label: 'Purchase bills',
        filenameHints: ['purchase', 'bill'],
        documentTypes: [DocumentType.PURCHASE_INVOICE],
      },
      {
        key: 'sales_bills',
        label: 'Sales bills',
        filenameHints: ['sales', 'invoice'],
        documentTypes: [DocumentType.SALES_INVOICE],
      },
      { key: 'expense_vouchers', label: 'Expense vouchers', filenameHints: ['expense', 'voucher'] },
    ],
  },
];

export function templateForService(service: FirmService): ChecklistTemplate | undefined {
  return CHECKLIST_TEMPLATES.find((t) => t.service === service);
}

/**
 * Best-effort guess at which checklist item an uploaded file satisfies.
 *
 * Returns the item key, or null when nothing matches confidently. An extracted
 * document type is trusted over a filename, because a filename is whatever the
 * client happened to call it.
 *
 * A match only ever proposes RECEIVED — never VERIFIED. Guessing wrong is
 * cheap when a human still confirms, and expensive if it silently closed out a
 * document the firm never actually got.
 */
export function matchDocumentToItem(
  candidates: ChecklistTemplateItem[],
  fileName: string,
  documentType?: DocumentType | null,
): string | null {
  if (documentType) {
    const byType = candidates.find((i) => i.documentTypes?.includes(documentType));
    if (byType) return byType.key;
  }

  const name = fileName.toLowerCase();
  // Longest hint first, so "bank statement" beats a bare "bank".
  let best: { key: string; length: number } | null = null;
  for (const item of candidates) {
    for (const hint of item.filenameHints) {
      if (name.includes(hint) && (!best || hint.length > best.length)) {
        best = { key: item.key, length: hint.length };
      }
    }
  }

  return best?.key ?? null;
}
