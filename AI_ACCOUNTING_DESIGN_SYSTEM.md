# AI Accounting Platform — Design System & Page Spec

> **Direction:** warm, confident, fast. A bookkeeping tool that feels like a smart assistant, not a tax form.
> **Palette:** saffron + marigold (orange/yellow) brand, warm neutrals, cool semantic states.
> **Companion to:** `AI_ACCOUNTING_PLATFORM_BUILD_SPEC.md`. This file defines how every page looks, behaves, and reads.

---

## 1. Design thesis — "amber to green"

The emotional core of this product is one moment: the AI proposes an entry, and a human confirms it. So the design is built around that arc.

- **Amber (brand)** = *uncertain, proposed, awaiting you.* Every AI-extracted value, every draft voucher, every unreviewed document carries the brand's warm glow. The brand color literally *means* "needs your eyes."
- **Green** = *confirmed, posted, reconciled, true.* The reward state.
- The interface should make turning amber → green feel quick and satisfying. That transition is the signature interaction.

This is why error/destructive states are **never** orange or yellow — the warm hues belong to "pending," and we keep that meaning sacred. Mistakes and danger use a cool, clearly non-brand red.

---

## 2. Color tokens

### Brand (warm)

| Token | Hex | Use |
|-------|-----|-----|
| `brand/saffron-600` | `#E8590C` | Primary buttons, primary links, active nav |
| `brand/saffron-500` | `#F76707` | Hover state for primary |
| `brand/saffron-700` | `#C84A06` | Pressed/active primary |
| `brand/marigold-400` | `#FAB005` | The yellow. Highlights, pending/AI badges, focus glow |
| `brand/marigold-300` | `#FFD43B` | Soft highlight, selection, progress fills |
| `brand/honey-100` | `#FFF4DC` | Amber tint surface (pending rows, AI panels) |
| `brand/honey-50` | `#FFFBF2` | Faintest brand wash for sectioned backgrounds |

### Neutrals (warm-toned, not gray-blue)

| Token | Hex | Use |
|-------|-----|-----|
| `ink/900` | `#1F1A15` | Headings, primary text |
| `ink/700` | `#3A322A` | Body text |
| `ink/500` | `#7A6E60` | Secondary text, captions |
| `ink/400` | `#A8998A` | Placeholders, disabled text, muted icons |
| `line/200` | `#EBE3D7` | Borders, dividers, table rules |
| `surface/card` | `#FFFFFF` | Cards, inputs, modals |
| `surface/page` | `#FFFCF6` | App background (warm off-white) |
| `surface/sink` | `#F6EFE3` | Inset wells, table headers, code blocks |
| `roast/900` | `#241A11` | Sidebar, footer, marketing dark sections |

### Semantic (cool — deliberately off-brand)

| State | Fg | Bg | Means |
|-------|-----|-----|------|
| **Pending / AI-proposed** | `#945800` | `brand/honey-100` | Awaiting human review *(uses brand on purpose)* |
| **Success / posted / reconciled** | `#1E7A47` | `#E6F6EE` | Confirmed, matched, paid |
| **Error / overdue / destructive** | `#C92A2A` | `#FBE9E9` | True red, never orange — clearly distinct from brand |
| **Info / system** | `#3B5BC0` | `#E9EDFB` | Neutral notices, AI explanations |

### Financial color rule (important for an accounting UI)

Color amounts by **sign and status, not by debit/credit**. A debit is not "bad."
- Negative balances / overdue / shortfall → error red.
- Positive movement / surplus / on-time → success green only when emphasis helps; default to `ink/900` for neutral readability.
- Debit and credit columns are distinguished by **column + label**, both in `ink/900`. Never paint debit red and credit green — that's not what they mean.

---

## 3. Typography

### Faces

| Role | Font | Why |
|------|------|-----|
| Display / headings | **Bricolage Grotesque** | Characterful, modern, slightly editorial — warmth without losing rigor |
| Body / UI | **Hanken Grotesk** | Clean, friendly, highly legible at small sizes |
| Numerals / ledger | **Hanken Grotesk w/ `font-feature-settings: "tnum"`** | Tabular figures so decimals align in every table |
| Code / IDs / GSTIN | **JetBrains Mono** | Monospace for invoice numbers, GSTINs, JSON, API keys |

