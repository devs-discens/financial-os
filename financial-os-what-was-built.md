# Financial OS: What Was Built

A working simulation of an AI-native financial intelligence platform that transforms open banking data into actionable financial insight through multi-LLM reasoning, PII-safe anonymization, and gamified progress tracking. Designed as an MVP pitch for Wealthsimple.

---

## Vision

Open banking solves the plumbing problem — data flowing between institutions via standardized FDX APIs. Financial OS solves the intelligence problem — making sense of that data through an AI-native platform that builds a **Digital Financial Twin**: a living, continuously-updated model of each user's complete financial state across every connected institution.

No single institution has this view. BMO sees BMO accounts. RBC sees RBC. Financial OS sees everything, in real time, and reasons across all of it using multiple AI models working in concert — with zero personal data ever leaving the trust perimeter.

The system doesn't layer AI onto existing workflows. It rebuilds the entire data ingestion, enrichment, reasoning, and action pipeline as AI-native — where orchestration learns and adapts, LLMs reason from multiple perspectives, and every external call is secured through an intelligent PII boundary.

---

## What Runs

Seven Docker services, a React frontend, and a PostgreSQL database — all operational, tested, and demonstrable end-to-end.

| Service | Port | Stack | Purpose |
|---|---|---|---|
| **postgres** | 5433 | PostgreSQL 16 + pgvector | All persistent state (16 tables, V1-V14 migrations) |
| **maple-direct** | 3001 | Node/Express | Simulated bank: chequing + 2 credit cards |
| **heritage-financial** | 3002 | Node/Express | Simulated bank: mortgage + HELOC, MFA required |
| **frontier-business** | 3003 | Node/Express | Simulated bank: business accounts, irregular income |
| **registry** | 3010 | Node/Express | Institution status tracking and discovery |
| **onboarding-orchestrator** | 3020 | Python/FastAPI | Core intelligence: onboarding, twin, council, DAGs, background, progress |
| **pii-filter** | 3030 | Python/FastAPI | Anonymization gateway for all external LLM calls |
| **ui** | 5173 | React/Vite | Wealthsimple-inspired dashboard |

### Test Coverage

208 integration tests (including real external LLM calls) and 120 unit tests verify the entire system.

| Suite | Tests | What It Covers |
|---|---|---|
| Bank/Registry E2E | 38 | FDX endpoints, OAuth, token lifecycle, failure injection |
| Orchestrator E2E | 21 | Onboarding flow, template discovery, reconnection |
| Twin E2E | 15 | Snapshot, metrics, account history, transactions |
| PII Filter E2E | 13 | Session management, anonymization, rehydration |
| LLM E2E | 6 | All 3 providers (Anthropic, OpenAI, Gemini) |
| Pipeline E2E | 2 | Full PII filter to LLM to rehydration |
| Council E2E | 8 | Collaborative + adversarial with real LLM calls |
| Background E2E | 10 | Polling, token refresh, anomaly detection, consent |
| DAG E2E | 14 | Generation, approval, execution, archive, node toggle with real LLM calls |
| Admin Demo E2E | 13 | Bulk setup, transaction injection, user reset |
| Auth E2E | 15 | Login, registration, token refresh, role enforcement |
| Multi-user E2E | 5 | Cross-user isolation, concurrent connections |
| Progress E2E | 13 | Scoring, milestones, streaks, benchmarks |
| Guardrails E2E | 18 | Inbound rejection, outbound compliance flagging |
| Session E2E | 17 | Session persistence, similarity search, archive, PATCH link (real LLM calls) |
| JS unit tests | 75 | Shared lib, bank configs, registry, error handling |
| Python guardrails unit | 45 | Inbound/outbound validation, edge cases |

---

## The 8 Components

### 1. Open Banking Registry

Tracks which financial institutions are live on the open banking network. Institutions progress through a lifecycle: `not_registered` to `pending` to `live`. When an institution goes live, the registry records its FDX base URL, supported account types, and data capabilities.

The registry emits Server-Sent Events on status changes, allowing the orchestrator to react in real time when new institutions come online — mirroring how Canada's open banking rollout will stagger institution availability.

**Key files:** `services/registry/src/index.js`
**Endpoints:** `GET /registry/institutions`, `GET /registry/institutions/{id}`, `POST /registry/institutions/{id}/register`, `POST /registry/institutions/{id}/go-live`

### 2. Simulated Bank APIs (x3)

Three banks built on a shared factory (`createFdxServer(config)`) that sets up FDX v6 endpoints, OAuth 2.0 authorization, token management, and configurable failure injection. Each bank defines its own account catalog and transaction patterns, but shares all protocol-level code.

**Maple Direct** (port 3001) — The clean, modern bank. Chequing account with biweekly $4,375 paycheque deposits, Visa ($2,800/$10k limit), Mastercard ($450/$5k limit). Standard OAuth, no MFA, fast responses. Represents a typical major bank with straightforward FDX support.

