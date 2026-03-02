# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Financial OS — AI-native financial intelligence platform. Builds a Digital Financial Twin from simulated open banking (FDX) data + multi-LLM reasoning. MVP simulation designed as a pitch for Wealthsimple.

Reference docs: `financial-os-system-overview.md` and `financial-os-mvp-build-plan.md` in repo root.

## Build & Run

All services live under `services/`. Node 20 via nvm is required.

```bash
# Start everything (Docker)
cd services
docker compose up --build -d
docker compose ps   # verify all 7 services show "healthy"

# Rebuild a single service after code changes
docker compose up --build -d onboarding-orchestrator
```

### Running Tests

Integration tests require all Docker containers running and healthy. Tests use Node's built-in test runner.

```bash
cd services

# All integration tests (includes real LLM calls for council/pipeline tests)
node --test tests/integration/*.test.js

# Individual test suites
node --test tests/integration/docker-e2e.test.js          # 38 bank tests
node --test tests/integration/orchestrator-e2e.test.js     # 21 orchestrator tests
node --test tests/integration/twin-e2e.test.js             # 15 twin tests
node --test tests/integration/pii-filter-e2e.test.js       # 13 PII filter tests
node --test tests/integration/llm-e2e.test.js              # 6 LLM tests
node --test tests/integration/pii-llm-e2e.test.js          # 2 pipeline tests
node --test tests/integration/council-e2e.test.js          # 8 council tests
node --test tests/integration/background-e2e.test.js       # 10 background orchestration tests
node --test tests/integration/dag-e2e.test.js              # 10 DAG engine tests (real LLM calls)
node --test tests/integration/guardrails-e2e.test.js       # 18 guardrails tests
node --test tests/integration/session-e2e.test.js          # 10 session persistence tests (real LLM calls)

# Python unit tests (no Docker needed)
cd onboarding-orchestrator && python3 -m unittest tests/test_guardrails.py -v  # 45 guardrails unit tests

# Unit tests (no Docker needed)
npm test                        # all workspaces
npm test -w shared              # just shared lib
npm test -w bank-maple-direct   # just one bank

# npm script shortcuts
npm run test:e2e:banks
npm run test:e2e:orchestrator
npm run test:e2e:background
npm run test:e2e:dags
npm run test:integration
```

Council, pipeline, and DAG tests make **real external LLM calls** (~30-60s per council run, ~15-30s per DAG generation) and require API keys in `services/onboarding-orchestrator/.env`.

### Reset Script

```bash
cd services
./scripts/reset.sh               # truncate DB, restart services, keep templates (default)
./scripts/reset.sh --full        # full reset including institution templates
```

### Orchestrator E2E test note

Some orchestrator tests (Heritage MFA, Frontier connect, second-user connect) fail with `already_connected` when the database has state from prior runs. This is expected — those tests assume a clean DB. The tests that check state resiliently always pass.

## Architecture

### Service Map

| Service | Port | Stack | What it does |
|---|---|---|---|
| postgres | 5433 | PostgreSQL 16 + pgvector | All persistent state + vector similarity search |
| maple-direct | 3001 | Node/Express | Simulated bank: chequing + 2 credit cards, no MFA |
| heritage-financial | 3002 | Node/Express | Simulated bank: mortgage + HELOC, requires MFA, slow |
| frontier-business | 3003 | Node/Express | Simulated bank: business chequing + Visa, irregular income |
| registry | 3010 | Node/Express | Institution status tracking (not_registered → pending → live) |
| onboarding-orchestrator | 3020 | Python/FastAPI | Onboarding, twin, council, background polling, DAG engine, goals, guardrails |
| pii-filter | 3030 | Python/FastAPI | Anonymize PII before LLM calls, rehydrate responses |

### Key Data Flows

**Onboarding** (POST `/onboarding/connect`): registry check → template discovery (LLM-assisted FDX parsing, cached) → OAuth → token exchange → data pull → SCD2 account upsert → transaction/statement pull → metrics compute.