> Don't substitute Inter — it's the default everyone reaches for. The Bricolage + Hanken pairing is the personality.

### Scale (rem, 16px base)

| Token | Size / Line | Weight | Use |
|-------|-------------|--------|-----|
| `display` | 2.75 / 1.05 | 700 | Marketing hero, big numbers |
| `h1` | 2.0 / 1.15 | 600 | Page titles |
| `h2` | 1.5 / 1.2 | 600 | Section headers |
| `h3` | 1.25 / 1.3 | 600 | Card titles |
| `body-lg` | 1.0625 / 1.55 | 400 | Lead paragraphs |
| `body` | 0.9375 / 1.55 | 400 | Default text |
| `label` | 0.8125 / 1.4 | 500 | Form labels, table headers (uppercase, +0.04em tracking) |
| `caption` | 0.75 / 1.4 | 400 | Helper text, timestamps |
| `mono-data` | 0.9375 / 1.4 | 400 | Amounts, IDs |

---

## 4. Spacing, radius, elevation

- **Spacing scale:** 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 (px). Use multiples; don't freehand.
- **Radius:** `sm 6px` (inputs, badges) · `md 10px` (buttons, cards) · `lg 16px` (modals, panels) · `full` (avatars, pills).
- **Elevation** (warm shadows, low spread):
  - `e1` cards: `0 1px 2px rgba(36,26,17,.06), 0 1px 1px rgba(36,26,17,.04)`
  - `e2` dropdowns/popovers: `0 6px 20px rgba(36,26,17,.10)`
  - `e3` modals: `0 16px 48px rgba(36,26,17,.18)`
- **Focus ring:** 2px `brand/marigold-400` glow + 2px offset. Always visible for keyboard users.
- **Layout grid:** 12-col, max content width 1200px, gutters 24px. App shell: 260px sidebar + fluid content.

---

## 5. Core components

### Buttons
- **Primary:** `brand/saffron-600` bg, white text, `radius md`. Hover → 500, press → 700. Label is the literal action: **Approve & post**, **Upload documents**, **Run reconciliation**.
- **Secondary:** white bg, `line/200` border, `ink/900` text.
- **Ghost:** transparent, `ink/700` text, for low-emphasis actions.
- **Destructive:** error red bg — used only for reject/delete, and always with confirmation.
- One primary button per view. Never two competing oranges.

### Inputs
- White bg, `line/200` border, `radius sm`, label above in `label` style, helper text in `caption`.
- Error state: red border + red helper text explaining *what to fix*, not "invalid input."
- Money inputs: right-aligned, mono tabular, `₹` prefix, parse to integer paise on blur.

### The confidence field (signature component)
The atom of the review experience. A field extracted by AI, styled by confidence:
- **High confidence:** plain value, subtle.
- **Medium / low:** amber underline + a small marigold dot; click reveals the source snippet from the document.
- **Confirmed by human:** the amber drops away, a quiet green check appears.
- This component appears anywhere AI proposed a value — review queue, GST entry creation, bank match.

### Status chips
Pill, `radius full`, `label` type. `Pending review` (amber), `Posted` (green), `Overdue` (red), `Matched` (green), `Needs attention` (red), `Draft` (ink/400).

### Data tables (the workhorse — accounting is tables)
- Sticky header in `surface/sink`, `label` style, uppercase.
- Row height 48px, zebra off by default; hover tint `brand/honey-50`.
- Amounts right-aligned, tabular mono.
- Pending rows carry a 3px left border in `brand/marigold-400`.
- Bulk-select column for batch approve/export.
- Empty cell shows `—` in `ink/400`, never blank.

### Toasts
Bottom-right, `e2`, auto-dismiss 4s. Voice matches the action: button says **Approve & post** → toast says **Posted to ledger**. Errors persist until dismissed and say what failed and the next step.

### Modals & sheets
- Confirmations for posting and destructive actions: title states the consequence, e.g. *"Post 12 entries to the ledger?"* with a one-line note that posting is permanent and reversed by contra entry, not deletion.
- Document preview opens in a right-side sheet next to the extracted fields, so the source and the data sit side by side.

---