**Heritage Financial** (port 3002) — The legacy institution. Mortgage ($385k at 4.89%, renewing in 14 months) and HELOC ($15k available). Requires MFA on every authorization (any 6-digit code accepted in simulation). Deliberately slow responses (500-2000ms delay). Provides amortization schedule via statements endpoint. Represents older institutions with more complex integration requirements.

**Frontier Business** (port 3003) — The business bank. Business chequing ($12,400) with irregular consulting income (random intervals, varying amounts), business Visa ($1,100/$8k limit). Represents business banking with non-standard income patterns that challenge assumptions about regular paycheque cycles.

**Shared capabilities across all banks:**
- FDX v6 endpoints: accounts, account detail, transactions, balances, statements, payment networks
- OAuth 2.0 with opaque UUID tokens (30-min access, 90-day refresh)
- Per-account consent: users authorize specific accounts, not blanket access
- `.well-known/fdx-configuration` for capability discovery
- Deterministic transaction generation via seeded PRNG (`seedrandom`) — same seed produces identical 6-month history every time
- Failure injection: configurable rate limiting, outages, token expiry, response transformation (for testing anomaly detection)
- Offset/limit pagination on transaction endpoints

**Key files:** `services/shared/src/fdx-server.js` (factory), `services/shared/src/data/transaction-generator.js`, `services/bank-*/src/accounts.js`

### 3. Dynamic Onboarding Orchestrator

The core intelligence service. When a user requests a bank connection, the orchestrator:

1. **Registry check** — Is the institution live?
2. **Template lookup** — Has the system seen this institution before?
3. **Template discovery** — If not, fetch the bank's `.well-known/fdx-configuration`, use LLM reasoning to understand capabilities, and build an onboarding template (OAuth config, supported account types, polling schedule). Cache for all future users.
4. **OAuth flow** — Redirect user to bank authorization, handle consent, exchange code for tokens.
5. **MFA handling** — If the bank requires MFA (Heritage), pause for user input and resume on submission.
6. **Initial data pull** — Fetch all consented accounts, upsert via SCD2 pattern, pull transactions and statements.
7. **Twin wiring** — Compute initial metrics (net worth, income, expenses, debt-to-income) from the new data.

The first user connecting a new institution triggers LLM-assisted template discovery (seconds of reasoning). Every subsequent user hits a cached template (milliseconds). This mirrors the production learning loop where early connections teach the system and later connections benefit from cached knowledge.

Reconnection is handled gracefully: active connections return `already_connected`, stale `mfa_pending` connections are cleaned up automatically, and FK-safe deletion prevents orphaned records.

**Key files:** `services/onboarding-orchestrator/src/routes/onboarding.py`, `services/onboarding-orchestrator/src/services/template_discovery.py`, `services/onboarding-orchestrator/src/services/oauth_flow.py`, `services/onboarding-orchestrator/src/services/data_pull.py`

### 4. Background Orchestration

An embedded asyncio task that continuously keeps the Digital Twin alive and accurate. Runs a 30-second polling loop (configurable) across all active connections.

**Each polling cycle per connection:**
- Check token validity. If access token expires within 5 minutes, preemptively refresh it.
- Pull current balances. Compare against last known values.
- If balance changed >20%, flag as anomaly and generate alert.
- Pull new transactions. Append to twin store (idempotent via ON CONFLICT DO NOTHING).
- Compute updated metrics.
- Log all events for audit trail.

**Failure handling spectrum:**
- **Transient errors (503):** Exponential backoff per-connection (10s, 20s, 40s... up to 600s max). Resets on success.
- **Rate limiting (429):** Back off, retry after delay.
- **Access token expired (401):** Silent refresh using refresh token, continue polling.
- **Refresh token expired:** Mark connection as `stale`, queue re-authentication notification.
- **Consent revoked (403):** Mark connection as `revoked`, stop polling, notify user.
- **Anomalous data:** Flag for user review without stopping the poll cycle.

**Key files:** `services/onboarding-orchestrator/src/services/background.py`, `services/onboarding-orchestrator/src/routes/background.py`
**Endpoints:** `GET /background/status`, `POST /background/trigger`, `GET /background/events`, `GET /background/anomalies`

### 5. Digital Financial Twin

A PostgreSQL-backed unified model of a user's complete financial state across all connected institutions.

**Data model patterns:**
- **SCD2 (Slowly Changing Dimensions)** for accounts: `connected_accounts` uses `valid_from`/`valid_to` columns. The current state has `valid_to IS NULL`. When account data changes (balance update, rate change), the system closes the old row and inserts a new one — preserving full history of how every account evolved over time.
- **Append-only** for transactions, statements, and metrics: never updated, only inserted. Idempotent via unique constraints and ON CONFLICT DO NOTHING.

