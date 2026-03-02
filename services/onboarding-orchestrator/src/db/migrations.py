import asyncpg
import logging

logger = logging.getLogger("onboarding")

SCHEMA = """
CREATE TABLE IF NOT EXISTS institution_templates (
    institution_id   TEXT PRIMARY KEY,
    institution_name TEXT NOT NULL,
    base_url         TEXT NOT NULL,
    fdx_version      TEXT NOT NULL DEFAULT '6.0',
    authorize_endpoint TEXT NOT NULL,
    token_endpoint     TEXT NOT NULL,
    revoke_endpoint    TEXT,
    accounts_endpoint  TEXT NOT NULL,
    scopes_supported   TEXT[] NOT NULL DEFAULT '{}',
    mfa_required       BOOLEAN NOT NULL DEFAULT FALSE,
    polling_interval_seconds INTEGER NOT NULL DEFAULT 300,
    discovered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    discovery_method TEXT NOT NULL DEFAULT 'llm_assisted'
);

CREATE TABLE IF NOT EXISTS connections (
    id               SERIAL PRIMARY KEY,
    user_id          TEXT NOT NULL DEFAULT 'alex-chen',
    institution_id   TEXT NOT NULL REFERENCES institution_templates(institution_id),
    status           TEXT NOT NULL DEFAULT 'pending',
    access_token     TEXT,
    refresh_token    TEXT,
    token_expires_at TIMESTAMPTZ,
    consent_scopes   TEXT[] NOT NULL DEFAULT '{}',
    connected_at     TIMESTAMPTZ,
    last_poll_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, institution_id)
);

CREATE TABLE IF NOT EXISTS connected_accounts (
    id               SERIAL PRIMARY KEY,
    connection_id    INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    account_id       TEXT NOT NULL,
    account_type     TEXT NOT NULL,
    account_category TEXT NOT NULL,
    display_name     TEXT NOT NULL,
    masked_number    TEXT,
    currency         TEXT NOT NULL DEFAULT 'CAD',
    balance          NUMERIC,
    balance_type     TEXT,
    raw_data         JSONB NOT NULL DEFAULT '{}',
    discovered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_from       TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to         TIMESTAMPTZ,
    pull_id          TEXT
);

CREATE TABLE IF NOT EXISTS twin_transactions (
    id               SERIAL PRIMARY KEY,
    connection_id    INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    account_id       TEXT NOT NULL,
    transaction_id   TEXT NOT NULL,
    posted_date      DATE,
    amount           NUMERIC,
    description      TEXT,
    category         TEXT,
    transaction_type TEXT,
    raw_data         JSONB NOT NULL DEFAULT '{}',
    pulled_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(connection_id, account_id, transaction_id)
);

CREATE TABLE IF NOT EXISTS twin_statements (
    id               SERIAL PRIMARY KEY,
    connection_id    INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    account_id       TEXT NOT NULL,
    statement_id     TEXT NOT NULL,
    statement_date   DATE,
    description      TEXT,
    raw_data         JSONB NOT NULL DEFAULT '{}',
    pulled_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(connection_id, account_id, statement_id)
);

CREATE TABLE IF NOT EXISTS twin_metrics (
    id               SERIAL PRIMARY KEY,
    user_id          TEXT NOT NULL DEFAULT 'alex-chen',
    metric_type      TEXT NOT NULL,
    metric_value     NUMERIC NOT NULL,
    breakdown        JSONB NOT NULL DEFAULT '{}',
    computed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_twin_metrics_user_type
    ON twin_metrics(user_id, metric_type, computed_at DESC);

CREATE TABLE IF NOT EXISTS onboarding_events (
    id               SERIAL PRIMARY KEY,
    connection_id    INTEGER REFERENCES connections(id),
    institution_id   TEXT NOT NULL,
    event_type       TEXT NOT NULL,
    details          JSONB NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


MIGRATION_V2_SCD2 = """
-- v2: Add SCD2 columns to connected_accounts if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'connected_accounts' AND column_name = 'valid_from'
    ) THEN
        ALTER TABLE connected_accounts ADD COLUMN valid_from TIMESTAMPTZ NOT NULL DEFAULT now();
        ALTER TABLE connected_accounts ADD COLUMN valid_to TIMESTAMPTZ;
        ALTER TABLE connected_accounts ADD COLUMN pull_id TEXT;
        -- Drop old unique constraint and replace with partial index
        ALTER TABLE connected_accounts DROP CONSTRAINT IF EXISTS connected_accounts_connection_id_account_id_key;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_connected_accounts_current
    ON connected_accounts(connection_id, account_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_connected_accounts_raw_data
    ON connected_accounts USING GIN (raw_data);
"""


MIGRATION_V3_DAGS = """
-- v3: Action DAG tables for the DAG Engine (Component 8)
CREATE TABLE IF NOT EXISTS action_dags (
    id               SERIAL PRIMARY KEY,
    user_id          TEXT NOT NULL DEFAULT 'alex-chen',
    title            TEXT NOT NULL,
    description      TEXT,
    source_type      TEXT NOT NULL DEFAULT 'council',
    source_id        TEXT,
    status           TEXT NOT NULL DEFAULT 'draft',
    council_question TEXT,
    council_synthesis TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dag_nodes (
    id               SERIAL PRIMARY KEY,
    dag_id           INTEGER NOT NULL REFERENCES action_dags(id) ON DELETE CASCADE,
    node_key         TEXT NOT NULL,
    title            TEXT NOT NULL,
    description      TEXT,
    node_type        TEXT NOT NULL DEFAULT 'check',
    execution_type   TEXT NOT NULL DEFAULT 'auto',
    status           TEXT NOT NULL DEFAULT 'pending',
    depends_on       TEXT[] NOT NULL DEFAULT '{}',
    prerequisites    JSONB NOT NULL DEFAULT '{}',
    result           JSONB,
    instructions     TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at       TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    UNIQUE(dag_id, node_key)
);

CREATE INDEX IF NOT EXISTS idx_action_dags_user ON action_dags(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dag_nodes_dag ON dag_nodes(dag_id, node_key);
"""


MIGRATION_V4_USERS = """
-- v4: Users table for authentication
CREATE TABLE IF NOT EXISTS users (
    id               TEXT PRIMARY KEY,
    username         TEXT NOT NULL UNIQUE,
    display_name     TEXT NOT NULL,
    password_hash    TEXT NOT NULL,
    role             TEXT NOT NULL DEFAULT 'user',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


MIGRATION_V5_ACCOUNT_CONSENT = """
-- v5: Per-account consent tracking on connections
ALTER TABLE connections ADD COLUMN IF NOT EXISTS consented_account_ids TEXT[];
"""


MIGRATION_V6_USER_PROFILE = """
-- v6: Add profile JSONB column to users for demographic/personal data
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}';
"""


MIGRATION_V7_PROGRESS = """
-- v7: Progress tracking tables for gamified financial wellness
CREATE TABLE IF NOT EXISTS progress_milestones (
    id               SERIAL PRIMARY KEY,
    user_id          TEXT NOT NULL,
    milestone_type   TEXT NOT NULL,
    milestone_key    TEXT NOT NULL,
    milestone_value  NUMERIC,
    details          JSONB NOT NULL DEFAULT '{}',
    narrative        TEXT,
    acknowledged     BOOLEAN NOT NULL DEFAULT FALSE,
    achieved_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, milestone_key)
);

CREATE TABLE IF NOT EXISTS progress_streaks (
    id               SERIAL PRIMARY KEY,
    user_id          TEXT NOT NULL,
    streak_type      TEXT NOT NULL,
    current_count    INTEGER NOT NULL DEFAULT 0,
    longest_count    INTEGER NOT NULL DEFAULT 0,
    last_checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    streak_start_at  TIMESTAMPTZ,
    UNIQUE(user_id, streak_type)
);

CREATE INDEX IF NOT EXISTS idx_progress_milestones_user
    ON progress_milestones(user_id, achieved_at DESC);
CREATE INDEX IF NOT EXISTS idx_progress_streaks_user
    ON progress_streaks(user_id);
"""


MIGRATION_V8_BENCHMARK_OVERRIDES = """
-- v8: Admin benchmark overrides — allows runtime editing of national benchmarks
CREATE TABLE IF NOT EXISTS benchmark_overrides (
    id               SERIAL PRIMARY KEY,
    bracket_key      TEXT NOT NULL UNIQUE,
    overrides        JSONB NOT NULL DEFAULT '{}',
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


MIGRATION_V9_HOLDINGS = """
-- v9: Investment holdings for on-platform (Wealthsimple) data
CREATE TABLE IF NOT EXISTS twin_holdings (
    id               SERIAL PRIMARY KEY,
    connection_id    INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    account_id       TEXT NOT NULL,
    symbol           TEXT NOT NULL,
    name             TEXT NOT NULL,
    asset_class      TEXT NOT NULL DEFAULT 'equity',
    quantity         NUMERIC NOT NULL DEFAULT 0,
    cost_basis       NUMERIC NOT NULL DEFAULT 0,
    market_value     NUMERIC NOT NULL DEFAULT 0,
    currency         TEXT NOT NULL DEFAULT 'CAD',
    as_of            DATE NOT NULL DEFAULT CURRENT_DATE,
    UNIQUE(connection_id, account_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_twin_holdings_connection
    ON twin_holdings(connection_id, account_id);
"""


MIGRATION_V10_GOALS = """
-- v10: User goals with LLM-powered feasibility analysis
CREATE TABLE IF NOT EXISTS user_goals (
    id               SERIAL PRIMARY KEY,
    user_id          TEXT NOT NULL,
    raw_text         TEXT NOT NULL,
    summary_label    TEXT,
    goal_type        TEXT,
    target_amount    NUMERIC,
    target_date      DATE,
    feasibility      TEXT DEFAULT 'yellow',
    feasibility_assessment TEXT,
    cross_goal_impact JSONB NOT NULL DEFAULT '[]',
    progress_pct     NUMERIC NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'active',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_goals_user_status
    ON user_goals(user_id, status);
"""


MIGRATION_V11_COUNCIL_SESSIONS = """
-- v11: Persistent council sessions with pgvector embeddings for similarity search
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS council_sessions (
    id               SERIAL PRIMARY KEY,
    user_id          TEXT NOT NULL,
    mode             TEXT NOT NULL,
    question         TEXT NOT NULL,
    question_embedding VECTOR(1536),
    response         JSONB NOT NULL DEFAULT '{}',
    synthesis        TEXT,
    elapsed_ms       INTEGER,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_council_sessions_user
    ON council_sessions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_council_sessions_embedding
    ON council_sessions USING hnsw (question_embedding vector_cosine_ops);
"""


MIGRATION_V12_GOAL_LINKS = """
-- v12: Link DAGs and council sessions to goals
ALTER TABLE action_dags ADD COLUMN IF NOT EXISTS goal_id INTEGER REFERENCES user_goals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_action_dags_goal ON action_dags(goal_id);

ALTER TABLE council_sessions ADD COLUMN IF NOT EXISTS goal_id INTEGER REFERENCES user_goals(id) ON DELETE SET NULL;
"""


MIGRATION_V13_GOAL_EMBEDDINGS_AND_ARCHIVE = """
-- v13: Goal similarity via pgvector + archive support for sessions/DAGs
ALTER TABLE user_goals ADD COLUMN IF NOT EXISTS goal_embedding VECTOR(1536);
CREATE INDEX IF NOT EXISTS idx_user_goals_embedding
    ON user_goals USING hnsw (goal_embedding vector_cosine_ops);

ALTER TABLE council_sessions ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE action_dags ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
"""


async def run_migrations(pool: asyncpg.Pool):
    async with pool.acquire() as conn:
        await conn.execute(SCHEMA)
        await conn.execute(MIGRATION_V2_SCD2)
        await conn.execute(MIGRATION_V3_DAGS)
        await conn.execute(MIGRATION_V4_USERS)
        await conn.execute(MIGRATION_V5_ACCOUNT_CONSENT)
        await conn.execute(MIGRATION_V6_USER_PROFILE)
        await conn.execute(MIGRATION_V7_PROGRESS)
        await conn.execute(MIGRATION_V8_BENCHMARK_OVERRIDES)
        await conn.execute(MIGRATION_V9_HOLDINGS)
        await conn.execute(MIGRATION_V10_GOALS)
        await conn.execute(MIGRATION_V11_COUNCIL_SESSIONS)
        await conn.execute(MIGRATION_V12_GOAL_LINKS)
        await conn.execute(MIGRATION_V13_GOAL_EMBEDDINGS_AND_ARCHIVE)
    logger.info("Database migrations complete")
