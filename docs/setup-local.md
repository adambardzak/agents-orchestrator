# Local Setup

Run the orchestrator on your laptop in ~10 minutes.

## Prerequisites

- **Node.js** 22+ (`node --version`)
- **pnpm** 9+ (`npm install -g pnpm`)
- **Docker** (for Postgres + Redis)
- **OpenCode binary** at `~/.opencode/bin/opencode` — install from
  https://opencode.dev or your package manager

## 1. Clone and install

```bash
git clone <repo-url> agent-orchestrator
cd agent-orchestrator
pnpm install
```

## 2. Start Postgres + Redis

```bash
docker compose up -d postgres redis
```

This starts Postgres on **5435** and Redis on **6381** (non-default ports
to avoid clashing with anything else you might be running).

## 3. Configure environment

Create `apps/api/.env`:

```bash
# Database
DATABASE_URL=postgres://orchestrator:orchestrator@localhost:5435/orchestrator
REDIS_URL=redis://localhost:6381

# Workspaces — where agent project clones live
WORKSPACES_ROOT=/tmp/orchestrator-workspaces

# Web origin — first entry is used for OAuth post-login redirect
CORS_ORIGINS=http://localhost:3010

# Encryption key for at-rest secrets (provider tokens, OAuth client secrets).
# Generate one: `openssl rand -base64 32`
APP_ENCRYPTION_KEY=<base64-encoded 32 bytes>

# At least one AI provider — see docs/ai-providers.md
ANTHROPIC_API_KEY=sk-ant-...
# or OPENAI_API_KEY=sk-...
# or COPILOT_OAUTH_TOKEN=gho_...

# Optional: Better Auth — required only if you want multi-user auth.
# In bootstrap dev mode (REQUIRE_AUTH=false), the orchestrator runs as a
# single auto-created user.
REQUIRE_AUTH=false

# Optional: Git providers (see docs/setup-git.md)
# GITHUB_OAUTH_CLIENT_ID=...
# GITHUB_OAUTH_CLIENT_SECRET=...
```

> **Heads up about ports.** API runs on **3002**, Nuxt web on **3010**.
> If you change `CORS_ORIGINS` you also need the OAuth callback URLs in
> your provider apps to match.

## 4. Build and run

```bash
# Build shared packages first (TypeScript project references)
pnpm --filter shared build
pnpm --filter api build

# Start API (terminal 1)
cd apps/api && node --env-file=.env dist/index.js

# Start web (terminal 2)
cd apps/web && pnpm dev
```

Open **http://localhost:3010**. You should see the orchestrator UI with the
bootstrap user logged in.

## 5. First steps

1. Create a project at `/projects` — pick **Local-only** for the easiest start
   (no git remote needed)
2. Open the project, type a prompt in the chat, hit **Send**
3. Watch the agent task tree populate in real-time

## Auto-restart in development

For an iterative loop with auto-rebuild + restart, use:

```bash
# API
cd apps/api && pnpm dev   # tsc --watch + nodemon

# Web
cd apps/web && pnpm dev   # Nuxt has HMR built in
```

## Stopping

```bash
# Kill API
lsof -ti tcp:3002 | xargs kill -9

# Kill web
lsof -ti tcp:3010 | xargs kill -9

# Stop databases
docker compose down
```

## Common gotchas

- **API says "ECONNREFUSED ::1:5435"** — Postgres container isn't running.
  `docker compose ps`.
- **Web shows blank page after login redirect** — `CORS_ORIGINS` first entry
  doesn't match the web's actual origin.
- **`Cannot find module '@agent-orchestrator/shared'`** — you forgot
  `pnpm --filter shared build`. Shared package is project-referenced; tsc
  needs the dist output to exist.
- **Agent task hangs at "spawning"** — OpenCode binary not found at
  `~/.opencode/bin/opencode`. Set `OPENCODE_BIN` env to your actual path.

## Next steps

- [Production deployment](./setup-production.md)
- [Set up git providers](./setup-git.md) — connect GitHub / GitLab so agents
  can push and you can branch chat → PR
- [Add knowledge base](./knowledge-base.md) — feed the agent your docs and
  conventions
