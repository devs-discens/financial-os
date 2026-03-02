#!/usr/bin/env bash
#
# stop.sh — Stop all Financial OS services.
#
# Usage:
#   ./scripts/stop.sh           # stop all containers (keep volumes)
#   ./scripts/stop.sh --clean   # stop and remove volumes (destroys DB data)
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

info()  { echo -e "${GREEN}[stop]${NC} $1"; }
warn()  { echo -e "${YELLOW}[stop]${NC} $1"; }
error() { echo -e "${RED}[stop]${NC} $1"; }

# Parse arguments
CLEAN=false
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=true ;;
    -h|--help)
      echo "Usage: $0 [--clean]"
      echo "  --clean  Remove volumes too (destroys database data)"
      exit 0
      ;;
    *)
      error "Unknown option: $arg"
      exit 1
      ;;
  esac
done

# Check if anything is running
RUNNING=$(docker compose ps --format '{{.Service}}' 2>/dev/null | grep -cv "^$" || true)
if [ "$RUNNING" -eq 0 ]; then
  info "No services are running."
  exit 0
fi

info "Stopping $RUNNING services..."

if [ "$CLEAN" = true ]; then
  warn "Removing volumes (database data will be lost)..."
  docker compose down -v 2>&1
else
  docker compose down 2>&1
fi

info "All services stopped."
