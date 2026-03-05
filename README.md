# Financial OS

An AI-native financial intelligence platform that builds a **Digital Financial Twin** from open banking (FDX) data and multi-LLM reasoning. Every external AI call passes through a PII anonymization boundary — zero personal data ever leaves the trust perimeter. Every AI-generated action plan requires explicit human approval before execution.


## What It Does

- **Connects to banks** via simulated FDX v6 open banking APIs (3 banks with different personalities — clean, legacy/MFA, business)
- **Builds a Digital Financial Twin** — unified view of accounts, transactions, balances, and metrics across all institutions
- **Reasons with multiple AI models** — 3 LLMs (Claude, GPT-4o, Gemini) working in parallel from different analytical perspectives, synthesized by a chairman
- **Keeps everything private** — PII filter anonymizes all data before it reaches external LLMs, preserving mathematical ratios for valid analysis
- **Enforces financial advisory scope** — inbound guardrails reject prompt injection, off-topic queries, and abuse; outbound guardrails flag compliance issues
- **Requires human approval** — AI-generated action plans (DAGs) follow a draft → approve → execute lifecycle; money movement nodes never auto-execute
- **Sets and tracks goals** — LLM-powered feasibility analysis with honest assessment, cross-goal conflict detection, and pgvector similarity search
- **Tracks financial progress** — gamified scoring, milestones, streaks, and peer/national benchmarking
- **Stays current** — background polling with token refresh, anomaly detection, and failure handling

## Architecture

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Maple Direct│  │  Heritage   │  │  Frontier   │
│  (bank)     │  │ (bank+MFA)  │  │  (business) │
│    :3001    │  │    :3002    │  │    :3003    │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       └────────────────┼────────────────┘
                        │ FDX v6
                ┌───────┴────────┐
                │    Registry    │
                │     :3010      │
                └───────┬────────┘
                        │
              ┌─────────┴──────────┐
              │    Orchestrator    │  ← onboarding, twin, council,
              │      :3020         │    DAGs, goals, background,
              │                    │    progress, guardrails
              └────┬──────────┬────┘
                   │          │
            ┌──────┴──┐  ┌───┴──────────┐
            │   PII   │  │  PostgreSQL   │
            │ Filter   │  │  + pgvector   │
            │  :3030   │  │    :5433      │
            └────┬─────┘  └──────────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
 Claude       GPT-4o      Gemini