**Computed metrics (recalculated on every poll cycle):**
- Net worth (total assets minus total liabilities, with mortgage property value as asset and principal as liability)
- Monthly income and expenses (from last 30 days of categorized transactions)
- Debt-to-income ratio
- Savings rate
- Credit utilization (total used / total limit across all credit accounts)
- Emergency fund coverage (liquid deposits / monthly essential expenses)
- Asset and liability breakdowns by category

**Progressive construction:** The twin starts with whatever Wealthsimple data exists on-platform, then grows as each bank connects. The system communicates what it can and cannot see at each stage — "60% visibility" after Maple, "85%" after Heritage, "95%+" after Frontier. This honesty about data completeness is a core design principle.

**Key files:** `services/onboarding-orchestrator/src/services/twin.py`, `services/onboarding-orchestrator/src/services/data_pull.py`
**Endpoints:** `GET /twin/{user_id}`, `GET /twin/{user_id}/metrics`, `GET /twin/{user_id}/accounts/{id}/history`, `GET /twin/{user_id}/transactions`

### 6. PII Filter Gateway

The architectural boundary between Wealthsimple infrastructure and external LLM APIs. No real personally identifiable information ever leaves the trust perimeter.

**How it works:**
1. **Create session** with known entities (names, institutions extracted from twin data).
2. **Filter outbound text:** Names become "Person A", "Person B". Financial amounts are shifted proportionally (preserving ratios — if savings are 40% of income in reality, they're 40% in the anonymized version). Institutions become "Institution A", "Institution B". Dates shift by a consistent offset. Account numbers are randomized.
3. **Send anonymized text to external LLM.** The LLM reasons over data that is structurally identical but contains no real PII.
4. **Rehydrate response:** Replace anonymized tokens with real values before presenting to user.
5. **Delete session** when advisory interaction completes.

**Key properties:**
- **Session-scoped consistency:** All LLM calls within one advisory session use the same mapping. Follow-up questions reference the same anonymized values, enabling coherent multi-turn conversations.
- **Proportional perturbation:** Financial ratios are preserved. The LLM's analysis of spending patterns, savings rates, and debt ratios remains valid because the mathematical relationships are maintained.
- **Multi-tenant isolation:** Sessions are keyed by UUID with no cross-session access possible by design.
- **Provider agnosticism:** Can switch or use multiple LLM providers simultaneously with zero data risk.

**Key files:** `services/pii-filter/src/services/detector.py`, `services/pii-filter/src/services/transformer.py`, `services/pii-filter/src/services/session_store.py`
**Endpoints:** `POST /sessions`, `POST /filter`, `POST /rehydrate`, `DELETE /sessions/{id}`

### 7. LLM Council

A multi-model reasoning engine that queries three LLM providers in parallel, each taking a different analytical perspective, then synthesizes their outputs into unified financial insight.

**Collaborative mode** — for open-ended financial questions ("How am I doing financially?"):
- **Financial Analyst** (Anthropic Claude): Analyzes current state from twin data — balances, cash flow, debt levels, utilization.
- **Financial Strategist** (OpenAI GPT-4o): Identifies opportunities, risks, and strategic considerations.
- **Financial Planner** (Google Gemini): Assesses goal progress and life-stage appropriateness.
- **Chairman** (Anthropic Claude): Reads all three perspectives and synthesizes a coherent overview with prioritized recommendations.

**Adversarial mode** — for decision questions ("Should I break my mortgage early?"):
- **Bull Advocate** (Anthropic Claude): Makes the strongest possible case FOR the action.
- **Bear Advocate** (OpenAI GPT-4o): Makes the strongest possible case AGAINST.
- **Chairman** (Google Gemini): Delivers an impartial verdict — presents both sides fairly, highlights where they agree and disagree, surfaces key assumptions and uncertainties.

**Every LLM call in both modes goes through the PII filter.** All models in a session use the same anonymization mapping. The chairman sees anonymized outputs and synthesizes in anonymized space. The final output is rehydrated once, so users see real numbers.

All specialist prompts include a `_GROUNDING` constant that enforces an honest adviser tone — grounded in the user's real numbers, acknowledging uncertainties, and avoiding promises or guarantees.

Both modes return `steps[]` — timestamped entries tracking each stage of processing (entity extraction, PII session creation, filtering, each LLM call, synthesis, rehydration) for transparency in the UI.

**Session persistence:** Every council session is stored in the `council_sessions` table with a pgvector embedding (OpenAI text-embedding-3-small, 1536 dimensions, HNSW index). This enables similarity search — before answering a new question, the system can surface past sessions that covered similar ground. Sessions persist across logins and accept an optional `goal_id` parameter to link advisory sessions to specific financial goals.

**Key files:** `services/onboarding-orchestrator/src/services/council.py`, `services/onboarding-orchestrator/src/services/session_store.py`
**Endpoints:** `POST /council/collaborative`, `POST /council/adversarial`, `POST /council/check-similar`, `GET /council/sessions`, `GET /council/sessions/{id}`, `PATCH /council/sessions/{id}` (retroactive goal linking), `DELETE /council/sessions/{id}` (soft archive)

### 8. Action DAG Engine

When a Council session produces a recommendation and the user wants to act on it, the DAG engine generates a structured execution plan as a directed acyclic graph.

**Generation flow:**
1. Get twin snapshot for current financial state.
2. Create PII session, anonymize context and the user's question.
3. Send to LLM with structured prompt requesting a JSON action plan.
4. Parse the LLM's response into nodes with dependencies.
5. Store DAG and nodes to database.
6. Rehydrate all node descriptions through PII filter.
7. Return the plan with reasoning steps.

**Node types:**
- `check` — Verify a condition against twin data (e.g., "verify TFSA room available")
- `transfer` — Money movement instruction (manual in Phase 1, automated via API in Phase 2)
- `allocate` — Fund allocation within Wealthsimple (simulated)
- `council` — Trigger a new council session for a sub-question
- `manual` — User-performed action with clear instructions

**Execution lifecycle:** `generate` (LLM creates plan) then `approve` (user selects which nodes to proceed with) then `execute` (system runs approved nodes in topological order via Kahn's algorithm). Partial approval is supported — approve steps 1-4, defer step 5.

**Node checklist:** Users can mark individual steps as done via a checkbox. Checked nodes show strikethrough styling in the UI. State is persisted to the database (`checked` boolean + `checked_at` timestamp) and survives page refresh. The checklist is independent of the approve/execute lifecycle — it's visual progress tracking for manual steps.

**Goal-linked DAGs:** `generate_dag` accepts an optional `goal_id` parameter, linking the action plan to a specific financial goal. Users can generate plans directly from a goal via `POST /goals/{user_id}/{goal_id}/plan`. The DAG generation prompt includes honest grounding language — action steps reference real numbers from the twin and acknowledge trade-offs.

**Key files:** `services/onboarding-orchestrator/src/services/dag_engine.py`, `services/onboarding-orchestrator/src/routes/dags.py`
**Endpoints:** `POST /dags/generate`, `GET /dags`, `GET /dags/{id}`, `POST /dags/{id}/approve`, `POST /dags/{id}/execute`, `PATCH /dags/{id}/nodes/{node_key}` (toggle checked), `DELETE /dags/{id}` (soft archive), `POST /goals/{user_id}/{goal_id}/plan`

---

## Positive Progress (Gamified Financial Wellness)

A gamification layer that transforms the Digital Twin from a data dashboard into an encouraging financial companion.

### Scoring System

A composite progress score (0-100) computed from five weighted components:

| Component | Weight | What It Measures | Perfect Score |
|---|---|---|---|
| Savings Rate | 25% | Percentage of income saved monthly | 20%+ savings rate |
| Emergency Fund | 25% | Months of essential expenses covered by liquid savings | 6+ months |
| Debt-to-Income Trend | 20% | Debt payments relative to income, with trend bonus | Low and improving |
| Credit Utilization | 15% | Credit used vs. available across all cards | Under 10% |
| Consistency | 15% | How many recent months show positive savings | Steady habits |

### Five Tiers

Progress scores map to tiers that reflect financial health, not wealth:

| Tier | Score | Character |
|---|---|---|
| Starting Out | 0-19 | Everyone begins somewhere |
| Building | 20-39 | Establishing financial habits |
| Growing | 40-59 | Making meaningful progress |
| Thriving | 60-79 | Strong financial foundation |
| Flourishing | 80-100 | Excellent financial health |

### Milestone Detection

The system automatically detects and celebrates achievements during each assessment:
- **Net worth crossings:** $0, $10K, $25K, $50K, $100K, $250K, $500K
- **Emergency fund levels:** 1 month, 2 months, 3 months, 6 months
- **Savings milestones:** First month of positive savings
- **Debt payoff:** All credit card balances paid off
- **Tier transitions:** Moving up to a new tier
- **Personal bests:** New highs in savings rate, emergency fund, or net worth

### Streak Tracking

Consecutive positive behaviors are tracked and displayed:
- **Positive savings:** Days/months with income exceeding expenses
- **Debt reduction:** Days/months where total debt decreased

### Benchmarking

Users see how they compare along two axes:
- **National benchmarks:** Simulated Statistics Canada data across 24 age/income brackets with province-level cost-of-living adjustments. Metrics include median savings rate, emergency fund months, credit utilization, DTI ratio, net worth, and homeownership rate.
- **Peer benchmarks:** Generated deterministically from user demographics (age, income, location hashed to produce consistent peer group metrics). Positioned as "people in a similar situation."

Admin-editable benchmark overrides allow adjusting any bracket's values for demo purposes.

### Assessment Engine

`POST /progress/{user_id}/assess` triggers a full cycle: compute metrics, compare to benchmarks, detect milestones, update streaks, and generate encouragement messages. The encouragement system produces a summary paragraph plus detailed per-metric insights. Wired into the background poll cycle so progress updates automatically.

**Key files:** `services/onboarding-orchestrator/src/services/twin.py` (scoring), `services/onboarding-orchestrator/src/services/benchmarks.py`, `services/onboarding-orchestrator/src/services/milestones.py`, `services/onboarding-orchestrator/src/routes/progress.py`

---

## Goal System

LLM-powered financial goal tracking that serves as the organizing principle for the platform's planning features.

**Goal creation:** Users describe goals in natural language ("save for a down payment on a $600k condo"). The system runs the description through the PII filter, then sends it to an LLM along with the twin snapshot. The LLM returns structured analysis: a summary label, goal type classification, target amount and date, feasibility assessment (green/yellow/red), narrative assessment text, cross-goal impact analysis, and estimated progress percentage.

**Cross-goal conflict detection:** When a user has multiple goals, the LLM analyzes how they interact. Adding an aggressive RRSP contribution goal when you already have a down payment savings goal surfaces the trade-off — both compete for the same discretionary income. The `cross_goal_impact` field in each goal's assessment explains these interactions.

**Background reassessment:** Active goals are automatically reassessed every 10 background polling cycles. As the twin updates (new transactions, balance changes, market movements), goal feasibility and progress percentages adjust to reflect reality.

**Goal milestones:** Progress thresholds at 25%, 50%, 75%, and 100% trigger milestone detection, feeding into the Positive Progress system.

**Goal similarity detection:** Goals are embedded via pgvector (same pattern as council sessions). When a user adds a new goal, the system checks for semantically similar existing goals via `POST /goals/{user_id}/check-similar` (cosine similarity, 0.80 threshold). This prevents duplicate goals and surfaces existing goals the user may have forgotten about.

**Goal-linked sessions and plans:** Goals connect to the Council and DAG engine via `goal_id`. Users can "Get Advice" on a goal (triggers a council collaborative session linked to that goal) or "Create Action Plan" (generates a DAG linked to that goal). Sessions can also be retroactively linked to goals via `PATCH /council/sessions/{id}` — when a conversation leads to "Track as Goal", the resulting goal and originating session are linked. This creates a traceable chain: goal to advisory session to action plan.

**Key files:** `services/onboarding-orchestrator/src/services/goals.py`, `services/onboarding-orchestrator/src/routes/goals.py`
**Endpoints:** `POST /goals/{user_id}`, `GET /goals/{user_id}`, `PUT /goals/{user_id}/{goal_id}`, `DELETE /goals/{user_id}/{goal_id}`, `POST /goals/{user_id}/{goal_id}/discuss`, `POST /goals/{user_id}/{goal_id}/plan`, `POST /goals/{user_id}/check-similar` (pgvector similarity, threshold 0.80)

---

## LLM Guardrails

Embedded inbound and outbound validation that keeps all LLM interactions within appropriate financial advisory scope.

**Inbound validation** wraps all four user-facing LLM entry points (council collaborative, council adversarial, DAG generate, goal add/update) at the route level. Requests are rejected with HTTP 422 if they are empty, excessively long, off-topic (no financial relevance), or contain prompt injection attempts. The validation is deliberately permissive for anything with plausible financial relevance — ambiguous queries pass through rather than being blocked.

**Outbound validation** scans all LLM responses after rehydration, flagging compliance issues: return promises ("guaranteed 12% returns"), unauthorized professional advice (tax/legal specifics that require credentials), or harmful recommendations. Flagged responses are never blocked — instead, a disclaimer is appended. The system errs on the side of transparency over suppression.

**SYSTEM_GUARDRAIL constant** is appended to all 9 user-facing LLM system prompts (7 council specialist/chairman prompts, 1 DAG generation prompt, 1 goal analysis prompt), establishing behavioral boundaries at the model level.

**Key files:** `services/onboarding-orchestrator/src/services/guardrails.py`

---

## Wealthsimple On-Platform Data

The system includes Wealthsimple as a pre-connected "on-platform" institution, representing the data Wealthsimple already has about the user before any open banking connections.

Seeded via `POST /admin/demo/setup`, Wealthsimple accounts use a special `discovery_method='on_platform'` template and `access_token='on-platform'` connection (with a 100-year expiry). Background polling skips on-platform connections — the data is already local.

**Alex Chen's Wealthsimple accounts:** TFSA ($38.5k in diversified ETFs and equities), RRSP ($22.1k in target-date funds and bonds), and chequing ($1.8k). Holdings include ETFs, individual equities, crypto, fixed income, and cash positions stored in the `twin_holdings` table.

The twin snapshot includes `holdings[]` with an investment breakdown by asset class. Council context incorporates holdings and goals alongside account and transaction data, giving the LLMs a complete picture of both banking and investment positions.

All six seed users have Wealthsimple accounts, each with holdings appropriate to their demographic and financial profile.

---

## The Frontend

A React 19 single-page application with a Wealthsimple-inspired design language.

### Design System

| Token | Value | Usage |
|---|---|---|
| Background | #FAF9F7 | Page background (warm off-white) |
| Surface | #F5F3F0 | Secondary surfaces, inactive elements |
| Card | #FFFFFF | Content cards |
| Border | #E8E5DF | Card and section borders |
| Accent | #32302F (Dune) | Primary actions, active navigation, emphasis |
| Text | #32302F | Body text |
| Muted | #908B85 | Secondary text, labels, timestamps |
| Font | Mulish | All text (Google Fonts, weights 300-900) |

Cards use subtle `shadow-sm` elevation. The palette is deliberately warm and calming — financial tools should reduce anxiety, not create it.

### Pages

**Financial Picture** (Twin Dashboard) — The main view. Profile card with demographics, four key metric cards (net worth, income, expenses, debt-to-income ratio), financial visibility indicator showing how complete the picture is, accounts grouped by institution with color-coded balances (Wealthsimple accounts show "On Platform" badge with holdings table and portfolio allocation card by asset class), asset/liability breakdown panels, goals section with text input and goal cards (feasibility badges, progress bars, assessment, "Get Advice" and "Create Action Plan" buttons), filterable transaction table, and a "Link Financial Source" modal with MFA support.

**Progress** — Gamified wellness view. Tier hero card with score, component breakdown (mini progress bars for each of the 5 scoring components), and next-tier guidance showing which areas to improve. Four progress metric cards comparing savings rate, emergency fund, credit utilization, and debt-to-income ratio against peer and national benchmarks. Visual benchmark comparison bars. Streak cards. Collapsible milestone history (latest shown prominently, expand for older). Combined assessment paragraph with expandable detailed insights and a button that navigates to Your Plan with a pre-filled question.

**Your Adviser** (route: `/plan`) — A conversation-first planning page. Discussions are the entry point — goals emerge from conversations, and plans form from goals. Four sections:

1. **Ask Your Adviser** — Always-available discussion input at the top (no empty state). Two modes: "Get a Recommendation" (collaborative) and "Debate a Decision" (adversarial). After receiving a result, action buttons appear: "Track as Goal" (creates a goal from the conversation and retroactively links the session) and "Create Action Plan" (generates a DAG). "Debate This?" on collaborative results re-runs the same question adversarially.

2. **Our Past Conversations** — Every advisory session shown as a collapsible card. Collapsed: question text + date + chevron. Expanded: mode badge, linked goal/plan badges, synthesis preview, archive button. Independent archive — deleting a conversation doesn't affect linked goals or plans.

3. **Your Goals** — Small "+ Add a goal manually" affordance (not the primary path — goals primarily emerge from conversations). Each goal as a collapsible card. Collapsed: goal label + date + chevron. Expanded: feasibility badge (green/yellow/red), type badge, progress bar, assessment text, "Get Advice" and "Create Action Plan" buttons, archive button. Similar goal detection via pgvector on manual add.

4. **Your Action Plans** — Goal-linked DAG-based execution. Each plan as a collapsible card. Collapsed: plan title + date + chevron. Expanded: status badge, goal linkage ("For: ..."), conversation lineage ("From: ..."), step count, node timeline, approve/execute workflow, archive button.

All three item types (conversations, goals, plans) use a uniform collapsible card pattern: collapsed shows only title + date + chevron; expanded reveals badges, metadata, content, and actions. All items are independently archivable.

**Admin** — Five-tab console. Registry tab (institution lifecycle management), Users tab (collapsible user list with connection details), Demo tab (bulk setup of 7 seed users, per-user reset, transaction injection), Benchmarks tab (editable 24-bracket table with override tracking and reset), Background tab (status bar, anomalies, per-user connection cards filtered to external banks only with poll buttons and lazy-loaded event history).

**Settings** — Profile editor for demographics (age, occupation, income, city, province, relationship status, housing status, dependents) and financial goals text. Updates via `PATCH /auth/me/profile`.

**Login** — Simple auth with register/sign-in toggle and demo credential hints.

### Cross-Page Navigation

Pages are connected by intentional user flows:
- **Progress to Your Adviser:** Assessment insights link to Your Adviser with a pre-filled question.
- **Goals to Council:** "Get Advice" on a goal pre-fills the discussion input with goal context, triggering a goal-linked council session.
- **Goals to Action Plans:** "Create Action Plan" on a goal generates a DAG linked to that goal.
- **Council to Goals:** "Track as Goal" on a council result creates a goal from the conversation and retroactively links the session.
- **Council to Action Plans:** "Create Action Plan" on a council result passes the question and synthesis to the DAG generator.

### Tech Stack

React 19, Vite 7, Tailwind CSS 4 with `@theme` CSS custom properties, react-router-dom 7, react-markdown for LLM response rendering. Ten API client modules handle all backend communication with JWT authentication. Custom SVG favicon (Dune circle with dollar sign). Dynamic page title shows "Your Financial Picture — {display_name}".

---

## Database Schema

16 tables across 14 migrations (V1-V14), all idempotent (CREATE IF NOT EXISTS), run automatically on orchestrator startup.

| Table | Pattern | Purpose |
|---|---|---|
| `institution_templates` | Cache | Onboarding blueprints (OAuth config, endpoints, polling schedule) |
| `connections` | Mutable | User-institution links (tokens, consent, status) |
| `connected_accounts` | SCD2 | Account state with full history (valid_from/valid_to) |
| `twin_transactions` | Append-only | All transactions across all institutions |
| `twin_statements` | Append-only | Bank statements (mortgage amortization schedules) |
| `twin_metrics` | Append-only | Computed metrics over time (net worth, income, DTI, etc.) |
| `onboarding_events` | Append-only | Audit trail of all onboarding and background events |
| `action_dags` | Mutable | Generated action plans with lifecycle status (goal_id FK) |
| `dag_nodes` | Mutable | Individual steps within action plans (with checked/checked_at for checklist tracking) |
| `users` | Mutable | Authentication and profile (demographics, role) |
| `progress_milestones` | Append-only | Detected achievements with narrative and acknowledgement |
| `progress_streaks` | Mutable | Current and longest streak counts |
| `benchmark_overrides` | Mutable | Admin-editable benchmark bracket values |
| `twin_holdings` | Append-only | Investment holdings for on-platform accounts (positions, asset class) |
| `user_goals` | Mutable | Financial goals with LLM feasibility analysis and progress tracking |
| `council_sessions` | Append-only | Advisory sessions with pgvector embeddings for similarity search (goal_id FK) |

MIGRATION_V12 adds `goal_id` foreign key columns to `action_dags` and `council_sessions`, linking plans and advisory sessions to specific goals.

MIGRATION_V13 adds `goal_embedding VECTOR(1536)` to `user_goals` (with HNSW index for cosine similarity search) and `archived BOOLEAN` columns to both `council_sessions` and `action_dags` (soft archive pattern).

MIGRATION_V14 adds `checked BOOLEAN NOT NULL DEFAULT FALSE` and `checked_at TIMESTAMPTZ` to `dag_nodes`, enabling checklist-style progress tracking on action plan steps.

---

## Simulated Users

Seven seed users with distinct financial profiles for demonstrating the system at scale.

**Alex Chen** (primary demo user) — 34yo, $105k income, common-law, renting, considering first home. Connected to all three banks: Maple Direct (chequing + 2 credit cards), Heritage Financial (mortgage + HELOC with MFA), Frontier Business (business accounts). Plus Wealthsimple on-platform accounts (TFSA $38.5k, RRSP $22.1k, chequing $1.8k).

Six additional seed users (Sarah Johnson, Marcus Williams, Priya Patel, David Kim, Emma Rodriguez, and an admin user) provide varied demographics, income levels, and financial situations for multi-user testing and benchmarking scenarios.

The admin demo system (`/admin/demo/setup`) can bulk-connect all seed users to their designated banks in a single operation, making it possible to demonstrate a populated system in seconds.

---

## The Data Flows

### Onboarding (connecting a new bank)

```
User requests connection
  -> Orchestrator checks registry (is institution live?)
  -> Checks template cache (have we seen this bank before?)
  -> If not: LLM-assisted discovery from .well-known config
     (first user: seconds of LLM reasoning; cached for all future users)
  -> OAuth redirect -> user consents to specific accounts
  -> Token exchange -> store encrypted tokens
  -> Initial data pull -> SCD2 account upsert
  -> Transaction and statement pull (append-only)
  -> Compute metrics -> Twin updated
```

### Council (asking a financial question)

```
User asks question (optionally linked to a goal)
  -> Inbound guardrail (reject empty/off-topic/prompt-injection)
  -> Get twin snapshot (complete financial state, including holdings and goals)
  -> Extract entities (names, institutions)
  -> Create PII session with entity mapping
  -> Filter context + question (anonymize)
  -> Query 3 LLMs in parallel (different analytical perspectives)
  -> Chairman synthesizes all responses
  -> Rehydrate everything (restore real values)
  -> Outbound guardrail (flag compliance issues, append disclaimer if needed)
  -> Delete PII session
  -> Embed question (pgvector) -> store session to council_sessions
  -> Return responses + synthesis + reasoning steps + session_id
```

### Background polling (continuous)

```
Every 30 seconds, for each active connection:
  -> Check token expiry (refresh if within 5-min buffer)
  -> Pull balances -> compare to last known
  -> If >20% change: flag anomaly, generate alert
  -> Pull new transactions -> append to twin
  -> Compute updated metrics
  -> Log event
  -> On failure: classify error, apply appropriate strategy
     (backoff / refresh / revoke / escalate)
```

### Action DAG (executing a financial plan)

```
Council produces recommendation
  -> User says "do this"
  -> Get twin snapshot, create PII session
  -> LLM generates structured JSON action plan
  -> Parse into nodes with typed dependencies
  -> Store to database, rehydrate descriptions
  -> User reviews and approves specific nodes
  -> Execute in topological order (Kahn's algorithm)
  -> Each node: check conditions, produce instructions or results
  -> Return execution report with reasoning steps
```

---

## Production Considerations

These architectural properties are structurally present in the design — visible in how the code is organized even where not fully production-hardened in the MVP:

- **Event sourcing foundation:** The append-only transaction and metric stores, SCD2 account versioning, and onboarding event log create an auditable history that can be replayed. The twin can answer "what did your finances look like 3 months ago?"
- **Eventual consistency:** Each data source carries freshness timestamps. The system honestly communicates data staleness rather than pretending everything is real-time.
- **Template versioning:** When a cached institution template becomes stale (detected via failed poll), the system can trigger re-discovery and graceful migration without disrupting existing connections.
- **Saga patterns:** The DAG engine's node-by-node execution with status tracking and partial approval is the foundation for compensating transactions in Phase 2 write-access scenarios.
- **Idempotency:** Transactions use ON CONFLICT DO NOTHING. Template discovery checks cache before LLM call. Connection creation checks for existing active connections.
- **Multi-tenant isolation:** PII sessions are keyed by UUID with no cross-session access. User data is always scoped by user_id. Each user's twin is independent.

---

## How to Run It

```bash
cd services

# Start all services
docker compose up --build -d
docker compose ps   # verify all 7 show "healthy"

# Start the UI
cd ui && npm run dev

# Run all tests
cd services
node --test tests/integration/*.test.js   # 208 integration tests
npm test                                   # 75 JS unit tests
cd onboarding-orchestrator && python3 -m unittest tests/test_guardrails.py -v  # 45 Python unit tests

# Reset to clean state
./scripts/reset.sh              # keep institution templates (faster re-onboarding)
./scripts/reset.sh --full       # clear everything
```

Council, pipeline, and DAG tests make real external LLM calls (Anthropic, OpenAI, Gemini) and require API keys configured in `services/onboarding-orchestrator/.env`.

---

## What This Demonstrates

1. **Dynamic institution onboarding** — Banks come online at different times with different capabilities. The system discovers, adapts, and caches — first connection triggers LLM reasoning, subsequent connections are instant.

2. **Progressive twin construction** — The financial picture grows from partial to complete as each institution connects. The system communicates visibility honestly at every stage.

3. **Autonomous background orchestration** — Polling, token refresh, anomaly detection, and failure handling all happen silently. The user only sees results (updated balances, detected anomalies) unless genuine re-authentication is needed.

4. **PII-safe multi-LLM reasoning** — Three AI models reason over personal financial data without ever seeing real PII. Side-by-side comparison shows real data in, anonymized data to LLM, anonymized response, rehydrated response the user sees.

5. **Multi-perspective financial analysis** — Collaborative mode synthesizes analyst, strategist, and planner perspectives. Adversarial mode structures genuine debate with a chairman verdict. Both produce richer insight than any single model.

6. **Structured action planning** — Council recommendations become inspectable, approvable execution plans with dependency awareness and typed nodes.

7. **Gamified financial wellness** — Progress scoring, tier advancement, milestone celebration, streak tracking, and peer/national benchmarking make financial health tangible and encouraging.

8. **Goal-driven financial planning** — A conversation-first flow where discussions lead to goals, and goals lead to plans. Users ask questions, then "Track as Goal" to create goals from conversations (with retroactive session linking). Goal similarity detection via pgvector prevents duplicates. Every item (conversation, goal, plan) is independently archivable with soft delete. The traceable chain runs from conversation to goal to action plan, all linked via `goal_id`.

9. **LLM guardrails** — Inbound validation prevents misuse (off-topic, prompt injection) while staying permissive for legitimate financial questions. Outbound validation flags compliance risks without blocking responses. The system enforces advisory boundaries through both route-level validation and model-level system prompts.

10. **The learning loop** — Template caching, DAG patterns, session persistence with similarity search, and session-scoped PII consistency all demonstrate how the system gets smarter with use. The first connection is the most expensive; every subsequent one benefits from learned knowledge.
