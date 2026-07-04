# Dev Agency runtime: Node + git + GitHub CLI.
# The Agent SDK bundles its own native Claude Code binary, so no extra runtime is needed.
FROM node:22-bookworm-slim

# Optional toolchains — all default ON (so existing deploys are unchanged on rebuild). For a lean
# core image (Claude pipeline only) pass e.g. `--build-arg WITH_PI=0 --build-arg WITH_TUNNEL=0
# --build-arg WITH_AUDITOR=0 --build-arg WITH_GITNEXUS=0 --build-arg WITH_PYTHON=0`.
ARG WITH_TUNNEL=1
ARG WITH_PYTHON=1
ARG WITH_AUDITOR=1
ARG WITH_GITNEXUS=1
ARG WITH_PI=1

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
RUN if [ "$WITH_TUNNEL" = "1" ]; then arch="$(dpkg --print-architecture)" \
    && curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}" \
        -o /usr/local/bin/cloudflared \
    && chmod +x /usr/local/bin/cloudflared; \
    else echo "skip cloudflared (WITH_TUNNEL=0) — phone preview tunnels disabled"; fi

# Python toolchain so the agency can lint/test Python projects (Django, ruff, pytest, coverage).
# The agent creates a venv per repo and pip-installs the repo's requirements at run time (writes
# into the node-owned clone — no system installs, no sudo needed). build-essential + libpq-dev +
# python3-dev cover C-extension deps like psycopg2.
RUN if [ "$WITH_PYTHON" = "1" ]; then apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv python3-dev build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*; \
    else echo "skip python toolchain (WITH_PYTHON=0) — Python repo lint/test unavailable"; fi

# Graphify (https://github.com/safishamsi/graphify) — knowledge-graph engine for the codebase
# Auditor agent: builds a structural graph (NetworkX + Leiden + tree-sitter) and a GRAPH_REPORT.md
# (god nodes + surprising connections). Pure Python, on-device, no native FTS extension. Best-effort
# (the audit feature degrades to direct code analysis if it's unavailable). PyPI name: graphifyy.
RUN if [ "$WITH_AUDITOR" = "1" ]; then pip install --no-cache-dir --break-system-packages graphifyy \
    || echo "graphify not installed (optional) — the auditor falls back to direct codebase analysis"; \
    else echo "skip graphify (WITH_AUDITOR=0)"; fi

WORKDIR /app

# Enable corepack so agents can use pnpm / yarn in target repos (not just npm).
RUN corepack enable || true

# Optional: GitNexus code-intelligence (token-light codebase research via MCP). Best-effort —
# the build never fails on it, and the runtime only uses it when GITNEXUS=true. Skipping the
# vendored Dart/Proto/Swift grammars avoids needing a C++ toolchain.
RUN if [ "$WITH_GITNEXUS" = "1" ]; then GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1 npm install -g gitnexus@latest \
    || echo "gitnexus not installed (optional) — set GITNEXUS=true only if this succeeds"; \
    else echo "skip gitnexus (WITH_GITNEXUS=0) — code-intelligence MCP disabled"; fi

# pi (https://github.com/earendil-works/pi) — the `pi-cli` runner now uses pi IN-PROCESS via the
# @earendil-works/pi-coding-agent SDK (a regular package.json dependency, installed by `npm install`
# above). This optional global install only provides the `pi` CLI binary for users who want it
# directly; the runner no longer needs it. WITH_PI=0 skips this (the SDK runner still works).
RUN if [ "$WITH_PI" = "1" ]; then npm install -g --prefix /usr/local --ignore-scripts @earendil-works/pi-coding-agent \
    || echo "pi CLI not installed (optional) — the in-process SDK runner works without it"; \
    else echo "skip pi CLI (WITH_PI=0) — the in-process SDK runner works without it"; fi

# Pre-install LadybugDB's FTS (full-text search) extension at BUILD time. GitNexus runs LadybugDB
# "load-only" during analyze — it won't download the extension itself — so at runtime full-text
# search is silently disabled with "FTS extension unavailable". The maintainer confirms a one-time
# `analyze` WITH network installs it. The build has full network, and GitNexus caches the extension
# under the node user's home (~/.gitnexus / ~/.ladybug), which lives in the IMAGE (only ~/.claude is
# on the data volume) — so installing it once here makes it persist for every run. Best-effort:
# never fails the build; if it can't install, runtime falls back to structural-graph-only.
RUN if [ "$WITH_GITNEXUS" = "1" ]; then set -eux; \
    d=/tmp/gnwarm; rm -rf "$d"; mkdir -p "$d"; cd "$d"; \
    git init -q; printf 'def hello():\n    return "hi"\n' > app.py; \
    git -c user.email=build@local -c user.name=build add -A; \
    git -c user.email=build@local -c user.name=build commit -qm init; \
    HOME=/home/node GITNEXUS_SKIP_OPTIONAL_GRAMMARS=1 gitnexus analyze --skip-embeddings 2>&1 | tail -25 \
      || echo "gitnexus FTS warm: best-effort (failed; runtime falls back to structural-only search)"; \
    cd /; rm -rf "$d"; \
    chown -R node:node /home/node/.gitnexus /home/node/.ladybug /home/node/.kuzu /home/node/.cache 2>/dev/null || true; \
    else echo "skip gitnexus FTS warm (WITH_GITNEXUS=0)"; fi

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY memory ./memory
COPY config ./config
COPY web ./web
COPY scripts ./scripts

# Coolify injects the deployed commit here when 'Include Source Commit in Build' is enabled (an
# ARG is also readable as an env var by the RUN below, so scripts/version.mjs stamps the SHA).
ARG SOURCE_COMMIT=""
RUN npm run build

# Re-stamp builtAt at image build (npm run build above already ran scripts/version.mjs with
# SOURCE_COMMIT). The running server overlays SOURCE_COMMIT from the ENV below at request time too,
# so the dashboard shows the real deployed commit even if the build arg wasn't passed.
RUN node scripts/version.mjs || true

# Webhook mode listens here (ignored in watch/once mode).
EXPOSE 3000

# Default to a long-running watcher (ideal for Coolify / any container host).
# Override RUN_MODE=once for a one-shot/cron-style run.
ENV RUN_MODE=watch \
    POLL_INTERVAL_SECONDS=60 \
    DB_PATH=/app/data/agency.db \
    HOME=/home/node \
    NODE_ENV=production

# Runtime-installed CLIs (dashboard "install runner") persist on the data volume and take PATH
# precedence over the baked-in copies.
ENV NPM_CONFIG_PREFIX=/app/data/npm-global \
    PATH=/app/data/npm-global/bin:$PATH
ENV SOURCE_COMMIT=$SOURCE_COMMIT

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
RUN set -eux; mkdir -p /app/data/npm-global
RUN set -eux; rm -rf /home/node/.claude; ln -sfn /app/data/claude /home/node/.claude
RUN set -eux; chown node:node /app; chown -R node:node /app/data /app/.work /app/data/npm-global
RUN set -eux; chown -h node:node /home/node/.claude
USER node

# Stable git identity for the agency's commits (written to the node user's home).
RUN git config --global user.name "dev-agency-bot" \
    && git config --global user.email "dev-agency-bot@users.noreply.github.com"

CMD ["node", "dist/runner.js"]
