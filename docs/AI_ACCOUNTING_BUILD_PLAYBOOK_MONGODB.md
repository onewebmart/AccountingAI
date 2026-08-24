# AI Accounting Platform — Claude Code Build Playbook (MongoDB)

> **What this is:** one paste-ready prompt per phase. Run them in order with Claude Code. Each phase assumes the previous one's invariants hold. Verify the **Done when** criteria before moving on.
> **Companion files (keep in the repo root, Claude Code should read them):** `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md`, `AI_ACCOUNTING_DESIGN_SYSTEM.md`, and the `CLAUDE.md` produced in Phase 0.
> **Stack:** Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui · NestJS + TypeScript · **MongoDB + Mongoose** · BullMQ + Redis · S3-compatible storage · Groq for AI.

---

## ⚠️ MongoDB ground rules (read before Phase 0)

These shape every later phase. Bake them into `CLAUDE.md`.

1. **Run MongoDB as a replica set, always** — even a single-node RS in dev (`rs.initiate()`). Multi-document transactions (required by the posting service) do **not** work on a standalone `mongod`.
2. **Money is integer paise stored as an integer `Number`** (JS is safe to 2^53 ≈ ₹90,000 crore in paise — enough). Validate `Number.isInteger` on every money field. Use `Decimal128` only if you ever need sub-paise.
3. **Journal lines are embedded inside the journal document**, not a separate collection. A balanced posting is then a single atomic write, and the balance check (`Σdebit = Σcredit`) runs before save.
4. **Append-only via Mongoose hooks** — a `pre('updateOne'/'findOneAndUpdate'/'save')` guard rejects any mutation of a journal whose `status = "posted"`. Corrections happen only through a reversing (contra) entry.
5. **Tenant isolation via Mongoose query middleware** — a global plugin injects `orgId` (from `AsyncLocalStorage` request context) into every find/update/delete. Never read `orgId` from the request body.
6. **Gapless numbering via a `counters` collection** — `findOneAndUpdate({_id}, {$inc:{seq:1}}, {new, session})` *inside the same transaction* as the posting.
7. **The AI never writes to `journals`.** It writes only to `proposedEntries`. The posting service is the single writer to the ledger.

---

## Phase 0 — Foundation, repo & `CLAUDE.md`

> **Paste to Claude Code:**
>
> Scaffold a monorepo for an AI accounting platform. Create two apps: `apps/api` (NestJS + TypeScript) and `apps/web` (Next.js 14 App Router + TypeScript + Tailwind + shadcn/ui), plus `packages/shared` for shared types/DTOs. Set up MongoDB with Mongoose in the API, configured to connect to a **replica set** (document how to run a single-node RS locally with `rs.initiate()` in the README). Add Redis + BullMQ, ESLint/Prettier, Jest, and a CI workflow that runs lint + test + build.
>
> Create a root `CLAUDE.md` that states these non-negotiable invariants and requires every future change to honor them: (1) money is integer paise as an integer Number, validated; (2) double-entry — every journal balances, enforced before save; (3) postings are append-only — never mutate a posted journal, reverse with a contra entry; (4) AI suggests, humans commit — AI writes only to `proposedEntries`, never to `journals`; (5) server-side tenant isolation by `orgId` from request context via Mongoose middleware, never from the client; (6) universal audit logging on every state change; (7) gapless per-org/per-type/per-FY document numbering via a `counters` collection inside the posting transaction; (8) MongoDB must run as a replica set so transactions work. Also import the design tokens from `AI_ACCOUNTING_DESIGN_SYSTEM.md` into `apps/web` (CSS variables, fonts Bricolage Grotesque + Hanken Grotesk + JetBrains Mono).
>
> **Done when:** both apps boot, API connects to a replica-set MongoDB, `CLAUDE.md` exists with all 8 invariants, design tokens are wired into the web app, and lint/test/build pass in CI.

---

