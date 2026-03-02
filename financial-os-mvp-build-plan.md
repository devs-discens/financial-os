# Financial OS: MVP Simulation Build Plan

## Objective

Build a working simulation that demonstrates the full Financial OS loop end-to-end: dynamic bank onboarding as institutions come online, progressive twin construction, background orchestration with autonomous issue resolution, PII-filtered multi-LLM Council sessions (collaborative and adversarial), and Action DAG generation with user approval.

The simulation uses fake banks with realistic financial data, simulates a staggered open banking rollout, and makes real external LLM calls through the PII filter. Someone can run this and see the complete system in action.

---

## Simulated Environment

### User Profile: Alex Chen

A single user with accounts across multiple institutions. This demonstrates the cross-institutional twin and the progressive onboarding as banks go live at different times.

**Personal finances:**
- Household income: ~$105,000/year
- Age: 34, common-law partner, no kids yet
- Renting, considering first home purchase

**Bank A — Maple Direct Bank** *(live at simulation start)*
- Chequing account: ~$4,200 balance, regular paycheque deposits, daily transaction flow
- Visa credit card: ~$2,800 balance, $10,000 limit, mix of recurring and discretionary spending
- Mastercard credit card: ~$450 balance, $5,000 limit, used mainly for subscriptions and online purchases

**Bank B — Heritage Financial** *(goes live mid-simulation)*
- Mortgage: $385,000 remaining, 4.89% fixed, renews in 14 months, original amortization 25 years
- Home equity line of credit (HELOC): $15,000 available, $0 drawn

**Bank C — Frontier Business Banking** *(goes live later in simulation)*
- Small business chequing: ~$12,400 balance, freelance/consulting income
- Business Visa: ~$1,100 balance, $8,000 limit, business expenses

**Wealthsimple accounts (already on-platform):**
- TFSA: $38,500 in managed portfolio
- RRSP: $22,100 in managed portfolio
- Chequing: $1,800 (secondary, growing as user consolidates)

### Simulated FDX API Layer

Each fake bank exposes a simulated FDX-compliant API surface:

```
/fdx/v6/accounts                    → list of accounts the user has consented to share
/fdx/v6/accounts/{id}               → account details
/fdx/v6/accounts/{id}/transactions  → transaction history
/fdx/v6/accounts/{id}/balances      → current balance
/fdx/v6/accounts/{id}/statements    → statement data (mortgage: amortization details)
```

Each bank also exposes:
- OAuth 2.0 authorization endpoint (simulated consent flow)
- Token endpoint (issues access + refresh tokens with configurable lifetimes)
- `.well-known/fdx-configuration` for endpoint discovery

**Capability differences between banks (realistic variation):**

| Bank | Account Types | Data Clusters | OAuth Flow | Notes |
|---|---|---|---|---|
| Maple Direct | Deposit, Credit Card | ACCOUNT_DETAILED, TRANSACTIONS, BALANCES | Standard | Full FDX support, clean API |
| Heritage Financial | Mortgage, LOC | ACCOUNT_DETAILED, BALANCES, STATEMENTS | Standard + MFA step | Mortgage amortization via statements endpoint. Slower API responses. |
| Frontier Business | Business Deposit, Business Credit | ACCOUNT_DETAILED, TRANSACTIONS, BALANCES | Standard | Business accounts — different transaction categorization patterns |

### Open Banking Registry

A simulated registry service that tracks which institutions are live:

```json
{
  "institutions": [
    {
      "id": "maple-direct",
      "name": "Maple Direct Bank",
      "status": "live",
      "live_date": "2026-06-01",
      "fdx_version": "6.4",
      "base_url": "http://localhost:3001/fdx/v6",
      "supported_account_types": ["DEPOSIT", "CREDIT_CARD"],
      "supported_data_clusters": ["ACCOUNT_DETAILED", "TRANSACTIONS", "BALANCES"]
    },
    {
      "id": "heritage-financial",
      "name": "Heritage Financial",
      "status": "pending",
      "expected_live_date": "2026-09-01",
      "fdx_version": "6.4",
      "base_url": null
    },
    {
      "id": "frontier-business",
      "name": "Frontier Business Banking",
      "status": "not_registered",
      "base_url": null
    }
  ]
}
```

The registry updates during the simulation — Heritage goes live, Frontier registers and then goes live — triggering the orchestrator's dynamic template discovery.

---

## System Components to Build

### Component 1: Open Banking Registry Service

