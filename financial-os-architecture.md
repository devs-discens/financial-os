# Financial OS: Technical Architecture & Implementation Guide

> **Note:** This document was the pre-build architecture spec. The 8-component structure was followed, but specific implementation details evolved during development. For what was actually built, see [What Was Built](financial-os-what-was-built.md). Key divergences are noted inline with **[Implementation note]** markers.

## Overview

Financial OS is an AI-native platform that builds a **Digital Financial Twin** — a living, real-time model of a user's complete financial life across all connected Canadian financial institutions. It combines open banking data (FDX APIs) with multi-LLM reasoning to deliver cross-institutional financial intelligence.

This document captures the full technical architecture, how existing codebases map in, and the implementation approach for the MVP simulation.

---

## Existing Codebases & Reuse Strategy

### LLM Council (`~/development/python/llmcouncil/llm-council`)

A working multi-LLM deliberation system with:
- **FastAPI backend** — async, SSE streaming, multi-provider LLM clients
- **React + Vite frontend** — chat interface, debate UI, model selection
- **Deliberation engine** — Stage 1 parallel queries → Stage 3 chairman synthesis
- **Debate mode** — flexible rounds, user interjections, chairman summary
- **Providers** — OpenAI, Gemini, Anthropic, Grok via direct APIs
- **Infrastructure** — Auth0, SQLite, Fernet encryption, httpx connection pooling

**Reuse in Financial OS:**
- Council collaborative mode becomes the financial analysis pipeline (Analyst → Strategist → Planner → Chairman)
- Debate mode becomes the adversarial financial decision engine (Bull → Bear → Macro → Chairman)
- All external LLM calls get wrapped with the PII Filter Gateway
- Financial-specific system prompts and role definitions added
- Session-scoped perturbation mapping shared across all council model calls within a session

### Jarvis-EA (`/home/nphilip/jarvis-ea`)

A self-evolving service orchestrator with:
- **7-layer pipeline** — L1 Receive → L2 Intent → L3 Path → L4 Preconditions → L5 Reasoning → L6 Executor → L7 Learning
- **PostgreSQL + pgvector knowledge graph** — nodes, edges, embeddings, execution logs
- **Two-tier reasoning** — Tier 1 cached path replay (ms) / Tier 2 LLM reasoning (learns for next time)
- **Execution DAGs** — dependency resolution, parallel groups, output reference resolution (`{{stepId.output.field}}`)
- **Template-based LLM prompting** — stored in DB, `{{variable}}` substitution
- **Trust scoring** — draft → trusted (3 successes) → degraded (2 failures)
- **Dynamic capability fabrication** — discover, deploy, register new capabilities at runtime

**Reuse in Financial OS:**
- Knowledge graph patterns → institution templates, DAG templates, learned patterns
- Tier 1/2 reasoning → cached template lookup vs. LLM-assisted institution discovery
- L6 executor DAG → Action DAG engine with approval gates
- L7 learning → template caching after first user, DAG template learning
- Precondition verification → DAG prerequisite checks (balance, contribution room)
- Output reference resolution → step-to-step data passing in Action DAGs

---

## Component Architecture

### Component 1: Open Banking Registry Service

**Purpose:** Tracks institution open banking status; simulates staggered rollout.

**Technology:** Node.js / Express

**API Surface:**
```
GET  /registry/institutions              → List all institutions with status
GET  /registry/institutions/{id}         → Single institution capability details
POST /registry/institutions/{id}/go-live → Admin: flip institution to live status
```

**Data Model:**
```json
{
  "id": "maple-direct",
  "name": "Maple Direct Bank",
  "status": "live | pending | not_registered",
  "live_date": "2026-06-01",
  "fdx_version": "6.4",
  "base_url": "http://localhost:3001/fdx/v6",
  "supported_account_types": ["DEPOSIT", "CREDIT_CARD"],
  "supported_data_clusters": ["ACCOUNT_DETAILED", "TRANSACTIONS", "BALANCES"],
  "oauth_endpoint": "http://localhost:3001/oauth",
  "well_known_url": "http://localhost:3001/.well-known/fdx-configuration"
}
```

**Events:** Emits status change events (WebSocket or polling) that the Onboarding Orchestrator subscribes to.

