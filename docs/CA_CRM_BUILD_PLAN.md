# CA Firm CRM — Phased Build Plan

**Source prototype:** `ca-crm (1).html` — a 1,490-line static mockup (10 views, hardcoded
markup, a view-switcher and a fake chat loop; no data, no network calls).

**Goal:** turn every view in that prototype into working product — schema, service, API,
queue jobs, UI — inside the existing monorepo, without breaking the 8 invariants in
[CLAUDE.md](../CLAUDE.md).

---

## 1. What the prototype actually contains

| View | Prototype state | Real work implied |
|---|---|---|
| Dashboard | 4 stat tiles, deadline list, AI activity panel, lead summary, client activity table | Aggregate read model over every other module |
| AI Agent | Fake chat with 4 canned replies on a 1.5s timer | Inbound message ingestion, threading, LLM reply, escalation rules, FAQ stats |
| Documents | 3 hardcoded client cards with checklist pills | Checklist templates per service, per-item state, progress %, bulk reminders |
| Compliance | Static deadline cards grouped by month | Statutory calendar, per-client applicability, 7/3/1-day reminder scheduler |
| Leads | 9 hardcoded cards in 3 stage columns | Lead CRUD, stage machine, AI qualification, follow-up jobs |
| Invoices | Static table + reminder-ladder diagram | Practice invoice CRUD, ageing, escalating reminder ladder |
| Clients | **Stub** — "247 Active Clients" placard only | Full directory, search, filters, service history, add-client modal |
| Tasks | **Stub** — "38 Open Tasks" placard only | Task CRUD, assignment, priority, due dates |
| Reports | **Stub** — placard only | Revenue trends, compliance rate, AI savings analytics |
| Settings | **Stub** — placard only | Messaging config, templates, reminder schedules, user management |

Four of the ten views are placards with no markup behind them. They are **not** "remaining
polish" — they are four modules to build from nothing.

---

## 2. Decisions taken

| # | Decision | Rationale |
|---|---|---|
| D1 | **App chrome in English, client-facing messages in Hinglish** | CA staff read the nav and buttons; clients read the WhatsApp/email/agent copy. Matches who actually reads each surface. |
| D2 | **Messaging via a pluggable `MessagingProvider`, mock adapter by default** | Every send is persisted and rendered in-app, so the whole flow is testable today with no Meta approval, no sender number, no SMTP. Real adapters slot in behind the interface later. |
| D3 | **Practice invoices are CRM records only — no ledger posting** | Keeps Invariant 4 trivially safe. The firm's own books can be a later phase. |
| D4 | **CRM is firm-scoped, not org-scoped** | See §3 — this is the load-bearing architectural decision. |
| D5 | **Rebuild the UI in the project design system, not the prototype's CSS** | Prototype uses Inter + Space Grotesk; CLAUDE.md says *never substitute Inter*. Port layout and behaviour, restyle to Bricolage Grotesque / Hanken Grotesk / JetBrains Mono and the saffron palette. Amber = pending/AI, green = confirmed, cool red for errors. |

---

## 3. The load-bearing architectural problem

The existing app is **org-scoped**. Invariant 5 injects `{ orgId }` from `AsyncLocalStorage`
into every query for tenant-scoped models. That is correct for bookkeeping: one company, one
ledger.

A CRM is **firm-scoped**. A CA firm has 247 clients; a lead is not yet a client and has no
`orgId` at all. Compliance deadlines, tasks and conversations span the whole client book.
Scoping CRM collections by `orgId` would be wrong at the data-model level.

The backbone for this already exists — [firm.schema.ts](../apps/api/src/tenancy/schemas/firm.schema.ts)
and `Organization.firmId` — but the wiring is broken:

> **`JwtPayload` declares `firmId?: string`, and `issueTokens()` never sets it.**
> [white-label.controller.ts](../apps/api/src/white-label/white-label.controller.ts) then calls
> `this.whiteLabelService.getClients(req.user.firmId!)` — a non-null assertion on a value that
> is always `undefined`. `getClients` does `new Types.ObjectId(undefined)`, which mints a
> *random* ObjectId, so every `/api/v1/firm/*` route silently returns `[]`.

It fails closed rather than leaking across firms, which is the good outcome of a bad bug — but
the entire firm surface is non-functional today. **Nothing in this plan works until Phase 0
fixes it.**

Firm scoping gets the same treatment as Invariant 5: context-injected `firmId`, never read from
the request body, plus an isolation test seeding two firms and asserting zero cross-reads.

---

## 4. Invariant compliance

