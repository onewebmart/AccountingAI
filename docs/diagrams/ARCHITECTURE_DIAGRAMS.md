# Architecture diagrams

Three pictures of the platform as the code stands on `feat/phase-1` (4 November 2026, commit `744a64c`): how the parts connect, what the database holds, and an accounting year from signup to year close.
They were drawn from `apps/api/src` and `apps/web/src` and checked against [the workflow and AI plan](../END_TO_END_WORKFLOW_AND_AI_PLAN.md). The plan's status marks were written before most of the building, so trust the marks here instead.
Each diagram is a plain Mermaid block, which GitHub and the VS Code Markdown preview both render. Edit them by hand. To change a box's status, change its `:::class`.

## Legend

| Status | Meaning | How it is drawn |
|---|---|---|
| **Built** | In the code on `feat/phase-1`, with tests | Green box, `:::built` |
| **Partly built** | Code exists, but part of what the plan promises is missing. The box says what. | Amber box, `:::partly` |
| **Pending** | Planned, with no code yet | Grey dashed box, `:::pending` |

The ER diagrams in section 2 can't colour entities, so they use a naming rule instead (see 2.0).

**Judgement calls behind the marks**

- **GSP.** E-invoice, e-way bill and GST filing are complete end to end, but `gsp/gsp.module.ts` has only `MockGsp`, and any other `GSP_PROVIDER` value stops the API. So every step that reaches a government portal is marked partly built.
- **Stock (Phase 7).** The API (`2a929f7`) and the `/stock` page (`744a64c`) are in, so stock is marked built. Two gaps remain: the closing checklist doesn't ask for the closing-stock entry yet (the Month-end assistant shows it), and credit and debit notes aren't read as stock moves (returns are entered as adjustments). Year close stays partly built for the first.
- **Sending messages.** Invoice email goes out over SMTP. Payment reminders and CRM messages are written and scheduled, but every channel goes through `MockMessagingProvider`, so nothing reaches the customer by WhatsApp or SMS.
- **AI provider.** Every model call goes to Gemini (`@google/generative-ai`). `groq-sdk`, `GroqVisionService` and `GroqExtractionService` are present, but no module provides them.
- **Razorpay and Setu.** Both are real adapters. Each falls back to a test provider when its keys or `BANK_FEED_PROVIDER` aren't set. Marked built.

---

## 1. System architecture

### 1a. The map: every module, store and outside service

