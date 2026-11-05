/** A voucher as GET /journals and GET /journals/:id return it. */
export interface JournalItem {
  _id: string;
  voucherNumber: string;
  /** Lower case: journal, purchase, sales, payment, receipt, contra, credit_note, debit_note. */
  voucherType: string;
  date: string;
  description: string;
  totalDebitPaise: number;
  totalCreditPaise: number;
  /** "posted", or "reversed" once a contra entry cancels it. */
  status: string;
  financialYear: string;
  /** The voucher number of the reversal that cancels this one. */
  reversedBy?: string;
  lines: Array<{ accountId: string; accountName: string; description: string; debitPaise: number; creditPaise: number; projectId?: string | null }>;
}

export const VOUCHER_TYPE_LABELS: Record<string, string> = {
  journal: 'Journal',
  purchase: 'Purchase',
  sales: 'Sales',
  payment: 'Payment',
  receipt: 'Receipt',
  contra: 'Contra',
  credit_note: 'Credit note',
  debit_note: 'Debit note',
};
