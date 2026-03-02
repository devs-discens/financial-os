#!/usr/bin/env bash
#
# ui-stop.sh — Stop the Financial OS UI dev server.
#
# Usage:
#   ./scripts/ui-stop.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICES_DIR="$(dirname "$SCRIPT_DIR")"
UI_DIR="$SERVICES_DIR/ui"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[ui]${NC} $1"; }
warn()  { echo -e "${YELLOW}[ui]${NC} $1"; }

PID_FILE="$UI_DIR/.ui.pid"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null
    info "Stopped UI server (PID $PID)"
  else
    warn "PID $PID is not running (stale pid file)"
  fi
  rm -f "$PID_FILE"
else
  # Try to find by port
  PID=$(lsof -ti:5173 2>/dev/null || true)
  if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null
    info "Stopped UI server on port 5173 (PID $PID)"
  else
    info "No UI server is running."
  fi
fi

rm -f "$UI_DIR/.ui.log"
