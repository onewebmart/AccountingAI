# AI Accounting Platform — End-to-End Build Spec

> **Codename:** internal working name TBD (Accountooze-class AI bookkeeping platform for Indian SMEs, CAs & bookkeeping firms)
> **Status:** implementation plan, ready to drive a Claude Code build
> **Builds on:** KhataPilot/LedgerLens ledger backbone + UDYOG360 GL/Stock service patterns. Reuse those services where they exist instead of rewriting.

---

## 0. What this product actually is

An **AI-first bookkeeping automation platform**, not a full ERP. The user uploads raw documents (bank statements, purchase bills, sales invoices, receipts) and the system extracts, classifies, proposes, and — *after human approval* — posts them into a proper double-entry ledger, then produces GST registers, financial reports, and Tally exports.

The product has **two distinct engines**:

1. **GeneralLedger (GL)** — the accounting truth. Immutable, double-entry, balanced. This already exists in KhataPilot form; reuse it.
2. **DocumentPipeline** — the AI ingestion engine. OCR → extract → classify → propose. This is the *new* differentiating surface and the bulk of net-new work.

Everything else (dashboard, reports, GST, exports) is read/projection layers on top of these two.

---

## 1. Non-negotiable architectural invariants

These override every feature request. If a feature can't be built without breaking one, the feature changes — not the invariant.

| # | Invariant | Why |
|---|-----------|-----|
| 1 | **Money is integer paise (`BigInt`)**, never floats | Float arithmetic silently corrupts ledgers |
| 2 | **Double-entry, always balanced** — `Σ debits = Σ credits` enforced at the DB transaction level | A journal that doesn't balance must never persist |
| 3 | **Postings are append-only** — never edit/delete a posted journal; reverse with a contra entry | Audit integrity, legal defensibility |
| 4 | **AI suggests, humans commit** — no AI output ever touches the GL directly | The firewall between extraction and accounting truth |
| 5 | **Server-side tenant isolation** — every query scoped by `org_id` from the auth context, never from the client | One tenant must never see another's data |
| 6 | **Universal audit logging** — who/what/when/before/after on every state change | Compliance + dispute resolution |
| 7 | **Gapless document numbering** — sequential per org, per voucher type, per financial year | GST + statutory requirement; gaps are red flags in audit |
| 8 | **Tally sync runs through a local Windows connector agent** | Tally's HTTP/XML gateway is LAN-only; the cloud cannot reach it directly |

These mirror the eight UDYOG360 invariants and the KhataPilot CLAUDE.md ruleset — keep them in the project's root `CLAUDE.md` so every agent build session inherits them.

---

## 2. Tech stack (refined from the source doc)

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend | **Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui** | TanStack Query for server state; one codebase serves user app + admin via route groups |
| Backend | **NestJS + Node + TypeScript** | Modular, matches your UDYOG360/KhataPilot pattern |
| DB | **PostgreSQL + Prisma** | Strong transactional guarantees needed for the ledger |
| Async jobs | **BullMQ + Redis** | OCR/AI is slow and bursty — must be queued, never inline in the request |
| Object storage | **S3-compatible** (MinIO self-hosted, or AWS S3) | Raw document files; never in Postgres |
| OCR (layered) | pdf-parse/pdfplumber → Textract/Google Vision → LLM vision fallback | See §5 for the cascade |
| AI extraction/classification | **Groq** for text structuring + classification; a vision-capable model for scanned/handwritten | Groq for speed/cost on the high-volume text path |
| Auth | JWT (access + refresh) + OAuth (Google) + TOTP 2FA | Role-based, multi-org |
| Cache | Redis | Sessions, rate limits, learned vendor→ledger maps |
| Search | Optional Elasticsearch | Defer until document volume justifies it |

**Decision: don't introduce Elasticsearch in v1.** Postgres full-text + good indexing covers early-stage document search. Add ES only when a tenant crosses ~100k documents.

---

## 3. Multi-tenancy model (this is the foundation — get it right first)

White-label for CA firms forces a **two-level tenant hierarchy**:

```
Platform (Onewebmart)
  └── Firm (a CA/bookkeeping firm — the white-label tenant)
        └── Company / Organization (the firm's client, OR a direct SME signup)
              └── Users (scoped to the company)
```

- A **direct SME** signs up and creates one Company with no parent Firm.
- A **CA firm** is a Firm tenant that owns many client Companies and gets its own branding/domain/portal.
- **Every** business table carries `org_id` (Company). Firm-level tables carry `firm_id`. Isolation is enforced in a NestJS guard/interceptor that reads tenant context from the JWT and injects it into every Prisma query — never trust an `org_id` sent from the client body.

