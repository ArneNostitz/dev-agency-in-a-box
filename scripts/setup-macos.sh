#!/usr/bin/env bash
# One-command setup for running the Dev Agency as an always-on service on macOS.
# Safe to re-run. Run from the dev-agency folder:  ./scripts/setup-macos.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

echo "=== Dev Agency · macOS setup ==="

# 1. Homebrew
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required. Install it from https://brew.sh and re-run this script." >&2
  exit 1
fi

# 2. Runtime dependencies
command -v node >/dev/null 2>&1 || { echo "Installing node..."; brew install node; }
command -v gh   >/dev/null 2>&1 || { echo "Installing gh...";   brew install gh; }
NODE_BIN="$(command -v node)"
echo "node: $NODE_BIN ($("$NODE_BIN" --version))"
echo "gh:   $(command -v gh) ($(gh --version | head -1))"

# 3. Environment file
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo ">> Created .env. Before continuing, set these in $DIR/.env:"
  echo "   - GITHUB_TOKEN   (your fine-grained token, or run: gh auth token)"
  echo "   - GITHUB_OWNER and TARGET_REPO"
  echo "   For the agent brains, EITHER run 'claude' and /login once (subscription),"
  echo "   OR put CLAUDE_CODE_OAUTH_TOKEN (from 'claude setup-token') / ANTHROPIC_API_KEY in .env."
  echo ""
  echo "Then re-run ./scripts/setup-macos.sh"
  exit 1
fi

# 4. Build
echo "Installing dependencies & building..."
npm install --no-audit --no-fund
npm run build

# 5. Install the launchd service
PLIST="$HOME/Library/LaunchAgents/com.devagency.runner.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$DIR/logs"
sed -e "s#__AGENCY_DIR__#$DIR#g" -e "s#__NODE_BIN__#$NODE_BIN#g" \
  "$DIR/scripts/com.devagency.runner.plist.template" > "$PLIST"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Service installed: it checks for queued issues every 60 seconds."

# 6. Keep awake while on power (best-effort; needs your password once)
if sudo -n true 2>/dev/null || true; then
  sudo pmset -c sleep 0 disksleep 0 2>/dev/null \
    && echo "Sleep disabled while on power." \
    || echo "(Could not set pmset — keep the Mac plugged in and lid open.)"
fi

echo ""
echo "=== Done. The agency is live. ==="
echo "File an issue on your target repo and add the 'agency:queue' label."
echo "Watch it work:   tail -f $DIR/logs/agency.log"
echo "Stop the agency: launchctl unload $PLIST"
