# Financial OS

An AI-native financial intelligence platform that builds a **Digital Financial Twin** from open banking (FDX) data and multi-LLM reasoning. Every external AI call is secured through a PII anonymization boundary — zero personal data ever leaves the trust perimeter.

Built as an MVP simulation designed as a pitch for Wealthsimple.

## What It Does

- **Connects to banks** via simulated FDX v6 open banking APIs (3 banks with different personalities — clean, legacy/MFA, business)
- **Builds a Digital Financial Twin** — unified view of accounts, transactions, balances, and metrics across all institutions
- **Reasons with multiple AI models** — 3 LLMs (Claude, GPT-4o, Gemini) working in parallel from different analytical perspectives, synthesized by a chairman
- **Keeps everything private** — PII filter anonymizes all data before it reaches external LLMs, preserving mathematical ratios for valid analysis
- **Tracks financial progress** — gamified scoring, milestones, streaks, and peer/national benchmarking
- **Plans and acts** — goal-driven financial planning with LLM-generated action DAGs, feasibility analysis, and cross-goal conflict detection
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

# All integration tests (197+ tests, some make real LLM calls)
node --test tests/integration/*.test.js

# Unit tests (no Docker needed)
npm test

# Python guardrails unit tests
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
| 8 | **Action DAG Engine** | LLM-generated execution plans as DAGs, typed nodes, topological execution, goal linkage |

Plus: **Positive Progress** (gamified scoring, milestones, streaks, benchmarks), **Goal System** (LLM feasibility analysis, cross-goal conflicts, similarity detection), and **LLM Guardrails** (inbound rejection + outbound compliance flagging).

## Frontend

React 19 + Vite + Tailwind CSS 4 with a Wealthsimple-inspired design (warm whites, Dune primary, Mulish font).

| Page | What It Shows |
|---|---|
| **Financial Picture** | Twin dashboard — accounts, metrics, holdings, transactions, goals |
| **Progress** | Tier scoring, benchmarks, milestones, streaks, LLM assessment |
| **Your Adviser** | Conversation-first planning — ask questions, track goals, create action plans |
| **Admin** | Registry, users, demo setup, benchmarks, background monitoring |

## Simulated User

**Alex Chen** — 34yo, $105k income, common-law, renting, considering first home.
- Maple Direct: chequing ($4,200) + Visa ($2,800) + Mastercard ($450)
- Heritage Financial: mortgage ($385k, 4.89%) + HELOC
- Frontier Business: business chequing ($12,400) + business Visa ($1,100)
- Wealthsimple: TFSA ($38.5k) + RRSP ($22.1k) + chequing ($1.8k)

Six additional seed users provide varied demographics for multi-user testing.

## Documentation

| Document | Contents |
|---|---|
| [What Was Built](financial-os-what-was-built.md) | Detailed walkthrough of all 8 components, data flows, database schema, test coverage |
| [System Overview](financial-os-system-overview.md) | Vision, core concepts, full system architecture |
| [Architecture](financial-os-architecture.md) | Technical architecture and design decisions |
| [MVP Build Plan](financial-os-mvp-build-plan.md) | 10-phase build plan and component specs |
| [Positive Progress](financial-os-positive-progress.md) | Gamified financial wellness design |
| [Production Considerations](financial-os-production-considerations.md) | Scaling, security, and production readiness notes |
| [Production at Scale](financial-os-production-at-scale.md) | Deep dive on production architecture |

## Tech Stack

- **Backend:** Python 3.12 / FastAPI / asyncpg
- **Banks & Registry:** Node.js 20 / Express
- **Database:** PostgreSQL 16 + pgvector (vector similarity search)
- **Frontend:** React 19 / Vite 7 / Tailwind CSS 4
- **LLMs:** Anthropic Claude, OpenAI GPT-4o, Google Gemini
- **Infrastructure:** Docker Compose (7 services)

## License

Private — not licensed for redistribution.