**Simulation:** Heritage goes `pending → live` mid-simulation; Frontier goes `not_registered → pending → live` later.

---

### Component 2: Simulated Bank APIs (×3)

**Purpose:** Three fake banks exposing FDX-compliant endpoints with realistic data for user Alex Chen.

**Technology:** Node.js / Express (one service per bank, different ports)

**Ports:**
- Maple Direct Bank: `localhost:3001`
- Heritage Financial: `localhost:3002`
- Frontier Business Banking: `localhost:3003`

**Per-Bank Endpoints:**

```
# OAuth
GET  /oauth/authorize    → Redirect with simulated consent screen
POST /oauth/token        → Issue access + refresh tokens
POST /oauth/revoke       → Revoke tokens

# FDX v6 Data
GET  /fdx/v6/accounts                       → List consented accounts
GET  /fdx/v6/accounts/{id}                  → Account details
GET  /fdx/v6/accounts/{id}/transactions     → Transaction history (paginated)
GET  /fdx/v6/accounts/{id}/balances         → Current balance
GET  /fdx/v6/accounts/{id}/statements       → Statement data (mortgage amort)

# Discovery
GET  /.well-known/fdx-configuration         → Endpoint & capability discovery
```

**Token Configuration:**
| Parameter | Value |
|---|---|
| Access token TTL | 30 minutes |
| Refresh token TTL | 90 days |
| Consent grant duration | 12 months |

**Data Generation:**
- 6 months pre-seeded transaction history
- New transactions generated on each poll (realistic patterns)
- Mortgage balance decreases with monthly payments
- Credit card balances fluctuate with spending/payments
- Configurable failure injection (rate limits, timeouts, schema changes)

**Bank-Specific Variations:**

| Bank | Accounts | Quirks |
|---|---|---|
| Maple Direct | Chequing ($4,200), Visa ($2,800/$10k), MC ($450/$5k) | Clean FDX, fast responses |
| Heritage Financial | Mortgage ($385k, 4.89% fixed, 14mo to renewal), HELOC ($15k avail) | MFA step in OAuth, amortization via statements endpoint, slower responses |
| Frontier Business | Business chequing ($12,400), Business Visa ($1,100/$8k) | Business account types, different transaction categorization |

---

### Component 3: Dynamic Onboarding Orchestrator

**Purpose:** Handles institution connection lifecycle — capability check, template discovery, OAuth execution, polling configuration.

**Technology:** Python (FastAPI), PostgreSQL knowledge graph

**Inspired by:** Jarvis-EA's Tier 1/2 reasoning, capability fabrication, L7 learning

**Core Flow:**
```
User: "Connect Maple Direct Bank"
    │
    ├── 1. Query Registry → Is institution live?
    │     ├── Not live → inform user, offer notification
    │     └── Live → continue
    │
    ├── 2. Check Knowledge Graph → Template exists?
    │     ├── YES → Tier 1: use cached template (ms)
    │     └── NO → Tier 2: LLM-assisted discovery
    │
    ├── 3. Template Discovery (Tier 2 only)
    │     ├── Fetch .well-known/fdx-configuration
    │     ├── LLM reasons over capabilities
    │     ├── Build template: OAuth config, account types, consent scopes, polling schedule
    │     └── Store template in knowledge graph (learn for next time)
    │
    ├── 4. Execute Onboarding
    │     ├── OAuth redirect → user authenticates & consents
    │     ├── Receive tokens → store encrypted
    │     ├── Configure polling schedule
    │     └── Initial data pull → begin twin construction
    │
    └── 5. Confirm to user
          └── "Connected: Chequing (****4829), Visa (****7712)"
```

**Knowledge Graph Nodes (Institution Template):**
```
Node type: "institution_template"
Properties: {
    "institution_id": "maple-direct",
    "name": "Maple Direct Bank",
    "fdx_version": "6.4",
    "oauth_config": { "authorize_url": "...", "token_url": "...", "mfa_required": false },
    "account_types": ["DEPOSIT", "CREDIT_CARD"],
    "data_clusters": ["ACCOUNT_DETAILED", "TRANSACTIONS", "BALANCES"],
    "polling_schedule": { "transactions": "daily", "balances": "daily", "details": "weekly" },
    "schema_mapping": { ... },
    "status": "trusted",
    "trust_score": { "total_executions": 150, "successes": 149 }
}
```

