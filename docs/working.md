# How this software works

One document covering the whole system: what the parts are, how a piece of paper
becomes a ledger entry, who is allowed to do what, and where to look when
something behaves oddly.

Companion documents: `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` (architecture and
data model), `AI_ACCOUNTING_DESIGN_SYSTEM.md` (every UI decision),
`CA_CRM_BUILD_PLAN.md` (how the practice side was built, phase by phase).

---

## 1. What it is

Two products sharing one login, one shell and one database:

- **The books** — an accounting system for an Indian SME. Upload a bill, the AI
  reads it, a human approves it, it posts to a double-entry ledger. GST, reports,
  sales, purchases, banking.
- **The practice** — a CRM for the CA firm that looks after several such
  businesses. Clients, statutory deadlines, document chasing, fees, leads, and a
  WhatsApp support agent.

They are not separate apps. A firm's staff move between "my client's books" and
"my practice" inside the same sidebar.

---

## 2. The shape of the system

| Piece | What runs | Where |
|---|---|---|
| Web | Next.js 14 App Router, TypeScript, Tailwind, shadcn/ui, TanStack Query | `apps/web` — port 3000 |
| API | NestJS, TypeScript strict | `apps/api` — port 3001, all routes under `/api/v1` |
| Database | MongoDB **as a replica set** | host port 27018 |
| Queue | BullMQ on Redis | port 6379 |
| Files | S3-compatible (MinIO locally) | ports 9000/9001 |
| AI | Gemini (`gemini-2.5-flash`) for vision OCR, extraction, lead scoring, the support agent | — |
| Shared types | `packages/shared` — enums, the RBAC matrix, DTO-ish types used by both sides | — |

The replica set is not optional. The posting service opens a multi-document
transaction, and transactions do not exist on a standalone `mongod`. If you point
the API at a standalone instance, every posting fails.

**Running it locally**

```bash
docker compose up -d          # mongo (RS), redis, minio
npm run dev                   # turbo: api + web in parallel
```

Or individually: `npm run dev -w apps/api`, `npm run dev -w apps/web`.

Useful scripts:

```bash
node apps/api/scripts/seed-admin.mjs          # creates the platform super admin
node apps/api/scripts/seed-demo.mjs <email>   # fills one org with demo data + a login per role
```

Both read `MONGODB_URI` from `apps/api/.env.local`, so they always talk to the
same database the API does.

---

## 3. Two tenancy axes

Almost every bug in a multi-tenant system is a scoping bug, so this is worth
holding in your head before anything else.

- **`orgId`** — a business whose books are kept. Journals, documents, invoices,
  bills, ledger accounts all carry it.
- **`firmId`** — a CA practice that looks after many orgs. Clients, deadlines,
  leads, fees, tasks and conversations carry it.

An `Organization` may point at a `Firm` (`org.firmId`). That is the join between
the two sides.

Both are injected automatically. `apps/api/src/database/tenant.plugin.ts`
registers Mongoose plugins that read the current request's context from
`AsyncLocalStorage` and stamp `orgId` / `firmId` onto every `find`, `findOne`,
`update`, `delete` and `count`, and onto new documents at `pre('validate')`.

Two things follow, and both matter:

1. **Neither id is ever read from the request body, query string or a header.**
   They come only from the verified JWT. A client cannot ask for another tenant's
   data by putting a different id in the payload.
2. **Injection happens at `pre('validate')`, not `pre('save')`.** Mongoose runs
   validation first, and every tenant-scoped schema marks the field required — so
   injecting at save time would fail validation before it ever ran.

`withOrg(orgId)` and `withFirm(firmId)` exist for legitimate cross-tenant work
(platform admin, batch jobs). Their use should be explicit and rare.

One caveat: the plugins cover queries, **not aggregation pipelines**. Code that
reaches for `aggregate()` must scope by hand, which is why several services
deliberately use `find()` and sort in memory instead.

---

## 4. Who you are, and what you may do

### Sign-in

`POST /auth/login` returns an access token (15 minutes) and a refresh token
(long-lived). The access token carries `sub`, `email`, `orgId`, `firmId`, `role`
and `firmRole`.

Signing up creates the person and their organisation together:

```bash
curl -X POST http://localhost:3001/api/v1/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"name":"Priya Nair","email":"priya@kaveri.co.in","password":"Test@12345","businessName":"Kaveri Traders"}'
```

