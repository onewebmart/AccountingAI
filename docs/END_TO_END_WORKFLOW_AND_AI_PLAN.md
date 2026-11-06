# End-to-end accounting workflow: where we stand, and how AI fills the gaps

> **As of:** 3 November 2026, branch `feat/books-automation` (commit `c10bf6e`).
> **Benchmark:** the 20 functional sections and the 11-step lifecycle of a complete SME accounting product (Zoho Books), as set out in the brief this plan answers.

This document does three things:

1. Checks every section of a complete accounting product against what this platform does today, and points to the code that does it.
2. For each gap, says how to build it without breaking the eight invariants in `CLAUDE.md`.
3. Says where AI genuinely helps, and where it adds nothing.

It is a plan, not a spec. Each phase in §7 should get its own build plan before work starts.

**Status:** ✅ built and tested · 🟡 partly built · ❌ not built
**Relative size:** S = a few days · M = one to two weeks · L = several weeks

---

## Contents

1. [The scorecard](#1-the-scorecard)
2. [The lifecycle, step by step](#2-the-lifecycle-step-by-step)
3. [How a sale and a purchase post today](#3-how-a-sale-and-a-purchase-post-today)
4. [Section by section](#4-section-by-section)
5. [The AI layer](#5-the-ai-layer)
6. [Data model additions](#6-data-model-additions)
7. [Build order](#7-build-order)
8. [Outside services we will need](#8-outside-services-we-will-need)
9. [Checklist for every new module](#9-checklist-for-every-new-module)
10. [Deliberately left out](#10-deliberately-left-out)

---

## 1. The scorecard

| # | Section | Status | What we have | Biggest gaps |
|---|---|---|---|---|
| 1 | Dashboard | ✅ | KPIs, AI insight cards, 13-week cash forecast, profit outlook | Receivables and payables tiles, a "needs you" list |
| 2 | Organization setup | 🟡 | Onboarding, GSTIN, PAN, state, financial-year start, timezone, firm branding | Invoice template and PDF, number prefixes, default payment terms, more than one GSTIN |
| 3 | Users & roles | ✅ | Seven roles, permission guard, team invites, Google login, TOTP 2FA | Approval limits per user, custom roles |
| 4 | Chart of accounts | 🟡 | Default Indian SME chart with groups; add accounts | Rename, move, deactivate accounts |
| 5 | Opening balances | 🟡 | Import from Tally, Zoho Books or QuickBooks: preview, one balanced opening journal, opening documents per party | Enter balances by hand; the opening-balance field on customers and vendors is stored but never posted; opening stock |
| 6 | Items & inventory | ❌ | Invoice and bill lines carry description, HSN/SAC, quantity, rate and tax rate | Item master, stock, valuation |
| 7 | Customers | 🟡 | Create, view, receivable, AR ageing, GSTIN check-digit validation | Edit a customer, contacts and addresses, credit limits, customer statements |
| 8 | Vendors | ✅ | Create, edit, outstanding, AP ageing, PAN, TDS section | Bank details, MSME status for section 43B(h) |
| 9 | Sales | 🟡 | Invoices, credit notes, part payments, recurring invoices, reminders, gapless numbers | Quotes, sales orders, delivery challans, refunds, invoice PDF and delivery. **"Send invoice" only marks it sent; nothing reaches the customer** |
| 10 | Purchases | 🟡 | Bills typed or scanned, debit notes, TDS, reverse charge, recurring bills, GSTR-2B reconciliation | Purchase orders, goods received notes, 3-way match, bill approval |
| 11 | Expenses | 🟡 | Receipt scanned → categorised → review → payment voucher; bank-line categorisation | Employee expense claims, reimbursement, mileage, expense policy, petty cash |
| 12 | Banking | ✅ | Statements as CSV, Excel or PDF; auto-match; settle invoices and bills from the bank; categorise unmatched lines; bank feeds (test aggregator) | A real Account Aggregator, a transfer screen, a bank-rules screen, cheques |
| 13 | Payments | 🟡 | Full or part payment on an invoice or bill, from the page or a bank line, with TDS | Advances, one receipt across many invoices, vendor payment runs, refunds, payment links |
| 14 | Accountant | 🟡 | Manual vouchers of every type, reversals that reopen linked documents, period lock, year close | Recurring journals, fixed assets and depreciation, accruals and prepaids |
| 15 | GST & taxation | 🟡 | GSTR-1, GSTR-3B with set-off, portal JSON, registers, GSTR-2B reconciliation, ITC summary; TDS payable, deposits and receivable in the API | Filing through a GSP, GSTR-9, ITC rules, TDS returns and TDS screens |
| 16 | E-invoice & e-way bill | ❌ | — | IRN and signed QR through the IRP; e-way bills |
| 17 | Projects & timesheets | ❌ | (CRM tasks cover the CA firm's own work, not client books) | Projects, cost tagging, timesheets, billing time |
| 18 | Approvals & automation | 🟡 | Every AI entry waits in the review queue; recurring drafts; reminders; daily jobs; CRM compliance chasers | Approval rules for documents people enter, maker-checker, custom automations |
| 19 | Documents & integrations | 🟡 | Upload pipeline with OCR tiers; inbox; CRM document hub; Tally export and import; messaging (test provider) | Email and WhatsApp capture, payment gateway, real message sending, attachments on any record |
| 20 | Reports & audit | 🟡 | TB, P&L, balance sheet, cash flow, ledger, day book, GST registers, ageing, CSV and Excel export; an audit entry on every change | An audit-trail screen for the org, sales/purchase/expense reports, comparisons, budgets |

From the brief's list of other features:

| Feature | Status | Note |
|---|---|---|
| Recurring transactions | ✅ | Bills and invoices, drafted for a person to post. Journals are not covered yet. |
| Payment reminders | ✅ | Built, but sent through a test provider until a WhatsApp or email provider is connected. |
| Partial payments | ✅ | |
| Credit notes / vendor credits | ✅ | Credit notes and debit notes. A refund of money already paid is refused today. |
| Document management | ✅ | |
| Transaction approval | 🟡 | AI entries only. |
| Audit trail | 🟡 | Every change is recorded; only the platform admin can read it. |
| Multi-currency | ❌ | Settings hold a currency code, but every amount is INR. |
| Customer portal | ❌ | The firm portal serves CA firms' clients. An SME's own customers cannot view or pay invoices. |
| Project accounting | ❌ | |

**Where we are already ahead:** the AI core (upload → OCR → extraction → proposal → approve) goes further than a conventional product:

- Every account suggestion comes with its reason.
- PDF statements are checked against their running balances before they are imported.
- Forecasts are worked out from the books.
- GSTR-2B is reconciled against the purchase register.
- CA firms get a CRM for their practice.

Throughout, the ledger is append-only and every entry balances.

---

## 2. The lifecycle, step by step

### Step 1 — Organization onboarding
- **Today:** sign up with email or Google. `/onboarding` takes the name, GSTIN and state; `/settings` holds PAN, timezone and financial-year start (`apps/api/src/org-settings`).
- **Missing:** business type, so the chart and GST defaults can fit the business; GSTIN lookup to prefill the legal name and address (a GSP lookup, not AI).
- **AI:** describe the business in a sentence → suggested extra accounts, likely GST rates, and the TDS sections to watch, shown as suggestions to accept or skip.

### Step 2 — Initial configuration
- **Today:** the default chart is seeded (`apps/api/src/gl/accounts.service.ts`). Roles and team invites work. The financial-year start month is set.
- **Missing:**
  - an invoice template and PDF;
  - number prefixes per voucher type;
  - default payment terms;
  - a list of tax rates (rates are typed on each line today).
- **AI:** not needed here.

### Step 3 — Opening balances and master data
- **Today:** `/migration` imports masters and balances from Tally XML or the CSV/Excel exports of Zoho Books and QuickBooks (`apps/api/src/migration`).
- **Missing:**
  - entering balances by hand;
  - posting the opening balance typed on a customer or vendor (stored today and read by nothing);
  - items and opening stock.
- **AI:** read a trial balance from a PDF or photo into the same preview. As with PDF statements, it is refused if it doesn't balance.

### Step 4 — Sales
- **Today:** invoice → post (gapless number) → payment from the page or a matched bank line → settled. Reminders go 3 days before the due date, on the due date, and 7, 15 and 30 days late. Credit notes work. Recurring invoices are drafted on schedule.
- **Missing:**
  - quote → sales order → invoice;
  - an invoice PDF delivered by email or WhatsApp;
  - a payment link;
  - refunds;
  - delivery challans.
- **AI:** draft a quote from a customer's message; predict each invoice's payment date; rank whom to chase first.

### Step 5 — Purchases
- **Today:** a bill is typed or scanned → review → post → pay from the page or the bank. TDS and reverse charge work, and GSTR-2B is reconciled.
- **Missing:** purchase request → purchase order → goods received note → bill matched to both → approval → payment run.
- **AI:** 3-way match with the differences explained; duplicate and fraud checks on bills; price-variance alerts.

### Step 6 — Expenses
- **Today:** a receipt is uploaded → extracted → categorised → reviewed → posted as a payment voucher.
- **Missing:** employee claims, approval, reimbursement, mileage, policy.
- **AI:** policy checks; flag GST that is likely blocked under section 17(5).

### Step 7 — Banking
- **Today:**
  - statements from CSV, Excel or PDF, or bank feeds;
  - auto-match;
  - a matched line settles its invoice or bill;
  - unmatched lines go to the review queue with a suggested account;
  - duplicates are caught.
- **Missing:** a real Account Aggregator; a transfer screen (a manual contra voucher works today); a bank-rules screen.
- **AI:** detect transfers between our own accounts and propose the contra entry.

### Step 8 — Accounting entries
- **Today:** every document posts its own balanced journal through `PostingService.post()`. Manual vouchers and reversals work.
- **Missing:** recurring journals, depreciation, accruals, prepaids.
- **AI:** a month-end assistant that proposes the adjusting entries into the review queue.

### Step 9 — GST and tax compliance
- **Today:** GSTR-2B reconciliation, GSTR-1 and GSTR-3B with set-off, and portal JSON downloads (`apps/api/src/gst`).
- **Missing:** filing through a GSP; GSTR-9; e-invoice and e-way bill; TDS returns.
- **AI:** explain each 2B mismatch and draft the message to the vendor; review the return before it is filed.

### Step 10 — Financial reporting
- **Today:** trial balance, P&L, balance sheet, cash flow, ledger, day book, GST registers and ageing, with CSV and Excel export (`apps/api/src/reports`, `apps/api/src/exports`).
- **Missing:** management reports, period comparisons, budgets, an audit-trail screen.
- **AI:** a monthly narrative; "Ask your books".

### Step 11 — Financial year closing
- **Today:** a closing checklist, period lock, year close into retained earnings, and reopen (`apps/api/src/closing`).
- **Missing:** the closing-stock entry (once items exist); a depreciation run before close.
- **AI:** a close-readiness review that lists what is still open and proposes fixes.

---

## 3. How a sale and a purchase post today

**A sale of ₹10,000 plus 18% GST, within the state:**

| Ledger | Debit | Credit |
|---|---|---|
| Accounts Receivable | ₹11,800 | |
| Sales | | ₹10,000 |
| Output CGST | | ₹900 |
| Output SGST | | ₹900 |

A sale to another state credits **Output IGST ₹1,800** instead of CGST and SGST.

**The customer pays:** Bank Dr ₹11,800, Accounts Receivable Cr ₹11,800.

If the customer withholds TDS (₹1,000 at 10% under section 194J, say):

| Ledger | Debit | Credit |
|---|---|---|
| Bank | ₹10,800 | |
| TDS Receivable | ₹1,000 | |
| Accounts Receivable | | ₹11,800 |

**A purchase of ₹20,000 plus 18% GST, within the state, with 1% TDS under section 194C:**

| Ledger | Debit | Credit |
|---|---|---|
| Purchases, or the account the categoriser picked | ₹20,000 | |
| Input CGST | ₹1,800 | |
| Input SGST | ₹1,800 | |
| Accounts Payable | | ₹23,400 |
| TDS Payable | | ₹200 |

TDS is worked out on the taxable value, not on the GST. Paying the vendor is Accounts Payable Dr ₹23,400, Bank Cr ₹23,400.

**Reverse charge:** the vendor is owed only the taxable value. The GST is credited to RCM GST Payable, and the input credit is debited where it is eligible.

Every one of these is a single journal, balanced, gapless-numbered and append-only. A correction is a reversal that also reopens whatever pointed at the journal (`apps/api/src/journals/journal-reversal.service.ts`).

---

## 4. Section by section

### 4.1 Dashboard ✅
- **Have:** `/dashboard` (income, expenses, cash on hand, GST due, cash forecast card) and `/insights` (expense spikes, cash warnings, overdue bills, GST due, health score, 13-week forecast, profit outlook). Code: `apps/api/src/insights`, `ReportsService.getDashboardSummary`.
- **Add:**
  - tiles for receivables and payables due this week;
  - top overdue customers;
  - balance per bank account;
  - a "needs you" list: review queue, unmatched bank lines, returns due.
- **AI:** anomaly cards, such as a vendor billing twice in a week or an expense three times its usual, each linking to the record; an "Ask your books" box (§5.3).

### 4.2 Organization setup 🟡
- **Have:** org settings (name, GSTIN, PAN, state, timezone, currency code, financial-year start, Tally company name, branding, client-portal flag); `/onboarding`; `/settings`.
- **Add:**
  - **Invoice template and PDF:** logo, address, bank details, UPI QR, terms, signature. Rendered in a job, not in the request.
  - **Number series per voucher type with a prefix**, keeping the gapless counter inside the posting transaction (Invariant 7).
  - **Default payment terms**, for customers and vendors.
  - **More than one GSTIN.** GST registration is per state. The simplest model is one org per GSTIN, each with its own number series and returns, grouped under one business in the workspace.
  - **Business type**, at onboarding.
- **AI:** suggestions from a one-line business description. Nothing changes until a person accepts.

### 4.3 Users & roles ✅
- **Have:**
  - seven roles: platform super admin, firm admin, company admin, accountant, CA reviewer, employee, auditor;
  - the `Permission` enum and `PermissionGuard`;
  - team invites in settings;
  - Google login and TOTP;
  - impersonation flagged in the audit log.
- **Add:** approval limits per user (needed for §4.18); employee self-service for expense claims (§4.11); custom roles later.
- **AI:** not needed.

### 4.4 Chart of accounts 🟡
- **Have:** the default chart (1xxx assets to 6xxx expenses) with groups and system keys; `GET`/`POST /gl/accounts`.
- **Add:** rename, recode, move under another group, deactivate. Refuse all of these for system accounts. A deactivated account is hidden from pickers but keeps its history. Audit every change.
- **AI:** when the categoriser keeps falling back to Purchases or Suspense for the same kind of spend, suggest a new account: "12 bills from software vendors went to Purchases this quarter. Add *Software subscriptions*?"

### 4.5 Opening balances 🟡
- **Have:** `/migration`: Tally XML, CSV or Excel trial balances, charts and contacts. Preview → one balanced opening journal → an opening invoice or bill per party. These are left out of GST returns, and reversing the opening journal removes them.
- **Add:**
  - **"Enter opening balances" screen:** a trial-balance grid over the chart plus party-wise receivables and payables, committed through the same `planOpening` and commit path, so there is one code path.
  - **Fix the trap:** `openingBalancePaise` on customers and vendors is stored and read by nothing. Either post it through the screen above or remove the field.
  - **Bank account opening balances**, through the same screen.
  - **Opening stock**, once items exist (§4.6).
- **AI:** a photo or PDF of a trial balance → OCR → the same preview. It must balance, or it is refused with the difference.

### 4.6 Items & inventory ❌
The build spec (§15) deferred inventory on purpose. Invoice and bill lines already carry description, HSN/SAC, quantity, rate and tax rate, so items can be added in two steps.

**Step 1 — Item master, no stock (M).**
- Fields: name, goods or service, HSN/SAC, unit (UQC, which the GSTR-1 HSN summary needs), GST rate, sale price, purchase price, income account and expense account.
- A line can pick an item, and the HSN, rate and accounts fill in.
- The GSTR-1 HSN summary groups by item.

**Step 2 — Stock (L).**
- A `stock_moves` collection: item, quantity in or out, rate, source document, date, and later warehouse.
- Moves come from posted bills (in), invoices (out), credit and debit notes, and adjustments.
- Weighted-average valuation; stock summary and item ledger reports.

**The accounting choice: periodic first.** Purchases stay expensed as today. Closing stock is booked by one period-end journal (Closing Stock Dr, Change in Inventory Cr), proposed into the review queue. Reasons:
- It matches how most Indian SMEs keep stock in Tally.
- Posting rules stay as they are.
- It is a single entry a person can check.

Perpetual inventory (stock as an asset on purchase, cost of goods sold on each sale) can come later if customers need live COGS.

**AI:**
- suggest HSN/SAC and the GST rate from the item description (rules table first, then the model, with the reason);
- map each scanned bill line to an item by name similarity and vendor history, and propose a new item when nothing matches;
- reorder suggestions from sales velocity;
- alert when a purchase price moves away from the last one.

### 4.7 Customers 🟡
- **Have:** create, list, view, receivable, AR ageing, GSTIN check digit, state for place of supply (`apps/api/src/sales`).
- **Add:**
  - `PATCH` a customer, audited. A change of GSTIN or state never alters posted invoices.
  - Contacts, plus billing and shipping addresses. The shipping state decides place of supply for goods.
  - A credit limit, with a warning on the invoice.
  - A customer statement (opening, invoices, receipts, closing) as a PDF to send.
- **AI:** show the customer's usual lateness (already worked out for the forecast by `typicalDelayDays`) on their page; flag a likely duplicate customer (same GSTIN, or a near-identical name) on create and on import.

### 4.8 Vendors ✅
- **Have:** create, edit, outstanding, AP ageing, PAN, TDS section and rate (`apps/api/src/purchase`).
- **Add:**
  - **Bank details**, for payment runs, and to compare with the bank details printed on a bill.
  - **MSME status** (Udyam number and category). Under section 43B(h), a payment to a micro or small enterprise made later than 15 days (45 days with a written agreement) is not deductible until paid. Due dates, ageing and payment runs should show it.
- **AI:**
  - suggest the TDS section from what the vendor bills for (contract work → 194C, professional fees → 194J, rent → 194I);
  - when a scanned bill's bank details differ from the vendor master, raise a "this bill asks you to pay a different account" alert. This is the commonest invoice fraud.

### 4.9 Sales 🟡
- **Have:** invoices (create, send, post, pay), credit notes, recurring invoices, reminders, gapless numbers on posting, data for GSTR-1.
- **Gap to fix first:** `SalesInvoicesService.send()` only sets the status to `sent`. No PDF is produced and nothing reaches the customer.
- **Add:**
  - **Invoice PDF and delivery:** the template from §4.2, sent by email or WhatsApp through the messaging provider (a test provider today), with a payment link (§4.13).
  - **Quotes:** draft → sent → accepted, declined or expired; convert to a sales order or an invoice. Quotes never touch journals.
  - **Sales orders:** from an accepted quote or entered directly; track ordered against invoiced quantity; convert to one or more invoices.
  - **Delivery challans:** goods sent without an invoice (job work, goods on approval).
  - **Refunds:** today a credit note on a paid invoice is refused. Add a credit note plus a refund payment (Accounts Receivable Dr, Bank Cr), so the customer's balance stays right.
- **AI:**
  - draft a quote from a customer's email or WhatsApp ("200 cartons of X by Friday"), with items, quantities and last prices; a person sends it;
  - suggest prices from this customer's history;
  - draft a follow-up on quotes with no answer after N days;
  - show a predicted payment date on each invoice.

### 4.10 Purchases 🟡
- **Have:** bills typed or scanned via the review queue, debit notes, TDS, reverse charge, recurring bills, AP ageing, GSTR-2B reconciliation.
- **Add**, in order:
  1. **Purchase orders:** never posted; sent to the vendor as a PDF.
  2. **Goods received notes:** quantity received against PO lines; not posted under periodic inventory.
  3. **Bill matched to its PO and GRN** (3-way match).
  4. **Approval** (§4.18).
  5. **Payment run** (§4.13).

  Purchase requests are optional and can stay light.
- **AI:**
  - when a scanned bill arrives, find its PO and GRN and show the 3-way match, with each difference in words ("billed 120, received 100", "rate ₹5 above the PO");
  - duplicate-bill checks before the review queue: same vendor and bill number, or same amount within a few days. Today only an identical file is caught;
  - alert when the price differs from the last purchase.

### 4.11 Expenses 🟡
- **Have:** receipt → extraction → categoriser → review → payment voucher; bank-line categorisation; an employee role.
- **Add:**
  - **Expense claims:**
    1. An employee photographs receipts on a phone, groups them into a claim and submits it.
    2. A manager approves the claim.
    3. An accountant posts it: expense Dr, input GST Dr where eligible, Employee Reimbursements Payable Cr.
    4. The reimbursement payment clears it.
  - **Mileage** (rate × km), **petty cash** with its own register, and an **expense policy** (limits per category; a receipt required above ₹X).
- **AI:**
  - receipt reading and categorisation already exist; reuse them;
  - check each line against the policy: over the limit, on a weekend, or the same receipt claimed twice;
  - **blocked ITC under section 17(5):** food and beverages, motor vehicles for personal use, club memberships, personal consumption and the like. Flag that "the GST on this receipt is likely not claimable", and propose posting it to the expense rather than to input GST. Rules first, the model for unclear cases.

### 4.12 Banking ✅
- **Have:**
  - accounts and statements (CSV, Excel and PDF, the PDF checked against its running balance);
  - auto-match and manual match, confirm, exclude, duplicates;
  - settling invoices and bills from bank lines;
  - categorising unmatched lines into the review queue;
  - bank feeds through `BankFeedProvider`, with a test aggregator (`apps/api/src/banking`, `apps/api/src/bank-feeds`).
- **Add:**
  - **A real Account Aggregator adapter** (Setu, Finvu, OneMoney or another licensed AA): FIU onboarding, consent artefacts, and the framework's encryption. It replaces `MockAccountAggregator` in `BankFeedsModule`; nothing else changes.
  - **A transfer screen** between our own accounts, posting a contra voucher.
  - **A bank-rules screen** to see and edit what the learned party→account map and the keyword rules do.
  - **A cheque register** (issued, deposited, cleared, bounced) and a cash register, later.
- **AI:** detect transfers. A debit in one of our accounts and a credit of the same amount in another within two days → propose the contra entry and match both lines. Reading the counterparty from narrations and learning from approvals already exist.

### 4.13 Payments 🟡
- **Have:** a full or part payment on an invoice or bill, dated, from the page or a matched bank line; TDS on receipts.
- **Add:**
  - **Customer advances:** a receipt with no invoice credits *Advances from customers*, a liability, and is applied to an invoice later. GST is due when an advance is received for services; advances for goods have been exempt since November 2017. Have the CA reviewer confirm this, and issue a receipt voucher. Vendor advances mirror it.
  - **One receipt across many invoices:** an allocation screen, oldest invoice first by default, part-paying the last one. Today payments live inside each invoice (`payments[]`). Add a `payments` document that holds the one receipt voucher, with allocations to invoices, and keep the embedded entries as the allocations so existing reports keep working.
  - **Refunds** (§4.9).
  - **Vendor payment runs:**
    1. Choose the bills due, MSME first (§4.8).
    2. Produce the bank's bulk-payment file.
    3. Mark each bill paid when its bank line is confirmed.
  - **Payment links:** Razorpay (settings already hold a key ID; the secret must come from config, never the database). Show the link on the invoice PDF and in reminders. A gateway confirmation creates a receipt matched to the invoice, waiting for confirmation, like a matched bank line. It posts when a person confirms it, or when the settlement arrives in the bank feed and is confirmed.
- **AI:**
  - allocate a lump-sum receipt: find the open invoices whose amounts add up to it, and read remittance advice (email or PDF) that lists invoice numbers;
  - suggest a payment run that weighs due dates, MSME limits, early-payment discounts and the cash forecast's low point.

### 4.14 Accountant 🟡
- **Have:** manual vouchers of every type including contra (`/vouchers`); reversals that reopen linked documents; period lock; year close and reopen; closing checklist.
- **Add:**
  - **Recurring journals:** add a `journal` kind to `RecurringTemplate` (today `bill` and `invoice`). It drafts a journal for a person to post.
  - **Fixed asset register:**
    - capitalise from a bill line: cost, date put to use, depreciation method and rate;
    - methods: SLM or WDV per Companies Act Schedule II for the books, and the Income Tax block rates as a separate report;
    - a monthly or yearly depreciation run produces one journal proposal (Depreciation Dr, Accumulated Depreciation Cr);
    - disposals post the gain or loss.
  - **Accruals and prepaids:** a schedule (amount, start, months) drafts each month's journal. An accrual reverses on the 1st of the next month through `PostingService.reverse()`.
  - **Bulk journal import** from CSV, through the same validation.
- **AI:** a **month-end assistant**. Before close, it proposes adjusting entries into the review queue, each with its reason:
  - accrue a recurring bill that hasn't arrived this month (rent, say);
  - spread an annual subscription found in this month's bills;
  - run depreciation;
  - capitalise a bill over a threshold with an asset-like HSN (laptops, 8471) that sits in expenses.

  Nothing posts until a person approves.

### 4.15 GST & taxation 🟡
- **Have:**
  - GSTR-1 and GSTR-3B for a month, with the tax set-off, blocking issues listed, and portal JSON;
  - purchase and sales registers;
  - GSTR-2B import and reconciliation, ITC summary, and creating an entry from a 2B line;
  - TDS payable, deposits and receivable in the API (`apps/api/src/tds`);
  - reverse charge.
- **Add:**
  - **Filing through a GSP:** save GSTR-1 → OTP or EVC → file; GSTR-3B the same; filing status. Filing is irreversible and outward-facing. A person clicks **File GSTR-1** after a confirmation, and it is audited.
  - **GSTR-9** (annual; mandatory above ₹2 crore turnover), built from the year's GSTR-1 and GSTR-3B data.
  - **ITC rules:**
    - blocked credit under section 17(5);
    - reversal of credit on bills unpaid after 180 days (Rule 37);
    - credit only for what appears in GSTR-2B.
  - **GST payment:** the challan amount from the 3B set-off, recorded as a payment voucher.
  - **TDS:**
    - web screens for the existing API;
    - the quarterly 26Q (and 27Q) return file in the Protean (NSDL) format, ready for the FVU utility;
    - Form 16A;
    - TDS receivable reconciled against 26AS/AIS.
- **AI:**
  - explain each 2B mismatch in plain words ("differs by the GST only: likely the wrong rate", "the vendor billed from another registration"), and draft the message to the vendor;
  - a pre-filing review that compares this month's return with past months and flags unusual swings;
  - list bills nearing the 180-day reversal.

### 4.16 E-invoice & e-way bill ❌
- **When it applies:**
  - **E-invoicing:** mandatory once aggregate turnover in any year since 2017-18 exceeds ₹5 crore. It covers B2B invoices, credit and debit notes, and exports. Above ₹10 crore, invoices must be reported within 30 days.
  - **E-way bill:** needed to move goods worth more than ₹50,000. State rules vary.

  Confirm current thresholds before building.
- **Add:**
  - **An `e_invoices` record per invoice:** IRN, acknowledgement number and date, signed QR, status, cancellation.
  - **Flow:**
    1. Post the invoice as today; the gapless number is ours.
    2. Generate the IRN through a GSP. This is an explicit action, or automatic after posting if the org opts in, since it is a deterministic system step and not AI.
    3. If the IRP rejects the invoice, show its errors on the invoice.
  - **QR printed on the invoice PDF.**
  - **Cancellation** within 24 hours goes through the IRP plus a reversal; after that, a credit note.
  - **E-way bill:** Part A from the invoice, Part B with vehicle details; validity, extension, cancellation.
- **AI:**
  - check the invoice before it goes to the IRP (missing pincode, invalid HSN, GSTIN state not matching place of supply) and suggest fixes;
  - reuse the transporter and vehicle from earlier e-way bills.

  Distance comes from a pincode lookup, not AI.

### 4.17 Projects & timesheets ❌
- **Add:**
  - **Projects:** customer, budget, billing method (fixed or time-and-materials), status.
  - **A `projectId` dimension on invoice, bill and journal lines.** Journal lines are embedded; the new optional field is set when the journal is posted and never after, so posted journals stay unchanged.
  - **Timesheets:** user, project, task, hours, billable rate. Unbilled time becomes an invoice draft.
  - **A project P&L report.**

  CRM tasks (`apps/api/src/crm/tasks`) cover the CA firm's own work. Reuse their UI patterns, not their data.
- **AI:** draft an invoice from unbilled time, with line descriptions summarised from the time notes; budget-burn alerts; nudges for missing timesheets.

### 4.18 Approvals & automation 🟡
- **Have:**
  - the review queue for AI proposals, with a person-triggered bulk approve at 0.9 confidence;
  - recurring drafts and payment reminders;
  - daily jobs: the bank-feed pull at 05:30 IST, then the books sweep;
  - CRM compliance chasers.
- **Add:**
  - **Approval policies:** rules on document type, amount, vendor (for example a new vendor) and role → the approvers required, one or two, in order. They apply to bills, expense claims, payments and journals entered by people.
  - **Maker-checker:** whoever created a document cannot approve it.
  - **States:** draft → pending approval → approved → posted. Posting stays an explicit human action; the final approval can be the posting itself (**Approve & post**).
  - **Automation rules, later:** a trigger (invoice 15 days overdue, bill over ₹X) → an action (send a message, create a task, notify). Webhooks for integrations.
- **AI:**
  - **A risk score per document:** new vendor, changed bank details, amount far from usual, looks like a duplicate, weekend receipt. High-risk documents always go to a second approver; low-risk ones still need one person. AI never approves.
  - **Rule drafting in plain words:** "bills over ₹50,000 from new vendors need Priya's approval" becomes a structured rule that a person checks and saves.

### 4.19 Documents & integrations 🟡
- **Have:**
  - the upload pipeline: text PDFs, Word and plain text without OCR, vision OCR for scans, spreadsheets, PDF statements;
  - the inbox and the CRM document hub;
  - Tally export (XML and the connector) and import;
  - bank feeds and messaging, both through test providers.
- **Add**, in order:
  1. **Email-in:** an address per org for bills. Attachments enter the upload pipeline, and the sender is matched to a vendor. The build spec names this the highest-value, lowest-effort addition.
  2. **WhatsApp-in**, through a WhatsApp Business provider. The same provider gives real sending for invoices and reminders.
  3. **Attachments on any record:** invoice, journal, payment. Reuse document storage.
  4. **Payment gateway** (§4.13), **Account Aggregator** (§4.12), **GSP** (§4.15, §4.16).
- **AI:** classify each incoming attachment (bill, receipt, statement or other) with the existing classifier, and drop marketing PDFs. Duplicates of a forwarded file are already caught by the file check.

### 4.20 Reports & audit 🟡
- **Have:** TB, P&L, balance sheet, cash flow, ledger, day book, GST registers, AR and AP ageing, CSV and Excel export, practice reports. `AuditService` records every change; only the platform-admin route can read it.
- **Add:**
  - **An audit-trail screen** for org admins and the existing auditor role: filter by record, user and date; before and after shown; read-only. Plus a *History* tab on each record.
  - **Management reports:** sales by customer, item and month; purchases by vendor; expenses by category; receivables and payables summaries; GST summary.
  - **Comparisons:** this period against the last, and against last year.
  - **Budgets against actuals:** a budget per account per month.
  - **PDF and scheduled email** of any report.
- **AI:**
  - **A monthly narrative:** "Profit fell 18% because freight doubled; three customers are paying later than usual." Every figure comes from a report row; the model only writes the words.
  - **"Ask your books"** (§5.3).

### 4.21 Multi-currency ❌
- **Add:**
  - a currency on customers, vendors, invoices and bills, with the exchange rate on the document;
  - journals post in INR, so Invariant 1 holds in INR paise; the foreign amount is kept alongside in that currency's minor units;
  - realised gain or loss on payment, and unrealised revaluation at period end as a proposal;
  - exports under LUT reported in the GSTR-1 export tables.
- **AI:** not needed. Reference rates come from RBI and are fetched, not guessed.

### 4.22 Customer portal ❌
- **Add:** a signed, expiring link per customer to see their invoices and statement, download PDFs and pay through the link. It is read-only, scoped to that customer and that org, and needs no login. It is separate from the existing firm portal, which serves CA firms' clients.

---

## 5. The AI layer

### 5.1 Rules every AI feature follows

1. **Writes only proposals or suggestions.** Anything that would change the ledger is a `ProposedEntry` that waits in the review queue for **Approve & post** → `PostingService.post()` (Invariant 4). Advice, such as risk flags, explanations and narratives, is an `ai_suggestions` record and changes nothing.
2. **Rules first, model second, safe default last.** `ExpenseCategorizerService` does exactly this. Every feature must still work with no AI key.
3. **The model picks from the org's own records.** We hand it the accounts, items or invoices by code. An answer naming something that isn't there is ignored.
4. **Every suggestion shows its source, reason and confidence.** The model's own confidence is capped (0.8 today), so a person always checks.
5. **Runs in a BullMQ job, never inside a request** (`CLAUDE.md`).
6. **Learns from what people approve and correct** (`LearningService`), not from its own suggestions.
7. **Numbers come from code; words come from the model.** Narratives and answers quote figures that reports have computed. The model never does the arithmetic; `apps/api/src/extraction/invoice-checks.ts` already re-checks the model's sums on extraction.
8. **One org's data per prompt.** Prompts carry only that org's records. Cost is metered per org (`apps/api/src/ocr/usage-meter.service.ts` does this for OCR).

### 5.2 AI that exists today

| Feature | Where | How |
|---|---|---|
| OCR cascade: text PDF, Word and plain text without OCR, vision for scans | `apps/api/src/ocr` | pdf-parse; Gemini or Groq vision |
| Invoice and bill extraction, with the arithmetic re-checked | `apps/api/src/extraction` | Gemini |
| Expense categorisation: past choice → HSN/SAC or keyword rule → model → default | `apps/api/src/proposals/categorisation` | Rules, then Gemini |
| Unmatched bank lines into review proposals | same | Rules, then Gemini |
| Learning from corrections | `apps/api/src/proposals/learning.service.ts` | Stored mapping |
| PDF bank statements: parser first, model fallback, both must add up | `apps/api/src/ingest` | Parser, then Gemini |
| Insights, cash forecast, profit outlook | `apps/api/src/insights` | Rules and statistics, no LLM |
| Books import classification | `apps/api/src/migration` | Rules |
| CRM lead qualification; support agent with escalation | `apps/api/src/crm/leads`, `apps/api/src/crm/agent` | Model |

### 5.3 New AI features, by value

| # | Feature | Section | What it does | Writes | Needs first | Size |
|---|---|---|---|---|---|---|
| 1 | Duplicate and fraud checks on bills | 4.10 | Same number or amount; bank details changed; large first bill from a new vendor | Suggestion | Vendor bank details | S |
| 2 | Blocked-ITC and expense-policy checks | 4.11, 4.15 | Flags GST likely not claimable; proposes the expense line instead | Proposal | — | S |
| 3 | Transfer detection | 4.12 | Pairs a debit and a credit across our accounts; proposes the contra entry | Proposal | — | S |
| 4 | 2B mismatch explainer and vendor follow-ups | 4.15 | Explains each mismatch; drafts the message | Suggestion and draft | Real messaging for sending | S |
| 5 | TDS section suggestion | 4.8 | Suggests a vendor's section from their bills | Suggestion | — | S |
| 6 | Chart suggestions | 4.4 | From the business description, or from spend piling into Suspense or Purchases | Suggestion | — | S |
| 7 | Monthly narrative | 4.20 | Words around computed figures | Suggestion | — | S |
| 8 | Receipt allocation | 4.13 | Which open invoices a lump sum pays; reads remittance advice | Proposal | `payments` document | M |
| 9 | Month-end assistant | 4.14 | Accruals, prepaids, depreciation, capitalisation | Proposals | Fixed assets, schedules | M |
| 10 | Document risk score | 4.18 | Routes risky documents to a second approver | Suggestion | Approval policies | M |
| 11 | Payment-run suggestion | 4.13 | Which bills to pay, weighing due dates, MSME limits and cash | Draft run | Payment runs | M |
| 12 | Quote drafting from a message | 4.9 | Items, quantities and prices from an email or WhatsApp | Draft quote | Quotes, items | M |
| 13 | HSN/SAC suggestion; bill line → item | 4.6 | Fills item fields; maps scanned lines | Suggestion | Item master | M |
| 14 | 3-way match explainer | 4.10 | Bill against PO and GRN, with differences in words | Suggestion | POs, GRNs | M |
| 15 | E-invoice pre-check | 4.16 | Lists what the IRP will reject, with fixes | Suggestion | E-invoice | S |
| 16 | Ask your books | 4.20 | A question in plain words → answer with the report rows behind it | Nothing (read-only) | Report coverage | L |

### 5.4 Status, November 2026

Checked end to end on a live run: a scanned tax invoice and a photographed restaurant bill were read, proposed, held in Review until approved, and posted balanced. All AI model calls run in BullMQ jobs; no AI output reaches the ledger without a person's approval.

**Built:**
- **From 5.3:** 1 (partly: no "bank details changed" check on scans), 2, 3 (a suggestion; a person posts the contra), 4 (drafts only, nothing sent), 5 (new), 7–16.
- **Not built:** 6.

**Added:**
- **Fixed asset or expense.**
  - The HSN rules for computers, printers, phones and furniture now book consumables and anything under ₹5,000 a unit as expenses: toner, ink, cables, a mouse.
  - A laptop at ₹55,000 is still Office Equipment, "with charger" or not.
  - `CAPITALISE_FROM_PAISE` in `proposals/categorisation/category-rules.ts`.
- **Split by line.** A bill of different things books each line to its own account, by the rules, when the line amounts account for the cost (`ProposalsService.splitByLine`).
- **Blocked GST moved, not just flagged (17(5)).**
  - The GST goes into the cost when the evidence is strong: the restaurant SAC, a vendor named as a restaurant, dhaba or caterer, a salon, a club, or leave travel.
  - Item words alone ("tea", "juice") only flag, since a trader may resell them. Cars, construction, gifts, health and insurance only flag.
- **Paid at the counter.**
  - "Paid by UPI", "Payment mode: Cash" and similar wording is read from the document's text, with no model call (`paidAtCounter`).
  - Review shows **Already paid** with **Record as expense**, which opens the expense form already set up: the account the AI chose, paid from the bank (or cash), and blocked GST not claimed.
- **TDS section suggestion (5.3 #5).** 194C, 194J, 194I and 194H by SAC code or wording. It is shown only once this bill or the vendor's year passes the Finance Act 2025 limits (`suggestTdsSection` in `gl/tds.ts`).
- **GST rate per line.** A CGST rate read as the line's GST rate (9 for 18) is doubled back when the bill's CGST and SGST say so (`fullGstRates`).
- **Quotes from messages.** Greetings ("Namaste, please send…") no longer hide the items. Any part with a number that could not be read is listed as "Not read" instead of being dropped.

**Fixed:**
- **Stuck jobs.** Ask your books, quote drafting and invoice wording from time notes used to stay "queued" for ever when the AI provider failed. They now end with a reason. The monthly summary falls back to the rules' words.
- **Bulk approval.** It never takes less than 0.9 confidence. It also skips entries whose account the AI model picked or nothing matched.
- **Silent failures.**
  - A categoriser that could not reach the AI now says so on the entry.
  - A scan that fails for credit, a limit or the key shows a readable reason.
  - With no AI key, scans fail with a reason instead of reading placeholder text (the mock OCR is for tests only).

**Removed:** the Groq vision and extraction services, which were registered nowhere and read a key that was never configured. Gemini is the one provider. `GROQ_API_KEY` is gone from `.env.example`.

**Still open:**
- A second provider to fall back to when Gemini fails.
- Metering for the category and statement models.
- Approval policies on Review approvals (F2 of the audit).
- The CRM support agent sends replies above 0.6 confidence without a person; the messaging provider is still a mock.
- The statement model can name or create a bank account.
- Chart-of-accounts suggestions (5.3 #6).

**How "Ask your books" stays safe:**
- The model gets a fixed set of read-only report tools (P&L, ledger, ageing, registers and so on), not database access.
- Each tool call runs with the `orgId` from the JWT, through the tenant plugin.
- The answer quotes the rows it used and links to the report, so every figure can be checked.

---

## 6. Data model additions

| Collection | Purpose | Touches the ledger? |
|---|---|---|
| `items` | Item master | No |
| `stock_moves` | Quantity in and out per item | No under periodic inventory; the closing-stock journal is separate |
| `quotes`, `sales_orders`, `delivery_challans` | Pre-invoice documents | No |
| `purchase_orders`, `goods_receipts` | Pre-bill documents | No under periodic inventory |
| `payments` (with allocations) | One receipt or payment across many documents; advances; refunds | Yes, one receipt or payment voucher each |
| `expense_claims` | Employee claims | Yes, when posted |
| `approval_policies`, `approval_requests` | Who must approve what | No |
| `fixed_assets`, `depreciation_runs` | Asset register | Yes, each run through a proposal |
| `RecurringTemplate` kind `journal`, plus accrual and prepaid schedules | Repeating adjustments | Yes, through drafts |
| `projects`, `time_entries` | Projects; `projectId` as a line dimension | No (the dimension is set at posting) |
| `e_invoices`, `e_way_bills` | IRP and e-way bill records | No |
| `exchange_rates` | Foreign-currency documents | No |
| `budgets` | Budget per account per month | No |
| `inbound_messages` | Email and WhatsApp capture | No |
| `ai_suggestions` | Risk flags, explanations, narratives | No |

Every one carries an indexed `orgId`, uses the tenant plugin, and is audited (Invariants 5 and 6).

---

## 7. Build order

### Phase 1 — Finish what is half-built (mostly S)
- edit customers; rename, move and deactivate accounts;
- enter opening balances by hand, and post or remove the unused party opening-balance field;
- TDS screens over the existing API;
- the org audit-trail screen;
- a transfer screen, with **AI transfer detection**;
- invoice PDF and delivery: email first through SES or SMTP, WhatsApp when the provider is in;
- **AI duplicate and fraud checks on bills**, and **AI blocked-ITC flags**.

*Why first:* each closes a hole a user meets in their first week, and none needs a new domain.

### Phase 2 — Money in and out, properly (M)
- customer and vendor advances;
- one receipt across many invoices, with **AI allocation**;
- refunds;
- vendor bank details and MSME status;
- payment runs, with the **AI payment-run suggestion**;
- Razorpay payment links and the customer portal.

### Phase 3 — Capture from everywhere (M)
- email-in and WhatsApp-in;
- attachments on any record;
- the real Account Aggregator adapter.

### Phase 4 — Compliance (L)
- item master (step 1, needed for the GSTR-1 HSN summary), with **AI HSN/SAC suggestion**;
- e-invoice and e-way bill through a GSP, with the **AI pre-check**;
- GST filing through the GSP;
- GSTR-9;
- the ITC rules;
- TDS 26Q and Form 16A;
- the **AI 2B mismatch explainer**.

### Phase 5 — Month-end (M)
- recurring journals;
- accrual and prepaid schedules;
- fixed assets and depreciation;
- the **AI month-end assistant**.

### Phase 6 — Orders and approvals (L)
- quotes, with **AI quote drafting**;
- sales orders and delivery challans;
- purchase orders, goods received notes and the **AI 3-way match**;
- approval policies and maker-checker, with the **AI risk score**;
- expense claims.

### Phase 7 — Stock (L)
- stock moves, valuation and reports;
- the closing-stock journal;
- opening stock;
- **AI bill-line → item mapping** and reorder suggestions.

### Phase 8 — Reports and answers (M–L)
- management reports, comparisons and budgets;
- report PDFs and scheduled email;
- the **AI monthly narrative**;
- **Ask your books**.

### Phase 9 — Projects and currencies (L)
- projects and timesheets, with **AI invoice drafting from time**;
- multi-currency.

**Why this order:**
1. Holes users hit come first.
2. Then the correctness of money owed and paid.
3. Then the legal obligations.
4. Then the large new domains (orders, stock, projects), which the build spec deliberately deferred until the core loop is solid.

AI features land in the phase that builds the data they need, not before.

---

## 8. Outside services we will need

| Need | For | Options | Note |
|---|---|---|---|
| Account Aggregator (as an FIU) | Bank feeds | Setu, Finvu, OneMoney or another licensed AA | Consent and encryption per the ReBIT specs; replaces the test aggregator |
| GSP | GST filing, e-invoice, e-way bill, GSTIN lookup | A licensed GSP, such as ClearTax, Masters India or IRIS | Sandbox first; every filing is a confirmed human action |
| WhatsApp Business provider | Sending invoices and reminders; WhatsApp-in | Meta Cloud API, Gupshup, Interakt | Message templates need Meta approval |
| Email, out and in | Invoice delivery; email-in | Amazon SES, SendGrid, Postmark | Inbound parsing for email-in |
| Payment gateway | Payment links | Razorpay (key field exists), Cashfree | Webhook signature verification; secret in config |
| TDS return format | 26Q / 27Q | Protean (NSDL) file format and FVU | File generation only; filing stays with the user |
| PDF rendering | Invoices, POs, statements, reports | Headless Chromium or a PDF library | Runs in a job |

---

## 9. Checklist for every new module

- [ ] Money is integer paise; `Number.isInteger` is checked on save (Invariant 1).
- [ ] Anything that changes the ledger goes through `PostingService.post()` in a transaction, with the gapless counter (Invariants 2 and 7). Documents that don't post never write journals.
- [ ] Posted documents never change. Corrections are reversals, and every new linked document is reopened or removed on reversal, as `JournalReversalService` does (Invariant 3).
- [ ] `orgId` on every collection, the tenant plugin, and an isolation test (Invariant 5).
- [ ] `AuditService.record` on every state change (Invariant 6).
- [ ] AI writes proposals or suggestions only, in queued jobs, with its reasons, and works without a key (Invariant 4).
- [ ] Integration tests against the replica set; no mocked database (Invariant 8).
- [ ] UI copy follows the design system:
  - buttons are the action verb (**Send quote**, **Record payment**, **Approve & post**);
  - amber means pending or AI, green means posted, red means an error.

---

## 10. Deliberately left out

These stay out of the books product, per build spec §15. They can be integrated with later rather than built in:

- payroll and HRMS;
- manufacturing and bills of materials;
- multi-warehouse logistics.