**What it does:** Maintains the list of institutions and their open banking status. Provides lookup for the orchestrator.

**Simulation features:**
- REST API: `GET /registry/institutions` — list all known institutions and their status
- REST API: `GET /registry/institutions/{id}` — check a specific institution's capability
- Admin endpoint to simulate rollout: `POST /registry/institutions/{id}/go-live` — flips an institution from pending to live, populates its base URL and capabilities
- Emits events when institutions change status (orchestrator subscribes)

### Component 2: Simulated Bank APIs (×3)

**What they do:** Each bank runs as a separate service exposing FDX-compliant endpoints with realistic financial data for user Alex Chen.

**Per-bank implementation:**

- OAuth endpoints: `/authorize` (redirect with consent screen), `/token` (issue tokens), `/revoke`
- FDX data endpoints: accounts, transactions, balances, statements
- Configurable token lifetimes (access: 30 min, refresh: 90 days)
- Configurable consent grant duration (12 months)
- Realistic transaction generation — daily transactions on chequing, monthly mortgage payments, recurring subscriptions on credit cards
- Failure injection — configurable rate limiting, occasional timeout, token expiry scenarios

**Data generation:**
- Pre-seeded with 6 months of transaction history
- New transactions generated on each polling cycle to simulate ongoing financial activity
- Mortgage balance decreases with each monthly payment
- Credit card balances fluctuate with spending and payments

### Component 3: Dynamic Onboarding Orchestrator

**What it does:** Handles the entire institution connection lifecycle — from checking capability to running OAuth to configuring polling.

**Core flow:**

```
User requests: "Connect Maple Direct Bank"
  │
  ├── Step 1: Query Registry Service
  │     └── Is Maple Direct live? → YES
  │
  ├── Step 2: Check Knowledge Graph for existing template
  │     └── Template exists? → NO (first time)
  │
  ├── Step 3: Template Discovery (LLM-assisted)
  │     ├── Fetch .well-known/fdx-configuration from Maple Direct
  │     ├── LLM reasons over the capability document
  │     ├── Builds onboarding template:
  │     │     ├── OAuth configuration
  │     │     ├── Available account types & data clusters
  │     │     ├── Consent scope recommendations
  │     │     └── Polling schedule configuration
  │     └── Store template in Knowledge Graph
  │
  ├── Step 4: Execute Onboarding
  │     ├── Redirect user to Maple Direct OAuth
  │     ├── User authenticates & consents
  │     ├── Receive tokens
  │     ├── Configure polling schedule
  │     └── Initial data pull → begin twin construction
  │
  └── Step 5: Confirm to user
        └── "Connected: Chequing (****4829), Visa (****7712), Mastercard (****3301)"
```

**Template caching demonstration:**
- First user connecting Maple Direct: full LLM-assisted discovery (show the reasoning).
- Second simulated connection request: instant template lookup, no LLM call needed (show the speed difference).

**Staggered rollout handling:**
- User requests Heritage Financial before it's live → system informs user it's not yet available, offers to notify when it goes live.
- Heritage goes live → system notifies user → user initiates connection → orchestrator discovers Heritage's capabilities (different from Maple Direct — mortgage accounts, MFA step, statement endpoint for amortization data).
- Same flow for Frontier Business Banking later.

### Component 4: Background Orchestration Service

**What it does:** Runs continuous polling cycles, manages token lifecycles, detects and resolves issues autonomously.

**Polling loop:**

```
Every polling cycle:
  For each connected institution:
    │
    ├── Check access token validity
    │     ├── Valid → proceed
    │     └── Expired → use refresh token to get new access token
    │           ├── Success → proceed (act-and-log)
    │           └── Failure → check refresh token validity
    │                 ├── Refresh token expired → queue re-auth prompt (ask-first)
    │                 └── Other error → escalate (human-in-the-loop)
    │
    ├── Pull balances → compare with last known state
    │     ├── Normal change → update twin
    │     └── Anomalous change → flag for review, alert user
    │
    ├── Pull transactions since last poll → enrich & categorize → update twin
    │
    ├── Pull account details (if scheduled) → check for changes
    │
    └── Log poll result (success/failure/partial)
```

**Simulated failure scenarios to demonstrate:**

