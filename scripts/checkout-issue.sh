#!/usr/bin/env bash
# Pull an agency issue's branch onto your machine so you can run/test it locally.
# Usage:  ./scripts/checkout-issue.sh <owner/repo> <issue-number>
#   e.g.  ./scripts/checkout-issue.sh ArneNostitz/reimedy-minimal 53
set -euo pipefail

REPO="${1:-}"; N="${2:-}"
if [ -z "$REPO" ] || [ -z "$N" ]; then
  echo "Usage: ./scripts/checkout-issue.sh <owner/repo> <issue-number>" >&2
  exit 1
fi

BRANCH="agency/issue-$N"
DIR="$(basename "$REPO")"

if [ ! -d "$DIR/.git" ]; then
  gh repo clone "$REPO" "$DIR"
fi
cd "$DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH" || true

echo ""
echo "✅ Checked out $BRANCH in ./$DIR"
if [ -f package.json ]; then
  echo "   Next: cd $DIR && npm install && npm run dev   (or this project's run command)"
fi
