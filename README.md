# AI Accounting Platform

AI-first bookkeeping for Indian SMEs and CA firms. Upload the pile — we sort the books.

**Stack:** Next.js 14 + NestJS + MongoDB (replica set) + BullMQ/Redis + S3/MinIO + Gemini

---

## Architecture

```mermaid
flowchart TB
  classDef app fill:#F8F9FA,stroke:#495057,color:#212529
  classDef ledger fill:#D3F9D8,stroke:#2B8A3E,color:#1B3D24
  classDef store fill:#E7F5FF,stroke:#1971C2,color:#0B3A66
  classDef ext fill:#FFF4E6,stroke:#E8590C,color:#5C1F00
  classDef partly fill:#FFF3BF,stroke:#E67700,color:#4D3000

  users["SME team, CA reviewers, employees, customers"]:::app
  inbound["WhatsApp Cloud API and inbound email:<br/>bills sent in"]:::ext

  subgraph web["Web: Next.js 14, apps/web"]
    direction LR
    w1["Review queue,<br/>inbox"]:::app
    w2["Sales, purchase, orders,<br/>stock, projects"]:::app
    w3["Banking, currencies, GST,<br/>TDS, month-end, close"]:::app
    w4["Reports, budgets,<br/>Ask your books"]:::app
    w1 ~~~ w2 ~~~ w3 ~~~ w4
  end

  subgraph api["API: NestJS, apps/api. Every request is scoped to the org in its JWT"]
    direction LR
    capture["Capture: documents,<br/>OCR, AI extraction"]:::app
    proposals[("proposed_entries<br/>AI writes here only")]:::store
    domain["Sales, purchase, orders, stock,<br/>projects, currencies, banking,<br/>GST, TDS, month-end"]:::app
    posting["PostingService<br/>the only ledger writer,<br/>on a person's approval"]:::ledger
    reports["Reports, PDFs, narrative,<br/>Ask your books: read only"]:::app
    capture --> proposals --> posting
    domain --> posting
  end

  subgraph infra["Infrastructure"]
    direction LR
    mongo[("MongoDB replica set<br/>journals, audit log, all data")]:::store
    redis[("Redis and BullMQ workers<br/>OCR, AI, bank feeds,<br/>daily sweep, report emails")]:::store
    s3[("S3 or MinIO<br/>uploaded files")]:::store
    mongo ~~~ redis ~~~ s3
  end

  subgraph outside["Outside services"]
    direction LR
    gemini["Gemini AI"]:::ext
    setu["Setu bank feeds"]:::ext
    razorpay["Razorpay"]:::ext
    smtp["SMTP email"]:::ext
    gsp["GSP: e-invoice, e-way bill,<br/>GST filing, mock today"]:::partly
    gemini ~~~ setu ~~~ razorpay ~~~ smtp ~~~ gsp
  end

  users --> web
  web -->|"HTTPS and JWT"| api
  inbound -->|webhooks| api
  api --> infra
  infra --> outside
  api <--> outside
```

**AI suggests, humans commit.** Every document, AI-read or typed, reaches the ledger the same way:

```mermaid
flowchart LR
  classDef store fill:#E7F5FF,stroke:#1971C2,color:#0B3A66
  classDef human fill:#FFF4E6,stroke:#E8590C,stroke-width:2px,color:#5C1F00
  classDef ledger fill:#D3F9D8,stroke:#2B8A3E,color:#1B3D24
  classDef app fill:#F8F9FA,stroke:#495057,color:#212529

  doc["Bill in: upload,<br/>email or WhatsApp"]:::app --> job["Worker job:<br/>OCR, AI extraction,<br/>sums re-checked in code"]:::app
  job --> pe[("proposed_entries")]:::store
  pe --> review{"A person reviews"}:::human
  review ==>|"Approve & post"| post["PostingService.post<br/>one MongoDB transaction"]:::ledger
  review -->|Reject| kept["Kept, never posted"]:::app
  post --> jr[("journals<br/>balanced, append-only")]:::store
  post --> ctr[("counters<br/>gapless numbers")]:::store
  post --> al[("auditLogs")]:::store
```

The full, editable diagrams (every module and outside service, the data model by domain, and the year from onboarding to year close, each step marked built, partly built or pending) are in [docs/diagrams/ARCHITECTURE_DIAGRAMS.md](docs/diagrams/ARCHITECTURE_DIAGRAMS.md).

---

## Quick start

### Prerequisites
- Node.js 18+
- pnpm 8+
- Docker + Docker Compose

### 1. Clone and install

```bash
pnpm install
```

### 2. Start infrastructure (MongoDB RS + Redis + MinIO)

```bash
docker-compose up -d
```

> **Why replica set?** MongoDB multi-document transactions — required for atomic posting — only work on a replica set, even in dev. The Docker Compose file starts `mongod --replSet rs0` and runs `rs.initiate()` automatically.

### 3. Configure environment

```bash
cp apps/api/.env.example apps/api/.env.local
# Edit GEMINI_API_KEY and other values
```

### 4. Run both apps

```bash
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:3001/api/v1
- Health: http://localhost:3001/api/v1/health
- MinIO console: http://localhost:9001 (minioadmin / minioadmin)

---

## Manual MongoDB replica set setup (without Docker)

If running `mongod` directly:

```bash
# 1. Start mongod with --replSet flag
mongod --replSet rs0 --port 27017 --dbpath /data/db

# 2. In a separate terminal, connect and initiate the RS
mongosh
> rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "localhost:27017" }] })

# 3. Verify
> rs.status()
```

Your connection string must include `replicaSet=rs0`:
```
mongodb://localhost:27017/ai_accounting?replicaSet=rs0&directConnection=true
```

---

## Project structure

```
ai-accounting-platform/
├── apps/
│   ├── api/          NestJS API (port 3001)
│   └── web/          Next.js 14 App Router (port 3000)
├── packages/
│   └── shared/       Shared TypeScript types and DTOs
├── scripts/          DB init scripts
├── docker-compose.yml
├── CLAUDE.md         Non-negotiable invariants for every build session
└── turbo.json        Turborepo pipeline config
```

---

## 8 Invariants (enforced in code — see CLAUDE.md)

1. **Money = integer paise** — never floats, never rupees in the DB
2. **Double-entry, balanced** — `Σ debit = Σ credit`, enforced by Mongoose hook
3. **Append-only journals** — posted journals cannot be mutated; reverse with contra entry
4. **AI suggests, humans commit** — AI writes to `proposedEntries` only, never `journals`
5. **Server-side tenant isolation** — `orgId` from JWT via AsyncLocalStorage, never from client
6. **Universal audit logging** — who/what/when/before/after on every change
7. **Gapless numbering** — voucher numbers via `counters` collection inside the posting transaction
8. **MongoDB as replica set** — transactions require RS; never run standalone in any environment

---

## Build phases

See `AI_ACCOUNTING_BUILD_PLAYBOOK_MONGODB.md` for the full 19-phase build playbook.

| Done | Phase | Description |
|------|-------|-------------|
| ✅ | 0 | Foundation — monorepo, scaffold, CLAUDE.md, design tokens |
| ⬜ | 1 | Tenancy & isolation |
| ⬜ | 2 | Auth & 2FA |
| ⬜ | 3 | RBAC & permission matrix |
| ⬜ | 4 | General Ledger backbone |
| ⬜ | 5–19 | … |

---

## Scripts

```bash
pnpm build        # Build all packages
pnpm dev          # Run all apps in watch mode
pnpm lint         # Lint all packages
pnpm test         # Run all tests
pnpm format       # Format all files with Prettier
```
