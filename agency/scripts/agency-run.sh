#!/usr/bin/env bash
# Wrapper invoked by launchd every minute. Processes one queued issue then exits.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
mkdir -p logs
NODE_BIN="${NODE_BIN:-node}"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] tick" >> logs/agency.log
"$NODE_BIN" --env-file=.env dist/runner.js >> logs/agency.log 2>&1
