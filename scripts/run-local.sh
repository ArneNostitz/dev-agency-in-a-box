#!/usr/bin/env bash
# Run the Phase 1 agency loop locally (no Docker). Requires Node >=20, git, and gh on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env found. Copy .env.example to .env and fill in your keys first." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Running the dev agency against the configured target repo..."
npm run dev