## 6. Navigation & app shell

```
┌──────────────┬─────────────────────────────────────────────┐
│  ROAST       │  Topbar: org switcher · search · AI cost ·   │
│  sidebar     │          notifications · avatar              │
│              ├─────────────────────────────────────────────┤
│  ◆ Brand     │                                             │
│              │   PAGE CONTENT (surface/page)               │
│  Dashboard   │                                             │
│  Inbox  ⬤3   │   • page title (h1)                         │
│  Review ⬤7   │   • content                                 │
│  Vouchers    │                                             │
│  Purchase    │                                             │
│  Sales       │                                             │
│  Banking     │                                             │
│  GST         │                                             │
│  Reports     │                                             │
│  Insights    │                                             │
│  ─────────   │                                             │
│  Settings    │                                             │
└──────────────┴─────────────────────────────────────────────┘
```

- Sidebar bg `roast/900`, items `ink/400`, active item white text with a `brand/saffron-600` left bar + faint honey glow.
- Amber count badges (`⬤3`, `⬤7`) on **Inbox** and **Review** — the only places a number nags you, because those are the human-in-the-loop queues.
- Topbar shows **AI usage this month** as a quiet meter — transparency on the thing that costs money.

---

## 7. Iconography, illustration, motion

- **Icons:** Lucide, 1.5px stroke, `ink/500` default. Consistent stroke weight everywhere.
- **Illustration:** sparse, line-based, warm — used only in empty states and onboarding. No stock-y 3D blobs.
- **Motion:** restrained. The one orchestrated moment is the **amber→green confirm**: on approve, the row's amber border sweeps to a green check (200ms ease-out) before it animates out of the queue. Everything else is ≤150ms fades. Respect `prefers-reduced-motion`.

---

## 8. Voice & tone (copy rules)

- Active voice, sentence case, plain verbs. **Approve & post**, not "Submit transaction."
- Name things by what the user controls: *"Documents waiting for you,"* not *"Unprocessed queue items."*
- An action keeps its name through the flow: button **Reconcile** → toast **Reconciled**.
- Errors don't apologize and aren't vague — they say what happened and what to do.
- Empty states are invitations to act, not decoration.
- The AI speaks as a helpful colleague, clearly labelled, never as authority: *"I think this is an office expense — confirm?"*

---

## 9. Page-by-page spec

Each page: purpose · layout · key elements · real copy.

---

### 9.1 Marketing / landing

**Purpose:** convert SMEs and CA firms. Hero is the product's thesis, not a generic dashboard screenshot.

**Hero copy:**
- Eyebrow: `BUILT FOR INDIAN SMEs & CAs`
- Headline: **Upload the pile. We'll sort the books.**
- Sub: *Bank statements, bills, invoices — drop them in and watch entries appear, ready for your one-tap approval. GST-ready, Tally-friendly.*
- Primary: **Start free** · Secondary: **See how it works**

**Signature hero visual:** a live mini-demo — a blurred invoice on the left, fields extracting on the right with amber confidence dots resolving to green checks. Show the thesis, don't describe it.

**Sections:** the loop (upload → extract → approve → post → GST → report), GST reconciliation callout, Tally connector, white-label for CA firms, pricing (with AI-usage transparency), trust strip (data residency, audit trail).

**Layout:** `roast/900` hero with marigold accents, alternating cream/white sections below, generous whitespace.

---

### 9.2 Auth (login / signup / 2FA)

**Layout:** centered card on `surface/page`, brand mark top, warm and minimal.

**Copy:**
- Login title: **Welcome back**
- Signup title: **Create your account** · sub: *Free to start. No card needed.*
- 2FA: **Enter your 6-digit code** · helper: *From your authenticator app.*
- Forgot: **Reset your password** · *We'll email you a link.*
- Empty error: *"That email and password don't match. Try again or reset your password."*

---

### 9.3 Onboarding — create organization

**Purpose:** capture the minimum to start (company, GSTIN, FY, currency).

**Layout:** stepper, one decision per screen, progress in marigold.

