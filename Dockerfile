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

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY memory ./memory
COPY config ./config

RUN npm run build

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
RUN mkdir -p /app/data /app/.work \
    && chown -R node:node /app /home/node
USER node

# Stable git identity for the agency's commits (written to the node user's home).
RUN git config --global user.name "dev-agency-bot" \
    && git config --global user.email "dev-agency-bot@users.noreply.github.com"

CMD ["node", "dist/runner.js"]