**Template Caching Demonstration:**
- First user connecting Maple Direct: full LLM reasoning (~3-5s) — show the template being built
- Second connection request: instant template lookup (<100ms) — show the speed difference

---

### Component 4: Background Orchestration Service

**Purpose:** Continuous polling, token lifecycle management, autonomous issue resolution, anomaly detection.

**Technology:** Python (async), integrates with knowledge graph

**Inspired by:** Jarvis-EA's autonomous resolution patterns, trust scoring

**Polling Loop:**
```python
# Per connected institution, per polling cycle:
async def poll_institution(connection):
    # 1. Token management
    if token_expired(connection.access_token):
        try:
            new_tokens = await refresh_token(connection)
            # act-and-log: silent refresh
        except RefreshExpired:
            # ask-first: queue re-auth prompt
            await queue_reauth_notification(connection)
            return

    # 2. Pull balances → compare with twin
    balances = await fetch_balances(connection)
    anomalies = detect_balance_anomalies(balances, twin.last_known)
    if anomalies:
        await alert_user(anomalies)  # immediate notification

    # 3. Pull transactions → enrich → update twin
    transactions = await fetch_transactions(connection, since=last_poll)
    enriched = await categorize_and_enrich(transactions)
    await twin.update_transactions(enriched)

    # 4. Pull account details (if scheduled)
    if scheduled_for_details(connection):
        details = await fetch_account_details(connection)
        await twin.update_details(details)
```

**Autonomy Spectrum:**

| Failure | Behavior | Level |
|---|---|---|
| Transient 503 | Exponential backoff, retry, succeed silently | Act-and-log |
| Rate limit 429 | Back off, retry after delay | Act-and-log |
| Access token expired | Silent refresh via refresh token | Act-and-log |
| Refresh token expired | Queue contextual re-auth prompt | Ask-first |
| Schema change | Fall back to last good data, alert engineering | Escalate |
| Anomalous balance | High-priority user alert | Immediate notification |
| Institution outage | Inform user of data freshness, auto-retry | Inform-and-monitor |
| Consent revoked | Detect 401, update twin, notify user | Inform |

**Anomaly Detection:**
- Unusual balance changes without corresponding transactions
- Duplicate/suspicious transactions across accounts
- Spending pattern deviations (potential fraud)
- Missed recurring payments (mortgage, credit card minimums)
- Approaching credit limits or overdraft thresholds

---

### Component 5: Digital Financial Twin

**Purpose:** Unified data model aggregating all institution data with derived metrics and temporal patterns.

**Technology:** PostgreSQL (knowledge graph tables)

**Data Model:**
```
Twin (user_id)
├── User Profile
│     ├── Demographics: age=34, household=common-law, goals=[first_home]
│     └── Wealthsimple: TFSA=$38,500, RRSP=$22,100, chequing=$1,800
│
├── Connected Institutions[]
│     ├── Institution metadata (from template)
│     ├── Connection status: active | needs_reauth | revoked
│     ├── Last successful poll timestamp
│     └── Accounts[]
│           ├── Type, identifiers, current balance
│           ├── Balance history (time series)
│           ├── Transactions[] (enriched, categorized)
│           └── Type-specific data:
│                 ├── Credit: limit, utilization, min_payment, due_date
│                 ├── Mortgage: rate, remaining, amortization, renewal_date
│                 └── Investment: holdings, book_value, market_value
│
├── Derived Metrics (computed cross-institution)
│     ├── net_worth
│     ├── total_debt, debt_to_income
│     ├── monthly_cash_flow (income - expenses)
│     ├── savings_rate
│     ├── credit_utilization (all cards)
│     ├── tfsa_rrsp_room_utilization
│     └── emergency_fund_months
│
└── Temporal Patterns (learned)
      ├── Income schedule (biweekly, 1st & 15th)
      ├── Recurring expenses & cadence
      ├── Seasonal spending patterns
      └── Savings/investment contribution patterns
```

**Progressive Construction:**