**Copy:**
- Step 1: **Tell us about your business** — fields: Business name, GSTIN (optional), PAN, State (place of supply default).
- Step 2: **Set your financial year** — FY start, base currency (₹ default), timezone.
- Step 3: **Invite your team** — *Add your accountant or CA now, or skip and do it later.*
- Finish CTA: **Go to dashboard**
- CA-firm branch: **Set up your firm** → then **Add your first client company.**

---

### 9.4 Dashboard

**Purpose:** the morning glance. What needs me, what's the money picture.

**Layout:**
```
┌ Needs your attention ────────────────────────────────┐
│  ⬤ 7 entries to review   ⬤ 3 documents waiting        │
│  ⬤ 2 invoices overdue    ⬤ 5 GST mismatches           │
└───────────────────────────────────────────────────────┘
┌ Income (MTD) ┐ ┌ Expenses ┐ ┌ Cash on hand ┐ ┌ GST due ┐
│  ₹ 8,42,100  │ │ ₹5,10,300│ │  ₹12,90,000  │ │ ₹84,200 │
└──────────────┘ └──────────┘ └──────────────┘ └─────────┘
┌ Cash flow (chart) ─────────────────┐ ┌ AI insights ──────┐
│                                    │ │ • Expenses up 18%  │
└────────────────────────────────────┘ └────────────────────┘
┌ Recent activity ──────────────────────────────────────┐
└───────────────────────────────────────────────────────┘
```