```json
{
  "user": { "id": "6a8d5a46…", "name": "Priya Nair", "email": "priya@kaveri.co.in" },
  "org":  { "id": "6a8d5a46…", "name": "Kaveri Traders" },
  "tokens": { "accessToken": "eyJ…", "refreshToken": "eyJ…" }
}
```

The access token's payload — this is the whole basis of authorisation, and note
that `orgId` and `role` are in here rather than in any request you send:

```json
{
  "sub": "6a8d5a465593e56acc5d0e46",
  "email": "priya@kaveri.co.in",
  "orgId": "6a8d5a465593e56acc5d0e48",
  "role": "COMPANY_ADMIN",
  "type": "access",
  "jti": "0dddc2c0-0eaf-430d-a0f6-b13746fd49f3",
  "iat": 1787648582,
  "exp": 1787649482
}
```

`exp − iat` is 900 seconds. `GET /auth/me` reflects the same claims back:

```json
{ "userId": "6a8d5a46…", "email": "priya@kaveri.co.in", "orgId": "6a8d5a46…", "role": "COMPANY_ADMIN" }
```

A `firmId` claim only appears once the org has a firm, and `firmRole` only for
someone who runs the practice — which is why enabling practice management
returns `reauthRequired: true`. A sole practitioner's token carries both:

```json
{ "orgId": "6a8c7f5e…", "role": "COMPANY_ADMIN", "firmId": "6a8c8b3b…", "firmRole": "FIRM_ADMIN" }
```

Refresh tokens **rotate**: each use replaces the stored hash, so a refresh token
works exactly once. Two consequences the web client has to respect —

- the client keeps a **single in-flight refresh promise**, because a page firing
  several queries at once would otherwise rotate the token concurrently and the
  losers would kill a perfectly good session;
- `/auth/refresh` returns the token pair **flat** (`{accessToken, refreshToken}`)
  while `/auth/login` and `/auth/signup` nest it under `tokens`. The client
  accepts either.

When a refresh genuinely fails, the API client raises one `onSessionEnded`
signal; the auth provider clears the cache once and redirects to
`/auth/login?next=…` so the user returns to the page they were on.

Signing out revokes the refresh token server-side, clears the query cache, and
lands on the marketing page.

### Roles

`packages/shared/src/auth/rbac.ts` is the single source of truth — role → the
permissions it holds. Every endpoint declares its requirement with
`@RequirePermission(...)`. **The server enforces; hiding buttons in the UI is
convenience, never security.**

| Role | Can do |
|---|---|
| `PLATFORM_SUPER_ADMIN` | Everything, across every org |
| `COMPANY_ADMIN` | The full books: post, approve, manage COA/sales/purchase/GST, manage org users |
| `ACCOUNTANT` | The same bookkeeping powers, minus managing the organisation itself |
| `CA_REVIEWER` | Review proposals, manage sales/purchase/GST — but **cannot post to the ledger** |
| `EMPLOYEE` | Upload documents, view documents and reports. No ledger access |
| `AUDITOR` | Read-only: journals, documents, reports, audit trail |
| `FIRM_ADMIN` | The practice side: manage firm, users, org; view reports/journals/documents. Held as `firmRole`, alongside — not instead of — an org role |

Verified against a live server, one column per role:

```
route                 owner  accountant reviewer clerk  auditor practice
read ledger accounts  200    200        200      403    200     200
read journals         200    200        200      403    200     200
read sales            200    200        200      403    403     403
practice clients      403    403        403      403    403     200
POST /gl/accounts     201    201        403      403    403     403
```

### Practice administration is a separate axis from the org role

A membership carries two roles, because they answer two different questions on
the two tenancy axes this system already distinguishes:

- **`role`** — scoped by `orgId`. What you may do to *this organisation's books*.
- **`firmRole`** — scoped by `firmId`. Whether you run *the practice* those books
  belong to.

Both are claims on the access token. `FirmAdminGuard` reads `firmRole`; the
`@RequirePermission` guards read `role`. A sole practitioner is therefore
normally `COMPANY_ADMIN` **and** `FIRM_ADMIN` at once, which is exactly right:
they keep their own books and run their own practice.

