FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate \
    && apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git openssh-client \
    && rm -rf /var/lib/apt/lists/*

# ── Dependencies ──────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --filter api...

# ── Build shared ─────────────────────────────────────────────────
FROM deps AS shared-build
WORKDIR /app
COPY packages/shared ./packages/shared
RUN pnpm --filter shared build

# ── Build API ────────────────────────────────────────────────────
FROM shared-build AS api-build
WORKDIR /app
COPY apps/api ./apps/api
RUN pnpm --filter api build

# ── Production deploy bundle ─────────────────────────────────────
# `pnpm deploy` produces a self-contained, hoisted node_modules layout
# at /deploy with workspace deps (like @agent-orchestrator/shared) inlined.
FROM api-build AS deploy
WORKDIR /app
RUN pnpm --filter api deploy --prod --legacy /deploy
# Copy compiled JS into the deploy bundle. The shared package's `dist/` is
# already present via pnpm deploy, but built AFTER the deploy snapshot — so
# we re-sync it explicitly to be safe.
RUN cp -r apps/api/dist /deploy/dist \
    && rm -rf /deploy/node_modules/@agent-orchestrator/shared/dist \
    && cp -r packages/shared/dist /deploy/node_modules/@agent-orchestrator/shared/

# ── Runtime image ────────────────────────────────────────────────
FROM base AS runtime
WORKDIR /app

# Install OpenCode CLI globally so the API can spawn it.
RUN npm install -g opencode-ai@latest \
    && opencode --version || true

COPY --from=deploy /deploy ./

# Workspaces volume mount point
RUN mkdir -p /workspaces /root/.local/share/opencode

EXPOSE 3001

CMD ["node", "dist/index.js"]
