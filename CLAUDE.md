# AI Accounting Platform — Claude Code Ruleset

You are building an AI accounting platform for Indian SMEs and CA firms.

**Stack:** Next.js 14 App Router + TS + Tailwind + shadcn/ui (web) · NestJS + TS (api) · MongoDB + Mongoose as a **replica set** · BullMQ + Redis · S3-compatible storage · Groq for AI.

**Companion files** (read before every session):
- `docs/AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md` — architecture, data model, pipeline
- `docs/AI_ACCOUNTING_DESIGN_SYSTEM.md` — every UI decision: colors, typography, copy, page specs

---

## ⛔ 8 Non-Negotiable Invariants

These override every feature request, shortcut, or convenience. If a feature cannot be built without violating one, **the feature changes — not the invariant.**

### Invariant 1 — Money is integer paise, always

- All monetary values are stored and transmitted as **integer paise** (`Number` in JS — safe to 2^53 ≈ ₹90,000 crore).
- Validate `Number.isInteger(value)` on every money field before save.
- The extraction step multiplies to paise **once**; nothing else converts.
- Display divides by 100 for rendering; it never stores that result.
- Use `Decimal128` only if sub-paise precision is ever needed (it isn't in v1).

### Invariant 2 — Double-entry, always balanced

- Every `Journal` must satisfy `Σ debitPaise === Σ creditPaise` and the total must be > 0.
- A Mongoose `pre('validate')` hook **rejects the document** if it fails this check.
- No code path may bypass this hook. No raw MongoDB writes to `journals`.
- Journal lines are **embedded** inside the journal document (not a separate collection), making a balanced posting a single atomic write.

### Invariant 3 — Postings are append-only

- A `Journal` with `status === "posted"` **must never be mutated**.
- A Mongoose `pre('save') / pre('findOneAndUpdate') / pre('updateOne')` hook throws if it detects an update to a posted document.
- Corrections are made **only** via a reversing (contra) entry referencing the original.
- `PostingService.reverse(journalId)` is the only sanctioned correction path.

### Invariant 4 — AI suggests, humans commit

- The AI pipeline writes **only** to the `proposedEntries` collection.
- **No AI output may ever touch `journals` directly** — not via a tool call, not via a helper, not via a "shortcut for obvious entries."
- The `PostingService.post()` method — triggered by an explicit human approve action — is the **single writer** to the ledger.
- If you are tempted to auto-post on behalf of the AI, stop and ask.

### Invariant 5 — Server-side tenant isolation by orgId

- Every tenant-scoped document carries an indexed `orgId` field.
- A global Mongoose plugin injects `{ orgId }` from `AsyncLocalStorage` request context into **every** `find / findOne / update / delete / count` for tenant-scoped models.
- `orgId` is **never** read from the request body, query params, or client headers; it comes only from the verified JWT via the NestJS auth guard.
- The `withOrg(orgId)` helper is available for legitimate cross-org system jobs (platform admin, batch jobs); its use must be explicit and justified.
- Write the isolation test: seed Org A and Org B, execute a query in Org A's context, assert zero Org B documents are returned even when the code omits an explicit filter.

### Invariant 6 — Universal audit logging

- Every state change on every business entity emits an `AuditLog` entry: `{ orgId, entityType, entityId, action, actorId, actorRole, before, after, timestamp }`.
- Audit logs are **append-only** — never update or delete them.
- Platform impersonation actions are flagged with `impersonatedBy` in the audit log.

### Invariant 7 — Gapless per-org document numbering

- Voucher numbers are sequential and gapless per `(orgId, voucherType, financialYear)`.
- Allocation uses `findOneAndUpdate({ _id }, { $inc: { seq: 1 } }, { new: true, session })` on a `counters` collection **inside the same Mongoose transaction** as the posting.
- The counter increment and the journal save are atomic — a crash between them must not leave a gap.

### Invariant 8 — MongoDB must run as a replica set

- Multi-document transactions (required by the posting service for Invariants 2, 6, 7) do **not** work on a standalone `mongod`.
- In development: run a single-node RS (`rs.initiate()`) — see README for exact setup.
- In production: a proper multi-node RS or MongoDB Atlas.
- Never connect to a standalone instance for any environment where the posting service runs.

---

## Code conventions

- TypeScript strict mode everywhere. No `any` without a comment explaining why.
- NestJS modules are the unit of encapsulation — one module per domain.
- Mongoose models live in `apps/api/src/<domain>/<domain>.schema.ts`.
- Every HTTP handler is thin; business logic lives in services.
- BullMQ jobs are the only way to invoke OCR/AI — never inline in a request handler.
- Environment config goes through `@nestjs/config` — no `process.env` in business logic.
- Tests use Jest; every service that touches the DB must have integration tests against a real replica-set MongoDB (no mocking the DB).

---

## Design system reminders

- Brand colors: saffron (`#E8590C`) primary, marigold (`#FAB005`) pending/AI, warm off-white (`#FFFCF6`) page background.
- **Amber = pending/AI-proposed. Green = confirmed/posted.** Error states are always cool red (`#C92A2A`), never orange.
- Fonts: Bricolage Grotesque (headings) + Hanken Grotesk (body) + JetBrains Mono (numbers/IDs). Never substitute Inter.
- Review queue (§9.6 of design system) is the signature page — build it first as the reference.
- Every button label is the action verb: **Approve & post**, **Send invoice**, **Run reconciliation**.
- Toasts mirror button copy: **Approve & post** → toast: **Posted to ledger**.
