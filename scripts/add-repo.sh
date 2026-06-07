#!/usr/bin/env bash
# Add a repository to the agency's watch list and push (Coolify auto-redeploys).
# Usage:  ./scripts/add-repo.sh <repo>
#   <repo> = "name" (under GITHUB_OWNER) or "owner/name"
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

REPO="${1:-}"
if [ -z "$REPO" ]; then
  echo "Usage: ./scripts/add-repo.sh <repo>   (e.g. my-app  or  someorg/my-app)" >&2
  exit 1
fi

FILE="config/repos.txt"
touch "$FILE"

# Already present? (ignore comments/whitespace)
if grep -qE "^\s*${REPO}\s*(#.*)?$" "$FILE"; then
  echo "'$REPO' is already in the watch list."
  exit 0
fi

echo "$REPO" >> "$FILE"
echo "Added '$REPO' to $FILE."

if git rev-parse --git-dir >/dev/null 2>&1; then
  git add "$FILE"
  git commit -q -m "watch repo: $REPO" && echo "Committed."
  if git push 2>/dev/null; then
    echo "Pushed — the agency will start watching '$REPO' on the next deploy/poll."
  else
    echo "Committed locally. Run 'git push' to deploy the change."
  fi
else
  echo "(Not a git repo here — just edit $FILE and deploy.)"
fi