```mermaid
flowchart LR
  %% ---- Status styles. Change a box's :::class to change its status. ----
  classDef built fill:#D3F9D8,stroke:#2B8A3E,color:#1B3D24
  classDef partly fill:#FFF3BF,stroke:#E67700,color:#4D3000
  classDef pending fill:#F1F3F5,stroke:#868E96,stroke-dasharray:5 3,color:#495057
  classDef store fill:#E7F5FF,stroke:#1971C2,color:#0B3A66
  classDef person fill:#FFFFFF,stroke:#495057,color:#212529

  subgraph people["People"]
    team["SME team and CA reviewers<br/>in a browser"]:::person
    staff["Employees<br/>claims, bills by WhatsApp"]:::person
    buyer["Customers<br/>no login"]:::person
  end

  %% Outside systems that call us
  subgraph inbound["Calls in from outside"]
    waIn["Meta WhatsApp Cloud API<br/>webhook in, media download"]:::built
    mailIn["Inbound mail webhook<br/>bills-code at our domain"]:::built
    tally["Tally Prime via a local connector<br/>agent not in this repo"]:::partly
  end

  %% One box per group of pages under apps/web/src/app/(app)
  subgraph web["Web app: Next.js 14, apps/web"]
    wCapture["Capture and review<br/>/review /inbox"]:::built
    wTrade["Sell and buy<br/>/sales /purchase /orders /items<br/>/expenses /approvals /recurring"]:::built
    wLedger["Bank and ledger<br/>/banking /vouchers /accounts"]:::built
    wTax["Tax and close<br/>/gst /tds /month-end /closing"]:::built
    wReports["Reports<br/>/dashboard /insights /reports<br/>/exports /audit"]:::built
    wSetup["Setup<br/>/onboarding /settings /migration"]:::built
    wFirm["CA firm and platform<br/>/crm /firm-portal /platform-admin"]:::built
    wPortal["Customer portal<br/>/portal/token"]:::built
    wStock["Stock<br/>/stock"]:::built
  end

  %% Every request passes here first: Invariant 5
  subgraph gate["Every API request"]
    aEdge["auth: JWT, Google, TOTP, RBAC<br/>tenancy: orgId from the JWT only,<br/>tenant plugin on every query"]:::built
  end

  %% One NestJS module per folder in apps/api/src, grouped by domain
  subgraph api["API: NestJS, apps/api"]
    aCapture["documents, inbound, ingest,<br/>ocr, extraction, proposals,<br/>attachments"]:::built
    aLedger["gl: PostingService, the only ledger writer<br/>journals, closing, audit"]:::built
    aTrade["sales, purchase, payments, portal,<br/>orders, items, expenses,<br/>approvals, automation"]:::built
    aStock["stock: moves, weighted average,<br/>stock entries as proposals"]:::built
    aBank["banking: statements, matching, transfers<br/>bank-feeds: consents, daily pull"]:::built
    aTax["gst: returns, 2B, ITC, filing, GSTR-9<br/>einvoice: IRN, e-way bill<br/>tds: 26Q, 26AS"]:::built
    aGsp["gsp: one provider seam<br/>for e-invoice and filing"]:::partly
    aClose["month-end: assets, depreciation,<br/>schedules, assistant"]:::built
    aReports["reports, insights, exports, migration"]:::built
    aFirm["org-settings, workspace, white-label,<br/>platform-admin, crm"]:::built
    aPhase8["Phase 8: management reports, budgets,<br/>report PDFs, narrative, Ask your books"]:::pending
    aPhase9["Phase 9: projects, timesheets,<br/>multi-currency"]:::pending
  end

  subgraph data["Data stores"]
    mongo[("MongoDB replica set rs0<br/>every collection, transactions")]:::store
    redis[("Redis<br/>BullMQ queues")]:::store
    s3[("S3-compatible storage<br/>MinIO or S3: uploaded files")]:::store
  end

  %% BullMQ processors are registered in their modules and run inside the API process
  subgraph jobs["Workers: BullMQ queues"]
    jDoc["document-processing"]:::built
    jAi["categorise, hsn-suggestions,<br/>quote-drafts"]:::built
    jDaily["bank-feeds 05:30 IST<br/>books-automation 06:30 IST:<br/>recurring, reminders, month-end sweep"]:::built
    jCrm["crm-messaging, crm-compliance 07:00,<br/>crm-leads, crm-agent"]:::built
  end

  %% Outside systems we call
  subgraph outbound["Outside services we call"]
    gemini["Gemini, @google/generative-ai<br/>OCR vision, extraction, categories,<br/>PDF statements, HSN, quotes, CRM"]:::built
    groq["Groq: client code present,<br/>not wired into any module"]:::pending
    waOut["WhatsApp and SMS sending<br/>test provider only"]:::pending
    gspExt["GSP: IRP, e-way bill, GST portal<br/>mock adapter only"]:::partly
    setu["Setu Account Aggregator<br/>bank feeds"]:::built
    smtp["SMTP: invoice email,<br/>password reset"]:::built
    razorpay["Razorpay: payment links,<br/>signed paid webhook"]:::built
    google["Google OAuth"]:::built
  end

  team --> web
  buyer --> wPortal
  staff --> waIn
  web -->|JWT| aEdge
  aEdge --> api
  waIn -->|webhook| aCapture
  mailIn -->|webhook| aCapture
  tally -->|"polls approved vouchers"| aReports
  api --> mongo
  aCapture -->|files| s3
  api -->|enqueue| redis
  redis --> jobs
  jobs --> gemini
  jDaily -.->|reminders| waOut
  aCapture -.->|unused| groq
  aEdge --> google
  aTrade --> smtp
  aTrade <-->|"links, paid events"| razorpay
  aBank <--> setu
  aTax --> aGsp
  aGsp <--> gspExt
```

### 1b. The key flow: from a bill to the ledger

AI writes only to `proposed_entries`. A journal is written only by `PostingService.post()`, inside one MongoDB transaction, and only after a person acts.

```mermaid
flowchart LR
  classDef built fill:#D3F9D8,stroke:#2B8A3E,color:#1B3D24
  classDef partly fill:#FFF3BF,stroke:#E67700,color:#4D3000
  classDef store fill:#E7F5FF,stroke:#1971C2,color:#0B3A66
  classDef human fill:#FFF4E6,stroke:#E8590C,stroke-width:2px,color:#5C1F00

  subgraph inbox["Step 1 - documents in"]
    up["Upload on /review or /inbox"]:::built
    em["Email to the org's bills address"]:::built
    wa["WhatsApp photo or PDF"]:::built
  end

  docs["documents module<br/>SHA-256 check: a repeat file<br/>is marked DUPLICATE"]:::built
  s3[("S3-compatible storage")]:::store
  queue[("Redis<br/>document-processing queue")]:::store

  %% Spreadsheets skip OCR: their cells are parsed directly by ingest
  subgraph worker["Step 2 - worker job, never inside the request"]
    ocrStep["OCR cascade<br/>tiers 0-1: text in the file<br/>tiers 2-3: Gemini vision"]:::built
    isStmt{"Bank statement?"}
    ext["Extraction: Gemini to strict JSON<br/>money as integer paise,<br/>sums re-checked in code"]:::built
    build["Proposal: bill checks,<br/>account by past choice, rule,<br/>model or default, with a reason"]:::built
  end

  recon["Bank reconciliation<br/>lines matched there"]:::built
  pe[("proposed_entries<br/>status PROPOSED")]:::store
  others["Other proposal sources<br/>unmatched bank lines, GSTR-2B lines,<br/>month-end adjustments"]:::built
  stockSrc["Opening and closing stock entries"]:::built

  subgraph decide["Step 3 - a person decides"]
    review["Review queue<br/>edit lines, then Approve & post"]:::human
    reject["Reject: kept, never posted"]:::built
  end

  typed["Documents people enter<br/>invoices, bills, payments, vouchers,<br/>expense claims, once any approval policy passes"]:::human

  subgraph tx["Step 4 - PostingService.post, one Mongo transaction"]
    checks["Period lock and<br/>account checks"]:::built
    counter["counters: inc seq<br/>gapless per org, type, FY"]:::built
    jr[("journals<br/>balanced, append-only")]:::store
    audit[("auditLogs<br/>append-only")]:::store
  end

  linked["Bill or invoice marked posted,<br/>linked to its journal"]:::built
  learn[("vendor_ledger_maps<br/>learns from corrections")]:::store

  up --> docs
  em --> docs
  wa --> docs
  docs -->|file| s3
  docs -->|job| queue
  queue --> ocrStep
  ocrStep --> isStmt
  isStmt -->|yes| recon
  isStmt -->|no| ext
  ext --> build
  build --> pe
  others --> pe
  stockSrc --> pe
  pe --> review
  review -->|Reject| reject
  review ==>|"Approve & post"| checks
  typed ==> checks
  checks --> counter
  counter --> jr
  jr --> audit
  jr --> linked
  review -.->|"account changed"| learn
```