**Council** (POST `/council/collaborative` or `/council/adversarial`): **inbound guardrail** → get twin snapshot → extract entities → create PII session → filter context + question → query 3 LLMs in parallel (Anthropic/OpenAI/Gemini) → chairman synthesis/verdict → rehydrate all responses → **outbound guardrail** → delete PII session → embed question (OpenAI text-embedding-3-small) → store session + embedding to `council_sessions` → return `session_id` in response. Accepts optional `goal_id` parameter to link session to a goal. `_GROUNDING` constant in `council.py` appended to all 7 specialist system prompts for honest adviser tone. Sessions persist across logins. Similarity search via `POST /council/check-similar` (pgvector cosine similarity, HNSW index). Session retrieval: `GET /council/sessions?user_id=`, `GET /council/sessions/{id}`. Retroactive goal linking: `PATCH /council/sessions/{id}` (body: `{goal_id}`). Archive: `DELETE /council/sessions/{id}` (soft archive, excluded from list/similarity).

**PII pipeline**: create session with known entities → filter text (names→"Person A", amounts shifted proportionally, dates shifted, institutions→"Institution A") → send anonymized text to LLM → rehydrate response → delete session.

**Background polling** (automatic, 30s interval): for each active connection → check token expiry (preemptive refresh with 5-min buffer) → pull balances → detect anomalies (>20% change) → pull transactions → compute metrics → log events. Handles consent revoked (403), token expired (401), rate limiting (429) with exponential backoff.

**DAG generation** (POST `/dags/generate`): **inbound guardrail** → get twin snapshot → create PII session → filter context → LLM generates structured action plan as JSON (realistic amounts via prompt engineering in `dag_engine.py`) → parse nodes with dependencies → store to DB → rehydrate descriptions → **outbound guardrail** → return DAG with `steps[]`. Accepts optional `goal_id` parameter to link DAG to a goal. Goal-linked DAGs also generated via `POST /goals/{user_id}/{goal_id}/plan`. Nodes are approved then executed in topological order. Archive: `DELETE /dags/{dag_id}` (soft archive, excluded from list).

**Goals** (POST `/goals/{user_id}`): **inbound guardrail** → get twin snapshot → PII filter → LLM analyzes feasibility (green/yellow/red, honest adviser tone via `goals.py` prompt engineering) → parse structured JSON → **outbound guardrail** → embed goal text (OpenAI text-embedding-3-small) → store goal with assessment + embedding. CRUD at `/goals/{user_id}`, discuss via `/goals/{user_id}/{goal_id}/discuss` (triggers Council with `goal_id` link), generate action plan via `/goals/{user_id}/{goal_id}/plan` (triggers DAG with `goal_id` link). Similarity search: `POST /goals/{user_id}/check-similar` (pgvector cosine similarity, threshold=0.80). Background reassesses every 10 cycles.

**Guardrails** (embedded in orchestrator): Inbound validation (reject empty/long/off-topic/prompt-injection, permissive for financial keywords) wraps all 4 user-facing LLM entry points at route level (HTTP 422 on rejection). Outbound validation (flag compliance issues: return promises, unauthorized advice, harmful recommendations) appends disclaimer after rehydration. `SYSTEM_GUARDRAIL` constant appended to all 9 user-facing LLM system prompts. File: `services/guardrails.py`.

**Wealthsimple on-platform**: Seeded via `POST /admin/demo/setup`. Creates institution template (discovery_method='on_platform'), connection (access_token='on-platform'), accounts, and holdings. Background polling skips on-platform connections. Twin snapshot includes `holdings[]` and `goals[]`.

### Adding a New Simulated Bank

The orchestrator, twin, council, PII filter, and DAG engine are all institution-agnostic. Adding a new bank is a configuration task, not an engineering task. Steps:

1. **Create the bank service** — new directory `bank-<name>/src/`. Define `accounts.js` (account products + per-seed-user balances in `SEED_USER_CONFIGS`) and `patterns.js` (transaction patterns). `index.js` calls `createFdxServer(config)` from the shared lib — gives you OAuth, FDX v6 endpoints, failure injection, pagination for free.
2. **Add to registry** — add the institution entry in `registry/src/index.js` (id, name, baseUrl, mfaRequired, capabilities).
3. **Add to Docker Compose** — new service in `docker-compose.yml` (same Node Dockerfile, new port, health check, `BASE_URL` env var). Add `<NAME>_BASE_URL` env var to the registry service.
4. **Add seed user configs** — define what accounts each seed user has at this bank. Add the bank to `admin_demo.py` `SEED_USER_CONFIGS` so `POST /admin/demo/setup` auto-connects.
5. **Add to workspace** — add `bank-<name>` to the root `package.json` workspaces array.

No changes needed in the orchestrator, twin, council, PII filter, or DAG engine — they work generically against any FDX-compliant bank the factory produces.

### Shared Library (`@financial-os/shared`)

All 3 banks + registry are Node npm workspaces sharing a common library. Banks are created via `createFdxServer(config)` factory which sets up OAuth, FDX v6 endpoints, failure injection, and token validation. Transaction data is deterministic via seeded PRNG (`seedrandom`).

### Database Patterns

- **SCD2 (Slowly Changing Dimensions)**: `connected_accounts` uses `valid_from`/`valid_to` — current row has `valid_to IS NULL`, historical rows have both set. On account data change, close old row and insert new.
- **Append-only**: `twin_transactions`, `twin_statements`, `twin_metrics` — never updated, only inserted. Idempotent via ON CONFLICT DO NOTHING.
- **Vector similarity**: `council_sessions` uses pgvector `VECTOR(1536)` column with HNSW index for cosine similarity search on question embeddings. `user_goals` also has `goal_embedding VECTOR(1536)` with HNSW index for goal similarity detection (MIGRATION_V13).
- **Goal-linked FKs**: `action_dags.goal_id` and `council_sessions.goal_id` FK to `user_goals` (MIGRATION_V12). Links DAGs and council sessions to the goal that spawned them.
- **Soft archive**: `council_sessions.archived` and `action_dags.archived` BOOLEAN columns (MIGRATION_V13). Archived items excluded from list/similarity queries. Goals use `status='abandoned'` for soft delete (pre-existing pattern).
- **Migrations**: Inline SQL in `onboarding-orchestrator/src/db/migrations.py`, idempotent (CREATE IF NOT EXISTS). Run automatically on orchestrator startup. 13 tables (through MIGRATION_V13): institution_templates, connections, connected_accounts, twin_transactions, twin_statements, twin_metrics, onboarding_events, action_dags, dag_nodes, twin_holdings, user_goals, council_sessions, + progress tables.

### Configuration Pattern

- **Node services**: env vars `PORT`, `BASE_URL`, `LOG_LEVEL`
- **Python orchestrator**: pydantic-settings with `ONBOARDING_` prefix (e.g., `ONBOARDING_DATABASE_URL`)
- **Python PII filter**: pydantic-settings with `PII_FILTER_` prefix (e.g., `PII_FILTER_SESSION_TTL_SECONDS`)
- **Docker networking**: services reference each other by Docker service name (e.g., `http://pii-filter:3030`), overridden via env vars in docker-compose.yml
- **API keys**: stored in `services/onboarding-orchestrator/.env`, loaded via env_file in docker-compose

### LLM Client

`onboarding-orchestrator/src/services/llm_client.py` — `query_llm()` supports 3 providers (anthropic, openai, gemini). Returns `{"content": str, "tokens": {...}}` or `None` on failure. Uses the shared httpx async client singleton.

### Logging Convention (Python)

```python
logger = logging.getLogger("onboarding")
logger.debug("Component → action param=value")     # entering
logger.info("Component ← result after action")      # completing
```

### Test Pattern (Integration)

