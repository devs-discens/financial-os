#!/usr/bin/env bash
#
# start.sh — Build and start all Financial OS services.
#
# Usage:
#   ./scripts/start.sh           # build and start all services
#   ./scripts/start.sh --no-build  # start without rebuilding images
#   ./scripts/start.sh --logs      # start and follow logs
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICES_DIR="$(dirname "$SCRIPT_DIR")"
cd "$SERVICES_DIR"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[start]${NC} $1"; }
warn()  { echo -e "${YELLOW}[start]${NC} $1"; }
error() { echo -e "${RED}[start]${NC} $1"; }

# Parse arguments
BUILD=true
FOLLOW_LOGS=false
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=false ;;
    --logs)     FOLLOW_LOGS=true ;;
    -h|--help)
      echo "Usage: $0 [--no-build] [--logs]"
      echo "  --no-build  Skip image rebuild (use existing images)"
      echo "  --logs      Follow container logs after startup"
      exit 0
      ;;
    *)
      error "Unknown option: $arg"
      exit 1
      ;;
  esac
done

# 1. Build and start
if [ "$BUILD" = true ]; then
  info "Building and starting all services..."
  docker compose up --build -d 2>&1
else
  info "Starting all services (no rebuild)..."
  docker compose up -d 2>&1
fi

# 2. Wait for services to start
info "Waiting for services to start..."
TIMEOUT=30
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  RUNNING=$(docker compose ps --format '{{.Service}}' 2>/dev/null | grep -cv "^$" || true)
  if [ "$RUNNING" -ge 7 ]; then
    break
  fi
  printf "\r  ${CYAN}%d/7 running (%ds)${NC}  " "$RUNNING" "$ELAPSED"
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done
echo ""

if [ $ELAPSED -ge $TIMEOUT ]; then
  warn "Only ${RUNNING}/7 services running after ${TIMEOUT}s"
  docker compose ps
fi

# 3. Show status
info "All services started!"
echo ""
docker compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'
echo ""

# 4. Quick health verification
info "Service endpoints:"
echo -e "  ${CYAN}Maple Direct${NC}      http://localhost:3001/health"
echo -e "  ${CYAN}Heritage Financial${NC} http://localhost:3002/health"
echo -e "  ${CYAN}Frontier Business${NC}  http://localhost:3003/health"
echo -e "  ${CYAN}Registry${NC}           http://localhost:3010/health"
echo -e "  ${CYAN}Orchestrator${NC}       http://localhost:3020/health"
echo -e "  ${CYAN}PII Filter${NC}         http://localhost:3030/health"
echo -e "  ${CYAN}PostgreSQL${NC}         localhost:5433"
echo ""

# Check background polling
BG_STATUS=$(curl -s http://localhost:3020/background/status 2>/dev/null || echo '{"running":false}')
BG_RUNNING=$(echo "$BG_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('running', False))" 2>/dev/null || echo "unknown")
BG_CYCLES=$(echo "$BG_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cycle_count', 0))" 2>/dev/null || echo "0")
info "Background polling: $BG_RUNNING (cycles: $BG_CYCLES)"

if [ "$FOLLOW_LOGS" = true ]; then
  echo ""
  info "Following logs (Ctrl+C to stop)..."
  docker compose logs -f
fi