---

## 2. Data model

### 2.0 How to read these

- Entity names are the real MongoDB collection names, exactly as `@Schema({ collection })` gives them. `auditLogs` and `orgMemberships` really are camelCase.
- **Singular names** such as `journal_line` and `doc_line` are **embedded subdocuments**, not collections.
- Each diagram shows a few key fields, not every field. Money is always an integer number of paise (`*Paise`, typed `int`). `amountsPaise` is the embedded `{ taxableValue, cgst, sgst, igst, cess, total }`, all in paise.
- Every collection except `platforms`, `firms`, `users`, `counters` and the CRM's firm-level collections carries an indexed `orgId`, scoped by the tenant plugin. `orgId` is left out of most boxes to save space.
- A collection that appears again in a later diagram shows only the fields that matter there.
- **Partly built** collections have `PARTLY BUILT` in a `%%` comment and in their first attribute's comment.
- **Planned** collections, and planned fields on existing collections, live only in diagram 2.10. When one is built, move it into its domain diagram.

### 2.1 Tenancy, platform and CA-firm CRM

```mermaid
erDiagram
  %% Platform > Firm > Organization > User, as in build spec section 3.
  %% A direct SME is an organization with no firm.
  platforms ||--o{ firms : hosts
  firms |o--o{ organizations : "manages as clients"
  organizations ||--o{ orgMemberships : has
  users ||--o{ orgMemberships : "belongs through"
  organizations ||--|| org_settings : "configured by"
  organizations ||--o| subscriptions : "pays through"
  organizations ||--o{ feature_flags : overrides
  organizations ||--o{ usage_meters : "metered by"
  %% CRM: the CA firm's own practice, keyed by firmId and clientOrgId
  firms ||--o{ crm_leads : works
  firms ||--o{ crm_tasks : tracks
  firms ||--o{ crm_compliance_items : "due dates for clients"
  firms ||--o{ crm_document_requests : "asks clients for"
  firms ||--o{ crm_practice_invoices : bills
  firms ||--o{ crm_conversations : holds
  crm_conversations ||--o{ crm_messages : contains

  platforms {
    ObjectId _id PK
    string name
  }
  firms {
    ObjectId _id PK
    ObjectId platformId FK
    string slug
    object whiteLabelConfig "logo, colour, domain, client portal"
  }
  organizations {
    ObjectId _id PK "this is the orgId"
    ObjectId firmId FK "null for a direct SME"
    string gstin
    string state
    int financialYearStart
  }
  users {
    ObjectId _id PK
    string email UK
    string googleId
    bool totpEnabled
  }
  orgMemberships {
    string orgId FK
    ObjectId userId FK
    string role "7 roles, from super admin to auditor"
  }
  org_settings {
    string orgId UK
    string gstin
    string pan
    string tan
    string inboxToken "the bills email address"
    array whatsappSenders
  }
  subscriptions {
    string orgId FK
    string plan
    int ocrPageQuota
  }
  usage_meters {
    string orgId FK
    string period
    int groqTokensIn "named for Groq, filled by Gemini calls"
  }
  feature_flags {
    string orgId FK
    string flagName
    bool enabled
  }
  crm_leads {
    ObjectId firmId FK
    string stage
    int estimatedValuePaise
    object qualification "model-scored"
  }
  crm_practice_invoices {
    ObjectId firmId FK
    ObjectId clientOrgId FK
    int totalPaise
    int paidPaise
  }
  crm_compliance_items {
    ObjectId firmId FK
    ObjectId clientOrgId FK
    string complianceType
    string dueDate
  }
  crm_document_requests {
    ObjectId firmId FK
    ObjectId clientOrgId FK
    array items "checklist, ticked by uploads"
  }
  crm_tasks {
    ObjectId firmId FK
    string status
  }
  crm_conversations {
    ObjectId firmId FK
    string channel
  }
  crm_messages {
    ObjectId conversationId FK
    string direction
    bool isMock
  }
```