> Build the tenancy guard and `org_id` scoping **before any business feature**. Retrofitting isolation is how data leaks happen.

---

## 4. Data model (core tables)

Grouped by domain. `*` = carries `org_id` and is tenant-scoped.

**Identity & tenancy**
`platforms`, `firms`, `organizations*`, `branches*`, `users`, `org_memberships` (user↔org with role), `roles`, `permissions`, `role_permissions`.

**Masters**
`chart_of_accounts*` (tree: Assets/Liabilities/Income/Expense/Capital + sub-ledgers), `vendors*`, `customers*`, `bank_accounts*`, `tax_rates*`, `vendor_ledger_map*` (the learned Amazon→Office Expense memory).

**Document pipeline (the AI staging area — NOT the ledger)**
`documents*` (raw file ref, type, status, S3 key, hash), `ocr_results*` (raw OCR text + layout JSON + confidence), `extracted_documents*` (the canonical JSON — see §6), `proposed_entries*` (draft vouchers awaiting human approval, with per-field confidence), `ai_classifications*`.

**Ledger (the immutable truth)**
`journals*` (header, balanced, posted/reversed status), `journal_lines*` (debit/credit, account_id, amount_paise), `vouchers*` (purchase/sales/receipt/payment/contra/journal types with gapless numbers).

**Subsidiary**
`purchase_bills*`, `sales_invoices*`, `credit_notes*`, `debit_notes*`, `payments*`, `receipts*`.

**GST**
`gst_purchase_register*`, `gst_sales_register*`, `gstr_2a_imports*`, `gstr_2b_imports*`, `gst_reconciliation*` (matched/missing/mismatched).

**Reconciliation**
`bank_statements*`, `bank_statement_lines*`, `bank_reconciliation*`.

**Platform**
`subscriptions`, `usage_meters` (AI/OCR cost per org), `audit_logs*`, `notifications*`, `white_label_configs` (per firm), `feature_flags`.

**Hard rule:** `proposed_entries` and `journals` are different tables for a reason. AI writes only to the proposal layer. A posting service — triggered by a human approve action — is the *only* code path that writes to `journals`/`journal_lines`, and it enforces the balance check inside a DB transaction.

---

## 5. The OCR / extraction cascade (cost-aware)

Don't send everything to an expensive vision model. Cascade by document type and need:

```
1. Native-text PDF? (bank statements, e-invoices)
   → pdf-parse / pdfplumber  →  layout-aware text       [cheapest, instant]

2. Scanned PDF / image, machine-printed?
   → Textract / Google Vision / Azure Form Recognizer    [structured OCR]

3. Handwritten bill / poor scan / table-heavy?
   → vision LLM fallback                                 [most expensive, last resort]

ALL PATHS → LLM structuring step:
   feed OCR text + layout to Groq with a STRICT JSON schema → extracted_document
```

