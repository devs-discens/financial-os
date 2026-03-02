#!/usr/bin/env bash
#
# ui-start.sh — Start the Financial OS UI dev server.
#
# Usage:
#   ./scripts/ui-start.sh            # start Vite dev server (foreground)
#   ./scripts/ui-start.sh --bg       # start in background
#   ./scripts/ui-start.sh --build    # production build + preview server
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICES_DIR="$(dirname "$SCRIPT_DIR")"
UI_DIR="$SERVICES_DIR/ui"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[ui]${NC} $1"; }
warn()  { echo -e "${YELLOW}[ui]${NC} $1"; }
error() { echo -e "${RED}[ui]${NC} $1"; }

# nvm / Node
export PATH="$HOME/.nvm/versions/node/v20.20.0/bin:$PATH"

if ! command -v node &>/dev/null; then
  error "Node.js not found. Ensure nvm is installed with Node 20."
  exit 1
fi

# Parse arguments
BACKGROUND=false
BUILD=false
for arg in "$@"; do
  case "$arg" in
    --bg)    BACKGROUND=true ;;
    --build) BUILD=true ;;
    -h|--help)
      echo "Usage: $0 [--bg] [--build]"
      echo "  --bg     Run dev server in background (PID saved to ui/.ui.pid)"
      echo "  --build  Production build then preview server"
      exit 0
      ;;
    *)
      error "Unknown option: $arg"
      exit 1
      ;;
  esac
done

cd "$UI_DIR"

# Install deps if needed
if [ ! -d "node_modules" ]; then
  info "Installing dependencies..."
  npm install 2>&1
fi

# Check if already running
PID_FILE="$UI_DIR/.ui.pid"
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    warn "UI dev server already running (PID $OLD_PID). Stop it first with ui-stop.sh"
    exit 1
  else
    rm -f "$PID_FILE"
  fi
fi

if [ "$BUILD" = true ]; then
  info "Building production bundle..."
  npm run build 2>&1
  info "Starting preview server..."
  if [ "$BACKGROUND" = true ]; then
    nohup npx vite preview > "$UI_DIR/.ui.log" 2>&1 &
    echo $! > "$PID_FILE"
    info "Preview server running in background (PID $!)"
    info "Log: $UI_DIR/.ui.log"
  else
    npx vite preview
  fi
else
  info "Starting Vite dev server..."
  echo -e "  ${CYAN}URL${NC}  https://localhost:5173"
  echo ""
  if [ "$BACKGROUND" = true ]; then
    nohup npx vite > "$UI_DIR/.ui.log" 2>&1 &
    echo $! > "$PID_FILE"
    info "Dev server running in background (PID $!)"
    info "Log: $UI_DIR/.ui.log"
  else
    npx vite
  fi
fi