| Scenario | Trigger | Expected System Behavior |
|---|---|---|
| Transient API error | Maple Direct returns 503 | Retry with backoff, succeed on attempt 3, log silently |
| Rate limiting | Maple Direct returns 429 | Back off, retry after delay, succeed, log |
| Access token expired | Token TTL elapsed between polls | Silent refresh using refresh token, continue polling |
| Refresh token expired | Simulate Heritage token expiry | Queue contextual re-auth notification for user |
| Schema change | Heritage changes a field name | Detect parsing error, fall back to last good data, alert engineering |
| Anomalous balance | Maple chequing drops $3,000 with no transaction | High-priority user alert |
| Institution outage | Frontier API unreachable | Log, inform user of data freshness, retry on next cycle |
| Consent revoked | User revokes at Heritage directly | Detect on next poll (401), update twin, notify user |

### Component 5: Digital Financial Twin

**What it does:** The unified data model that aggregates, normalizes, and maintains the user's complete financial state.

**Data model:**

```
Twin
├── User Profile
│     ├── Demographics (age, household, goals)
│     └── Wealthsimple account data (direct access, not via FDX)
│
├── Connected Institutions[]
│     ├── Institution metadata (from template)
│     ├── Connection status (active, needs re-auth, revoked)
│     ├── Last successful poll timestamp
│     └── Accounts[]
│           ├── Account type, identifiers
│           ├── Current balance
│           ├── Balance history (time series)
│           ├── Transactions[] (enriched, categorized)
│           └── Account-specific data
│                 ├── Credit: limit, utilization, min payment, due date
│                 ├── Mortgage: rate, remaining balance, amortization, renewal date
│                 └── Investment: holdings, book value, market value
│
├── Derived Metrics (computed across all accounts)
│     ├── Net worth
│     ├── Total debt / debt-to-income
│     ├── Monthly cash flow (income minus expenses)
│     ├── Savings rate
│     ├── Credit utilization (across all cards)
│     ├── TFSA/RRSP contribution room utilization
│     └── Emergency fund coverage (months of expenses)
│
└── Temporal Patterns (learned over time)
      ├── Income schedule (biweekly, 1st & 15th, etc.)
      ├── Recurring expenses & their cadence
      ├── Seasonal spending patterns
      └── Savings/investment contribution patterns
```

**Progressive construction:**
- After connecting Maple Direct: twin shows chequing cash flow, credit card spending patterns, basic income detection. Net worth is partial (Wealthsimple investments + Maple Direct cash - credit card debt).
- After connecting Heritage: mortgage appears, net worth recalculates with property debt, debt-to-income updates, mortgage renewal timeline visible.
- After connecting Frontier: business income visible, personal vs. business cash flow separated, total picture emerges.

Each connection enriches the twin. The system communicates what it can and can't see at each stage.

### Component 6: PII Filter Gateway Service

**What it does:** Intercepts all outbound calls to external LLM APIs. Perturbs PII, maintains session-scoped consistency, stores perturbed context internally, rehydrates responses.

**Implementation:**

```
PII Filter Service
│
├── Session Manager
│     ├── Create session → generate perturbation mapping
│     ├── Get session → retrieve existing mapping for follow-up calls
│     └── End session → archive or destroy mapping
│
├── Perturbation Engine
│     ├── Names → random name generator (Jane Doe, John Smith, etc.)
│     ├── Financial values → proportional shift (±8-15%, consistent factor per session)
│     ├── Institution names → anonymized labels (Institution A, B, C)
│     ├── Account numbers → randomized tokens
│     ├── Addresses → omitted or genericized
│     └── Dates → shifted by consistent offset
│
├── Outbound Filter
│     ├── Receive internal request with real data
│     ├── Apply perturbation mapping
│     ├── Store perturbed context internally (for follow-up calls)
│     └── Forward perturbed request to external LLM
│
├── Inbound Filter
│     ├── Receive LLM response (contains perturbed values)
│     ├── Rehydrate using mapping (replace perturbed values with real ones)
│     └── Return rehydrated response to internal caller
│
└── Context Store (internal, encrypted)
      ├── Perturbed conversation history per session
      ├── Mapping table per session
      └── Audit log of all external calls (perturbed data only)
```

**Demonstration scenarios:**

1. **Single call:** User asks a question. Show the real data going in, the perturbed data going to the LLM, the perturbed response, and the rehydrated response the user sees.
2. **Multi-turn:** User asks a follow-up. Show that the same perturbation mapping is used, the stored perturbed context is sent with the new question, and the LLM sees a coherent conversation.
3. **Council session:** Multiple models called in one session. Show all models receiving the same perturbed dataset. Chairman synthesizes perturbed outputs coherently. Single rehydration at the end.
4. **Provider switch:** Same question sent to two different LLM providers. Show that both receive perturbed data, neither gets real PII, and Wealthsimple can compare outputs safely.