| Invariant | How this build honours it |
|---|---|
| 1 — integer paise | Every money field (`estimatedValuePaise`, `amountPaise`, `collectedPaise`) is integer paise, validated with `Number.isInteger` on save. The prototype's `₹15,000` / `₹3.8L` / `₹85,000` are display-only formatting. |
| 2 — balanced double-entry | Not engaged: D3 means CRM writes no journals. |
| 3 — append-only postings | Not engaged, same reason. |
| 4 — AI suggests, humans commit | AI qualification scores and drafted replies are **proposals**. AI never changes a lead stage, never sends an unreviewed message on an escalated thread, never writes to `journals`. |
| 5 — tenant isolation | Extended, not bypassed: CRM models are firm-scoped via context; client-org data reached through a CRM view still resolves `orgId` server-side. |
| 6 — universal audit | Every CRM state change (stage move, invoice status, checklist item, message send) emits an `AuditLog`. |
| 7 — gapless numbering | Practice invoice numbers (`INV-2026-089`) allocate through the same `counters` + transaction pattern. |
| 8 — replica set | Unchanged; already enforced at boot in [database.module.ts](../apps/api/src/database/database.module.ts). |

---

## 5. Phases

Each phase is a **vertical slice** — schema → service → API → queue → UI → tests — so every
phase ends with something you can click, not a layer you have to trust.

### Phase 0 — Firm scoping foundations *(blocker for everything)*

No UI. Fix the substrate.

- Resolve `firmId` in `issueTokens()` from the user's org membership; add it to the access token.
- Extend the tenancy `AsyncLocalStorage` context with `firmId`; add a `firmScoped` Mongoose plugin mirroring the `orgId` plugin.
- Replace the `req.user.firmId!` non-null assertions with a guard that 403s when it is absent.
- `withFirm(firmId)` escape hatch for system jobs, mirroring `withOrg`.
- **Tests:** two firms seeded; a query in Firm A's context returns zero Firm B documents even when the caller omits a filter. Plus a regression test that a FIRM_ADMIN token actually carries `firmId`.

**Done when:** `GET /api/v1/firm/clients` returns real clients for a firm admin instead of `[]`.

### Phase 1 — Firm shell + Clients directory

- Extend `Organization` with CRM contact fields (`whatsappNumber`, `email`, `clientType`, `services[]`).
- Client CRUD; the prototype's add-client modal (English chrome per D1) with client type, PAN, GSTIN, WhatsApp, email, service checkboxes.
- Directory with search, service filters, status, last-activity.
- Web: firm workspace layout + sidebar, replacing the placeholder firm-portal page.

**Done when:** you can add a client and see it in a searchable directory.

### Phase 2 — Messaging core

- `MessagingProvider` interface (`sendWhatsApp`, `sendEmail`) + `MockMessagingProvider` persisting to `crm_messages` with `isMock: true`.
- `crm-messaging` BullMQ queue — **no send happens in a request handler** (CLAUDE.md rule).
- Template engine with variable substitution; Hinglish client-facing templates per D1.
- Minimal settings surface to view templates and the outbox.

**Done when:** a template renders and "sends" through the queue, and the message is visible in an outbox UI. — **Shipped.** Verified live: a `DOCUMENT_REMINDER` queued over WhatsApp rendered to Hinglish, the worker handed it to the mock adapter, and it landed SENT in the outbox with an audit log written.

### Phase 3 — Compliance tracker + reminders

- `crm_compliance_items`: type (GSTR-1 / GSTR-3B / TDS / ITR / ROC), period, statutory due date, authority, per-client status.
- Indian statutory calendar generator (GSTR-1 11th, GSTR-3B 20th, TDS quarterly, ITR 31 Jul, MGT-7 within 60 days of AGM).
- Auto-apply deadlines to clients by subscribed service.
- Repeatable BullMQ job firing reminders at 7 / 3 / 1 days.
- UI: urgent / upcoming / filed tabs, per-deadline client lists, bulk reminder action.

**Done when:** a deadline auto-appears for the right clients and a dated reminder lands in the outbox. — **Shipped.** Verified live: generating for a real firm produced 20 obligations across 3 clients, with ROC filings appearing only for the client that is both incorporated and subscribed to ROC; regeneration was a clean no-op; and reminders fired at exactly the 7- and 3-day marks, rendering readable Hinglish into the outbox. A daily sweep runs at 07:00 IST.

### Phase 4 — Document collection hub

- Checklist templates per service (ITR → Form 16, PAN, Aadhaar, Bank Statement; GST → Sales Register, Purchase Bills, Bank Statement).
- `crm_document_requests` with per-item state PENDING → RECEIVED → VERIFIED, progress %.
- Bridge to the existing [documents module](../apps/api/src/documents) so an uploaded doc satisfies its checklist item.
- UI: client cards, filter tabs, per-item pills, bulk reminder.

**Done when:** uploading a client document flips its checklist item and moves the progress bar. — **Shipped.** Verified live: a client uploaded `Form16_Ramesh.txt`, the pipeline auto-matched it to the Form 16 item on that client's ITR request (RECEIVED, not VERIFIED), the bar moved 0% → 20%, and the follow-up chase listed only the four documents still outstanding. Other clients' checklists were untouched.

### Phase 5 — Lead pipeline + AI qualification