All E2E tests use a `fetchJSON(url, options)` helper wrapping `fetch()`. Tests are designed to be resilient to existing DB state where possible (check current state and adapt rather than assuming pristine).

## Simulated User

**Alex Chen** — user_id: `alex-chen`. 34yo, $105k income, common-law, renting.
- Maple Direct: chequing ($4,200) + Visa ($2,800) + Mastercard ($450)
- Heritage Financial: mortgage ($385k, 4.89%) + HELOC
- Frontier Business: business chequing ($12,400) + business Visa ($1,100)

## UI (React Frontend)

React 19 + Vite + Tailwind CSS 4. Lives in `services/ui/`.

**Design**: Wealthsimple-inspired light theme — warm whites (#FAF9F7), Dune (#32302F) primary, Mulish font (Google Fonts). White cards with subtle shadows on warm off-white background.

**Branding**: "Your Financial Picture" (not "Financial OS"). Sidebar subtitle: "Powered by AI". Button: "Link Financial Source" (not "Connect Bank"). Custom SVG favicon (Dune circle + dollar sign). Dynamic page title: "Your Financial Picture — {display_name}".

**Pages**: Login, Financial Picture (TwinDashboard), Progress, Your Adviser (`/plan`, `YourPlan.tsx` — conversation-first: Ask Your Adviser → Past Conversations → Your Goals → Your Action Plans), Admin (5 subroutes). Auth context with protected/admin routes. Sidebar shows "Your Adviser" (was "Your Plan"). Sidebar shows admin nav items directly for admin users (no user nav), user nav items for regular users. `Explore.tsx` is dead code (kept but not imported).

**Admin routing**: Nested subroutes (`/admin/registry`, `/admin/users`, `/admin/demo`, `/admin/benchmarks`, `/admin/background`). `Admin.tsx` is a layout wrapper (`h1` + `<Outlet />`), each tab is a named export. Index redirects to `/admin/registry`.

**Key patterns**:
- Human-readable labels throughout (no acronyms like "DTI" — always "Debt-to-Income Ratio")
- Progress page: Assessment at top (LLM-generated title + summary on POST assess, rule-based fallback on GET), no milestone toasts. Latest milestone shown in Milestones section, expand for older ones
- Your Adviser page (conversation-first flow): Section 1 "Ask Your Adviser" (question input at top, mode toggle below, "Track as Goal"/"Debate This?"/"Create Action Plan" on results), Section 2 "Our Past Conversations", Section 3 "Your Goals" (small "+ Add a goal manually", similar goal detection via pgvector), Section 4 "Your Action Plans". All three list sections use identical collapsible card pattern: collapsed shows title/question + date + arrow, expanded shows metadata badges + detail content + action buttons (including Archive). "Track as Goal" retroactively links session to new goal via PATCH.
- TierCard shows next-tier guidance with weakest component analysis
- Wealthsimple accounts show "On Platform" badge, holdings table per account, portfolio allocation card
- Recent Transactions: collapsed rows (date, description, amount), click to expand details (category, account, type, ID)
- Admin Background tab: status bar, anomalies, per-user cards filtered to external bank connections only (on-platform-only users hidden, on-platform connections removed entirely). Per-user poll button with health group labels (Successful/Partially Failed/Failed) and color-coded counts; timestamp turns green after poll. Connection expand → lazy-loaded event history (collapsed rows, click to expand details), `EventTypeBadge` color-codes event types. `fetchJSON` uses `cache: 'no-store'`; `fetchData` uses `Promise.allSettled` for resilience
- HTTPS via `@vitejs/plugin-basic-ssl`

```bash
cd services/ui
npm run dev     # Vite dev server
npm run build   # Production build
```

## Environment Notes

- Node 20.20.0 via nvm — in bash tool, set `PATH="/home/nphilip/.nvm/versions/node/v20.20.0/bin:$PATH"` or source nvm
- Python 3.12 (in Docker containers)
- Docker at `/usr/bin/docker`
- Working directory: `services/` for npm/node commands, repo root for docker compose
