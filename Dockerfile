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

RUN npm run build

# Set a stable git identity for the agency's commits.
RUN git config --global user.name "dev-agency-bot" \
    && git config --global user.email "dev-agency-bot@users.noreply.github.com"

CMD ["node", "dist/runner.js"]