## Phase 1 — Tenancy & isolation (the foundation that can't be retrofitted)

> **Paste to Claude Code:**
>
> Read `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` §3. Implement the Firm → Organization → User hierarchy with Mongoose models: `Platform`, `Firm`, `Organization`, `User`, `OrgMembership` (user↔org with role). Every tenant-scoped model must carry an indexed `orgId`. Implement tenant context using `AsyncLocalStorage`: a NestJS middleware reads the authenticated org from the JWT and stores it; a global Mongoose plugin auto-injects `{ orgId }` into every `find/findOne/update/delete/count` for tenant-scoped models, pulling from that context. Provide a `withOrg(orgId)` helper for system jobs that legitimately cross orgs (e.g. platform admin), and require it explicitly.
>
> Write tests proving isolation: seed Org A and Org B, then assert a query executed in Org A's context **cannot** return Org B documents even when the code "forgets" to filter.
>
> **Done when:** the isolation test passes, and no tenant-scoped query can read another org's data.

---

## Phase 2 — Auth & 2FA

> **Paste to Claude Code:**
>
> Implement authentication on the NestJS API and Next.js web app: email/password signup + login with bcrypt, JWT access + refresh tokens (rotation + revocation), Google OAuth, password reset via emailed link, and TOTP-based 2FA (enrol with QR, verify on login). The JWT must encode the user and the active `orgId`/`firmId` so the Phase-1 tenant context can read it. Build the auth screens per `AI_ACCOUNTING_DESIGN_SYSTEM.md` §9.2 with the exact copy specified (sentence-case, plain-verb, helpful error messages).
>
> **Done when:** a user can sign up, log in, enable 2FA, reset a password, and the issued JWT carries org context that the isolation middleware consumes.

---

## Phase 3 — RBAC & permission matrix

> **Paste to Claude Code:**
>
> Read `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` §10. Implement roles (Platform Super Admin, Firm Admin, Company Admin, Accountant, CA/Reviewer, Employee, Auditor) and a permission matrix. Add a NestJS guard that authorizes each endpoint against the caller's `OrgMembership.role`. The web app hides controls a role can't use, but the **server is the enforcer**. Write a test proving an Employee-role token is rejected by the posting endpoint.
>
> **Done when:** the Employee-can't-post test passes and every endpoint declares its required permission.

---

## Phase 4 — General Ledger backbone (the accounting truth)

> **Paste to Claude Code:**
>
> Read `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` §4 and the MongoDB ground rules in `CLAUDE.md`. Build the GL with Mongoose:
> - `Journal` model with **embedded `lines[]`** (each line: `accountId`, `debitPaise`, `creditPaise`), `voucherType`, `voucherNumber`, `status` (`posted`/`reversed`), `financialYear`, `postedBy`, `postedAt`. Money fields validate `Number.isInteger`.
> - A `pre('validate')` hook that rejects the document unless `Σdebit === Σcredit` and the total is non-zero.
> - A `pre('save'/'findOneAndUpdate'/'updateOne')` hook that throws if the existing doc's `status === "posted"` — enforcing append-only.
> - A `PostingService.post()` that opens a Mongoose **session/transaction**, allocates a gapless `voucherNumber` from a `counters` collection (`$inc` with the session, keyed by org+type+FY), saves the balanced journal, writes an `AuditLog`, and commits. Provide `PostingService.reverse(journalId)` that creates a contra journal referencing the original.
>
> Write tests: an unbalanced journal is rejected; a posted journal cannot be updated; concurrent postings get gapless sequential numbers; `reverse()` produces a balanced contra entry and leaves the original intact.
>
> **Done when:** all four tests pass.

---

## Phase 5 — Document upload, storage & dedup