### 2.2 Ledger core

```mermaid
erDiagram
  %% Invariants 2, 3 and 7: balanced, append-only, gapless.
  %% journal_line is embedded, so a journal and its lines are one atomic write.
  journals ||--|{ journal_line : "embeds two or more"
  ledger_accounts ||--o{ journal_line : "posted to"
  ledger_accounts |o--o{ ledger_accounts : "groups"
  journals |o--o| journals : "reversed by a contra entry"
  counters ||--o{ journals : "numbers"
  journals ||--o{ auditLogs : "recorded in"
  closing_runs ||--|| journals : "year-end closing entry"
  import_batches |o--o| journals : "opening journal"
  journals ||--o| tally_sync_records : "synced to Tally as"

  journals {
    ObjectId _id PK
    string orgId "indexed, tenant plugin"
    string voucherType
    int voucherNumber "gapless per org, type and FY"
    string financialYear "for example 2026-27"
    string status "posted or reversed, never edited"
    ObjectId reversalOf FK "set on the contra entry"
    string date
    bool isClosingEntry
    array lines "embedded journal_line"
  }
  journal_line {
    ObjectId accountId FK
    int debitPaise "sum of debits equals sum of credits"
    int creditPaise
  }
  ledger_accounts {
    ObjectId _id PK
    string orgId
    string code "1xxx assets to 6xxx expenses"
    string type
    ObjectId parentId FK "group"
    string systemKey "for system accounts"
    bool isActive "deactivated accounts take no new postings"
  }
  counters {
    string _id PK "orgId:voucherType:financialYear"
    int seq "inc inside the posting transaction"
  }
  auditLogs {
    string orgId
    string entityType "any collection"
    string entityId
    string action
    string performedBy
    object before
    object after
  }
  period_locks {
    string orgId UK
    string lockedThrough "nothing posts on or before"
  }
  closing_runs {
    string orgId
    string financialYear
    ObjectId journalId FK
    int netIncomePaise
  }
  import_batches {
    string orgId
    string source "tally, zoho, quickbooks, spreadsheet or manual"
    ObjectId journalId FK
  }
  tally_sync_records {
    ObjectId journalId FK
    string tallyGuid
    string status
  }
```

### 2.3 Document pipeline and AI

```mermaid
erDiagram
  %% Invariant 4: AI output lands in proposed_entries or ai_suggestions, never in journals.
  inbound_messages ||--o{ documents : "carried in"
  documents |o--o| documents : "duplicate of"
  documents ||--o| ocr_results : "read into"
  ocr_results ||--o| extracted_documents : "structured into"
  extracted_documents ||--o| proposed_entries : "proposed as"
  bank_statement_lines |o--o| proposed_entries : "unmatched line"
  gstr_2b_lines |o--o| proposed_entries : "bill missing from books"
  proposed_entries |o--o| journals : "Approve & post"
  vendor_ledger_maps }o--|| ledger_accounts : "learned account"

  documents {
    ObjectId _id PK
    string orgId
    string status "UPLOADED to PROPOSED, or DUPLICATE, FAILED"
    object source "upload, email or whatsapp"
    string s3Key
    string sha256
    ObjectId duplicateOf FK
  }
  inbound_messages {
    string orgId
    string from
    bool knownSender
    array files "each with its documentId"
  }
  ocr_results {
    ObjectId documentId FK
    int tier "0 file text to 3 vision"
    string rawText
    float confidence
  }
  extracted_documents {
    ObjectId documentId FK
    ObjectId ocrResultId FK
    object amountsPaise
    array lineItems "ratePaise, amountPaise per line"
    float confidenceOverall
  }
  proposed_entries {
    ObjectId _id PK
    string orgId
    string sourceType "document, bank, gst2b, adjustment"
    string status "proposed, edited, approved or rejected"
    object amountsPaise
    array suggestedLines "debitPaise and creditPaise per line"
    array checks "duplicate, GSTIN, blocked ITC"
    object category "source, reason, confidence"
    object adjustment "month-end and stock kinds"
    ObjectId journalId FK "set when posted"
  }
  vendor_ledger_maps {
    string orgId
    string vendor
    ObjectId ledgerAccountId FK
    int count
  }
  ai_suggestions {
    string orgId
    string kind "hsn, quote draft"
    string entityType "points at any record"
    string entityId
    float confidence
    string reason
  }
  attachments {
    string orgId
    string entityType "invoice, bill, voucher, payment or party"
    string entityId
    string storageKey "in S3"
  }
```

### 2.4 Sales, purchase and payments

