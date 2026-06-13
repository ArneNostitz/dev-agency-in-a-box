# Dev Agency runtime: Node + git + GitHub CLI.
# The Agent SDK bundles its own native Claude Code binary, so no extra runtime is needed.
FROM node:22-bookworm-slim

# git (for branches/commits) and gh (GitHub CLI used by the agency and the agents).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git gnupg \
    && mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | gpg --dearmor -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# cloudflared: opens a temporary public tunnel so a PR's dev server (run in-container) can be
# opened from your phone — no DNS/Coolify setup. Arch-aware (amd64/arm64).
RUN arch="$(dpkg --print-architecture)" \
    && curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}" \
        -o /usr/local/bin/cloudflared \
    && chmod +x /usr/local/bin/cloudflared

# Python toolchain so the agency can lint/test Python projects (Django, ruff, pytest, coverage).
# The agent creates a venv per repo and pip-installs the repo's requirements at run time (writes
# into the node-owned clone — no system installs, no sudo needed). build-essential + libpq-dev +
# python3-dev cover C-extension deps like psycopg2.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv python3-dev build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Graphify (https://github.com/safishamsi/graphify) — knowledge-graph engine for the codebase
# Auditor agent: builds a structural graph (NetworkX + Leiden + tree-sitter) and a GRAPH_REPORT.md
# (god nodes + surprising connections). Pure Python, on-device, no native FTS extension. Best-effort
# (the audit feature degrades to direct code analysis if it's unavailable). PyPI name: graphifyy.
RUN pip install --no-cache-dir --break-system-packages graphifyy \
    || echo "graphify not installed (optional) — the auditor falls back to direct codebase analysis"

WORKDIR /app

# Enable corepack so agents can use pnpm / yarn in target repos (not just npm).
RUN corepack enable || true

# Optional: GitNexus code-intelligence (token-light codebase research via MCP). Best-effort —
# the build never fails on it, and the runtime only uses it when GITNEXUS=true. Skipping the
# vendored Dart/Proto/Swift grammars avoids needing a C++ toolchain.
RUN GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1 npm install -g gitnexus@latest \
    || echo "gitnexus not installed (optional) — set GITNEXUS=true only if this succeeds"

# Pre-install LadybugDB's FTS (full-text search) extension at BUILD time. GitNexus runs LadybugDB
# "load-only" during analyze — it won't download the extension itself — so at runtime full-text
# search is silently disabled with "FTS extension unavailable". The maintainer confirms a one-time
# `analyze` WITH network installs it. The build has full network, and GitNexus caches the extension
# under the node user's home (~/.gitnexus / ~/.ladybug), which lives in the IMAGE (only ~/.claude is
# on the data volume) — so installing it once here makes it persist for every run. Best-effort:
# never fails the build; if it can't install, runtime falls back to structural-graph-only.
RUN set -eux; \
    d=/tmp/gnwarm; rm -rf "$d"; mkdir -p "$d"; cd "$d"; \
    git init -q; printf 'def hello():\n    return "hi"\n' > app.py; \
    git -c user.email=build@local -c user.name=build add -A; \
    git -c user.email=build@local -c user.name=build commit -qm init; \
    HOME=/home/node GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1 gitnexus analyze --skip-embeddings 2>&1 | tail -25 \
      || echo "gitnexus FTS warm: best-effort (failed; runtime falls back to structural-only search)"; \
    cd /; rm -rf "$d"; \
    chown -R node:node /home/node/.gitnexus /home/node/.ladybug /home/node/.kuzu /home/node/.cache 2>/dev/null || true

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY memory ./memory
COPY config ./config
COPY web ./web
COPY scripts ./scripts

RUN npm run build

# Build stamp so the dashboard can show what's actually deployed (vs what's on main). The commit
# SHA is best-effort: Coolify can pass --build-arg BUILD_SHA=$SOURCE_COMMIT; otherwise the build
# time alone already reveals a stale deploy.
ARG BUILD_SHA=
RUN BUILD_SHA="$BUILD_SHA" node -e "require('fs').writeFileSync('web/version.json', JSON.stringify({version:require('./package.json').version, builtAt:new Date().toISOString(), sha:(process.env.BUILD_SHA||'').slice(0,7)}))"

# Webhook mode listens here (ignored in watch/once mode).
EXPOSE 3000

# Default to a long-running watcher (ideal for Coolify / any container host).
# Override RUN_MODE=once for a one-shot/cron-style run.
ENV RUN_MODE=watch \
    POLL_INTERVAL_SECONDS=60 \
    DB_PATH=/app/data/agency.db \
    HOME=/home/node \
    NODE_ENV=production

# Run as a NON-root user: Claude Code refuses --dangerously-skip-permissions (bypassPermissions)
# when running as root, which is exactly what the agents need. The `node` user ships with the
# base image. Owning /app (incl. the data dir an empty named volume inherits ownership from)
# lets the agent write code, clone repos, and persist the SQLite memory.
# Put Claude's session store (~/.claude) on the data volume so an interrupted run's session can
# be resumed after a restart/redeploy (sessions live at ~/.claude/projects/<dir>/<id>.jsonl).
# Only the dirs the node user must WRITE at runtime are chowned: /app/data (SQLite DB + a named
# volume inherits its ownership) and /app/.work (repo clones). We deliberately do NOT `chown -R
# /app`: that walks all of node_modules, and since node_modules comes from a cached lower overlay
# layer, chowning it forces a full copy-up of the tree into the writable layer every time this
# layer rebuilds — which (after many deploys fill the builder's disk) is what made the build exit
# 1 with no surfaced stderr. node_modules only needs to be readable/executable (root-owned, world-
# readable by default), so leaving it untouched is correct and far cheaper. The /app dir entry
# itself is chowned (non-recursively) so the node user can create paths directly under it.
RUN set -eux; mkdir -p /app/data /app/.work /app/data/claude
RUN set -eux; rm -rf /home/node/.claude; ln -sfn /app/data/claude /home/node/.claude
RUN set -eux; chown node:node /app; chown -R node:node /app/data /app/.work
RUN set -eux; chown -h node:node /home/node/.claude
USER node

# Stable git identity for the agency's commits (written to the node user's home).
RUN git config --global user.name "dev-agency-bot" \
    && git config --global user.email "dev-agency-bot@users.noreply.github.com"

CMD ["node", "dist/runner.js"]
