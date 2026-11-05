# Navigation and pages: the plan

Restructure the web app into grouped navigation with one page per module, and replace pop-up dialogs with full pages in the content area. Every module listed below must exist and work against the API.

## Rules for every page

- **One page per list, per form, per record.** A list at `/area/module`, a form at `/area/module/new` (and `/area/module/[id]/edit` where editing exists), a record at `/area/module/[id]`. No create or edit dialogs; small confirmations (reverse, delete, cancel) may stay as confirm dialogs.
- **Use the shared layout** in `apps/web/src/components/page/`: `PageHeader` (title, subtitle, actions, back link), `FormPage` (sections and a sticky footer with the action buttons), `Section`, `EmptyState`, `ListToolbar`. Lists are tables with search and status filters.
- **Design system:** button labels are the action verb (**Save invoice**, **Record payment**, **Post to ledger**); toasts mirror them. Amber = waiting or AI-suggested, green = posted, red = errors only. Money in `font-mono`. Fonts and tokens as in `docs/AI_ACCOUNTING_DESIGN_SYSTEM.md`.
- **Invariants hold** (`CLAUDE.md`): integer paise, drafts until **Post to ledger**, AI writes only proposals, approval policies still apply, every change audited, nothing edits a posted journal.
- **Old routes redirect** to the new ones so no link breaks.

## Navigation

| Group | Item | Route |
|---|---|---|
| | Home | `/dashboard` |
| | Inbox | `/inbox` |
| | Review | `/review` |
| | Approvals | `/approvals` |
| Items | Items | `/items` |
| | Stock | `/stock` |
| Sales | Customers (+ new) | `/sales/customers` |
| | Quotes | `/sales/quotes` |
| | Sales Orders | `/sales/orders` |
| | Invoices | `/sales/invoices` |
| | Recurring Invoices | `/sales/recurring-invoices` |
| | Delivery Challans | `/sales/challans` |
| | Payments Received | `/sales/payments-received` |
| | Credit Notes | `/sales/credit-notes` |
| Purchases | Vendors (+ new) | `/purchases/vendors` |
| | Expenses | `/purchases/expenses` |
| | Recurring Expenses | `/purchases/recurring-expenses` |
| | Purchase Orders | `/purchases/orders` |
| | Bills | `/purchases/bills` |
| | Recurring Bills | `/purchases/recurring-bills` |
| | Payments Made | `/purchases/payments-made` |
| | Payment Runs | `/purchases/payment-runs` |
| | Vendor Credits | `/purchases/vendor-credits` |
| | Employee Claims | `/purchases/claims` |
| Time Tracking | Projects | `/time/projects` |
| | Timesheet | `/time/timesheet` |
| | Banking | `/banking` |
| Accountant | Manual Journals | `/accountant/manual-journals` |
| | Bulk Update | `/accountant/bulk-update` |
| | Currency Adjustments | `/accountant/currency-adjustments` |
| | Chart of Accounts | `/accountant/chart-of-accounts` |
| | Budgets | `/accountant/budgets` |
| | Transaction Locking | `/accountant/transaction-locking` |
| | Month-end | `/month-end` |
| | Opening Balances | `/migration` |
| | All Vouchers | `/vouchers` |
| | Foreign Currency | `/currency` |
| Taxes | GST | `/gst` |
| | TDS | `/tds` |
| Reports | Reports | `/reports` |
| | Management Reports | `/reports/management` |
| | Insights | `/insights` |
| | Audit Trail | `/audit` |
| | Documents | `/documents` |
| Practice (firms) | unchanged | `/crm/...`, `/firm-portal` |

Redirects: `/sales` → `/sales/invoices`, `/purchase` → `/purchases/bills`, `/orders` → `/sales/quotes`, `/recurring` → `/sales/recurring-invoices`, `/expenses` → `/purchases/claims`, `/projects` → `/time/projects`, `/accounts` → `/accountant/chart-of-accounts`, `/closing` → `/accountant/transaction-locking`.

## Workstreams