```mermaid
erDiagram
  customers ||--o{ sales_invoices : billed
  vendors ||--o{ purchase_bills : bills
  sales_invoices ||--o{ sales_credit_notes : "credited by"
  purchase_bills ||--o{ purchase_debit_notes : "debited by"
  sales_invoices |o--o| journals : "posted as"
  purchase_bills |o--o| journals : "posted as"
  customers ||--o{ party_payments : "receipts from"
  vendors ||--o{ party_payments : "payments to"
  party_payments }o--o{ sales_invoices : "allocated to"
  party_payments }o--o{ purchase_bills : "allocated to"
  party_payments ||--|| journals : "one voucher each"
  payment_runs }o--o{ purchase_bills : "pays"
  customers ||--o{ portal_links : "views invoices through"
  sales_invoices ||--o{ payment_reminders : "chased by"
  recurring_templates ||--o{ sales_invoices : "drafts"
  recurring_templates ||--o{ purchase_bills : "drafts"

  customers {
    ObjectId _id PK
    string orgId
    string gstin "check digit validated"
    string stateCode "place of supply"
  }
  vendors {
    ObjectId _id PK
    string orgId
    string pan
    string tdsSection
    int tdsRateBps
    object bankAccount "checked against bills"
    object msme "Udyam, for the 43B(h) pay-by day"
  }
  sales_invoices {
    ObjectId _id PK
    string orgId
    ObjectId customerId FK
    string invoiceNumber "gapless on posting"
    string status
    object amountsPaise
    int amountPaidPaise
    array payments "embedded settlements, each with its journalId"
    object paymentLink "Razorpay link and paid event"
    object source "quote or sales order"
    ObjectId journalId FK
  }
  purchase_bills {
    ObjectId _id PK
    string orgId
    ObjectId vendorId FK
    string billNumber
    string status
    object amountsPaise
    int amountPaidPaise
    object tds "section, rateBps, amountPaise, depositId"
    bool isReverseCharge
    object source "purchase order"
    ObjectId journalId FK
  }
  sales_credit_notes {
    ObjectId invoiceId FK
    object amountsPaise
    ObjectId journalId FK
  }
  purchase_debit_notes {
    ObjectId billId FK
    object amountsPaise
    int tdsPaise
    ObjectId journalId FK
  }
  party_payments {
    ObjectId _id PK
    string orgId
    ObjectId partyId FK "customer or vendor"
    int amountPaise
    int tdsPaise
    int unappliedPaise "an advance until applied"
    array allocations "documentId, amountPaise"
    array refunds
    ObjectId bankLineId FK
    ObjectId journalId FK
  }
  payment_runs {
    string orgId
    string payOn
    array items "billId, amountPaise"
    int totalPaise
    array paymentIds
  }
  portal_links {
    ObjectId customerId FK
    string tokenHash
    date expiresAt
  }
  payment_reminders {
    ObjectId invoiceId FK
    string rung "before due to 30 days late"
    int outstandingPaise
    bool isMock "true until a real sender exists"
  }
  recurring_templates {
    string orgId
    string kind "bill, invoice or journal"
    string nextRunDate
    object amountsPaise
  }
```

### 2.5 Orders and items

```mermaid
erDiagram
  %% Orders never post. They lead to an invoice or a bill, which does.
  customers ||--o{ quotes : "quoted"
  quotes |o--o| sales_orders : "accepted into"
  customers ||--o{ sales_orders : orders
  sales_orders ||--o{ delivery_challans : "goods sent on"
  sales_orders |o--o{ sales_invoices : "invoiced as"
  quotes |o--o| sales_invoices : "or invoiced directly"
  vendors ||--o{ purchase_orders : "ordered from"
  purchase_orders ||--o{ goods_receipts : "received against"
  purchase_orders |o--o{ purchase_bills : "3-way match"
  %% doc_line is embedded in quotes, sales_orders, delivery_challans,
  %% purchase_orders and goods_receipts. Invoice and bill lines carry itemId too.
  items |o--o{ doc_line : "picked on"
  items }o--o| ledger_accounts : "income and expense accounts"

  items {
    ObjectId _id PK
    string orgId
    string kind "goods or service"
    string hsnSac "suggested by rules, then the model"
    string uqc "unit for the GSTR-1 HSN summary"
    float gstRatePct
    int salePricePaise
    int purchasePricePaise
    bool trackStock
    float reorderLevel
  }
  doc_line {
    ObjectId itemId FK
    string hsnSac
    float qty
    int ratePaise
    int amountPaise
    float taxRatePct
  }
  quotes {
    ObjectId customerId FK
    string number
    string status "draft, sent, accepted, declined, converted"
    object amountsPaise
    object drafted "from a customer message"
  }
  sales_orders {
    ObjectId customerId FK
    ObjectId quoteId FK
    string status "open, closed, cancelled"
    object amountsPaise
  }
  delivery_challans {
    ObjectId salesOrderId FK
    string reason "supply, job work, approval"
    string status
  }
  purchase_orders {
    ObjectId vendorId FK
    string number
    object amountsPaise
  }
  goods_receipts {
    ObjectId purchaseOrderId FK
    string vendorChallanNo
    array lines "qty received per PO line"
  }
```