### Component 7: LLM Council

**What it does:** Multi-model reasoning over the twin data. Collaborative and adversarial modes. All calls go through the PII filter.

**Collaborative Mode — Financial Health Overview**

```
Input: Twin data for Alex Chen (via PII filter → "Jane Doe")

Model A (Analyst): 
  "Analyze Jane Doe's current financial state. Income, expenses, 
   debt levels, savings rate, investment allocation."

Model B (Strategist):
  "Given Jane Doe's financial state, identify the top 3 opportunities 
   and top 3 risks in her current financial position."

Model C (Planner):
  "Given Jane Doe's stated goals (first home purchase) and current 
   state, assess progress and identify gaps."

Chairman (Synthesizer):
  "Given the analyst's assessment, strategist's opportunities/risks, 
   and planner's goal analysis, produce a unified financial health 
   overview with prioritized action items."
```

Output (rehydrated): A comprehensive overview using Alex's real numbers, combining state analysis, strategic opportunities, and goal progress.

**Adversarial Mode — Decision Debate**

```
User question: "Should I break my mortgage early and refinance at 
a lower rate, or wait for renewal in 14 months?"

Bull Model (Case for breaking early):
  "Make the strongest case for breaking the mortgage now. Consider 
   current rates, penalty costs, total interest savings, cash flow 
   impact."

Bear Model (Case for waiting):
  "Make the strongest case for waiting until renewal. Consider 
   penalty avoidance, rate uncertainty, opportunity cost of penalty 
   payment, flexibility."

Macro Model (Context check):
  "Assess the current Canadian rate environment, Bank of Canada 
   direction, housing market conditions. Which assumptions in the 
   bull and bear cases are strongest/weakest?"

Chairman (Synthesis):
  "Present both cases fairly. Highlight where they agree, where they 
   disagree, and what the key decision factors are. Surface the 
   assumptions that most affect the outcome. Do not recommend — 
   present the trade-offs clearly so the user can decide."
```

Output: A structured debate showing both sides with real numbers, key assumptions called out, and clear trade-offs for the user to evaluate.

### Component 8: Action DAG Engine

**What it does:** Takes a Council recommendation that the user wants to act on, generates an inspectable execution plan as a directed acyclic graph, and manages approval and execution.

**DAG Generation Flow:**

```
Council recommends: "Maximize TFSA contribution using funds from 
Maple Direct chequing before investing in non-registered account."

User says: "I want to do this."

DAG Engine generates:
│
├── Node 1: Verify TFSA contribution room
│     ├── Type: Automated check
│     ├── Source: CRA data / Wealthsimple records  
│     ├── Prerequisites: None
│     └── Approval: None needed (read-only check)
│
├── Node 2: Verify Maple Direct chequing sufficient balance
│     ├── Type: Automated check (poll twin data)
│     ├── Prerequisites: None
│     └── Approval: None needed (read-only check)
│
├── Node 3: Transfer $6,500 from Maple Direct to Wealthsimple
│     ├── Type: Manual action (Phase 1) / API-initiated (Phase 2)
│     ├── Prerequisites: Node 1 (room confirmed), Node 2 (funds confirmed)
│     ├── Approval: User must confirm
│     ├── Instructions (Phase 1): "Log into Maple Direct, initiate 
│     │   e-transfer of $6,500 to your Wealthsimple chequing account"
│     └── Rollback: N/A (user-initiated, reversible)
│
├── Node 4: Allocate $6,500 to TFSA
│     ├── Type: Automated (Wealthsimple internal)
│     ├── Prerequisites: Node 3 (funds received)
│     ├── Approval: User confirms allocation strategy
│     └── Sub-steps:
│           ├── Move funds from Wealthsimple chequing → TFSA
│           └── Invest per managed portfolio allocation
│
└── Node 5: Review remaining non-registered investment strategy
      ├── Type: New Council session trigger
      ├── Prerequisites: Node 4 (TFSA maxed)
      ├── Approval: User decides whether to proceed
      └── Note: "Once TFSA is maximized, want to explore options for 
           additional investing?"
```