(Anthropic)  (OpenAI)    (Google)
```

**7 Docker services** + a React frontend + PostgreSQL with pgvector.

## Safety and Human Control

The system implements defense-in-depth across every layer where AI interacts with user data or produces recommendations.

### Trust Boundary: PII Filter

Every LLM call passes through a dedicated PII Filter Gateway (separate service, port 3030). No personal data reaches external AI providers.

- **Session-scoped isolation** — each LLM call creates a unique PII session with its own anonymization seed, preventing cross-session correlation
- **Proportional amount shifting** — dollar amounts are scaled by a consistent factor per session, preserving ratios so LLM analysis remains mathematically valid
- **Date shifting** — all dates offset by a consistent number of days per session
- **Entity replacement** — names become "Person A/B/C", institutions become "Institution A/B/C", account numbers are randomized
- **Bidirectional rehydration** — responses are de-anonymized before reaching the user, longest-match-first to prevent partial replacement corruption
- **Explicit session deletion** — every code path that creates a PII session deletes it in a `finally` block; sessions also TTL-expire

### Guardrails: Inbound and Outbound

All four user-facing LLM entry points (council collaborative, council adversarial, DAG generation, goal creation) are wrapped with guardrails.

**Inbound (blocks bad input, HTTP 422):**
- Empty/length validation (max 2,000 characters)
- Prompt injection detection (14 patterns: "ignore previous instructions", "jailbreak", "DAN mode", etc.)
- Off-topic rejection (code generation, creative writing, medical/legal questions) — only when no financial keywords are present
- Financial keyword pass-through (75+ terms) prevents false positives on legitimate queries

**Outbound (flags compliance issues, never blocks):**
- Return promise detection ("guaranteed return", "risk-free return")
- Unauthorized professional advice detection ("as your tax advisor", "I am a certified financial planner")
- Harmful recommendation detection ("payday loan", "borrow to gamble", "max out credit cards to invest")
- When flagged: disclaimer appended — "This is informational only and does not constitute professional financial, tax, or investment advice."

**System prompt reinforcement:** A `SYSTEM_GUARDRAIL` constant is appended to all 9 user-facing LLM system prompts, constraining scope to personal finance and prohibiting return guarantees, specific tax advice, and illegal recommendations.

### Human-in-the-Loop: DAG Approval

AI-generated action plans follow a mandatory three-phase lifecycle:

1. **Draft** — LLM generates a structured action plan as a DAG. Nothing executes. Plan is returned for human review.
2. **Approve** — User reviews nodes and explicitly approves specific steps. Granular control: approve some, skip others.
3. **Execute** — Only approved nodes run, in dependency order. Transfer/money-movement nodes never auto-execute — they return instructions for the user to act on manually.

### Honest Adviser Tone

All council and goal analysis prompts include grounding instructions that force LLMs to:
- Use specific numbers from the user's actual financial data
- Be honest about risks and trade-offs
- Not minimize difficulties or over-promise outcomes
- Clearly explain when a goal is unrealistic, with math showing why

### Authentication and Authorization

- JWT-based auth with access/refresh token pairs
- Role-based access control (admin vs user routes)
- User isolation: `resolve_user_id()` ensures users can only access their own data
- Per-account OAuth consent: bank access tokens are scoped to specific consented accounts, enforced at every FDX endpoint

### Data Integrity

- **SCD2 history** — account changes tracked via valid_from/valid_to, preserving complete balance history
- **Append-only tables** — transactions, statements, and metrics are never updated or deleted
- **Soft deletes** — goals, council sessions, and DAGs are archived (not destroyed), preserving audit trails
- **Idempotent inserts** — `ON CONFLICT DO NOTHING` prevents duplicate data

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 20 (via nvm)
- LLM API keys: Anthropic, OpenAI, and Google Gemini

### 1. Configure API keys

```bash
cd services/onboarding-orchestrator
cp .env.example .env
# Edit .env with your real API keys
```

### 2. Start all services

```bash
cd services
docker compose up --build -d
docker compose ps   # verify all 7 show "healthy" or "running"
```

### 3. Start the UI

```bash
cd services/ui
npm install
npm run dev          # https://localhost:5173
```

### 4. Set up demo data

Open the UI, log in as `admin` / `admin123`, navigate to Admin > Demo, and click **Run Full Setup**. This connects all 7 seed users to their designated banks and seeds Wealthsimple on-platform data.

Then log in as `alex-chen` / `alex123` to see the full experience.

### 5. Run tests

```bash
cd services