This used to be one field, and it caused a real failure worth remembering.
`FIRM_ADMIN` holds no bookkeeping permissions at all — no `POST_JOURNAL`,
`APPROVE_PROPOSAL`, `MANAGE_COA`, `MANAGE_SALES`/`MANAGE_PURCHASE` or
`UPLOAD_DOCUMENT` — and `POST /workspace/practice` used to *overwrite* `role`
with it. So the moment a sole practitioner switched on the practice side, they
silently lost the ability to run their own books: Review, Sales, Purchase, Inbox
and Chart of accounts all began returning 403 with nothing to explain why. That
is the origin of the classic "I clicked Add account and it said Unauthorized".

Practice setup now sets `firmRole` and leaves `role` alone. Existing accounts are
repaired by `node apps/api/scripts/migrate-firm-role.mjs --apply` (dry run by
default), which restores `role` to `COMPANY_ADMIN` and moves practice
administration to `firmRole`. Affected users must sign in again — both are token
claims.

`role === FIRM_ADMIN` is still accepted by the guard while pre-split tokens and
unmigrated memberships drain.

One consequence in the UI: `GET /workspace` returns the `firm` object only to
someone who actually has firm access. Belonging to an org that happens to have a
firm is not enough — otherwise a plain accountant would get a Practice section in
their sidebar where every link answers 403.

---

## 5. The eight invariants

These override every feature request. If a feature cannot be built without
breaking one, the feature changes.

1. **Money is integer paise.** Always. Multiplied to paise once, at extraction;
   divided by 100 only for display, never stored back.
2. **Double entry always balances.** `Σ debit === Σ credit`, total > 0, enforced
   by a Mongoose `pre('validate')` hook that rejects the document. Lines are
   embedded in the journal, so a balanced posting is one atomic write.
3. **Postings are append-only.** A `posted` journal is never mutated. Corrections
   go through `PostingService.reverse()`, which writes a contra entry referencing
   the original.
4. **AI suggests, humans commit.** The pipeline writes only to `proposed_entries`.
   `PostingService.post()` — reached only by an explicit human approve — is the
   single writer to the ledger.
5. **Tenant isolation is server-side**, by the plugins described above.
6. **Everything is audited.** Each state change writes an `AuditLog` row
   (`before`, `after`, actor, role). Append-only. Impersonation is flagged.
7. **Voucher numbers are gapless** per `(orgId, voucherType, financialYear)`. The
   counter `$inc` happens inside the same transaction as the journal save, so a
   crash cannot leave a hole.
8. **MongoDB runs as a replica set**, because 2, 6 and 7 need transactions.

---

## 6. The pipeline: from a photo to a ledger entry

This is the spine of the product. Six steps, and the human sits in the middle of
it on purpose.

```
upload → OCR cascade → extract → propose → HUMAN APPROVES → post
```

**1. Upload.** `POST /documents/upload` (needs `UPLOAD_DOCUMENT`). Max 20 MB.
Accepted: PDF, JPEG/PNG/WebP/TIFF/HEIC, XLS/XLSX/CSV, DOCX, TXT, MD, RTF. The
file is hashed (SHA-256) and stored; an identical hash marks the document
`DUPLICATE` instead of paying to read it twice. A job goes onto the
`document-processing` queue. **Nothing AI-related ever runs inside a request
handler.**

**2. The OCR cascade** (`ocr/ocr-cascade.service.ts`) escalates only as far as it
must, because each tier costs more than the last:

| Tier | For | Cost |
|---|---|---|
| 0 | `.docx`, `.txt`, `.md`, `.rtf` — the file already contains text | free, not metered |
| 1 | PDFs with a real text layer | cheap |
| 2 | Images, and scanned PDFs whose text layer came back sparse | moderate |
| 3 | Gemini vision, used only when tier 1/2 confidence is too low | expensive |

Tier 3 is skipped when tier 2 was already a vision model — the same bytes through
the same eyes will not produce a better answer. Legacy `.doc` is rejected with an
actionable message rather than a silent failure.

Spreadsheets take a different branch: they are ingested row-wise rather than read
as pictures.

**3. Extraction.** The text plus layout goes to the model, which returns typed
fields — vendor, date, invoice number, line items, tax split, totals. Amounts are
multiplied to paise here, once.

**4. Proposal.** `proposals.createFromExtracted()` turns the extraction into a
**balanced draft journal** with a confidence score and writes it to
`proposed_entries`. The document becomes `PROPOSED`. **This is as far as the AI is
ever allowed to go.**

**5. Human approval.** The Review queue (`/review`) is the signature screen of the
product. `POST /proposals/:id/approve` with an empty body accepts the suggested
lines as they stand; edits post the corrected version.