> **Paste to Claude Code:**
>
> Read `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` §4–§5. Implement document upload to S3-compatible storage (MinIO in dev). Create a `Document` model (orgId, type, status, s3Key, sha256 hash, uploadedBy). On upload: store the file, compute the hash, run a dedup check (file hash + vendor/invoiceNo/amount/date once known) and flag suspected duplicates instead of discarding, then enqueue a BullMQ job for processing. Build the Inbox UI per `AI_ACCOUNTING_DESIGN_SYSTEM.md` §9.5 (dropzone, status chips including `Duplicate?`, the specified copy and empty state).
>
> **Done when:** a file uploads to storage, gets hashed, a duplicate is flagged, and a processing job is queued.

---

## Phase 6 — OCR cascade

> **Paste to Claude Code:**
>
> Read `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` §5. Implement the cost-aware OCR cascade as a BullMQ worker: (1) native-text PDFs → pdf-parse/text extraction; (2) scanned/printed images → an OCR provider (Textract/Google Vision/Azure — make the provider pluggable behind an interface); (3) handwritten/poor scans → vision-LLM fallback. Persist raw OCR text + layout + a per-document confidence to an `OcrResult` model. Meter OCR pages to a `UsageMeter` model per org (cost telemetry starts now, not later).
>
> **Done when:** a native PDF, a scanned image, and a handwritten sample each route through the correct tier and produce an `OcrResult`, with usage metered.

---

## Phase 7 — AI extraction to the canonical contract