The structuring LLM call must use a **strict JSON output contract** (same discipline as your MedReport Analyst prompt: no prose, no markdown fences, anti-fabrication rule — if a field isn't present, return `null`, never guess). Validate the JSON server-side; on parse failure, retry once then route to manual entry.

---

## 6. Canonical extracted-document JSON contract

Every extraction normalizes to this shape regardless of source format. This is the contract between the AI layer and the proposal layer.

```json
{
  "document_type": "purchase_invoice | sales_invoice | bank_statement | receipt | bill",
  "confidence_overall": 0.0,
  "vendor": { "name": "string|null", "gstin": "string|null", "confidence": 0.0 },
  "invoice_number": { "value": "string|null", "confidence": 0.0 },
  "invoice_date": { "value": "YYYY-MM-DD|null", "confidence": 0.0 },
  "place_of_supply": "string|null",
  "currency": "INR",
  "amounts_paise": {
    "taxable_value": 0,
    "cgst": 0, "sgst": 0, "igst": 0, "cess": 0,
    "total": 0,
    "confidence": 0.0
  },
  "line_items": [
    { "description": "string", "hsn_sac": "string|null",
      "qty": 0, "rate_paise": 0, "amount_paise": 0,
      "tax_rate_pct": 0 }
  ],
  "is_reverse_charge": false,
  "raw_warnings": ["balance mismatch", "low OCR confidence on total"]
}
```

Notes:
- All money as **integer paise**. The extractor multiplies/rounds once, here, and never again.
- `confidence` per critical field drives the review UI — low-confidence fields get flagged for human attention.
- `raw_warnings` surfaces extraction doubts (e.g. line-item sum ≠ stated total) instead of silently posting bad data.

---

## 7. The end-to-end pipeline (state machine)

```
UPLOADED → CLASSIFYING → EXTRACTING → EXTRACTED
   → PROPOSED (draft voucher created, status=proposed)
   → [human review queue]
       ├─ APPROVE → POSTING → POSTED (immutable journal) → registers/GST updated
       ├─ EDIT    → corrected fields feed vendor_ledger_map (learning) → re-PROPOSED
       └─ REJECT  → REJECTED (kept for audit, never posted)
DUPLICATE detected at any stage → flagged, not auto-discarded
```

- **Dedup** runs on file hash + (vendor + invoice_number + amount + date). A suspected duplicate never auto-posts; it's surfaced for human decision.
- **Learning loop:** when a human corrects the suggested ledger account, write/strengthen the `vendor_ledger_map` entry. Next time "Swiggy" appears, the suggestion is pre-correct. This is cheap, deterministic memory — no model retraining needed.
- **Posting service** is the single writer to the GL. It opens a Prisma transaction, builds balanced journal lines, asserts `Σdr = Σcr`, assigns a gapless voucher number, commits, then emits an event that updates GST registers and dashboard projections.

---

## 8. GST module (the India differentiator)

This is where Indian SMEs feel the value. Build it deep.

- **Registers**: `gst_purchase_register` / `gst_sales_register` auto-built from posted vouchers (IGST vs CGST+SGST split decided by place-of-supply vs supplier state).
- **GSTR-2A / 2B reconciliation**: import GSTN JSON/Excel → match against purchase register → classify each line as *matched / missing-in-books / missing-in-2B / mismatched (amount or GSTIN)*. Surface **ITC eligibility** and the gap that's costing the client input credit.
- **One-click entry creation**: from an unmatched 2B line, generate a proposed purchase entry (back into the proposal layer — human still approves).
- **Edge cases to handle explicitly**: reverse charge, HSN/SAC, rounding differences, supplier amendments across periods, B2B vs B2C, credit/debit note linkage.

Keep GST computation **deterministic and server-side** — never let the LLM compute tax. The LLM extracts the stated tax figures; the GST service validates and recomputes from taxable value + rate + place of supply.

---

## 9. Reports & exports

**Reports** (all derived from posted journals, never from proposals): P&L, Balance Sheet, Cash Flow, Trial Balance, Ledger, Day Book, Expense/Income, GST summary, Outstanding/Ageing (AP & AR), Vendor/Customer/Bank statements.

**Exports**: Excel, CSV, PDF, and **Tally** (XML via the local connector — see §11).

**AI Insights** (read-only advisory layer, clearly labelled as suggestions): high-expense flags, cash-flow warnings, late-payment patterns, tax-due alerts, monthly summary, business-health score. These read the ledger; they never write to it.

---

## 10. RBAC & permission matrix

| Role | Scope | Can do |
|------|-------|--------|
| **Platform Super Admin** | Platform | Everything: tenants, billing, feature flags, global audit, AI cost |
| **Firm Admin** | Firm | Manage client companies, firm branding, firm users |
| **Company Admin** | Org | Company settings, users, COA, GST config, integrations |
| **Accountant** | Org | Upload, review, approve postings, run reports |
| **CA / Reviewer** | Org | Review, GST, tax, audit sign-off |
| **Employee** | Org | Upload documents, view reports only — **cannot post** |
| **Auditor** | Org | Read-only + full audit trail access |

Permissions are checked server-side per endpoint via a NestJS guard reading `org_memberships.role`. The UI hides what a role can't do, but the **server is the enforcer** — UI hiding is convenience, not security.

---

## 11. Tally integration (the connector pattern)

Tally Prime exposes an HTTP/XML gateway on the local machine/LAN only. The cloud platform can't reach it. So:

- Ship a small **local connector agent** (a lightweight Windows service / tray app) that the client installs on the machine running Tally.
- The agent authenticates to the platform, pulls approved vouchers as a queue, transforms them to Tally XML, posts to `http://localhost:9000`, and reports back success/failure.
- Sync masters (ledgers, vendors) first, then vouchers. Idempotent — re-running never double-posts (track Tally GUID per voucher).

This is the same constraint and solution from your KhataPilot spec — reuse that connector if built.

---

## 12. Two admin surfaces

**A. Platform Super Admin** (Onewebmart-internal)
Tenant/firm management, subscription & billing, white-label config approval, **usage & AI-cost dashboards** (OCR pages, tokens, per-org cost — critical because AI cost is your variable margin), feature flags, system health, global audit search, support impersonation (logged).

**B. Org/Firm Admin** (in-app)
Company details (GSTIN, PAN, FY, currency, timezone), user invites & roles, chart of accounts management, GST settings, integration keys, invoice templates, and — for white-label firms — branding (logo, domain, colors, client portal).

Build A as a separate route group / app shell with its own auth scope. Don't let platform-admin abilities leak into tenant tokens.

---

## 13. Build sequencing (phase playbook for Claude Code)

Each phase: a focused Claude Code session with clear acceptance criteria. Don't skip ahead — later phases assume earlier invariants hold.

| Phase | Goal | Acceptance criteria |
|-------|------|---------------------|
| **0. Foundation** | Monorepo, NestJS + Next.js scaffolds, Prisma, Redis, BullMQ, CI, `CLAUDE.md` with the 8 invariants | App boots; lint/test/build pass |
| **1. Tenancy & auth** | Firm→Org→User hierarchy, JWT + refresh + 2FA, tenant-isolation guard | A query from Org A *cannot* return Org B rows (write the test) |
| **2. RBAC** | Roles, permissions, per-endpoint guard | Employee role blocked from posting endpoint (tested) |
| **3. Masters** | COA tree, vendors, customers, bank accounts, tax rates | CRUD + validation; COA enforces account-type rules |
| **4. GL backbone** | `journals`/`journal_lines`, posting service, balance enforcement, gapless numbering, append-only + reversal | Unbalanced journal is rejected; posted journal is immutable |
| **5. Document upload & storage** | S3 upload, `documents` table, hashing, dedup check, BullMQ enqueue | File stored, job queued, duplicate flagged |
| **6. OCR cascade** | The §5 cascade with fallbacks | Native PDF, scanned image, handwritten each route correctly |
| **7. AI extraction** | Groq structuring to the §6 JSON contract, strict validation, confidence scoring | Returns valid schema or routes to manual; never fabricates |
| **8. Proposal & review** | `proposed_entries`, review queue UI, field-confidence highlighting, approve/edit/reject | Approving a proposal posts a balanced journal via Phase-4 service |
| **9. Learning loop** | `vendor_ledger_map`, correction feedback | Corrected vendor→ledger suggested correctly next time |
| **10. Purchase & Sales** | Bills, invoices, credit/debit notes, AP/AR ledgers, ageing | Outstanding & ageing reconcile to GL |
| **11. Bank reconciliation** | Statement parse, auto-match, manual match, difference report | Reconciled balance ties to bank account ledger |
| **12. GST module** | Registers, 2A/2B import & reconcile, ITC, one-click entry | 2B mismatch correctly classified; entry creation routes to proposal layer |
| **13. Reports** | P&L, BS, Cash Flow, TB, ledgers, ageing — all from posted journals | TB balances; P&L + BS tie out |
| **14. Exports & Tally** | Excel/CSV/PDF + local connector agent | Voucher syncs to Tally idempotently |
| **15. AI Insights** | Read-only advisory dashboard | Insights never write to GL |
| **16. Org Admin** | Settings, users, branding, integrations | Company admin can configure without platform access |
| **17. Platform Super Admin** | Tenant mgmt, billing, **AI-cost meters**, feature flags, audit | Per-org AI cost visible; impersonation logged |
| **18. White-label** | Firm branding, custom domain, client portal | CA firm sees own brand; clients isolated |
| **19. Hardening & deploy** | Rate limits, backups, monitoring, security review, load test of the OCR queue | Queue survives a burst upload; restore-from-backup verified |

---

## 14. Cost & margin watch-outs (don't skip)

AI/OCR is your **variable cost per document** — it directly sets your gross margin. Build cost telemetry from Phase 5, not as an afterthought:

- Meter OCR pages and LLM tokens per org → `usage_meters`.
- The cascade in §5 exists *to protect margin* — keep cheap paths cheap; only escalate to vision LLM when needed.
- Cache learned vendor mappings so repeat documents skip re-classification.
- Set per-plan quotas; surface usage to Company Admins so heavy users self-select into higher tiers.

---

## 15. What to defer (resist scope creep)

The source doc's "advanced features" list (payroll, HRMS, inventory, fraud detection, voice accounting, WhatsApp upload, etc.) is tempting but will sink v1. Ship the core loop — **upload → extract → propose → approve → post → GST → report → export** — rock-solid first. Then add, in rough priority: WhatsApp/email auto-import (high value, low effort on top of the existing pipeline), multi-company switching, UPI reconciliation. Everything else is v2+.

---

## 16. Immediate next step

Pick one of these and I'll produce the detailed artifact in your usual format:
- A root **`CLAUDE.md` ruleset** for the repo (invariants + conventions, like your KhataPilot one).
- A **Phase-by-phase Claude Code prompt playbook** (one prompt per phase above, ready to paste).
- The **Prisma schema** for §4.
- The **strict extraction system prompt** for §6/§7 (MedReport-Analyst discipline applied to invoices).