**6. Posting.** `PostingService.post()` opens a transaction and, atomically:
allocates the next voucher number from `counters`, writes the balanced journal,
writes the audit row. Then, depending on the source, it also creates the matching
bill/invoice and moves the ledger.

Document statuses along the way: `UPLOADED → CLASSIFYING → EXTRACTING →
EXTRACTED → PROPOSED → APPROVED`, plus `REJECTED`, `DUPLICATE`, `FAILED`. A
failure stores a human-readable `failureReason`, and `POST /documents/:id/retry`
re-runs the pipeline (it refuses anything not in `FAILED`).

**If the totals on a report look wrong, walk this chain.** Nine times in ten the
answer is that the proposal was never approved, so nothing was ever posted.

### Worked example: a supplier bill becomes a ledger entry

Every response below is real output from a running system, trimmed only of ids
and noise. The input is a one-page PDF invoice from Sterling Stationers:
₹22,700 taxable, 9% CGST, 9% SGST, ₹26,786 total.

**1 — Upload.**

```bash
curl -X POST http://localhost:3001/api/v1/documents/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@invoice.pdf"
```

```json
{
  "id": "6a8d5a475593e56acc5d0e51",
  "originalName": "invoice.pdf",
  "status": "CLASSIFYING",
  "sizeBytes": 2135,
  "sha256": "c86cab099d63452422cdd71b979c4fba482ce2e89b349ce414cb76d283719525",
  "jobId": "26"
}
```

The `sha256` is what makes a re-upload of the same bytes come back
`"status": "DUPLICATE"` instead of costing another extraction.

**2 — Poll until the pipeline settles.** `GET /documents/:id` moves through
`CLASSIFYING → EXTRACTING → PROPOSED`. This one took about four seconds.

**3 — Read the proposal.** `GET /proposals?status=proposed`:

```json
{
  "documentType": "purchase_invoice",
  "vendorName": "Sterling Stationers",
  "vendorGstin": "27AAFCS3456M1Z9",
  "invoiceNumber": "STS/2026/0442",
  "invoiceDate": "2026-08-12",
  "confidenceOverall": 0.9,
  "amountsPaise": {
    "taxableValue": 2270000,
    "cgst": 204300, "sgst": 204300, "igst": 0, "cess": 0,
    "total": 2678600
  },
  "suggestedLines": [
    { "accountName": "Purchases",        "accountCode": "5100", "debitPaise": 2270000, "creditPaise": 0,       "confidence": 0.9, "isAiSuggested": true },
    { "accountName": "Input CGST",       "accountCode": "1300", "debitPaise": 204300,  "creditPaise": 0,       "confidence": 0.9, "isAiSuggested": true },
    { "accountName": "Input SGST",       "accountCode": "1310", "debitPaise": 204300,  "creditPaise": 0,       "confidence": 0.9, "isAiSuggested": true },
    { "accountName": "Accounts Payable", "accountCode": "2100", "debitPaise": 0,       "creditPaise": 2678600, "confidence": 0.9, "isAiSuggested": true }
  ],
  "status": "proposed"
}
```

Note what this is and is not. Every amount is integer paise — ₹22,700 is
`2270000`, never `22700.00`. The four lines already balance
(2270000 + 204300 + 204300 = 2678600). And it is sitting in `proposed_entries`:
**nothing has touched the ledger yet.**

**4 — A human approves.**

```bash
curl -X POST http://localhost:3001/api/v1/proposals/$ID/approve \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
```

An empty body accepts the suggested lines as they stand. Sending
`{"lines": []}` would instead post a journal with no lines at all.

**5 — The journal now exists.** `GET /journals`:

```json
{
  "voucherType": "purchase",
  "voucherNumber": "PUR/2026-27/0001",
  "financialYear": "2026-27",
  "status": "posted",
  "totalDebitPaise": 2678600,
  "totalCreditPaise": 2678600
}
```

The voucher number was allocated by `$inc` on `counters` **inside the same
transaction** as the save, which is what makes the sequence gapless.

**6 — It shows up in the reports.**
`GET /reports/trial-balance?financialYear=2026-27`:

```json
{
  "financialYear": "2026-27",
  "entries": [
    { "accountDescription": "Accounts Payable", "accountType": "LIABILITIES", "totalDebitPaise": 0,       "totalCreditPaise": 2678600, "netPaise": -2678600 },
    { "accountDescription": "Input CGST",       "accountType": "ASSETS",      "totalDebitPaise": 204300,  "totalCreditPaise": 0,       "netPaise": 204300 },
    { "accountDescription": "Input SGST",       "accountType": "ASSETS",      "totalDebitPaise": 204300,  "totalCreditPaise": 0,       "netPaise": 204300 },
    { "accountDescription": "Purchases",        "accountType": "EXPENSE",     "totalDebitPaise": 2270000, "totalCreditPaise": 0,       "netPaise": 2270000 }
  ],
  "grandTotalDebitPaise": 2678600,
  "grandTotalCreditPaise": 2678600,
  "isBalanced": true
}
```

One photographed bill, six steps, and the books balance — with a person having
made the one decision that mattered.

**7 — Correcting it.** You cannot edit that journal; a posted journal is
immutable. `PostingService.reverse()` writes a contra entry pointing at the
original, so both the mistake and the correction stay visible.

---

## 7. The books, screen by screen

| Screen | Route | What it does |
|---|---|---|
| Dashboard | `/dashboard` | Real figures for the current financial year — no invented percentages |
| Inbox | `/inbox` | Uploads and their pipeline state; polls while anything is in flight |
| Review | `/review` | The proposal queue. Approve → posts to the ledger |
| Vouchers | `/vouchers` | Every posted journal, by financial year |
| Chart of accounts | `/accounts` | The ledger tree. Uses the shared `AccountType` enum |
| Sales | `/sales` | Customers, invoices; draft → post → pay |
| Purchase | `/purchase` | Vendors, bills; draft → post → pay |
| Banking | `/banking` | Statement upload, matching, confirmation |
| GST | `/gst` | Return workings |
| Reports | `/reports` | Trial balance, P&L, balance sheet, with charts |
| Insights | `/insights` | AI commentary over posted history |
| Exports | `/exports` | CSV, Excel, PDF |
| Settings | `/settings` | Org, team, preferences |

Sales and purchase both follow the same three-step life: **create → post → pay.**
Creating needs `MANAGE_SALES` / `MANAGE_PURCHASE`; posting and paying need
`POST_JOURNAL`. That split is deliberate — a reviewer can prepare an invoice they
are not permitted to commit.

Reports take `?financialYear=2026-27` (note: `2026-27`, not `FY2026-27`). The
response is `{ entries, grandTotalDebitPaise, grandTotalCreditPaise, isBalanced }`.
Excel exports are rendered *from* the CSV builders rather than rebuilt, so the two
formats cannot drift apart.

---

## 8. The practice, screen by screen

All under `Practice` in the sidebar; all require `FIRM_ADMIN` + a `firmId`.

| Screen | Route | What it does |
|---|---|---|
| Practice home | `/crm` | Clients, deadlines, fees, documents, leads, agent — at a glance |
| Clients | `/crm/clients` | Each client org, its GSTIN/PAN, contact and **services** |
| Compliance | `/crm/compliance` | Statutory deadlines, urgent / upcoming / filed |
| Document hub | `/crm/documents` | Checklist-driven document requests and chasing |
| Support agent | `/crm/agent` | The AI WhatsApp assistant's conversations |
| Leads | `/crm/leads` | Pipeline: NEW → QUALIFYING → PROPOSAL_SENT → WON / LOST |
| Fees | `/crm/invoices` | Practice invoices, issuing, payments, ageing |
| Tasks | `/crm/tasks` | Internal work, optionally tied to a client |
| Practice reports | `/crm/reports` | Revenue trend, client growth, compliance, automation |
| Messaging | `/crm/settings` | Outbox, templates, delivery adapter |

### Services are the switch that turns the practice on

**A client's `services` array drives almost everything else.** Deadlines are
generated from it; reminders, document checklists and the agent's context all key
off it. A client with `services: []` produces nothing, anywhere — the pages are
not broken, there is genuinely nothing to show.

`POST /crm/compliance/generate` walks the statutory calendar
(`statutory-calendar.ts`, declarative data — GSTR-1, GSTR-3B, TDS returns by
financial-year quarter, ITR, ROC MGT-7 and AOC-4) and creates the deadlines each
client's services make them liable for. It returns
`{created, alreadyPresent, clientsConsidered}`, and the page now reports which of
those happened rather than always claiming success.

**Worked example.** Add one client, tagging the services you handle:

```bash
curl -X POST http://localhost:3001/api/v1/firm/clients \
  -H "Authorization: Bearer $FIRM_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Sharma Textiles Pvt Ltd","gstin":"27AAPFU0939F1ZV","pan":"AAPFU0939F",
       "contactName":"Rakesh Sharma","whatsappNumber":"919822011001",
       "services":["GST_FILING","TDS"]}'
```

The client is stored as an organisation carrying `firmId`; its `_id` is the
`clientOrgId` every other CRM route wants. Then:

```text
POST /crm/compliance/generate  {}
→ { "created": 9, "alreadyPresent": 0, "clientsConsidered": 2 }
```

Nine deadlines from one client's two services — because GST filing recurs monthly
and TDS quarterly. Run it again and you get `created: 0, alreadyPresent: 9`; it is
idempotent. `GET /crm/compliance` groups them by deadline:

```json
{
  "complianceType": "GSTR_3B",
  "label": "GSTR-3B — Summary return",
  "authority": "GST Department",
  "periodKey": "2026-08",
  "periodLabel": "August 2026",
  "dueDate": "2026-09-20",
  "daysLeft": 26,
  "pendingCount": 1,
  "filedCount": 0,
  "clients": [
    { "itemId": "6a8d5a6b…", "clientOrgId": "6a8d5a6b…", "clientName": "Sharma Textiles Pvt Ltd", "status": "PENDING" }
  ]
}
```

**Change `services` to `[]` and all of this disappears.** That single field is
what makes the practice side inert or alive.

### The support agent

`POST /crm/agent/inbound` takes `{channel, from, text, contactName?}` — no client
id; the sender's number resolves the client.

**The deterministic escalation rules run before the model, never after.** If the
message matches a `COMMERCIAL` pattern (fees, discounts, refunds — commitments a
firm must make itself), `SENSITIVE` (complaints, legal threats, departmental
notices) or `CLIENT_REQUESTED` (they asked for a person), it goes straight to a
human and the model is not consulted at all. A message mentioning a legal notice
escalates as `SENSITIVE` — not something a language model should be improvising
about.

There is a fourth reason, `LOW_CONFIDENCE`, which by its nature can only be
decided after the model has run: the agent drafted something but was not sure
enough to send it.

**Worked example.** A client messages the firm's WhatsApp number:

```bash
curl -X POST http://localhost:3001/api/v1/crm/agent/inbound \
  -H "Authorization: Bearer $FIRM_TOKEN" -H 'Content-Type: application/json' \
  -d '{"channel":"WHATSAPP","from":"919822011001","text":"August ki GST filing ka status kya hai?"}'
```

```json
{ "conversationId": "6a8d5a6b…", "messageId": "6a8d5a6b…", "escalated": false, "reason": null }
```

There is no client id in that request — the sender's number resolves the client.
Seconds later the thread reads:

```text
[INBOUND]  August ki GST filing ka status kya hai?
[OUTBOUND] Hi Rakesh ji, August 2026 ki GSTR-1 aur GSTR-3B filings abhi pending
           hain. Unki due dates 11 Sept 2026 aur 20 Sept 2026 hain respectively.
           Hum jaldi hi process kar denge.
```

Those dates are not invented — they are the deadline rows generated above, read
back through `ClientContextService`. The greeting uses `contactName`, so it is
"Rakesh ji", not the company name.

Now the same number sends something the firm must handle itself:

```text
"I received a legal notice from the GST department."
→ { "escalated": true, "reason": "SENSITIVE" }
```

**The model was never called.** A regex matched first, the message went to a
human, and the client got a holding reply on the same thread.

Otherwise the agent answers with the client's real context: their pending filings
and actual due dates, in Hinglish, signed with the firm's name. English is used
for the firm's own chrome; Hinglish only in copy addressed to clients.

### Practice fees

Separate from the ledger, on purpose. Practice invoices are CRM records — they
number gaplessly within a transaction (`INV-2026-27-0001`), can be issued and
part-paid, and feed an ageing report, but **they do not post to any org's books.**

```bash
curl -X POST http://localhost:3001/api/v1/crm/invoices \
  -H "Authorization: Bearer $FIRM_TOKEN" -H 'Content-Type: application/json' \
  -d '{"clientOrgId":"6a8d5a6b…","issueDate":"2026-08-25","dueDate":"2026-09-09",
       "lines":[{"description":"GST filing — Aug 2026","service":"GST_FILING","amountPaise":500000}]}'
```