**DAG Visualization:**
The user sees the full plan as a clear step-by-step flow with:
- Status indicators (pending, ready, in-progress, complete, blocked)
- Which steps are automated vs. manual
- Which steps need their approval
- Dependencies between steps
- Estimated completion time

**Partial execution:** User can approve nodes 1-4 but skip node 5 for now. The engine executes the approved subset.

**Advisor integration:** For managed accounts, nodes requiring approval show dual gates — user + advisor must both approve before execution.

---

## Simulation Sequence

The MVP runs as a scripted demonstration with interactive elements. Here's the timeline:

### Phase 1: Initial State
- Wealthsimple accounts for Alex Chen are pre-loaded (TFSA, RRSP, chequing).
- Registry shows Maple Direct as live, Heritage as pending, Frontier as not registered.
- Twin contains only Wealthsimple data — partial financial picture.

### Phase 2: First Bank Onboarding (Maple Direct)
1. User requests: "Connect my Maple Direct accounts."
2. Orchestrator checks registry → Maple Direct is live.
3. No cached template → LLM-assisted template discovery (show the reasoning).
4. Simulated OAuth flow → user consents to chequing + both credit cards.
5. Initial data pull → transactions, balances, account details.
6. Twin updates: cash flow from chequing visible, credit card spending categorized, income detected from paycheque deposits.
7. Twin dashboard shows: "60% visibility. Connect more institutions for a complete picture."

### Phase 3: Background Orchestration Running
- Polling cycles run on Maple Direct. New transactions appear. Twin updates.
- Demonstrate: access token expires, silent refresh, polling continues.
- Demonstrate: one poll hits a rate limit, system retries, succeeds.

### Phase 4: First Council Session (Collaborative)
1. User asks: "How am I doing financially?"
2. PII filter activates: show real data → perturbed data mapping.
3. Council runs in collaborative mode across multiple LLMs.
4. All calls go through PII filter with same session mapping.
5. Chairman synthesizes. Response rehydrated.
6. User sees a financial health overview with real numbers, noting that mortgage and business data aren't yet visible.

### Phase 5: Second Bank Comes Online (Heritage Financial)
1. Registry update: Heritage Financial goes live.
2. User is notified: "Heritage Financial is now available for connection."
3. User requests connection.
4. Orchestrator discovers Heritage — different from Maple Direct (mortgage accounts, MFA step, statements endpoint).
5. New template built and cached.
6. OAuth + MFA flow → user consents to mortgage + HELOC.
7. Data pull: mortgage balance, rate, amortization schedule, renewal date.
8. Twin updates dramatically: net worth recalculates with mortgage debt, debt-to-income updates, mortgage renewal timeline visible.
9. Dashboard: "85% visibility."

### Phase 6: Council Session (Adversarial — Mortgage Decision)
1. User asks: "My mortgage renews in 14 months. Should I break it early and refinance?"
2. PII filter activates with new session mapping.
3. Council runs in adversarial mode: bull case (break early), bear case (wait), macro check.
4. Chairman presents structured debate with real (rehydrated) numbers.
5. User follows up: "What if rates drop another 0.5% by renewal?" — demonstrate session continuity through PII filter.

### Phase 7: Third Bank Comes Online (Frontier Business)
1. Registry update: Frontier registers and goes live.
2. User connects business accounts.
3. Orchestrator discovers Frontier — business account type, different categorization.
4. Twin updates: business income visible, personal vs. business separation, complete financial picture.
5. Dashboard: "95%+ visibility."

### Phase 8: Action DAG Generation
1. From the Phase 6 mortgage debate, user decides: "I want to maximize my TFSA first, then think about the mortgage."
2. Council generates a recommendation with specific steps.
3. Action DAG engine builds the execution plan.
4. User reviews the DAG — sees every step, prerequisites, approval gates.
5. User approves nodes 1-4, defers node 5.
6. Execution simulation: automated checks pass, manual transfer step queued, TFSA allocation prepared.

### Phase 9: Background Failure Handling
- Demonstrate: Heritage refresh token expires → system queues re-auth prompt → user re-authenticates → polling resumes.
- Demonstrate: anomalous balance change on Maple Direct chequing → immediate user alert.
- Demonstrate: Frontier API returns unexpected schema → system falls back to last good data, alerts engineering.