| Phase | Connected | Visibility | What's New |
|---|---|---|---|
| Initial | Wealthsimple only | ~30% | Investments, WS chequing |
| + Maple Direct | + chequing, 2 credit cards | ~60% | Cash flow, spending patterns, income detection |
| + Heritage | + mortgage, HELOC | ~85% | Net worth with debt, DTI, renewal timeline |
| + Frontier | + business accounts | ~95%+ | Business income, personal/business separation |

The system communicates visibility at each stage: "Based on connected accounts, here's what we see. Connecting your mortgage would complete the picture."

---

### Component 6: PII Filter Gateway Service

**Purpose:** Intercepts all outbound LLM calls. Perturbs PII, maintains session-scoped consistency, rehydrates responses.

**Technology:** Python (FastAPI), sits between Council and external LLM APIs

**Architecture:**
```
Internal Service (real data)
    │
    ▼
PII Filter Gateway
    ├── Session Manager
    │     ├── create_session() → generate perturbation mapping
    │     ├── get_session() → retrieve existing mapping
    │     └── end_session() → archive or destroy mapping
    │
    ├── Perturbation Engine
    │     ├── Names → randomized (Alex Chen → Jane Doe)
    │     ├── Financial values → proportional shift (±8-15%, consistent factor)
    │     ├── Institutions → anonymized (Maple Direct → Institution A)
    │     ├── Account numbers → randomized tokens
    │     ├── Addresses → omitted or genericized
    │     └── Dates → shifted by consistent offset
    │
    ├── Outbound Filter
    │     ├── Receive request with real data
    │     ├── Apply perturbation mapping
    │     ├── Store perturbed context (for follow-up calls)
    │     └── Forward perturbed request to external LLM
    │
    ├── Inbound Filter
    │     ├── Receive LLM response (perturbed values)
    │     ├── Reverse-map perturbed → real values
    │     └── Return rehydrated response
    │
    └── Context Store (encrypted)
          ├── Perturbed conversation history per session
          ├── Mapping table per session
          └── Audit log (perturbed data only)
```

**Key Properties:**
- **Session-scoped consistency:** One mapping per session. All LLM calls in a session (including multi-model Council calls) use the same mapping.
- **Proportional perturbation:** Financial values shifted by a consistent factor (e.g., ×0.89). Ratios between accounts are preserved, so financial reasoning remains valid.
- **Stored perturbed context:** Follow-up calls reproduce stored perturbed context + extend it. No re-perturbation of previously sent data.
- **Provider agnostic:** Any LLM provider can be swapped in/out. PII exposure is zero regardless.

**Integration with Council:**
```
User asks question
    → Twin data assembled (real)
    → PII Filter: perturb all data, create session mapping
    → Council Stage 1: all models receive same perturbed data
    → Council Stage 3: chairman sees perturbed Stage 1 outputs
    → Chairman synthesis (perturbed)
    → PII Filter: rehydrate final output
    → User sees response with real values
```

---

### Component 7: LLM Council (Financial Modes)

**Purpose:** Multi-model reasoning over twin data. Two modes: collaborative analysis and adversarial debate.

**Technology:** Python — adapted from existing LLM Council codebase

**Base:** `~/development/python/llmcouncil/llm-council/backend/council.py`

**Collaborative Mode — Financial Health Overview:**
```
Twin data (via PII Filter → "Jane Doe") feeds into:

Model A (Analyst):
  "Analyze Jane Doe's financial state: income, expenses, debt, savings rate,
   investment allocation, cash flow patterns."

Model B (Strategist):
  "Identify top 3 opportunities and top 3 risks in Jane Doe's position.
   Consider rate environment, tax optimization, asset allocation."

Model C (Planner):
  "Assess progress toward stated goals (first home purchase). Identify gaps
   between current trajectory and goal timeline."

Chairman (Synthesizer):
  "Synthesize analyst assessment, strategist opportunities/risks, and planner
   goal analysis into a unified financial health overview with prioritized
   action items."
```