### 2.6 Banking

```mermaid
erDiagram
  bank_accounts ||--o{ bank_statements : "statements of"
  bank_statements ||--o{ bank_statement_lines : contains
  bank_feed_consents |o--o{ bank_accounts : "feeds"
  bank_statement_lines |o--o| journals : "matched to"
  bank_statement_lines }o--o| sales_invoices : "settles"
  bank_statement_lines }o--o| purchase_bills : "settles"
  bank_statement_lines |o--o| bank_statement_lines : "other half of a transfer"
  party_payments |o--o| bank_statement_lines : "recorded from"

  bank_accounts {
    ObjectId _id PK
    string orgId
    string accountNumber
    string ifsc
    int openingBalancePaise
  }
  bank_statements {
    ObjectId bankAccountId FK
    string periodStart
    string periodEnd
    int openingBalancePaise
    int closingBalancePaise "PDF statements must add up to this"
  }
  bank_statement_lines {
    ObjectId statementId FK
    ObjectId bankAccountId FK
    int debitPaise
    int creditPaise
    int runningBalancePaise
    string matchStatus
    ObjectId matchedJournalId FK
    ObjectId matchedInvoiceId FK
    ObjectId matchedBillId FK
    ObjectId transferLineId FK
    bool possibleDuplicate
    string externalId "from the bank feed"
  }
  bank_feed_consents {
    string orgId
    string provider "setu or mock"
    string consentHandle UK
    string status "PENDING to ACTIVE, REVOKED, EXPIRED"
    array accounts "each linked to a bankAccountId"
  }
```

### 2.7 GST and TDS

```mermaid
erDiagram
  gstr_2b_lines }o--o| purchase_bills : "reconciled with"
  gst_filings |o--o| journals : "GST payment voucher"
  sales_invoices ||--o| e_invoices : "registered as"
  sales_invoices ||--o{ e_way_bills : "goods moved on"
  tds_deposits }o--o{ purchase_bills : "deposits TDS of"
  tds_deposits ||--|| journals : "challan payment"

  gstr_2b_lines {
    string orgId
    string period
    string supplierGstin
    int taxableValuePaise
    int cgstPaise
    int sgstPaise
    int igstPaise
    int itcEligiblePaise "2B only, rule 37 applied"
    string reconStatus
    string mismatchType "explained in words"
    ObjectId matchedBillId FK
  }
  gst_filings {
    string orgId
    string returnType "GSTR1 or GSTR3B"
    string period
    string status "saved, otp_sent, filed"
    string arn
    string provider "mock only so far"
    bool isTest
    ObjectId paymentJournalId FK
  }
  e_invoices {
    ObjectId invoiceId FK
    string status "pending, active, failed, cancelled"
    string irn
    string ackNo
    string signedQrCode
    array irpErrors
    bool isTest "true while the GSP is the mock"
  }
  e_way_bills {
    ObjectId invoiceId FK
    string ewbNo
    int valuePaise
    string vehicleNo
    string validUpto
  }
  tds_deposits {
    string orgId
    string month
    string section
    int amountPaise
    string challanNumber
    array billIds
    ObjectId journalId FK
  }
```

GSTR-9, Form 26Q, the Form 16A summary and the 26AS match are computed when asked for. Nothing is stored for them.

### 2.8 Month-end and stock

```mermaid
erDiagram
  %% Adjustments are proposals first. They post only through the review queue.
  fixed_assets }o--|| ledger_accounts : "asset account"
  fixed_assets }o--o| purchase_bills : "capitalised from"
  fixed_assets ||--o{ proposed_entries : "depreciation, disposal"
  adjustment_schedules }o--|| ledger_accounts : "expense account"
  adjustment_schedules ||--o{ proposed_entries : "accrual or prepaid each month"
  recurring_templates ||--o{ proposed_entries : "journal kind drafts"
  %% Phase 7. stock_moves holds only opening stock and
  %% adjustments. Moves from posted bills and invoices are read from them, not copied.
  items ||--o{ stock_moves : "opening and adjustments"
  stock_moves }o--o{ proposed_entries : "opening and closing stock entries"

  fixed_assets {
    ObjectId _id PK
    string orgId
    ObjectId assetAccountId FK
    int costPaise
    int residualPaise
    int openingAccumulatedPaise
    string putToUse
    float lifeYears
    ObjectId billId FK
    object disposal
  }
  adjustment_schedules {
    string orgId
    ObjectId expenseAccountId FK
    int amountPaise
    string startPeriod
    int months
  }
  recurring_templates {
    string kind "journal: added in Phase 5"
    array journalLines
  }
  stock_moves {
    ObjectId itemId FK
    string kind "opening or adjustment"
    string reason "count, damaged, returns, own use"
    string date
    float qty "plus in, minus out"
    int ratePaise "null takes the running average"
    date voidedAt "voided, never deleted"
  }
  proposed_entries {
    object adjustment "kind: accrual, prepaid, depreciation, capitalise, disposal, closing_stock, opening_stock"
  }
```