> **Paste to Claude Code:**
>
> Read `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` §6–§7. Build the extraction step: feed OCR text + layout to Groq with a **strict JSON system prompt** that outputs exactly the canonical schema in §6 — no prose, no markdown fences, `null` for absent fields, never fabricate, integer paise only, and a `raw_warnings[]` array (e.g. line items don't sum to total). Validate the JSON server-side against a schema; on parse/validation failure retry once, then route the document to manual entry. Store the result in an `ExtractedDocument` model with per-field confidence. Meter tokens to `UsageMeter`.
>
> **Done when:** valid documents produce schema-conformant `ExtractedDocument`s with confidence and warnings; malformed AI output never persists and routes to manual entry.

---

## Phase 8 — Proposal layer & review queue (the signature page)

> **Paste to Claude Code:**
>
> Read `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` §7 and `AI_ACCOUNTING_DESIGN_SYSTEM.md` §9.6. From each `ExtractedDocument`, create a `ProposedEntry` (draft voucher, `status="proposed"`, suggested ledger accounts, per-field confidence). The AI writes **only** here. Build the review queue UI exactly to the design spec: split view (document preview beside extracted fields), the **confidence field** component (amber dot on low-confidence fields, click to highlight the source region), inline `raw_warnings`, and the **amber→green** confirm animation. Actions: **Approve & post** (calls `PostingService.post()` from Phase 4 — the only path to the ledger), **Edit**, **Reject** (kept for audit), **Approve all high-confidence**. On approve, decrement the Review count badge.
>
> **Done when:** approving a proposal posts a balanced journal via Phase 4, rejecting keeps an audited record, and nothing in the proposal layer can write to `journals` directly.

---

## Phase 9 — Learning loop

> **Paste to Claude Code:**
>
> Read `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` §7. Add a `VendorLedgerMap` model (orgId, vendor, ledgerAccountId, strength/count). When a human corrects the suggested ledger account during review, upsert/strengthen the mapping. On the next extraction from the same vendor, pre-fill the suggestion from this map. Cache hot mappings in Redis. This is deterministic memory — no model retraining.
>
> **Done when:** correcting a vendor's ledger once causes the next document from that vendor to suggest the corrected account.

---

## Phase 10 — Purchase & Sales (user side)

> **Paste to Claude Code:**
>
> Read `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` §4 and `AI_ACCOUNTING_DESIGN_SYSTEM.md` §9.9–§9.10. Build Purchase (vendors, purchase/expense bills, vendor outstanding) and Sales (customers, invoices, credit/debit notes, receivables). All postings go through `PostingService`. Implement AP/AR ledgers and ageing buckets. Invoice send keeps its verb through the flow (button **Send invoice** → toast **Invoice sent**). Use the specified status chips and empty states.
>
> **Done when:** outstanding and ageing totals reconcile to the GL, and all entries are posted via the Phase-4 service.

---

## Phase 11 — Bank reconciliation

> **Paste to Claude Code:**
>
> Read `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` §4 and `AI_ACCOUNTING_DESIGN_SYSTEM.md` §9.11. Parse uploaded statements into `BankStatementLine`s, auto-match against book entries (date/amount/reference heuristics), support manual match, and produce a difference report. Build the two-column matched/unmatched UI with the specified summary band and copy. Confirmed matches turn green.
>
> **Done when:** the reconciled balance ties to the bank account's GL balance and unmatched lines are clearly surfaced.

---

## Phase 12 — GST module (the India differentiator)

> **Paste to Claude Code:**
>
> Read `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` §8 and `AI_ACCOUNTING_DESIGN_SYSTEM.md` §9.12. Auto-build `GstPurchaseRegister`/`GstSalesRegister` from posted vouchers (IGST vs CGST+SGST decided by place-of-supply vs supplier state — compute **deterministically server-side**, never via the LLM). Import GSTR-2A/2B (JSON/Excel) and reconcile into buckets: matched, missing-in-books, missing-in-2B, mismatched (amount/GSTIN). Surface ITC eligibility and the rupee value of missing credit. **Create entry** on a missing-in-books line generates a `ProposedEntry` and routes it to the review queue — never auto-posts. Handle reverse charge, HSN/SAC, credit/debit note linkage, amendments.
>
> **Done when:** a 2B mismatch is correctly classified, the missing-credit figure is shown, and one-click entry creation lands in the proposal layer (not the ledger).

---

## Phase 13 — Reports

> **Paste to Claude Code:**
>
> Read `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` §9 and `AI_ACCOUNTING_DESIGN_SYSTEM.md` §9.13. Build P&L, Balance Sheet, Cash Flow, Trial Balance, Ledger, Day Book, and AP/AR ageing — all derived **only from posted journals** (use MongoDB aggregation pipelines). Add period/FY controls and a "Trial balance ties out ✓" marker. Use tabular figures for all amounts.
>
> **Done when:** the trial balance balances and P&L + Balance Sheet tie out for seeded data.

---

## Phase 14 — Exports & Tally connector

> **Paste to Claude Code:**
>
> Read `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` §11 and `AI_ACCOUNTING_DESIGN_SYSTEM.md` §9.14. Implement Excel/CSV/PDF export. Build the local **Tally connector agent** (a lightweight Windows service/tray app) that authenticates to the platform, pulls approved vouchers as a queue, transforms them to Tally XML, posts to `http://localhost:9000`, and reports status. Sync masters first, then vouchers; track a Tally GUID per voucher so re-syncing never double-posts. Show the connector status card (Connected / last sync / pending) with the specified copy.
>
> **Done when:** an approved voucher syncs to Tally idempotently and the connector status reflects reality.

---

## Phase 15 — AI insights (read-only)

> **Paste to Claude Code:**
>
> Read `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` §9 and `AI_ACCOUNTING_DESIGN_SYSTEM.md` §9.15. Build a read-only insights feed (expense spikes, overdue patterns, GST-due alerts, monthly summary, business-health). It **reads** the ledger and **never writes** to it. Every insight carries an `AI suggestion — review before acting` tag. Use the specified copy and empty state.
>
> **Done when:** insights render from real ledger data and there is no code path from insights to a write.

---

## Phase 16 — Org / company admin (admin side, tenant level)

> **Paste to Claude Code:**
>
> Read `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` §12B and `AI_ACCOUNTING_DESIGN_SYSTEM.md` §9.16. Build the org settings area: General (company, GSTIN, PAN, FY, currency, timezone), Team & roles (invite users, assign roles with plain-language descriptions), Tax & GST defaults, Integrations (API keys), Invoice template, and Branding (white-label only: logo, accent color, custom domain, client-portal toggle). All gated by the Phase-3 RBAC.
>
> **Done when:** a Company Admin can configure the org and manage the team without any platform-level access.

---

## Phase 17 — Platform super admin (admin side, Onewebmart level)

> **Paste to Claude Code:**
>
> Read `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` §12A and §14, and `AI_ACCOUNTING_DESIGN_SYSTEM.md` §9.17. Build a separate dark-chromed admin shell scoped to Platform Super Admin. Features: manage firms/orgs, subscriptions & billing, **AI & OCR cost dashboard** (per-org spend from `UsageMeter`, margin flags) front and center, feature flags, system health, global audit search, and support impersonation ("View as this org") with a persistent banner and full audit logging of every impersonated action. Platform abilities must never leak into tenant tokens.
>
> **Done when:** per-org AI cost is visible, impersonation is logged and clearly banner-flagged, and a tenant token cannot reach any platform-admin endpoint.

---

## Phase 18 — White-label firm portal (admin side, firm level)

> **Paste to Claude Code:**
>
> Read `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` §3 and §12, and `AI_ACCOUNTING_DESIGN_SYSTEM.md` §9.18. Build the CA-firm portal: firm branding replaces ours (logo/accent/domain from `WhiteLabelConfig`), a client-company grid with per-client status pills (docs waiting, GST due, overdue), and **Add client company**. A Firm Admin sees all their clients; clients stay fully isolated from each other (Phase-1 rules still apply per org).
>
> **Done when:** a CA firm sees its own brand and client list, and no client org can see another client's data.

---

## Phase 19 — Hardening & deployment

> **Paste to Claude Code:**
>
> Read `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` §13 (Phase 19) and §14. Add rate limiting, request validation everywhere, MongoDB backups + a verified restore procedure, monitoring/alerting, security review (auth, isolation, file upload, secrets), and a load test of the OCR/AI BullMQ queue under a burst upload. Confirm the replica set is correctly configured in production (transactions must work). Document the deployment (Docker-based) and the runbook.
>
> **Done when:** the queue survives a burst upload without dropping jobs, a backup restores cleanly, and the production replica set supports transactions.

---

## How to run this playbook

1. Run **Phase 0** first; commit the `CLAUDE.md` so every later session inherits the invariants.
2. Do phases **in order** — each relies on the previous one's guarantees (tenancy → auth → RBAC → ledger → pipeline → features → admin).
3. After each phase, run its **Done when** check before continuing. If it fails, fix it in that phase; don't carry debt forward into the ledger.
4. Build **Phase 8 (review queue)** carefully — it's the product's signature and it exercises the whole pipeline end to end.
5. If you already have the KhataPilot ledger/tenancy code, you can **reuse Phases 1–4** and start net-new work at Phase 5.

---

## One-paste master context (prepend to any phase if starting a fresh session)

> You are building an AI accounting platform for Indian SMEs and CA firms. Stack: Next.js 14 App Router + TS + Tailwind + shadcn/ui (web), NestJS + TS (api), **MongoDB + Mongoose run as a replica set**, BullMQ + Redis, S3-compatible storage, Groq for AI. Honor the 8 invariants in `CLAUDE.md` at all times — especially: integer paise; balanced append-only double-entry journals (lines embedded in the journal doc); AI writes only to `proposedEntries` and never to `journals`; the `PostingService` (inside a Mongoose transaction, with gapless numbering from a `counters` collection) is the only writer to the ledger; tenant isolation by `orgId` from request context via Mongoose middleware. Follow `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` for architecture and `AI_ACCOUNTING_DESIGN_SYSTEM.md` for all UI (yellow/orange brand, amber→green workflow, exact copy). Build the phase I specify, then report against its acceptance criteria.