**Copy:**
- Top band title: **Needs your attention** (the amber action band — the page's first job).
- Each KPI card: big tabular number, small label, tiny delta vs last month.
- Insights card header: **What I noticed** with a labelled AI tag.
- Empty state: **Nothing's waiting. Upload some documents to get started.** + **Upload documents** button.

---

### 9.5 Inbox (documents)

**Purpose:** everything uploaded, by status, before/after extraction.

**Layout:** upload dropzone at top, filterable table below (status, type, date, vendor, amount, confidence).

**Copy:**
- Dropzone: **Drop bank statements, bills, invoices, or receipts** · sub: *PDF, image, or Excel. We'll figure out what each one is.*
- Status chips: `Reading…` (amber, animated), `Ready to review` (amber), `Posted` (green), `Duplicate?` (red), `Couldn't read` (red).
- Duplicate row copy: *"Looks like a duplicate of INV-2208. Keep both, or skip?"*
- Empty: **Your inbox is clear.** *Drop a document above to begin.*

---

### 9.6 Review queue — THE signature page

**Purpose:** turn amber into green. Source document beside extracted fields; confirm or correct fast.

**Layout (split):**
```
┌ Document preview ─────────┬ Extracted entry ──────────────┐
│                           │  Vendor   [Swiggy        ] ✓   │
│   [ invoice image /       │  Date     [2025-03-12    ] ⬤   │
│     pdf render, with      │  Invoice# [SWG-99281     ] ✓   │
│     highlighted regions ] │  Taxable  [₹ 1,200.00    ] ✓   │
│                           │  GST 5%   [₹    60.00    ] ⬤   │
│                           │  Total    [₹ 1,260.00    ] ✓   │
│                           │  Ledger   [Food Expense ▾] ⬤   │
│                           │  ⚠ Line items don't sum to total│
│                           │                                │
│                           │  [ Reject ]  [ Edit ]  [Approve & post]│
└───────────────────────────┴────────────────────────────────┘
   ◀ 3 of 7        Skip for now        Approve all high-confidence ▸
```

**Behavior:**
- `⬤` marigold dot = AI uncertain on this field; click highlights the matching region in the document.
- `✓` = high confidence; editing it teaches the vendor→ledger map for next time.
- `⚠` warnings from `raw_warnings` surface inline in amber, never block silently.
- **Approve all high-confidence** lets a user clear the easy ones and focus on the flagged few.
- On **Approve & post**: amber border sweeps green, check appears, row leaves, count badge ticks down.

**Copy:**
- Page title: **Review & post** · sub: *I've pulled the details. Confirm or fix, then post.*
- Ledger suggestion microcopy: *"I think this is Food Expense — change it if I'm wrong."*
- Empty: **All caught up. Nothing to review.** + a quiet green check illustration.

---

### 9.7 Vouchers & journals

**Purpose:** browse the posted ledger. Read-only truth (append-only invariant respected in UI).

**Layout:** filter bar (type, date range, FY) + table (voucher no., date, type, party, debit, credit, status).

**Copy:**
- Title: **Vouchers**
- Posting is permanent — the only edit action is **Reverse** (creates a contra entry): button **Reverse entry**, modal *"This posts a reversing entry. The original stays in the record."*
- Empty: **No vouchers yet.** *Approved entries land here.*

---

### 9.8 Chart of accounts

**Purpose:** manage the account tree.

**Layout:** collapsible tree (Assets · Liabilities · Income · Expense · Capital) with sub-ledgers; right panel shows selected account details + balance.

**Copy:**
- Title: **Chart of accounts**
- Add: **Add account** · group field validates account-type rules.
- Empty group: **No accounts under Income yet.** + **Add account.**

---

### 9.9 Purchase

**Purpose:** vendors, purchase bills, expense bills, vendor outstanding.

**Layout:** tabs (Bills · Vendors · Outstanding), table-driven, **New bill** primary.

**Copy:**
- Title: **Purchases**
- Vendor outstanding chip: `Due in 5 days` (ink), `Overdue 12 days` (red).
- Empty: **No purchase bills yet.** *Upload a bill or add one manually.*

---

### 9.10 Sales

**Purpose:** customers, invoices, credit/debit notes, receivables.

**Layout:** tabs (Invoices · Customers · Receivables), **New invoice** primary.

**Copy:**
- Title: **Sales**
- Invoice status: `Draft` · `Sent` · `Paid` (green) · `Overdue` (red).
- Send action keeps name: button **Send invoice** → toast **Invoice sent**.
- Empty: **Create your first invoice.** + **New invoice.**

---

### 9.11 Banking & reconciliation

**Purpose:** import statements, auto-match, resolve differences.

**Layout:** account selector → two columns (Bank lines · Book entries) with matched pairs locked, unmatched highlighted; difference summary on top.

**Copy:**
- Title: **Bank reconciliation**
- Summary band: **₹ 4,200 unmatched across 3 lines.**
- Match microcopy: *"I matched 38 of 41 lines. 3 need you."*
- Action: **Confirm matches** → **Matched** chips turn green.
- Empty: **Import a statement to reconcile.** + **Upload statement.**

---

### 9.12 GST

**Purpose:** registers + GSTR-2A/2B reconciliation + ITC + one-click entry. The India differentiator — make it feel powerful.

**Layout:** tabs (Purchase register · Sales register · 2A/2B reconciliation · Summary). Reconciliation view is a 3-bucket table: **Matched**, **Missing in your books**, **Missing in 2B**, **Mismatched**.

**Copy:**
- Title: **GST**
- Recon header: **You may be missing ₹ 23,400 of input credit.** sub: *18 invoices are in 2B but not in your books.*
- Per-row action on a missing-in-books line: **Create entry** → opens the confidence-field flow → routes to the review queue (never auto-posts).
- Mismatch chip: `Amount differs` / `GSTIN differs` (red).
- Period selector + **Export GSTR-ready** action.
- Empty: **Import your 2B to find missing credit.** + **Import GSTR-2B.**

---

### 9.13 Reports

**Purpose:** the statutory and management reports — all from posted journals.

**Layout:** report picker (P&L · Balance Sheet · Cash Flow · Trial Balance · Ledger · Day Book · Ageing) + period/FY controls + export row.

**Copy:**
- Title: **Reports**
- Each report header carries period + a **Trial balance ties out ✓** confidence marker where relevant.
- Export row: **Excel · PDF · CSV · Send to Tally**.
- Empty: **Post some entries to see reports.**

---

### 9.14 Exports & Tally

**Purpose:** push approved data out; manage the local connector.

**Layout:** export panel + Tally connector status card (Connected / Last sync / Pending vouchers).

**Copy:**
- Connector card title: **Tally connector**
- Status: **Connected — last synced 6 min ago** (green) / **Connector offline** (red) with help: *"Open the connector app on the machine running Tally."*
- Action: **Sync now** → **Synced 12 vouchers**.
- Note: *Masters sync first, then vouchers. Re-syncing never double-posts.*

---

### 9.15 AI insights

**Purpose:** read-only advisory. Clearly labelled as suggestions, never writes to the ledger.

**Layout:** card feed — each insight = headline, one-line explanation, optional drill-in.

**Copy (examples):**
- **Expenses up 18% this month** — *Mostly logistics. Want to see the breakdown?*
- **3 vendors usually paid by now** — *₹ 1,80,000 in bills are past their usual payment date.*
- **GST due in 6 days** — *Estimated ₹ 84,200. Reconcile 2B first to claim full credit.*
- Footer disclaimer chip: `AI suggestion — review before acting.`
- Empty: **Not enough history yet.** *Insights appear as you post more.*

---

### 9.16 Org / company settings

**Purpose:** company, users, COA defaults, GST, integrations, invoice templates, branding (white-label).

**Layout:** left sub-nav (General · Team & roles · Tax & GST · Integrations · Invoice template · Branding) + content.

**Copy:**
- Title: **Settings**
- Team roles use the §10 RBAC matrix; role descriptions in plain language: *"Employee — can upload documents and view reports, can't post entries."*
- Branding (white-label only): logo, accent color, custom domain, client-portal toggle.

---

### 9.17 Platform super admin (Onewebmart-internal)

**Purpose:** run the business — tenants, billing, **AI cost**, feature flags, audit.

**Layout:** separate dark-chromed shell to signal "you're in platform mode." Tables of firms/orgs; per-org **AI & OCR cost** dashboard front and center.

**Copy:**
- Title: **Platform admin**
- Cost card: **AI spend this month: ₹ 1,42,300** with per-org breakdown and margin flags.
- Impersonation action: **View as this org** → persistent banner *"You're viewing Acme Traders as support. Exit"* — every action logged.
- Feature flags, subscription tiers, system health.

---

### 9.18 White-label firm portal

**Purpose:** a CA firm's branded home over its client companies.

**Layout:** firm brand replaces ours; client-company grid with per-client status pills (docs waiting, GST due, overdue).

**Copy:**
- Title: **{Firm name} — clients**
- Per client: **4 to review · GST due in 3 days**.
- Add: **Add client company.**
- Empty: **Add your first client to get started.**

---

## 10. Accessibility & quality floor

- All text meets WCAG AA contrast on its surface. (Marigold on white fails for text — use it for accents/borders/large UI only, never small body text; pending text uses `#945800` on honey.)
- Keyboard reachable, visible focus everywhere, logical tab order, especially in the review queue (Approve/Edit/Reject reachable without a mouse).
- `prefers-reduced-motion` disables the amber→green sweep (jump straight to the result).
- Status never relies on color alone — pair every chip with a label and an icon.
- Touch targets ≥ 44px; the app is usable down to mobile for upload + review on the go.

---

## 11. Implementation tokens (CSS variables)

```css
:root {
  /* brand */
  --saffron-600:#E8590C; --saffron-500:#F76707; --saffron-700:#C84A06;
  --marigold-400:#FAB005; --marigold-300:#FFD43B;
  --honey-100:#FFF4DC; --honey-50:#FFFBF2;
  /* neutrals */
  --ink-900:#1F1A15; --ink-700:#3A322A; --ink-500:#7A6E60; --ink-400:#A8998A;
  --line-200:#EBE3D7; --surface-card:#FFFFFF; --surface-page:#FFFCF6;
  --surface-sink:#F6EFE3; --roast-900:#241A11;
  /* semantic */
  --success-fg:#1E7A47; --success-bg:#E6F6EE;
  --error-fg:#C92A2A;   --error-bg:#FBE9E9;
  --info-fg:#3B5BC0;    --info-bg:#E9EDFB;
  --pending-fg:#945800; --pending-bg:#FFF4DC;
  /* radius */
  --r-sm:6px; --r-md:10px; --r-lg:16px;
  /* type */
  --font-display:"Bricolage Grotesque",sans-serif;
  --font-body:"Hanken Grotesk",sans-serif;
  --font-mono:"JetBrains Mono",monospace;
}
```

---

## 12. Build note

Hand this to Claude Design or a frontend Claude Code session alongside the build spec. Build the **review queue (§9.6) first as the reference page** — it exercises the signature component, the amber→green motion, the confidence field, and the split layout. Once that page feels right, every other page inherits the same tokens and patterns.