### Phase 10: Full Twin Overview
- Complete financial picture across all institutions and Wealthsimple accounts.
- Net worth, cash flow, debt profile, investment allocation, business vs. personal separation.
- Council can now reason over the full picture — demonstrate a comprehensive advisory session.

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User Interface                              │
│    (Twin Dashboard, Council Chat, Action DAG Viewer, Alerts)        │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
┌──────────────────────────────────┴──────────────────────────────────┐
│                      Wealthsimple Internal                          │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐ │
│  │  Onboarding   │  │  Background   │  │    Action DAG Engine      │ │
│  │  Orchestrator │  │  Orchestrator │  │                           │ │
│  │              │  │  (Polling,    │  │  Generation, Approval,    │ │
│  │  Discovery,  │  │   Token Mgmt, │  │  Execution, Audit         │ │
│  │  Templates,  │  │   Anomaly     │  │                           │ │
│  │  OAuth       │  │   Detection)  │  │                           │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────────────────────┘ │
│         │                 │                                         │
│  ┌──────┴─────────────────┴──────────────────────────────────────┐ │
│  │                    Digital Financial Twin                      │ │
│  │         (Unified data model, derived metrics, patterns)       │ │
│  └──────────────────────────────┬────────────────────────────────┘ │
│                                 │                                   │
│  ┌──────────────────────────────┴────────────────────────────────┐ │
│  │                      LLM Council Engine                       │ │
│  │        (Collaborative & Adversarial modes, Chairman)          │ │
│  └──────────────────────────────┬────────────────────────────────┘ │
│                                 │                                   │
│  ┌──────────────────────────────┴────────────────────────────────┐ │
│  │                 Knowledge Graph / Template Store               │ │
│  │      (Institution templates, DAG templates, learned paths)    │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │     PII Filter Gateway       │
                    │                              │
                    │  Perturbation Engine          │
                    │  Session Manager              │
                    │  Context Store (internal)     │
                    │  Rehydration Engine            │
                    └──────────────┬──────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
   ┌──────┴──────┐         ┌──────┴──────┐         ┌──────┴──────┐
   │  Claude API  │         │   GPT API   │         │ Gemini API  │
   │  (External)  │         │  (External) │         │ (External)  │
   └─────────────┘         └─────────────┘         └─────────────┘

                    ┌──────────────┴──────────────┐
                    │   Open Banking Registry      │
                    └──────────────┬──────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
   ┌──────┴──────┐         ┌──────┴──────┐         ┌──────┴──────┐
   │ Maple Direct │         │  Heritage    │         │  Frontier   │
   │  Bank API    │         │  Financial   │         │  Business   │
   │  (Simulated) │         │  (Simulated) │         │  (Simulated)│
   └─────────────┘         └─────────────┘         └─────────────┘
```

---

## Technology Stack (MVP)

| Layer | Technology | Rationale |
|---|---|---|
| Simulated bank APIs | Node.js / Express | Fast to stand up, easy FDX endpoint simulation |
| Registry service | Node.js / Express | Simple REST API with event emission |
| Orchestrator | Python | Aligns with existing Orchestrator project (Postgres knowledge graph) |
| Twin data store | PostgreSQL | Aligns with existing Orchestrator (knowledge graph tables) |
| PII Filter service | Python | Needs tight integration with LLM client libraries |
| LLM Council | Python | Aligns with existing LLM Council project |
| Action DAG engine | Python | DAG logic, dependency resolution, state management |
| UI (optional) | React or terminal-based | Dashboard for twin, chat for Council, DAG visualization |
| External LLMs | Anthropic Claude, OpenAI GPT | Real API calls through PII filter |

---

## What Success Looks Like

At the end of the simulation, someone watching can see:

1. **Banks coming online dynamically** — the system adapts as institutions become available, builds templates on the fly, caches them for reuse.
2. **The twin growing progressively** — from partial (one bank) to complete (all accounts), with the system communicating what it can and can't see at each stage.
3. **Background orchestration working silently** — polling, refreshing, handling failures without user involvement (except when it genuinely needs the user).
4. **PII never leaving the boundary** — visible side-by-side comparison of what the user sees (real data) vs. what the LLM receives (perturbed data) vs. what comes back (rehydrated).
5. **Multi-LLM reasoning over personal finances** — collaborative and adversarial modes producing genuinely useful financial analysis.
6. **Session continuity through the PII filter** — follow-up questions working naturally, perturbed context maintained internally.
7. **Action plans generated and inspectable** — the DAG as a clear, approvable execution plan with dependency awareness and approval gates.
8. **The learning loop in action** — second bank connection faster than first (cached template), common scenarios producing cached DAG templates.
