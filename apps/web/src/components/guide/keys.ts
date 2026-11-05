/**
 * Every section that has a guide, and the content file it lives in. The
 * content is loaded only when a guide is opened, one area at a time, so the
 * text of fifty-odd guides in two languages does not ride along on every page.
 */
export const GUIDE_AREAS = {
  // Top of the sidebar
  home: 'home',
  inbox: 'core',
  review: 'core',
  approvals: 'core',
  // Items
  items: 'core',
  stock: 'core',
  // Sales
  customers: 'sales',
  quotes: 'sales',
  salesOrders: 'sales',
  invoices: 'sales',
  recurringInvoices: 'sales',
  challans: 'sales',
  paymentsReceived: 'sales',
  creditNotes: 'sales',
  // Purchases
  vendors: 'purchases',
  expenses: 'purchases',
  recurringExpenses: 'purchases',
  purchaseOrders: 'purchases',
  bills: 'purchases',
  recurringBills: 'purchases',
  paymentsMade: 'purchases',
  paymentRuns: 'purchases',
  vendorCredits: 'purchases',
  claims: 'purchases',
  // Time tracking, banking, taxes
  projects: 'books',
  timesheet: 'books',
  banking: 'books',
  gst: 'books',
  tds: 'books',
  // Accountant
  manualJournals: 'accountant',
  bulkUpdate: 'accountant',
  currencyAdjustments: 'accountant',
  chartOfAccounts: 'accountant',
  budgets: 'accountant',
  transactionLocking: 'accountant',
  monthEnd: 'accountant',
  openingBalances: 'accountant',
  vouchers: 'accountant',
  foreignCurrency: 'accountant',
  // Reports, documents, settings
  reports: 'reports',
  managementReports: 'reports',
  insights: 'reports',
  audit: 'reports',
  documents: 'reports',
  settings: 'reports',
  // Practice (CA firms)
  practiceHome: 'practice',
  practiceClients: 'practice',
  compliance: 'practice',
  documentHub: 'practice',
  tasks: 'practice',
  leads: 'practice',
  fees: 'practice',
  supportAgent: 'practice',
  messaging: 'practice',
  practiceReports: 'practice',
  firmBranding: 'practice',
} as const;

export type GuideKey = keyof typeof GUIDE_AREAS;
export type GuideArea = (typeof GUIDE_AREAS)[GuideKey];

/** The keys whose content lives in one area's file. */
export type AreaKeys<A extends GuideArea> = {
  [K in GuideKey]: (typeof GUIDE_AREAS)[K] extends A ? K : never;
}[GuideKey];