**Adversarial Mode — Decision Debate:**
```
User: "Should I break my mortgage early and refinance?"

Bull (Anthropic Claude — Case for breaking early):
  "Strongest case for breaking now. Current rates, penalty costs, total
   interest savings, cash flow impact."

Bear (OpenAI GPT-4o — Case for waiting):
  "Strongest case for waiting until renewal. Penalty avoidance, rate
   uncertainty, opportunity cost."

Chairman (Google Gemini):
  "Present both cases fairly. Where they agree, disagree. Key decision
   factors. Surface assumptions. Do not recommend — present trade-offs."

> **[Implementation note]** The original design included a fourth "Macro" model. The implementation uses three roles (Bull, Bear, Chairman). The chairman incorporates macro context into its verdict.
```

**Adaptations from Base Council:**
- Financial-specific system prompts and role definitions
- Twin data formatting for LLM consumption
- PII filter integration on all external calls
- Clarification flow for ambiguous financial questions
- Web search integration for market data, rates, economic conditions
- Session continuity through PII filter for follow-up questions

---

### Component 8: Action DAG Engine

**Purpose:** Generates inspectable execution plans from Council recommendations. Manages approval gates and execution.

**Technology:** Python

**Inspired by:** Jarvis-EA's L6 executor (DAG walking, dependency resolution, output references)

**DAG Node Structure:**

> **[Implementation note]** The actual implementation uses simpler node types than originally designed. Rollback conditions, advisor approval gates, and output reference resolution were not implemented in the MVP.

```python
{
    "key": "check-balance",
    "description": "Verify chequing account has sufficient funds",
    "type": "check | transfer | allocate | council | manual",
    "execution_type": "auto | manual | approval_required",
    "dependencies": ["node-key-1", "node-key-2"],
    "status": "pending | approved | completed | failed",
    "instructions": "Human-readable instructions (for manual/transfer steps)",
}
```

**Node types:** `check` (verify conditions against twin), `transfer` (money movement — never auto-executes, returns instructions), `allocate` (fund allocation), `council` (triggers new advisory session), `manual` (user-performed action).