# All integration tests (208 tests, some make real LLM calls)
node --test tests/integration/*.test.js

# Unit tests (no Docker needed)
npm test

# Python guardrails unit tests (45 tests)
cd onboarding-orchestrator && python3 -m unittest tests/test_guardrails.py -v
```

### Reset to clean state

```bash
cd services
./scripts/reset.sh              # keep institution templates (faster)
./scripts/reset.sh --full       # clear everything
```

## The 8 Components

| # | Component | What It Does |
|---|---|---|
| 1 | **Open Banking Registry** | Tracks institution lifecycle (not_registered → pending → live), SSE events |
| 2 | **Simulated Banks (x3)** | FDX v6 endpoints, OAuth, per-account consent, failure injection, deterministic transactions |
| 3 | **Onboarding Orchestrator** | 5-step connect flow with LLM-assisted template discovery, MFA, SCD2 account upsert |
| 4 | **Background Orchestration** | 30s polling, token refresh, anomaly detection (20% threshold), exponential backoff |
| 5 | **Digital Financial Twin** | SCD2 accounts, append-only transactions, computed metrics (net worth, income, DTI, etc.) |
| 6 | **PII Filter Gateway** | Session-scoped anonymization preserving mathematical ratios, bidirectional rehydration |
| 7 | **LLM Council** | Collaborative (3 specialists + chairman) and adversarial (bull/bear + verdict) modes, pgvector session persistence |
| 8 | **Action DAG Engine** | LLM-generated execution plans as DAGs, typed nodes, human approval, topological execution |

### Beyond the 8 Components

| Feature | What It Does |
|---|---|
| **Goal System** | LLM feasibility analysis (green/yellow/red), cross-goal conflict detection, similarity search (pgvector), background reassessment, goal-linked sessions and plans |
| **Positive Progress** | 5-tier scoring (Starting Out → Flourishing), milestone detection (net worth crossings, emergency fund, debt payoff, personal bests), streaks, national + peer benchmarks (simulated Stats Canada) |
| **LLM Guardrails** | Inbound rejection (prompt injection, off-topic, abuse) + outbound compliance flagging (return promises, unauthorized advice, harmful recommendations) |
| **Session Persistence** | Council sessions stored with pgvector embeddings (OpenAI text-embedding-3-small, 1536d) for semantic similarity search, soft archive |
| **Wealthsimple On-Platform** | Seeded TFSA/RRSP/chequing accounts with ETF/equity/crypto/fixed-income holdings, portfolio allocation breakdown |

## Frontend

React 19 + Vite + Tailwind CSS 4 with a Wealthsimple-inspired design (warm whites, Dune primary, Mulish font).

| Page | What It Shows |
|---|---|
| **Financial Picture** | Twin dashboard — accounts, metrics, holdings, portfolio allocation, transactions, goals |
| **Progress** | Tier scoring, national + peer benchmarks, milestones, streaks, LLM assessment |
| **Your Adviser** | Conversation-first planning — ask questions, track goals, create action plans, review past conversations |
| **Settings** | Profile editor — demographics, income, occupation, housing, financial goals |
| **Admin** | Registry, users, demo setup, benchmarks, background monitoring with per-user connection health |

## Simulated Users

**Alex Chen** — 34yo, $105k income, common-law, renting, considering first home.
- Maple Direct: chequing ($4,200) + Visa ($2,800) + Mastercard ($450)
- Heritage Financial: mortgage ($385k, 4.89%) + HELOC
- Frontier Business: business chequing ($12,400) + business Visa ($1,100)
- Wealthsimple: TFSA ($38.5k) + RRSP ($22.1k) + chequing ($1.8k)

Six additional seed users (sarah-johnson, marcus-williams, priya-patel, david-kim, emma-rodriguez, admin) provide varied demographics for multi-user testing.

## Documentation

| Document | Contents |
|---|---|
| [What Was Built](financial-os-what-was-built.md) | Detailed walkthrough of all components, data flows, database schema, test coverage |
| [System Overview](financial-os-system-overview.md) | Vision, core concepts, full system architecture |
| [Architecture](financial-os-architecture.md) | Technical architecture, component specs, API surfaces |
| [MVP Build Plan](financial-os-mvp-build-plan.md) | Original 10-phase build plan and component specs |
| [Positive Progress](financial-os-positive-progress.md) | Gamified financial wellness design |
| [Production Considerations](financial-os-production-considerations.md) | Scaling, security, and production readiness |
| [Production at Scale](financial-os-production-at-scale.md) | Deep dive on production architecture at 500K-1M users |

## Tech Stack

- **Backend:** Python 3.12 / FastAPI / asyncpg
- **Banks & Registry:** Node.js 20 / Express
- **Database:** PostgreSQL 16 + pgvector (vector similarity search, HNSW indexes)
- **Frontend:** React 19 / Vite 7 / Tailwind CSS 4
- **LLMs:** Anthropic Claude, OpenAI GPT-4o, Google Gemini
- **Embeddings:** OpenAI text-embedding-3-small (1536d)
- **Infrastructure:** Docker Compose (7 services)

## License

Private — not licensed for redistribution.