### 2.9 Approvals and expense claims

```mermaid
erDiagram
  %% Maker-checker: whoever made a document cannot approve it. AI scores risk but never approves.
  approval_policies }o--o{ approval_requests : "matched by"
  users ||--o{ approval_requests : "made by"
  approval_requests |o--o| journals : "posts on final approval"
  users ||--o{ expense_claims : "submits"
  expense_claims |o--o| approval_requests : "approved through"
  expense_claims |o--o| journals : "posted, then reimbursed"
  expense_rules ||--o{ expense_claims : "checks"

  approval_policies {
    string orgId
    string docType "bill, payment, journal, expense_claim"
    int minAmountPaise
    bool newVendorOnly
    array approverRoles
    int approvalsRequired "1 or 2"
  }
  approval_requests {
    string orgId
    string docType
    object payload "the document waiting to post"
    int amountPaise
    string makerId FK
    object risk "score and reasons"
    array approvals
    string status "pending, approved, rejected"
  }
  expense_claims {
    string orgId
    string number
    string employeeId FK
    string status "draft, submitted, approved, posted, paid"
    array lines "expense or mileage"
    int totalPaise
    array flags "policy checks, blocked ITC"
    ObjectId journalId FK
    ObjectId paymentJournalId FK
  }
  expense_rules {
    string orgId UK
    int receiptRequiredAbovePaise
    int lineLimitPaise
    int mileageRatePaise
  }
```

### 2.10 Planned: not in the code yet

Everything below is pending. Existing collections appear here only with the fields the plan would add to them.

```mermaid
erDiagram
  %% PLANNED (Phase 9): projects and timesheets.
  customers ||--o{ projects : "work for"
  projects ||--o{ time_entries : "time booked to"
  users ||--o{ time_entries : "logs"
  time_entries }o--o| sales_invoices : "billed on"
  projects |o--o{ journal_line : "projectId set at posting"
  %% PLANNED (Phase 8): budgets and scheduled report emails.
  ledger_accounts ||--o{ budgets : "budgeted"
  organizations ||--o{ report_schedules : "emails reports by"
  %% PLANNED (Phase 9): multi-currency. Journals stay in INR paise.
  exchange_rates |o--o{ sales_invoices : "rate on the document"
  exchange_rates |o--o{ purchase_bills : "rate on the document"

  projects {
    string orgId "PLANNED"
    ObjectId customerId FK
    string billingMethod "fixed or time and materials"
    int budgetPaise
    string status
  }
  time_entries {
    string orgId "PLANNED"
    ObjectId projectId FK
    ObjectId userId FK
    float hours
    int billableRatePaise
    ObjectId invoiceId FK "null until billed"
  }
  budgets {
    string orgId "PLANNED"
    ObjectId accountId FK
    string month
    int amountPaise
  }
  report_schedules {
    string orgId "PLANNED, name not fixed by the plan"
    string report
    string cadence
    array recipients
  }
  exchange_rates {
    string orgId "PLANNED"
    string currency
    string date
    float rate "fetched from RBI, never guessed"
  }
  journal_line {
    ObjectId projectId FK "PLANNED field"
  }
  sales_invoices {
    string currency "PLANNED field"
    int foreignAmountMinor "PLANNED field, that currency's minor units"
  }
  purchase_bills {
    string currency "PLANNED field"
    int foreignAmountMinor "PLANNED field"
  }
```

The plan also names `depreciation_runs`. The code doesn't need it: each depreciation run is a `proposed_entries` record with `adjustment.kind = depreciation`. "Ask your books" and the monthly narrative need no new collection. They read reports, and the narrative would be an `ai_suggestions` record.

---

## 3. End-to-end lifecycle

One organisation's year, from signup to year close. Arrows show the usual order. Dotted links join a step to related work that is still missing.

