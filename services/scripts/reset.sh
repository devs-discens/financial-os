#!/usr/bin/env bash
#
# reset.sh — Reset Financial OS to day-0 state for clean demo runs.
#
# Usage:
#   ./scripts/reset.sh                  # keep templates for faster re-onboarding
#   ./scripts/reset.sh --full           # clear everything including templates
#   ./scripts/reset.sh --keep-templates # explicit keep (default behavior)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICES_DIR="$(dirname "$SCRIPT_DIR")"
cd "$SERVICES_DIR"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[reset]${NC} $1"; }
warn()  { echo -e "${YELLOW}[reset]${NC} $1"; }
error() { echo -e "${RED}[reset]${NC} $1"; }

# Parse arguments
CLEAR_TEMPLATES=false
for arg in "$@"; do
  case "$arg" in
    --full)           CLEAR_TEMPLATES=true ;;
    --keep-templates) CLEAR_TEMPLATES=false ;;
    -h|--help)
      echo "Usage: $0 [--full | --keep-templates]"
      echo "  --full            Clear everything including institution templates"
      echo "  --keep-templates  Keep templates for faster re-onboarding (default)"
      exit 0
      ;;
    *)
      error "Unknown option: $arg"
      exit 1
      ;;
  esac
done

# 1. Verify Docker services are running
info "Checking Docker services..."
if ! docker compose ps --format '{{.Service}}' | grep -q postgres; then
  error "PostgreSQL is not running. Start services with: docker compose up -d"
  exit 1
fi

# 2. Clear database tables (FK-safe order)
info "Clearing database tables..."

TRUNCATE_TABLES="council_sessions, user_goals, benchmark_overrides, progress_streaks, progress_milestones, dag_nodes, action_dags, onboarding_events, twin_metrics, twin_statements, twin_transactions, twin_holdings, connected_accounts, connections, users"

if [ "$CLEAR_TEMPLATES" = true ]; then
  TRUNCATE_TABLES="$TRUNCATE_TABLES, institution_templates"
  info "  (including institution_templates — full reset)"
else
  info "  (keeping institution_templates for faster re-onboarding)"
fi

docker exec services-postgres-1 psql -U financial_os -d financial_os -c \
  "TRUNCATE $TRUNCATE_TABLES CASCADE;" 2>&1

if [ $? -eq 0 ]; then
  info "Database tables cleared"
else
  error "Failed to clear database tables"
  exit 1
fi

# 3. Restart services to clear in-memory state
info "Restarting registry (clears in-memory state)..."
docker compose restart registry 2>&1

info "Restarting PII filter (clears sessions)..."
docker compose restart pii-filter 2>&1

info "Restarting orchestrator (clears background state)..."
docker compose restart onboarding-orchestrator 2>&1

# 4. Wait for services to start
info "Waiting for services to start..."
sleep 5

# 5. Verify clean state
info "Verifying clean state..."
CONN_COUNT=$(docker exec services-postgres-1 psql -U financial_os -d financial_os -t -c \
  "SELECT COUNT(*) FROM connections;" 2>&1 | tr -d ' ')
DAG_COUNT=$(docker exec services-postgres-1 psql -U financial_os -d financial_os -t -c \
  "SELECT COUNT(*) FROM action_dags;" 2>&1 | tr -d ' ')
SESSION_COUNT=$(docker exec services-postgres-1 psql -U financial_os -d financial_os -t -c \
  "SELECT COUNT(*) FROM council_sessions;" 2>&1 | tr -d ' ')

if [ "$CONN_COUNT" = "0" ] && [ "$DAG_COUNT" = "0" ] && [ "$SESSION_COUNT" = "0" ]; then
  info "Verified: connections=0, dags=0, sessions=0"
else
  warn "Unexpected state: connections=$CONN_COUNT, dags=$DAG_COUNT, sessions=$SESSION_COUNT"
fi

# Check background status
BG_STATUS=$(curl -s http://localhost:3020/background/status 2>/dev/null || echo '{"running":false}')
BG_RUNNING=$(echo "$BG_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('running', False))" 2>/dev/null || echo "unknown")

info ""
info "Reset complete!"
info "  Background polling: $BG_RUNNING"
info "  Templates kept: $([ "$CLEAR_TEMPLATES" = true ] && echo 'no (full reset)' || echo 'yes')"
info ""
info "Ready for demo. Start onboarding with:"
info "  curl -X POST http://localhost:3020/onboarding/connect -H 'Content-Type: application/json' -d '{\"institution_id\":\"maple-direct\"}'"