**Human control:** DAGs follow a mandatory three-phase lifecycle: draft → approve (user selects specific nodes) → execute (only approved nodes, in topological order via Kahn's algorithm). Transfer nodes always return instructions for manual user action.

**DAG Generation Flow:**
```
Council recommendation + user approval to act
    │
    ├── 1. LLM generates execution plan as DAG
    │     ├── Identify required steps
    │     ├── Determine dependencies between steps
    │     ├── Classify each step (automated/manual/api)
    │     ├── Set approval gates
    │     └── Define rollback conditions
    │
    ├── 2. User reviews full DAG
    │     ├── Every step visible with dependencies
    │     ├── Automated vs. manual clearly marked
    │     ├── Approval gates explicit
    │     └── User can approve all, partial, or reject
    │
    ├── 3. Execution (approved nodes only)
    │     ├── Topological sort by dependencies
    │     ├── Execute in parallel where possible
    │     ├── Forward outputs to dependent nodes
    │     ├── Pause at manual steps (instructions to user)
    │     └── Pause at approval gates
    │
    └── 4. Audit trail
          ├── Full DAG stored (what was recommended)
          ├── User approval record (what was approved)
          ├── Execution log (what happened)
          └── Outcomes recorded
```

**Phase 1 vs Phase 2:**
- Phase 1 (read-only): Cross-institution transfers are `manual_action` nodes with instructions
- Phase 2 (write-access): Same nodes become `api_action` with FDX write API calls

**DAG Template Caching (from Jarvis-EA pattern):**
- Common scenarios (e.g., "maximize TFSA") produce similar DAGs
- First generation: LLM reasoning to build DAG
- Subsequent instances: cached template with user-specific values
- Trust scoring: templates promoted after successful executions

---

## Database Schema

> **[Implementation note]** The original design called for a generic node/edge knowledge graph. The implementation uses purpose-built relational tables, which proved simpler and more performant. pgvector extensions provide vector similarity search for embeddings.

### Actual Tables (16 tables across V1-V14 migrations)

| Table | Pattern | Purpose |
|---|---|---|
| `institution_templates` | Cache | Onboarding blueprints (OAuth config, endpoints, polling schedule) |
| `connections` | Mutable | User-institution links (tokens, consent, status) |
| `connected_accounts` | SCD2 | Account state with full history (valid_from/valid_to) |
| `twin_transactions` | Append-only | All transactions across all institutions |
| `twin_statements` | Append-only | Bank statements (mortgage amortization schedules) |
| `twin_metrics` | Append-only | Computed metrics over time (net worth, income, DTI, etc.) |
| `onboarding_events` | Append-only | Audit trail of all onboarding and background events |
| `action_dags` | Mutable | Generated action plans with lifecycle status (goal_id FK, archived) |
| `dag_nodes` | Mutable | Individual steps within action plans (with checked/checked_at for checklist tracking) |
| `users` | Mutable | Authentication and profile (demographics, role) |
| `progress_milestones` | Append-only | Detected achievements with narrative and acknowledgement |
| `progress_streaks` | Mutable | Current and longest streak counts |
| `benchmark_overrides` | Mutable | Admin-editable benchmark bracket values |
| `twin_holdings` | Append-only | Investment holdings for on-platform accounts |
| `user_goals` | Mutable | Financial goals with LLM analysis, goal_embedding VECTOR(1536) |
| `council_sessions` | Append-only | Advisory sessions with question_embedding VECTOR(1536), goal_id FK, archived |

**Key patterns:** SCD2 for account history, append-only for immutable data, pgvector HNSW indexes for similarity search, soft archive (boolean) for goals/sessions/DAGs, ON DELETE SET NULL for goal FK cascading.

---

## Service Architecture

```
Port    Service                  Technology       Container
─────   ─────────────────────    ──────────────   ─────────
3001    Maple Direct Bank API    Node.js/Express  docker
3002    Heritage Financial API   Node.js/Express  docker
3003    Frontier Business API    Node.js/Express  docker
3010    Open Banking Registry    Node.js/Express  docker
5433    PostgreSQL + pgvector    PostgreSQL 16     docker
3020    Orchestrator (all)       Python/FastAPI    docker
3030    PII Filter Gateway       Python/FastAPI    docker
5173    React Frontend           React/Vite       local
```

> **[Implementation note]** Background orchestration runs as an embedded asyncio task within the orchestrator (port 3020), not as a separate service. PostgreSQL runs on port 5433 (not 5432) to avoid conflicts with local Postgres installations.

**LLM Providers (external, through PII Filter):**
- Anthropic Claude API
- OpenAI GPT API
- Google Gemini API

---

## Simulation Sequence (10 Phases)

### Phase 1: Initial State
- Wealthsimple accounts pre-loaded (TFSA $38.5k, RRSP $22.1k, chequing $1.8k)
- Registry: Maple Direct = live, Heritage = pending, Frontier = not_registered
- Twin: partial (~30% visibility)

### Phase 2: First Bank Onboarding (Maple Direct)
- LLM-assisted template discovery (Tier 2 — show reasoning)
- OAuth flow → consent → initial data pull
- Twin grows to ~60% visibility

### Phase 3: Background Orchestration Running
- Polling cycles, new transactions appearing
- Demo: silent token refresh, rate limit retry

### Phase 4: First Council Session (Collaborative)
- "How am I doing financially?"
- PII filter: show real → perturbed → rehydrated pipeline
- Multi-model analysis with partial twin data

### Phase 5: Second Bank Online (Heritage Financial)
- Registry update → notification → connection
- Different capabilities (mortgage, MFA, statements endpoint)
- Twin grows to ~85% visibility

### Phase 6: Council Session (Adversarial — Mortgage)
- "Should I break my mortgage early?"
- Bull/Bear/Macro debate with real numbers
- Follow-up demonstrating session continuity through PII filter

### Phase 7: Third Bank Online (Frontier Business)
- Business accounts connected
- Personal vs. business separation
- Twin reaches ~95%+ visibility

### Phase 8: Action DAG Generation
- User acts on mortgage debate recommendation
- DAG generated, reviewed, partially approved
- Execution simulation with manual steps

### Phase 9: Background Failure Handling
- Heritage refresh token expires → re-auth flow
- Anomalous balance → immediate alert
- Frontier schema change → fallback + engineering alert

### Phase 10: Full Twin Overview
- Complete financial picture across all institutions
- Comprehensive Council session over full data

---

## User Profile: Alex Chen (Simulation Data)

| Category | Details |
|---|---|
| **Personal** | Age 34, common-law partner, no kids, renting, considering first home |
| **Income** | ~$105,000/year household |
| **Maple Direct** | Chequing $4,200 · Visa $2,800/$10k · MC $450/$5k |
| **Heritage Financial** | Mortgage $385k @ 4.89% fixed (renews 14 months) · HELOC $15k available |
| **Frontier Business** | Business chequing $12,400 · Business Visa $1,100/$8k |
| **Wealthsimple** | TFSA $38,500 · RRSP $22,100 · Chequing $1,800 |

---

## Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Simulated bank APIs | Node.js / Express | Fast to stand up, easy FDX endpoint simulation |
| Registry service | Node.js / Express | Simple REST API with event emission |
| Orchestrator | Python / FastAPI | Aligns with Jarvis-EA patterns (Postgres knowledge graph) |
| Twin data store | PostgreSQL + pgvector | Knowledge graph from Jarvis-EA |
| PII Filter service | Python / FastAPI | Tight integration with LLM client libraries |
| LLM Council | Python / FastAPI | Direct adaptation from LLM Council codebase |
| Action DAG engine | Python | DAG logic from Jarvis-EA's L6 executor |
| UI | React 19 / Vite 7 / Tailwind CSS 4 | Wealthsimple-inspired design, conversation-first planning |
| External LLMs | Claude, GPT-4o, Gemini | Real API calls through PII filter |
| Embeddings | OpenAI text-embedding-3-small | 1536d vectors for session/goal similarity search |

---

## Features Added During Implementation

> **[Implementation note]** The following features were designed and built during implementation, extending beyond the original 8-component architecture.

### LLM Guardrails

Inbound validation (HTTP 422 rejection for empty/long/off-topic/prompt-injection) wraps all 4 user-facing LLM entry points. Outbound validation flags compliance issues (return promises, unauthorized advice, harmful recommendations) with disclaimer append — never blocks. `SYSTEM_GUARDRAIL` constant appended to all 9 LLM system prompts. `_GROUNDING` constant enforces honest adviser tone on all council prompts.

**File:** `services/onboarding-orchestrator/src/services/guardrails.py`

### Goal System

LLM-powered goal feasibility analysis (green/yellow/red), cross-goal conflict detection, background reassessment (every 10 cycles), pgvector similarity search (threshold 0.80), goal-linked sessions and DAGs via `goal_id` FK. CRUD at `/goals/{user_id}`, discuss via `/goals/{user_id}/{goal_id}/discuss`, plan via `/goals/{user_id}/{goal_id}/plan`.

**Files:** `services/onboarding-orchestrator/src/services/goals.py`, `services/onboarding-orchestrator/src/routes/goals.py`

### Positive Progress

Five-tier scoring (0-100, five weighted components), milestone detection (net worth crossings, emergency fund, debt payoff, tier transitions, personal bests, goal progress), streak tracking, national benchmarks (24 brackets, province COL), peer benchmarks (deterministic from demographics), LLM-generated assessment narrative.

**Files:** `services/onboarding-orchestrator/src/services/benchmarks.py`, `services/onboarding-orchestrator/src/services/milestones.py`, `services/onboarding-orchestrator/src/routes/progress.py`

### Session Persistence

Council sessions stored with pgvector embeddings (1536d, HNSW index). Cosine similarity search for semantic deduplication. Soft archive pattern. Retroactive goal linking via PATCH.

**File:** `services/onboarding-orchestrator/src/services/session_store.py`

### Wealthsimple On-Platform Data

Pre-connected on-platform institution with TFSA/RRSP/chequing accounts and holdings (ETFs, equities, crypto, fixed income, cash). Background polling skips on-platform connections. Twin snapshot includes holdings with portfolio allocation breakdown.

### React Frontend

React 19 + Vite 7 + Tailwind CSS 4. Wealthsimple-inspired design (warm whites #FAF9F7, Dune #32302F, Mulish font). Pages: Financial Picture (twin dashboard), Progress (gamified wellness), Your Adviser (conversation-first planning), Settings (profile editor), Admin (5-tab console). 7 seed users with varied demographics.

### Simulated Users (7)

alex-chen (primary), sarah-johnson, marcus-williams, priya-patel, david-kim, emma-rodriguez, admin. Each with distinct financial profiles, designated bank connections, and Wealthsimple on-platform accounts.
