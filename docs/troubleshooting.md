# Troubleshooting

Symptoms → fixes for the recurring issues.

## OAuth & connections

### "Route GET:/settings/connections not found" after authorizing GitLab/GitHub

**Cause:** OAuth callback redirected you to the **API origin** (`:3002`)
instead of the **web origin** (`:3010`). The API was sending a relative
redirect that the browser resolved against the API host.

**Fix:** Make sure `CORS_ORIGINS` in `apps/api/.env` lists your web URL
**first**:
```
CORS_ORIGINS=http://localhost:3010
```
Then restart the API. The OAuth callback now resolves the post-login redirect
against this origin.

### "redirect_uri_mismatch" from the provider

The redirect URI registered in the OAuth Application doesn't match what the
orchestrator sends. The exact URL the orchestrator uses is:
```
http://<API_HOST>:<API_PORT>/api/git/callback/<provider>
```
Watch for trailing slashes, `http://` vs `https://`, and host typos.

### "invalid_client"

Client ID or Secret in env doesn't match the OAuth app on the provider side.
Re-copy both, restart API.

### `getaddrinfo ENOTFOUND <host>` for self-hosted GitLab/GitHub

The API process can't resolve the on-prem host. Causes:
- Not on the corporate VPN
- DNS not configured for the host
- Host genuinely down

The browser succeeding doesn't mean the API will — they may be on different
networks if you're tunneling.

### `self signed certificate in certificate chain`

Self-hosted Git provider uses an internal CA. Fix:
```bash
NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem node --env-file=.env dist/index.js
```
Or install the CA bundle system-wide.

---

## Database / startup

### `ECONNREFUSED ::1:5435` (or 6381 for Redis)

Postgres / Redis container not running:
```bash
docker compose ps
docker compose up -d postgres redis
```

### `invalid input syntax for type uuid: "bootstrap"`

You hit an endpoint expecting a UUID with the legacy `bootstrap` session id.
The bootstrap session is for dev mode only (`REQUIRE_AUTH=false`) and uses a
TEXT id. Endpoints now reject non-UUID ids up front; if you're seeing this on
a recent build, file an issue with the route name.

### `Cannot find module '@agent-orchestrator/shared'`

You forgot to build the shared package first. Project references need dist
output to exist:
```bash
pnpm --filter shared build && pnpm --filter api build
```

---

## Agent tasks

### Tasks stuck at "spawning"

OpenCode binary not found. Default lookup is `~/.opencode/bin/opencode`.
Override:
```bash
OPENCODE_BIN=/usr/local/bin/opencode node --env-file=.env dist/index.js
```

### Agent says "no AI provider configured"

No provider resolved for your user + active org. Add one at `/settings/ai`,
or set fallback env vars (`ANTHROPIC_API_KEY` etc.). If you have providers
configured but it's still failing, check the resolution order in
[AI Providers](./ai-providers.md).

### "Branch already merged" when trying to merge

The session was already merged (probably via PR mode) and you can't double-
merge. The session row stays in the sidebar with a "merged" badge but is
read-only.

### Branch chat merge says "Merge failed (likely conflicts)"

Two branch chats touched the same lines and the second one to merge has
conflicts vs. the parent's now-updated branch. Resolve in the workspace
manually:
```bash
cd /tmp/orchestrator-workspaces/<project-id>
git checkout <parent-branch>
git merge <branch-chat-branch>
# resolve conflicts, commit, then mark the session merged manually in DB
# (no UI for "force merged" yet — open an issue if you hit this often)
```

---

## Knowledge base

### KB returns empty hits even though docs exist

- **Wrong scope** — top topbar warning if scope=Workspace but no active org
- **Embedding failed** — check API logs for embedding errors. Some Copilot
  model versions fail on the embedding endpoint; try a different provider for
  embeddings (`/settings/ai` → set Anthropic/OpenAI as default)
- **Document not chunked yet** — large docs are chunked async; give it a few
  seconds after upload

### "KB scope is set to Workspace but no workspace is active"

Pick a workspace from the top-left switcher, or click "Switch to My KB" in
the warning banner.

---

## Known limitations / not bugs

- **No fork-of-fork** — only main chats can be forked into branch chats. Fork
  a sibling instead.
- **Bitbucket Data Center (self-hosted)** — not supported. Different REST API
  path than SaaS.
- **GitLab/Bitbucket PR auto-create** — only GitHub supported today. Use
  local merge for the others.
- **Multiple instances of the same git provider** — single instance per
  deploy. If you set `GITLAB_API_BASE` you can't also use gitlab.com.

---

## Where to look when nothing here helps

```bash
# API logs (if you used the standard restart command)
tail -f /tmp/api-server.log

# Web logs
tail -f /tmp/web-dev.log

# Database state
docker exec agent-orchestrator-postgres-1 psql -U orchestrator -d orchestrator
```

Then file an issue with:
- What you did (URL, payload, click sequence)
- What you expected
- What happened (error message, screenshot)
- Last 30 lines of `/tmp/api-server.log`
