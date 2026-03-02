# Financial OS: The AI-Native Financial Intelligence Platform

> **Note:** This document was the original vision/design document written before construction began. For what was actually built, see [What Was Built](financial-os-what-was-built.md). The core architecture described here was implemented, but specific details (ports, service topology, council roles) evolved during development. Key divergences are noted inline with **[Implementation note]** markers.

## Vision

Open banking is solving the plumbing problem — getting data to flow between institutions. But someone still needs to solve the intelligence problem — making sense of that data, learning user preferences, reasoning across institutions, and getting smarter over time.

Financial OS is an AI-native platform that transforms Wealthsimple from a financial services provider into the operating system for Canadians' financial lives - a platform. It combines real-time multi-institutional data (via open banking FDX APIs) with multi-LLM reasoning to build a **digital financial twin** — a living, continuously-updated model of each user's complete financial state across every connected institution.

The system doesn't layer AI onto existing workflows. It rebuilds the entire data ingestion, enrichment, reasoning, and action pipeline as an AI-native system where orchestration learns and adapts, LLMs reason from multiple perspectives, and every external call is secured through an intelligent PII boundary.

---

## Core Concepts

### The Digital Financial Twin

A persistent, real-time representation of a user's complete financial life across all connected institutions. Not a snapshot — a living model that updates as data flows in.

The twin includes:

- **Account topology:** Every account across every institution — chequing, savings, credit cards, mortgages, lines of credit, investment accounts, business accounts — mapped as a unified graph.
- **Transaction flow:** Categorized, enriched transaction history across all accounts. Income sources, recurring expenses, discretionary spending, debt servicing — all visible in one place.
- **Position & balance state:** Current balances, investment holdings, debt balances, credit utilization — updated on each polling cycle.
- **Temporal patterns:** The system learns the user's financial rhythms — payday cycles, seasonal spending, contribution patterns, bill payment timing.
- **Derived insights:** Net worth, savings rate, debt-to-income ratio, TFSA/RRSP contribution room utilization, mortgage-to-income ratio — computed across institutions, not siloed within one.

No single institution has this view. BMO sees BMO accounts. RBC sees RBC. The user's accountant sees a snapshot once a year. Financial OS sees everything, in real time, and reasons across it.

**Event-Sourced Foundation**
The twin is built on an event-sourced model — rather than storing only the current state, every event that changed it is stored: every transaction pulled, every balance update, every connection made, every anomaly detected. The current state is derived by replaying the event log. This gives full audit history, the ability to replay and debug any point in time, and a compliance story regulators will expect from a system handling millions of financial profiles.

