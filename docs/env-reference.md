# Environment Variables Reference

Every env var the API reads, what it does, and when you need to set it.
Web frontend reads from `nuxt.config.ts` runtime config which mostly mirrors
the API URL — see `apps/web/nuxt.config.ts` if you need to override that.

## Required

| Var | What | Example |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | `postgres://orchestrator:orchestrator@localhost:5435/orchestrator` |
| `REDIS_URL` | Redis for BullMQ job queue | `redis://localhost:6381` |
| `WORKSPACES_ROOT` | Where agent project clones live on disk | `/tmp/orchestrator-workspaces` |
| `APP_ENCRYPTION_KEY` | Base64-encoded 32-byte key for AES-256-GCM at-rest encryption (provider tokens, OAuth client secrets). **Generate with `openssl rand -base64 32`. Rotating breaks all existing encrypted secrets.** | `Vh3...` (44 chars) |
| `CORS_ORIGINS` | Comma-separated list of allowed CORS origins. **First entry is also used as the OAuth post-login redirect target**, so put your web URL first. | `http://localhost:3010,http://localhost:3000` |
| At least one AI provider key | See AI Providers section below | |

## Authentication

| Var | What | Default |
|---|---|---|
| `REQUIRE_AUTH` | When `false`, the API skips auth for non-public routes and uses a single auto-created bootstrap user. Use `true` in production. | `true` |
| `BETTER_AUTH_SECRET` | Random secret for Better Auth session signing | (required if `REQUIRE_AUTH=true`) |
| `BETTER_AUTH_URL` | Base URL of the API for auth callbacks | `http://localhost:3002` |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth for both **sign-in** and **git provider connection** (single OAuth app reused) | (optional) |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth for sign-in only | (optional) |

## Git providers

See [Git Provider Setup](./setup-git.md) for full details.

| Var | What | Example |
|---|---|---|
| `GITHUB_OAUTH_CLIENT_ID` / `_SECRET` | GitHub OAuth app credentials | (registered in GitHub) |
| `GITHUB_API_BASE` | Base URL of GitHub Enterprise Server. Omit for SaaS github.com. | `https://github.your-corp.com` |
| `GITLAB_OAUTH_CLIENT_ID` / `_SECRET` | GitLab OAuth app credentials | (registered in GitLab) |
| `GITLAB_API_BASE` | Base URL of self-hosted GitLab. Omit for SaaS gitlab.com. | `https://gitlab.your-corp.com` |
| `BITBUCKET_OAUTH_CLIENT_ID` / `_SECRET` | Bitbucket OAuth consumer | (registered in Bitbucket) |

## AI providers (legacy single-tenant fallback)

These are read-once-at-boot fallbacks for single-user setups. For multi-user
production, prefer adding providers via `/settings/ai` in the UI — they're
stored encrypted in the DB.

| Var | What |
|---|---|
| `ANTHROPIC_API_KEY` | Claude |
| `OPENAI_API_KEY` | OpenAI |
| `GOOGLE_API_KEY` | Gemini |
| `OPENROUTER_API_KEY` | OpenRouter |
| `OLLAMA_URL` | Local Ollama base URL |
| `MISTRAL_API_KEY` | Mistral |
| `GITHUB_TOKEN` | Used as a fallback for Copilot model access |

## Operational

| Var | What | Default |
|---|---|---|
| `LOG_LEVEL` | pino log level | `info` |
| `OPENCODE_BIN` | Override path to OpenCode binary | `~/.opencode/bin/opencode` |
| `BUDGET_DEFAULT_USD` | Default budget cap per session | `5` |
| `NODE_EXTRA_CA_CERTS` | Path to extra CA bundle (for self-hosted Git/AI providers behind internal CAs) | (none) |

## Context optimization

These knobs control how much context each sub-agent receives in its system
prompt. Lower values save tokens (and money) at the cost of potentially missing
relevant context. Defaults are tuned for typical usage; tweak if you observe
agents either drowning in irrelevant snippets or missing obvious context.

| Var | What | Default | Range |
|---|---|---|---|
| `RAG_MIN_SCORE` | Minimum cosine similarity (0..1) for a code-RAG chunk to be injected. Hits below the threshold are dropped before the prompt is built. `0` disables the filter (legacy behaviour: always inject top-K). | `0.45` | `0`–`1` |
| `KB_MIN_SCORE` | Same threshold but for Knowledge Base hits (workspace + personal docs). | `0.45` | `0`–`1` |
| `FRONTEND_RULES_MAX_CHARS` | Hard cap on `design-system/frontend-rules.md` body length when injected into the Frontend agent. Above this length the file is truncated and a warning is logged. `0` disables the cap. | `4000` | `0`–`∞` |

**Tuning guide:**
- If agents complain "I don't have enough context", lower the score thresholds (try `0.30`).
- If agents waste tokens summarizing unrelated files, raise them (`0.55`).
- If a long `frontend-rules.md` is being silently truncated and you want all of it, raise `FRONTEND_RULES_MAX_CHARS` or set to `0`. Beware: very long rules docs can blow past the model's context window when combined with RAG/KB.