```json
{
  "invoiceNumber": "INV-2026-27-0001",
  "financialYear": "FY2026-27",
  "sequence": 1,
  "status": "DRAFT",
  "totalPaise": 500000,
  "lines": [{ "description": "GST filing — Aug 2026", "service": "GST_FILING", "amountPaise": 500000 }]
}
```

Then `POST /crm/invoices/:id/issue` moves it out of `DRAFT`, and
`POST /crm/invoices/:id/payments` with `{"amountPaise":300000,"receivedOn":"2026-09-02"}`
records a part payment — leaving ₹2,000 outstanding on the ageing report.

---

## 9. Background work

Five BullMQ queues, one processor each:

| Queue | Does |
|---|---|
| `document-processing` | The whole OCR → extract → propose pipeline |
| `crm-agent` | Drafts and sends the support agent's replies |
| `crm-compliance` | Deadline generation and 7/3/1-day reminders |
| `crm-leads` | AI lead qualification and scoring — **on request, not on create**: a new lead sits at `NOT_STARTED` until someone presses Qualify, so tokens are spent deliberately |
| `crm-messaging` | Delivery through the messaging adapter |

Messaging is pluggable and defaults to a **mock provider** in development —
messages land in the outbox at `/crm/settings` rather than reaching anyone.

Two lessons already paid for, worth not relearning: BullMQ rejects `:` in custom
job ids, and a record must never be marked *queued* before the enqueue actually
succeeds, or a failed enqueue strands it showing "Qualifying…" forever.

---

## 10. Platform admin

`/platform-admin` in the UI, `/platform/*` on the API, behind
`PlatformAdminGuard` — a **separate guard, not a permission**, so no platform
ability can leak into a tenant JWT. Only `PLATFORM_SUPER_ADMIN` passes; everyone
else gets 403.

Ten endpoints: org list and detail, cost summary, per-org usage, subscription
read/update, feature flags read/update, impersonation, platform audit trail. The
UI currently wires three of them — cost, orgs, audit. Subscriptions, feature
flags and impersonation are built on the API but not yet driven from the page.

Create the account with `node apps/api/scripts/seed-admin.mjs`.

---

## 11. Collections

```
users  orgMemberships  organizations  firms  org_settings
documents  ocr_results  extracted_documents  proposed_entries
journals  ledger_accounts  counters  auditLogs
sales invoices / customers   purchase_bills / vendors
usage_meters
crm_compliance_items  crm_document_requests  crm_leads
crm_practice_invoices  crm_tasks  crm_conversations  crm_messages
```

`counters` backs invariant 7. `auditLogs` is append-only. `usage_meters` records
OCR pages by tier and AI tokens per org per month, which is what the platform
cost view and the topbar's "AI this month" figure both read.

---

## 12. What failures look like

A validation failure returns the field-level reasons, which are worth surfacing
verbatim rather than replacing with "something went wrong":

```text
POST /crm/leads  {"name":"X","source":"NOPE"}
```

```json
{
  "message": ["source must be one of the following values: WHATSAPP, WEBSITE, REFERRAL, WALK_IN, OTHER"],
  "error": "Bad Request",
  "statusCode": 400
}
```

`message` is an **array** when class-validator rejects a body, and a string
otherwise — clients have to handle both.

A permission failure is a 403 that names the role, so the reader knows whether to
change what they are doing or who they are signed in as:

```text
POST /gl/accounts   as AUDITOR
```

```json
{
  "message": "Your role (AUDITOR) does not have permission to perform this action.",
  "error": "Forbidden",
  "statusCode": 403
}
```

A firm route reached without a firm-scoped token says so explicitly, because the
alternative — an empty list — would read as "you have no clients":

```text
GET /firm/clients   as COMPANY_ADMIN
```

```json
{ "message": "Firm admin access required", "error": "Forbidden", "statusCode": 403 }
```

And an expired or invalid access token is a plain 401, which the web client turns
into a single sign-out plus a redirect carrying `?next=`:

```text
GET /journals   with a 15-minute-old token
```

```json
{ "message": "Unauthorized", "statusCode": 401 }
```

That is deliberately uninformative — it is the one response an unauthenticated
caller can provoke at will, so it reveals nothing.

---

## 13. Where things go wrong

- **A report reads ₹0.** Check the financial year first (`2026-27`, not
  `FY2026-27`), then check that anything was actually approved in Review.
- **A page is blank with no error.** Almost always an empty state, not a failure.
  On the practice side, check whether the clients carry `services`.