**Eventual Consistency**
The twin is never perfectly real-time. There's always a lag between what happened at the bank and what the twin shows. The system communicates this honestly — "Maple Direct data as of 2:00 AM today" — and handles cases where the user knows something the twin doesn't yet (e.g., they just made a transfer that hasn't been polled yet). Each data source carries a freshness timestamp, and the UI surfaces staleness explicitly rather than pretending the data is live.

### Open Banking as the Data Layer

Canada's Consumer-Driven Banking Framework provides the secure, standardized, consent-driven data pipes:

- **Phase 1 (2026):** Read-access — users authorize institutions to share account data, balances, and transactions via FDX APIs with accredited third parties.
- **Phase 2 (mid-2027):** Write-access — payment initiation, account switching, and directed financial actions via the Real-Time Rail.

Financial OS is architected for both phases. Read-access builds the twin. Write-access enables Action DAGs to execute across institutions.

---

## System Architecture

### 1. Dynamic Onboarding Orchestrator

Bank onboarding is not hardcoded per institution. The orchestrator dynamically discovers and connects to institutions as they come online and as users request them.

**Capability Registry**
A continuously updated registry of which institutions are live on open banking, what FDX API version they support, what account types and data clusters they expose, and what consent scopes they offer. As institutions roll out over months and years, the registry grows.

**Template Discovery & Fabrication**
When a user requests connection to an institution for the first time:

1. **Capability check** — Is this institution live? If not, inform the user. If in legacy mode (Plaid/Flinks), offer fallback during transition period.
2. **Endpoint discovery** — The orchestrator examines the institution's FDX endpoint, discovers available resources (account types, data clusters, consent parameters).
3. **Template construction** — An LLM reasons through the institution's capabilities and builds an onboarding template: OAuth flow configuration, consent scope options to present to the user, available account types, polling schedule recommendations, schema mapping for data normalization.
4. **Template caching** — The template is stored in the knowledge graph. Every subsequent user connecting to this institution uses the cached template. First user triggers LLM reasoning. User 1,000,000 hits a cached lookup in milliseconds.

**Template Versioning**
Banks will update their FDX APIs over time — new endpoints, changed schemas, deprecated fields. The orchestrator detects when a cached template is stale (usually via a failed poll or unexpected response shape) and triggers re-discovery. Templates are versioned with graceful migration rather than hard breaks — the old template remains active until the new one is validated, so existing connections aren't disrupted during the transition.

**Per-User Onboarding Execution**
For each user connecting an institution:

1. OAuth redirect to the institution's login page — user authenticates directly with their bank, Wealthsimple never sees credentials.
2. Consent screen presented based on the institution template — user selects which accounts and data types to share.
3. Institution issues OAuth tokens (access + refresh) to Wealthsimple.
4. Orchestrator configures polling schedule based on the data types consented.
5. Initial data pull — twin begins construction for this institution's accounts.

**Institution Onboarding is a Configuration Problem, Not an Engineering Problem**

When a new institution announces FDX compliance — say BMO publishes their FDX 6.4 endpoints tomorrow — adding them to Financial OS does not require new code in the orchestrator, the twin, the council, or any reasoning component. The entire intelligence pipeline is institution-agnostic by design.

What changes:

1. **A data configuration** defining what accounts BMO offers (chequing, savings, credit cards, mortgages) and what transaction patterns their customers see (payday deposits, subscription charges, mortgage payments).
2. **A registry entry** so the platform knows BMO exists, its FDX base URL, and whether it requires MFA.
3. **An infrastructure entry** so BMO runs alongside the other institutions in the deployment.

That's it. The orchestrator's template discovery, OAuth flow, data pull, SCD2 account tracking, transaction ingestion, metrics computation, PII filtering, Council reasoning, and Action DAG generation all work identically for BMO as they do for every other institution — because they operate on the FDX standard, not on institution-specific logic.

The first user who connects BMO triggers LLM-assisted template discovery — the orchestrator examines BMO's `.well-known/fdx-configuration` endpoint, reasons through its capabilities, and caches a template. Every subsequent BMO user hits that cached template in milliseconds. The platform learns BMO once, then scales to millions of BMO users without additional reasoning cost.

This is the architectural payoff of building institution-agnostic from day one: as Canada's open banking rollout adds institutions over months and years, Financial OS absorbs each one as a configuration change, not a development project.

**Progressive Twin Construction**
Open banking rolls out bank by bank. The twin grows incrementally:

- User connects Bank A in month 1 → twin shows 60% of their financial picture.
- Bank B goes live in month 3, user connects → twin grows to 85%.
- Bank C goes live in month 6, user connects → twin reaches 95%+.

The system handles partial visibility gracefully. Recommendations are qualified by what's visible: "Based on the accounts you've connected, here's what we see. Connecting your mortgage would give us a more complete picture."

### 2. Background Orchestration Layer

A continuous background process that keeps the twin alive, accurate, and healthy — autonomously resolving what it can, escalating what it can't.

**Scheduled Polling**
Each connected institution is polled on a configured cadence:

- Transaction data: daily (or more frequent for active accounts)
- Balances: daily
- Account details & static data: weekly
- Mortgage/loan amortization details: monthly
- Investment holdings & positions: daily during market hours

Polling runs through the standard FDX API calls — `/accounts`, `/accounts/{id}/transactions`, `/accounts/{id}/balances` — using the stored OAuth tokens.

**Rate Limiting & Backpressure**
At scale — millions of users each connected to 3-5 institutions — polling generates tens of millions of API calls daily. The system respects each institution's rate limits as a shared resource (not per-user), spreads polling across time windows to avoid thundering herd, and gracefully degrades when an institution is under load. Backpressure signals flow from the institution through the orchestrator to the polling scheduler, which adjusts cadence dynamically rather than blindly retrying.

**Token Lifecycle Management**
- Access tokens (15-60 min lifespan): silently refreshed using the refresh token before each polling cycle. No user involvement.
- Refresh tokens (weeks to months): monitored for approaching expiry. When renewal is needed, the system queues a contextual re-authentication prompt delivered at the right moment (not a generic banner that sits for weeks).
- Consent grants (typically 12 months): tracked and managed. Proactive re-consent flow initiated before expiry.

**Autonomous Issue Resolution — The Autonomy Spectrum**

| Failure Type | System Response | Autonomy Level |
|---|---|---|
| Rate limit / transient API error | Exponential backoff, retry, succeed silently | Act-and-log |
| Stale data (poll returned unchanged data) | Verify with a balance check, log if consistent | Act-and-log |
| Refresh token approaching expiry | Queue contextual re-auth prompt at optimal time | Ask-first |
| Unexpected schema change at institution | Flag internally, alert engineering, fall back to last good data, inform user of data freshness | Escalate to human-in-the-loop |
| Anomalous balance change without matching transaction | High-priority alert to user immediately | Immediate notification |
| Institution API unreachable for extended period | Inform user, track status, auto-retry when available | Inform-and-monitor |
| Consent revoked externally (user revoked at bank) | Detect on next poll, update twin, notify user | Inform |

**Consent Drift**
A user might revoke consent at the bank's own dashboard without telling Wealthsimple. The system discovers this on the next poll (401 unauthorized) and handles it gracefully — updates the twin to reflect reduced visibility, informs the user of what's no longer connected, and doesn't crash or leave stale data pretending to be current. The twin's completeness percentage recalculates, and any active Action DAGs that depend on the revoked data source are paused with an explanation.

**Anomaly Detection**
The background layer doesn't just poll — it watches for patterns that need attention:

- Unusual balance changes without corresponding transactions
- Duplicate or suspicious transactions across accounts
- Spending pattern deviations that might indicate fraud
- Missed recurring payments (mortgage, credit card minimums)
- Approaching credit limits or overdraft thresholds

These feed into both the twin (enriching the model with risk signals) and the user-facing experience (proactive alerts).

### 3. PII Filter Gateway Service

**Architectural Boundary**
All internal Wealthsimple services operate on real data. The PII filter sits at the boundary between Wealthsimple's infrastructure and any external service — primarily external LLM APIs (Claude, GPT, Gemini, etc.).

No real PII ever leaves Wealthsimple's trust perimeter.

**Intelligent Perturbation**
The filter doesn't strip data — it transforms it. Every detail in the outbound request is replaced with a realistic but fictional equivalent:

- **Names:** Real names → randomized names (Jane Doe, John Doe, etc.)
- **Financial values:** Real amounts → proportionally perturbed amounts ($12,754 → $11,278). Perturbation preserves ratios and relationships between accounts so financial reasoning remains valid.
- **Institutions:** Real institution names → anonymized labels (Institution A, Institution B). The LLM doesn't need to know it's BMO — it needs to know it's a chequing account at an institution.
- **Account identifiers:** Real account numbers → randomized tokens.
- **Addresses, employers, personal details:** Replaced with fictional equivalents or omitted entirely where not needed for reasoning.

**Session-Scoped Consistency**
Each advisory session generates one perturbation mapping. All external LLM calls within that session use the same mapping. This means:

- The LLM sees a coherent multi-turn conversation about a consistent fictional person.
- Follow-up questions reference the same perturbed values — no contradictions.
- Multiple Council models in the same session all reason over the same perturbed dataset, so the chairman's synthesis is coherent.

**Multi-Tenant Session Isolation**
When millions of users run concurrent advisory sessions, the filter must guarantee complete isolation between session mappings. No risk of cross-contamination where User A's real values leak into User B's perturbed context. Each session is keyed by a unique identifier, session stores are isolated by design (not by convention), and the architecture enforces that a session's entity mappings are never accessible from another session's scope. This is a hard security boundary, not a soft one.

**Rehydrated Context Preserved Internally**
After each LLM call, the perturbed context (exactly what was sent to the external model) is stored inside Wealthsimple's infrastructure alongside the mapping table. For follow-up calls, this stored perturbed context is reproduced and extended — not regenerated. This guarantees consistency across the full session.

**Lifecycle**

1. Session begins — perturbation mapping generated and stored internally.
2. Each external LLM call — outbound data perturbed using the session mapping. Response rehydrated for the user.
3. Perturbed context stored internally after each call for use in subsequent calls.
4. Session ends — mapping archived (encrypted, with retention policy for compliance audit) or destroyed.

**Provider Agnosticism**
Because the PII filter is a service that all external calls pass through, Wealthsimple can switch LLM providers at any time with zero data risk. Test Claude today, evaluate Gemini tomorrow, run both in the Council simultaneously — the PII exposure is zero regardless of provider.

### 4. LLM Council

The multi-model reasoning engine that powers the intelligence layer of Financial OS. The Council takes the user's question plus relevant twin data, reasons through it from multiple perspectives, and produces analysis the user can understand and act on.

**The Council gives ideas, not actions.** It produces analysis, scenarios, trade-offs, and reasoning. It does not execute anything. Users see the why — and they decide.

**Collaborative Mode**
Multiple models work together to build a comprehensive analysis:

- Model A: Analyzes the user's current financial state from the twin data.
- Model B: Researches market conditions, rate environment, tax implications (potentially using Fey's market data).
- Model C: Considers the user's stated goals, risk tolerance, and life stage.
- Chairman: Synthesizes all perspectives into a coherent overview with clear scenarios.

Use case: "Give me an overview of my financial health" or "How am I doing on my retirement savings?"

**Adversarial / Debate Mode**
Models argue opposing positions on a financial decision:

- Bull model (Anthropic Claude): Makes the strongest case for Option A (e.g., pay off the mortgage early).
- Bear model (OpenAI GPT-4o): Makes the strongest case for Option B (e.g., invest the money instead).
- Chairman (Google Gemini): Presents both cases fairly, highlights where they agree and disagree, surfaces key assumptions and uncertainties.

> **[Implementation note]** The original design included a fourth "Macro" model. The implementation uses three roles (Bull, Bear, Chairman), with the chairman incorporating macro context into its verdict.

Use case: "Should I pay off my mortgage or invest?" or "Is now a good time to buy a rental property?"

**PII Filter Integration**
All Council models are external LLM calls. Every call passes through the PII filter. All models in a session use the same perturbation mapping. The chairman sees perturbed outputs from other models and synthesizes in perturbed space. Final output is rehydrated once before presentation to the user.

**Clarification Flow**
Financial questions are often ambiguous. "Should I save more?" depends on: save for what? In what account type? Over what time horizon? At what risk tolerance? The Council can generate clarifying questions before deliberating, ensuring the analysis is relevant to the user's actual situation.

> **[Implementation note]** Clarification flow was not implemented in the MVP. System prompts and grounding constants handle ambiguity by requiring LLMs to ask for specifics within their responses when needed.

**Session Persistence and Similarity Search**

> **[Implementation note]** Every council session is stored in `council_sessions` with pgvector embeddings (OpenAI text-embedding-3-small, 1536d, HNSW index). Before answering a new question, the system can surface past sessions that covered similar ground via cosine similarity search. Sessions accept an optional `goal_id` to link advisory sessions to financial goals. Sessions support soft archive (excluded from list/similarity but preserved for audit).

### 5. Action DAGs

When the Council produces a recommendation and the user decides to act, the system generates an Action DAG — a directed acyclic graph of the specific steps needed to execute that scenario.

**DAG Structure**
Each node in the DAG represents an action step:

- **Prerequisites:** What must be true before this step can execute (e.g., sufficient balance, TFSA contribution room available).
- **Dependencies:** Which prior steps must complete first.
- **Approval gates:** Who must approve — user alone, or user + advisor for managed accounts.
- **Execution type:** Automated (Wealthsimple-internal action), manual (user must act at external institution — Phase 1 reality), or API-initiated (external action via FDX write-access — Phase 2).
- **Rollback conditions:** What happens if this step fails after prior steps succeeded.

**Sagas & Compensating Transactions**
When a DAG spans multiple systems (Wealthsimple internal + external banks via FDX), there's no single database transaction that can roll everything back if something fails halfway. The DAG engine manages this as a saga — each node carries its forward action paired with a compensating transaction (a defined "undo" action). If Node 4 fails after Nodes 1-3 succeeded, the engine walks backward and reverses the completed steps. Each node specifies whether compensation is automatic, manual, or requires approval — mapping naturally onto the autonomy spectrum. This is what separates a toy execution engine from one that can handle real money movement.

**Idempotency**
If a transfer request times out, did it go through or not? Every action in the DAG carries an idempotency key so that retrying a step never accidentally executes it twice. This is critical for anything involving money movement. The engine stores execution state per-node with the idempotency key, and on retry checks whether the step already completed before re-executing.

**Inspectability**
The user sees the entire DAG before anything executes. Every step is visible, every dependency is clear, every approval gate is explicit. No surprises. The user understands what will happen, in what order, and what requires their action vs. what the system handles.

**Approval Flow**

- Self-directed users: Review DAG, approve/modify, trigger execution.
- Managed account users: Review DAG, advisor reviews DAG, both approve, trigger execution.
- Partial approval: User can approve steps 1-3 but hold step 4 for later. The DAG handles partial execution gracefully.

**Phased Capability**

- Phase 1 (read-only): Action DAGs involving external institutions include manual steps — "Transfer $X from Institution B to Wealthsimple" as a user-action item with instructions.
- Phase 2 (write-access): Those manual steps become automated — the system can initiate transfers, payments, and account actions across institutions via FDX write APIs and the Real-Time Rail.

The DAG architecture is the same in both phases. Write-access simply unlocks nodes that were previously manual.

**DAG Templates & Learning**
Common scenarios produce similar DAGs. "Maximize TFSA then invest remainder" is a pattern that recurs across thousands of users. The orchestrator caches DAG templates for common scenarios. First generation requires LLM reasoning. Subsequent instances use cached templates with user-specific values.

**Audit Trail**
Every generated DAG is stored as a complete record: what the Council recommended, what the user approved, what steps executed, what the outcomes were. This serves compliance requirements, enables system improvement, and gives users a history of their financial decisions.

---

### 6. LLM Guardrails

> **[Implementation note]** This section describes functionality that was built after the original vision document.

Embedded inbound and outbound validation that keeps all LLM interactions within appropriate financial advisory scope. Four layers of protection:

**Inbound validation** wraps all four user-facing LLM entry points (council collaborative, council adversarial, DAG generate, goal add/update) at the route level. Requests are rejected with HTTP 422 if they are empty, excessively long (>2,000 chars), off-topic (no financial relevance), or contain prompt injection attempts (14 patterns including "ignore previous instructions", "jailbreak", "DAN mode"). The validation is deliberately permissive — 75+ financial keywords provide a fast-pass, and ambiguous queries pass through rather than being blocked.

**Outbound validation** scans all LLM responses after rehydration, flagging compliance issues: return promises ("guaranteed 12% returns"), unauthorized professional advice ("as your tax advisor"), or harmful recommendations ("take out a payday loan to invest"). Flagged responses are never blocked — a disclaimer is appended instead.

**System prompt reinforcement** via a `SYSTEM_GUARDRAIL` constant appended to all 9 user-facing LLM system prompts, establishing behavioral boundaries at the model level.

**Honest adviser tone** via a `_GROUNDING` constant on all council prompts and goal analysis prompts, forcing LLMs to use real numbers, acknowledge risks, and avoid over-promising.

The current implementation uses regex-based pattern matching — fast, zero-cost, no false positives. The architecture is designed to evolve to a fine-tuned classifier (BERT/DistilBERT) behind the same interface.

### 7. Goal System

> **[Implementation note]** This section describes functionality that was built after the original vision document.

LLM-powered financial goal tracking that serves as the organizing principle for the platform's planning features.

Users describe goals in natural language. The system runs the description through the PII filter with the twin snapshot, and the LLM returns structured analysis: summary label, goal type (savings/debt_payoff/investment/purchase/income/retirement/emergency_fund), target amount and date, feasibility assessment (green/yellow/red), narrative assessment, cross-goal impact analysis, and estimated progress percentage.

**Cross-goal conflict detection:** Multiple goals competing for the same resources (e.g., aggressive RRSP contributions alongside a down payment savings goal) are identified and explained.

**Background reassessment:** Active goals are automatically re-evaluated every 10 polling cycles against current twin data.

**Goal similarity detection:** Goals are embedded via pgvector (cosine similarity, threshold 0.80) to detect duplicate or overlapping goals.

**Goal-linked sessions and plans:** Goals connect to the Council and DAG engine via `goal_id`, creating a traceable chain: conversation → goal → action plan.

### 8. Positive Progress (Gamified Financial Wellness)

> **[Implementation note]** This section describes functionality that was built after the original vision document. See [Positive Progress design](financial-os-positive-progress.md) for the original vision.

A gamification layer that transforms the Digital Twin from a data dashboard into an encouraging financial companion. Design principle: **celebration of progress, not punishment of spending.**

**Five-tier scoring system** (Starting Out → Building → Growing → Thriving → Flourishing) computed from five weighted components: savings rate (25%), emergency fund (25%), debt-to-income trend (20%), credit utilization (15%), and consistency (15%).

**Milestone detection:** Net worth crossings ($0, $10K, $25K...), emergency fund levels, savings milestones, debt payoff, tier transitions, goal progress thresholds, and personal bests.

**Streak tracking:** Consecutive positive savings and debt reduction periods.

**Benchmarking:** National benchmarks (simulated Stats Canada, 24 age/income brackets, province cost-of-living adjustments) and peer benchmarks (deterministic from demographics hash).

**Assessment engine:** LLM-generated narrative titles and summaries with rule-based fallback. Wired into the background poll cycle.

### 9. Human Control and Safety

> **[Implementation note]** This section describes the defense-in-depth approach implemented across the system.

**DAG approval lifecycle:** AI-generated action plans follow a mandatory three-phase lifecycle — draft (LLM generates, nothing executes) → approve (user explicitly selects which nodes to proceed with) → execute (only approved nodes run in dependency order). Transfer/money-movement nodes never auto-execute — they return instructions for the user to act on manually.

**Authentication and authorization:** JWT-based auth with access/refresh token pairs. Role-based access control (admin vs user). User isolation via `resolve_user_id()` ensures users can only access their own data. Per-account OAuth consent enforced at every FDX endpoint.

**Data integrity:** SCD2 history preserves complete account change records. Append-only tables for transactions, statements, metrics. Soft deletes (goals, sessions, DAGs) preserve audit trails. Idempotent inserts prevent duplicates.

---

## The Learning Loop

Financial OS gets smarter at every level over time:

**Per-institution:** First user connecting a new bank triggers template discovery via LLM reasoning. Template is cached. Every subsequent user benefits from the cached knowledge.

**Per-user:** Each question teaches the system the user's priorities, risk tolerance, financial goals, and communication preferences. The orchestrator builds a personalized context that makes subsequent interactions faster and more relevant.

**Cross-user (anonymized):** Aggregate patterns across millions of twins — stripped of all PII — reveal insights no single institution has. "Users with similar income/debt profiles who chose Option A had X outcome on average." These patterns improve the Council's reasoning over time.

**Per-scenario:** Common financial decisions produce repeating patterns. The system builds a library of scenario templates, DAG templates, and reasoning patterns that make it faster and more reliable with each use.

---

## Platform Implications

### Asset Consolidation Engine

The twin sees everything. When Wealthsimple can identify a low-interest savings account at Institution B, underperforming investments at Institution C, or an approaching mortgage renewal at Institution D — every insight is a potential consolidation opportunity, driven by genuine value to the user.

### Premium Advisory Tier

Basic twin and financial overview: included. Deep Council analysis, adversarial debate mode, proactive scenario planning, Action DAGs with advisor review: premium feature justifying management fees or a subscription tier.

### Data Flywheel

More connected users → richer aggregate patterns → better reasoning → more value per user → more users connect more accounts. The twin creates a cross-institutional dataset that no Canadian bank or fintech has.

### Switching Cost

A user who has connected 6 institutions, 15 accounts, asked 200 questions over 3 years, and built a rich personalized context cannot easily replicate that at a competitor. The twin is the stickiest product Wealthsimple can build.

---

## Alignment with Wealthsimple's Existing Assets

| Existing Asset | Financial OS Role |
|---|---|
| Fey (acquired Aug 2025) | Market data & research feeds into Council's macro analysis |
| Wealthsimple Tax (1.7M returns) | Tax data enriches the twin — contribution room, income verification, tax optimization |
| 30+ ML models on NVIDIA Triton | Transaction enrichment, categorization, fraud detection — powers the twin's data quality |
| Willow (AI voice agent) | Conversational interface for twin insights, re-auth prompts, proactive alerts |
| Chequing, credit card, mortgages | Products that receive assets the twin identifies as suboptimally placed elsewhere |
| Managed portfolios + advisor network | Advisor-in-the-loop for Action DAG approval on managed accounts |

---

## Regulatory Positioning

- **Information, not advice:** The Council provides analysis, scenarios, and reasoning. Users decide. This positions Financial OS as a financial information tool, not an advisory service — unless used within Wealthsimple's licensed advisory products where advisor-in-the-loop applies.
- **PII never leaves:** The filter architecture means no personal financial data reaches external services. Audit trails prove it.
- **Consent is user-controlled:** FDX consent grants are per-institution, per-account-group, per-data-type. Users see exactly what they're sharing, can revoke anytime, from either Wealthsimple or the institution.
- **Action DAGs are transparent:** Nothing executes without explicit user approval. Every step is visible and inspectable before execution.

---

## Production Considerations

These concerns represent the gap between a working demo and a production system handling real money for millions of users. Each is structurally present in the architecture (defined above, visible in the design) even if not fully implemented in the MVP.

| Concern | Where It Lives | Architecture Section |
|---|---|---|
| **Event Sourcing** | Twin stores every event, not just current state. Full audit trail and time-travel debugging. | Digital Financial Twin |
| **Eventual Consistency** | Twin is never perfectly real-time. Freshness timestamps and honest staleness communication. | Digital Financial Twin |
| **Template Versioning** | Stale templates detected via failed polls; versioned migration without hard breaks. | Dynamic Onboarding Orchestrator |
| **Rate Limiting & Backpressure** | Shared rate limit budget per institution, adaptive polling cadence, graceful degradation. | Background Orchestration Layer |
| **Consent Drift** | External consent revocation detected on next poll, twin visibility recalculated. | Background Orchestration Layer |
| **Sagas & Compensating Transactions** | Each DAG node pairs forward action with undo action. Failure triggers backward walk. | Action DAGs |
| **Idempotency** | Every DAG action carries an idempotency key. Retries never double-execute. | Action DAGs |
| **PII Filter Multi-Tenancy** | Complete session isolation by design. No cross-user mapping leakage possible. | PII Filter Gateway Service |
| **Guardrails** | Inbound rejection + outbound compliance flagging wrap all LLM entry points. | LLM Guardrails |
| **Human-in-the-Loop** | DAG approval lifecycle (draft → approve → execute). Transfer nodes never auto-execute. | Human Control and Safety |
| **Session Persistence** | pgvector embeddings enable similarity search across council sessions. Soft archive for audit. | LLM Council |
| **Goal Similarity** | pgvector cosine similarity detects duplicate/overlapping goals before creation. | Goal System |

> **[Implementation note]** Actual service ports: PostgreSQL 5433, Maple Direct 3001, Heritage Financial 3002, Frontier Business 3003, Registry 3010, Orchestrator 3020, PII Filter 3030. Background orchestration runs as an embedded asyncio task within the orchestrator (port 3020), not as a separate service. The React frontend runs on port 5173.