### A. Sales (`apps/web/src/app/(app)/sales/**`, `components/sales/**`)
- **Customers:** list (search, what each owes), new, edit, record page (details, what they owe, their invoices, portal link, attachments, history).
- **Quotes, Sales Orders, Delivery Challans:** list, new, record pages with their actions (send, accept, make order or invoice, invoice part of an order, return a challan, PDF). Move from the tabs on `/orders`; keep **Draft from a message**.
- **Invoices:** list (status filters, receivables ageing as a strip), new as a **multi-line** form (item, description, HSN/SAC, qty, rate, GST %, project per line; currency: INR, or a foreign currency for an export under LUT through `/currency/invoices`), record page (post, mark paid, credit note, PDF, email, payment link, e-invoice and e-way bill, receipts, history).
- **Recurring Invoices:** list and new, from the invoice side of `/recurring` (reminder settings move here as a section).
- **Payments Received:** list of receipts; new receipt page (one payment across many invoices, AI allocation, TDS, advances; a foreign invoice uses `/currency/invoices/:id/receive`); advances and refunds.
- **Credit Notes:** list; new from an invoice (pick the invoice, or `?invoiceId=`).
- **API:** `POST /sales/invoices/from-lines`: customer, dates, number, lines (itemId, description, hsnSac, qty, ratePaise, taxRatePct, projectId, uqc), notes. Prices on the server with `docAmounts` and the customer's state, and creates a draft. Integration test.

### B. Purchases and expenses (`app/(app)/purchases/**`, `components/purchases/**`, new API module `apps/api/src/direct-expenses/`)
- **Vendors:** list, new, edit, record page (bank details, MSME, TDS section, bills, what you owe).
- **Bills:** list (due, MSME pay-by), new multi-line form (currency: INR, or foreign via `/currency/bills`), record page (post, pay, debit note, PO match, attachments, history).
- **Purchase Orders:** list, new, record page (send, receive goods, bill).
- **Recurring Bills:** list and new, from the bill side of `/recurring`.
- **Payments Made:** list; new payment page (one payment across many bills; a foreign bill uses `/currency/bills/:id/pay`). **Payment Runs:** its own page.
- **Vendor Credits:** list of debit notes; new from a bill.
- **Employee Claims:** the expense-claims page, moved.
- **Expenses (new):** money paid straight from bank or cash, not through a bill. Collection `expenses`: number, date, vendor (optional), expense account, paid through (a bank or cash account), amount before tax, GST rate, inter-state, claimable or not, reference, notes, project, status draft or posted, journal. Posting is a PAYMENT voucher: Dr expense (and input GST when claimable) / Cr paid-through account, through `PostingService` and the payment approval policy. List, new, record page, **Post to ledger**. Tests.
- **Recurring Expenses (new):** a recurring template of kind `expense` that drafts an expense on its date, for a person to post. List and new.
- **API:** `POST /purchase/bills/from-lines`, as for invoices. Integration tests.

### C. Accountant, time and documents (`app/(app)/accountant/**`, `app/(app)/time/**`, `app/(app)/documents/**`)
- **Manual Journals:** list of journal vouchers; new journal page (date, lines with account, debit, credit, project, narration; must balance) through `POST /journals`, approval policy applies.
- **Bulk Update (new):** pick an account, dates and optional text, and see the matching posted lines. Choose the account to move them to, then **Propose reclassification**: one `reclass` adjustment in the review queue moving the total. Posted journals are never edited. API: preview and propose endpoints. Tests.
- **Currency Adjustments:** exchange rates and month-end revaluation, from `/currency`.
- **Chart of Accounts:** moved from `/accounts`. **Budgets:** moved from the management reports tab. **Transaction Locking:** moved from `/closing` (lock, checklist, year-end close).
- **Projects:** list, new, record page (unbilled time, **Draft invoice from time**, time list). **Timesheet:** everyone's time, filters, **Log time**, a person's own entries editable while unbilled.
- **Documents:** every uploaded document and attachment, searchable, filtered by type and status, each opening its file and its record.

## Done when

- Every route above renders, loads real data, and its actions work against the API.
- No create or edit dialogs remain on these modules.
- `tsc` passes for both apps; new API code has integration tests against the replica set; the full API suite passes.
- The user guide and diagrams name the new routes.