```mermaid
flowchart TB
  classDef built fill:#D3F9D8,stroke:#2B8A3E,color:#1B3D24
  classDef partly fill:#FFF3BF,stroke:#E67700,color:#4D3000
  classDef pending fill:#F1F3F5,stroke:#868E96,stroke-dasharray:5 3,color:#495057

  subgraph legend["Legend"]
    direction LR
    lgBuilt["Built"]:::built
    lgPartly["Partly built"]:::partly
    lgPending["Pending"]:::pending
  end

  subgraph onboard["Onboarding, once"]
    direction LR
    A1["Sign up: email or Google,<br/>optional TOTP"]:::built
    A2["Create the org:<br/>name, GSTIN, state"]:::built
    A3["Settings: PAN, TAN, FY start,<br/>branding, team and roles"]:::built
    A4["Default Indian chart seeded,<br/>rename, move, deactivate"]:::built
    A5["Opening balances: import Tally,<br/>Zoho or QuickBooks, or type a TB"]:::built
    A6["Item master with<br/>HSN/SAC suggestions"]:::built
    A7["Opening stock, then an<br/>opening-stock proposal"]:::built
    A8["Connect: Setu bank feed, bills inbox<br/>by email and WhatsApp, Razorpay"]:::built
    A9["Business type, number prefixes,<br/>payment terms, more GSTINs"]:::pending
    A10["Read a trial balance<br/>from a photo"]:::pending
    A1 --> A2 --> A3 --> A4 --> A5 --> A6 --> A7 --> A8
    A3 -.- A9
    A5 -.- A10
  end

  %% Explicit directions: Mermaid otherwise flips direction at each nesting level
  subgraph daily["Daily work"]
    direction TB
    D0["Dashboard: needs your attention,<br/>13-week cash forecast, insights"]:::built
    subgraph capture["Documents in"]
      direction TB
      D1["Bills and receipts:<br/>upload, email, WhatsApp"]:::built
      D2["OCR, extraction, bill checks:<br/>duplicate, GSTIN, blocked ITC"]:::built
      D3["Review queue:<br/>Approve & post"]:::built
      D1 --> D2 --> D3
    end
    subgraph sell["Sell"]
      direction TB
      D4["Quote, drafted from<br/>a customer's message"]:::built
      D5["Sales order,<br/>delivery challan"]:::built
      D6["Invoice: post,<br/>PDF, email"]:::built
      D7["E-invoice IRN, e-way bill<br/>mock GSP only"]:::partly
      D8["Payment link,<br/>customer portal"]:::built
      D9["Payment reminders<br/>sent by a test provider"]:::partly
      D10["Credit limits, customer<br/>statements, addresses"]:::pending
      D4 --> D5 --> D6 --> D7
      D6 --> D8
      D6 --> D9
      D6 -.- D10
    end
    subgraph buy["Buy and spend"]
      direction TB
      D11["Purchase order,<br/>goods received"]:::built
      D12["Bill, with the<br/>3-way match in words"]:::built
      D13["Approval policy:<br/>maker-checker, risk score"]:::built
      D14["Payment run: MSME first,<br/>bank bulk file"]:::built
      D15["Expense claims: submit,<br/>approve, post, reimburse"]:::built
      D11 --> D12 --> D13 --> D14
    end
    subgraph bank["Bank and pay"]
      direction TB
      D16["Statements or the<br/>daily bank feed"]:::built
      D17["Auto-match: settle documents,<br/>find transfers, catch duplicates"]:::built
      D18["Unmatched lines: account<br/>suggested, to the review queue"]:::built
      D19["Receipts across invoices,<br/>advances, refunds"]:::built
      D20["Bank-rules screen,<br/>cheque register"]:::pending
      D16 --> D17 --> D18
      D17 --> D19
      D17 -.- D20
    end
    subgraph more["Stock and projects"]
      direction TB
      D21["Bill lines linked to items,<br/>adjustments, reorder to a draft PO"]:::built
      D22["Projects, timesheets,<br/>foreign-currency documents"]:::pending
    end
  end

  subgraph monthly["Every month"]
    direction LR
    M1["Recurring journals, accruals<br/>and prepaids drafted"]:::built
    M2["Depreciation run,<br/>month-end assistant"]:::built
    M3["Closing-stock entry<br/>at weighted average"]:::built
    M4["GSTR-2B: ITC by the rules,<br/>each mismatch explained"]:::built
    M5["GSTR-1 and GSTR-3B built,<br/>reviewed before filing"]:::built
    M6["File through the GSP with OTP<br/>mock GSP only"]:::partly
    M7["GST payment voucher"]:::built
    M8["TDS challans, quarterly 26Q table,<br/>Form 16A summary, 26AS match"]:::built
    M9["Form 27Q,<br/>FVU file"]:::pending
    M10["Closing checklist,<br/>then period lock"]:::built
    M11["Reports: TB, P&L, balance sheet,<br/>cash flow, ledger, day book,<br/>Excel, CSV, Tally"]:::built
    M12["Management reports, comparisons,<br/>budgets, report PDFs and email"]:::pending
    M13["AI monthly narrative,<br/>Ask your books"]:::pending
    M1 --> M2 --> M3 --> M10
    M4 --> M5 --> M6 --> M7 --> M10
    M8 --> M10
    M8 -.- M9
    M10 --> M11
    M11 -.- M12
    M11 -.- M13
  end

  subgraph yearEnd["Year close"]
    direction LR
    Y1["The year's depreciation and<br/>closing stock booked<br/>stock not on the checklist yet"]:::partly
    Y2["GSTR-9 built from the year's<br/>GSTR-1 and GSTR-3B"]:::built
    Y3["File GSTR-9<br/>through the GSP"]:::pending
    Y4["Close the year: P&L into<br/>retained earnings, reopen if needed"]:::built
    Y5["Carry forward: the balance sheet<br/>opens the new year, numbers restart"]:::built
    Y6["AI close-readiness<br/>review"]:::pending
    Y1 --> Y4 --> Y5
    Y2 -.- Y3
    Y4 -.- Y6
  end

  onboard --> daily
  daily --> monthly
  monthly --> yearEnd
```