- `crm_leads`: contact, source, services, `estimatedValuePaise`, stage (NEW → QUALIFYING → PROPOSAL_SENT → WON/LOST), assignee.
- Gemini-backed qualification job (BullMQ) that asks a question set and produces a **score + summary — never an automatic stage change** (Invariant 4).
- Follow-up scheduling and no-response escalation.
- UI: 3-column pipeline, add-lead, AI-progress indicators in amber per the design system.

**Done when:** a lead can be created, qualified by AI, and moved through stages by a human.

### Phase 6 — Practice invoices & collections

- `crm_practice_invoices` with gapless `INV-{FY}-{seq}` numbering via `counters` in a transaction (Invariant 7).
- Ageing buckets, outstanding totals, status ladder DRAFT → SENT → OVERDUE → LEGAL_NOTICE.
- Escalating reminder ladder (7 days before → due → +7 → +15) as queue jobs.
- UI: outstanding table, ageing summary, reminder schedule panel.

**Done when:** an invoice issues with a gapless number and its reminder ladder queues correctly.

### Phase 7 — AI support agent

- `crm_conversations` + `crm_messages`, threaded per client/lead and channel.
- Inbound webhook endpoint (mock-driven in dev) → queue → Gemini reply grounded in that client's real context (GSTIN, pending documents, next deadline).
- Escalation rules: fee questions, low confidence, and explicit client requests route to a human and **suppress auto-reply**.
- Auto-resolve rate, average response time, FAQ aggregation.

**Done when:** an inbound message produces a contextual reply, and a fee question escalates instead of answering.

### Phase 8 — Dashboard + Reports

Built after its inputs exist.

- Aggregate read model: client count, pending deadlines, collected/outstanding paise, AI activity, lead pipeline value, recent activity.
- Reports: revenue trend, client growth, compliance completion rate, AI time saved.

**Done when:** every dashboard tile reads live data, with zero hardcoded numbers.

### Phase 9 — Tasks, Settings, polish

- `crm_tasks`: title, optional client, assignee, priority, due date, status.
- Full settings: messaging config, template editor, reminder schedules, team/RBAC management.
- Design-system audit pass across all 10 views; empty/loading/error states; accessibility.

**Done when:** no view renders prototype placeholder content.

---

## 5a. Ingestion: every file type reaches the ledger

Requested alongside the CRM: uploads must work for images, PDFs, text and Word files.
The cascade now has a **Tier 0** for files that already contain text, so they skip OCR
entirely — running a vision model over bytes that already spell out the words costs
tokens and loses fidelity.

| Input | Path | Status |
|---|---|---|
| `.docx` (Word) | Tier 0 — `mammoth` raw-text extraction | **Working** |
| `.txt` / `.md` / `.rtf` | Tier 0 — UTF-8 decode, BOM stripped | **Working** |
| PDF with a text layer | Tier 1 — `pdf-parse` | Working (pre-existing) |
| Scanned PDF | Tier 2 → Gemini vision | Working (pre-existing) |
| Images — jpg, png, webp, tiff, heic, heif | Tier 2 → Gemini vision | Working (pre-existing) |
| `.xlsx` / `.xls` / `.csv` | Spreadsheet ingest (`exceljs`), bypasses OCR | Working (pre-existing) |
| `.doc` (legacy binary) | **Rejected** with an actionable message | By design — `mammoth` reads OOXML only; emitting garbled binary as "text" would be worse than a clear failure |

Every path converges on the same downstream flow: extraction → integer-paise amounts →
balanced `ProposedEntry` → human approval. Verified end-to-end against the live stack:

- `.txt` purchase invoice → Tier 0 → Purchases 25,00,000 + CGST 2,25,000 + SGST 2,25,000 Dr / AP 29,50,000 Cr — balanced.
- `.docx` purchase invoice → Tier 0 → Purchases 60,00,000 + **IGST** 10,80,000 Dr / AP 70,80,000 Cr — balanced, and correctly routed to IGST for an interstate supply.
- `journals` count for the org after both runs: **0** — Invariant 4 held; AI wrote only proposals.

## 6. Out of scope (explicitly deferred)

- Real WhatsApp Business API, Meta template approval, production SMTP (D2 — adapters only).
- Posting practice invoices to the ledger (D3).
- Client-facing portal login for document upload (the prototype mentions a `client.<firm>/upload` URL).
- Payment gateway collection.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Firm scoping is a genuine second tenancy axis; getting it wrong is a cross-firm data leak | Phase 0 lands the isolation test before any CRM collection exists |
| The prototype implies 247 clients × 5 deadline types of reminder fan-out | All sends are queued and batched; reminder jobs are idempotent per (item, client, offset) |
| LLM replies to clients on the firm's behalf carry real advisory risk | Escalation rules plus a human-review path on anything financial; every AI message is stored and attributable |
| Statutory dates change by notification | The calendar is data-driven and editable in settings, not hardcoded in logic |