- **"Unauthorized" / 403 on an action you expect to have.** Check your role — and
  see §4 if you have ever switched on practice management.
- **A session dies after ~15 minutes.** That is the access-token lifetime; the
  refresh path is what should renew it silently.
- **Postings fail with "Transaction numbers are only allowed on a replica set
  member".** The API is pointed at a standalone `mongod`. On this machine a
  host-installed mongod squats on 27017, which is why the project's replica set is
  published on **27018** with `directConnection=true`.
- **Anything AI-shaped is slow or absent.** Look at the queue and its processor,
  not the request handler — no AI work happens inline.
- **A Gemini call returns truncated or unparseable JSON.** `gemini-2.5-flash` is
  a *thinking* model: its reasoning tokens are spent out of `maxOutputTokens`, so
  that setting bounds thinking **plus** answer, not answer length. On the lead
  qualification prompt the model spends ~1,200 tokens thinking before writing a
  character, so a 1,024 budget returned `finishReason: MAX_TOKENS` and JSON cut
  off mid-sentence. Budget for reasoning, and keep replies short with the prompt
  rather than the cap.
- **A document fails with "Unable to process input image".** Something routed a
  non-image to the vision model. Check the stored `mimeType` — uploads often
  arrive as `application/octet-stream`, which is why the cascade resolves an
  effective type from the file extension before routing (`effectiveMimeType`).

---

## 14. Testing

Jest, with integration tests running against a **real replica-set MongoDB** — the
database is not mocked, because the invariants being tested are database
behaviour. A shared in-memory replica set is started once in `globalSetup` and
each spec gets its own database inside it; starting one per suite caused port
races on Windows and took roughly three times as long.

The isolation test is the one to keep honest: seed org A and org B, run a query in
A's context with no explicit filter, assert that nothing from B comes back.

---

## 15. Try it in five minutes

Everything below is copy-pasteable against a running stack.

```bash
API=http://localhost:3001/api/v1

# 1. Create a business and keep the token
TOKEN=$(curl -s -X POST $API/auth/signup -H 'Content-Type: application/json' \
  -d '{"name":"Priya Nair","email":"priya@example.com","password":"Test@12345","businessName":"Kaveri Traders"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['tokens']['accessToken'])")

# 2. Push a bill through the pipeline
DOC=$(curl -s -X POST $API/documents/upload -H "Authorization: Bearer $TOKEN" \
  -F "file=@invoice.pdf" | python -c "import sys,json;print(json.load(sys.stdin)['id'])")

# 3. Watch it move: CLASSIFYING → EXTRACTING → PROPOSED (a few seconds)
curl -s $API/documents/$DOC -H "Authorization: Bearer $TOKEN" \
  | python -c "import sys,json;print(json.load(sys.stdin)['status'])"

# 4. Read what the AI proposed — nothing is in the ledger yet
curl -s "$API/proposals?status=proposed" -H "Authorization: Bearer $TOKEN"

# 5. Approve it — this is the only thing that writes to the ledger
curl -s -X POST $API/proposals/$PROPOSAL_ID/approve \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'

# 6. See it in the books
curl -s "$API/reports/trial-balance?financialYear=2026-27" -H "Authorization: Bearer $TOKEN"
```

To see the practice side, turn it on and **sign in again** — `firmId` and `role`
are token claims, so the token you are holding predates the change:

```bash
curl -s -X POST $API/workspace/practice -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"firmName":"Kaveri & Co"}'
# → { "firm": {...}, "reauthRequired": true }

# re-login, then:
curl -s -X POST $API/firm/clients -H "Authorization: Bearer $FIRM_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Sharma Textiles Pvt Ltd","gstin":"27AAPFU0939F1ZV","services":["GST_FILING","TDS"]}'

curl -s -X POST $API/crm/compliance/generate -H "Authorization: Bearer $FIRM_TOKEN" \
  -H 'Content-Type: application/json' -d '{}'
# → { "created": 9, ... }
```

Remember that switching on practice management moves you to `FIRM_ADMIN`, which
cannot post to the books — see §4. Steps 2–6 will start returning 403 for that
account.

Or skip all of it and seed a whole worked account in one command:

```bash
node apps/api/scripts/seed-demo.mjs you@example.com
```

That creates clients, deadlines, leads, fee invoices, tasks, a client
conversation, posted sales and purchase entries, and one login per role — all
written through the API, so the invariants hold exactly as they would in
production.
