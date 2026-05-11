# Deploy

Production stack lives on Netcup VPS at **https://agents.appitect.eu**.
Everything is plain Docker Compose + Caddy + GitHub Actions CI/CD —
no Kubernetes, no nginx, no basic-auth wrappers.

## Files

| file                          | purpose                                                          |
|-------------------------------|------------------------------------------------------------------|
| `docker-compose.netcup.yml`   | Production stack: postgres, redis, api, web, code-server, caddy. |
| `Caddyfile`                   | TLS termination + reverse proxy + `/code/*` forward-auth gate.   |

## Layout on the VPS

```
/opt/agent-orchestrator/
├── .env                       # Production secrets (NOT in git)
├── compose/
│   ├── docker-compose.netcup.yml
│   └── Caddyfile
├── workspaces/                # Mounted into api + code-server containers
├── backups/                   # PG dumps (cron + restic — TODO)
└── migrations/                # SQL migrations applied to PG
```

## Deployment flow

Code lands on `main` → GitHub Actions (`.github/workflows/deploy.yml`):

1. Builds `ghcr.io/adambardzak/agent-orchestrator-{api,web}:latest` images.
2. SSHs into `deploy@159.195.27.128`.
3. `docker compose pull && docker compose up -d --remove-orphans`.
4. Smoke test against `https://agents.appitect.eu/api/health`.

Manual restart (rarely needed):

```bash
ssh deploy@159.195.27.128
cd /opt/agent-orchestrator/compose
docker compose -f docker-compose.netcup.yml --env-file ../.env up -d --no-deps api
# Or to reload Caddy after Caddyfile edit:
docker exec orchestrator-caddy caddy reload --config /etc/caddy/Caddyfile
```

## Public ports

| port | exposed to | purpose                                  |
|------|------------|------------------------------------------|
| 22   | UFW        | SSH (key-only)                           |
| 80   | UFW        | ACME HTTP-01 + redirect → 443            |
| 443  | UFW        | HTTPS (TCP + UDP for HTTP/3)             |

All container ports (`33002` api, `33010` web, `5438` postgres,
`6383` redis) are bound to `127.0.0.1` only.

## Required `.env` keys

See `apps/api/src/config/env.ts` for the full Zod schema. The minimum
production set:

```
NODE_ENV=production
APP_URL=https://agents.appitect.eu
CORS_ORIGINS=https://agents.appitect.eu
CODE_SERVER_URL=https://agents.appitect.eu/code
PUBLIC_API_BASE=https://agents.appitect.eu
PUBLIC_WS_BASE=wss://agents.appitect.eu
GHCR_OWNER=adambardzak
POSTGRES_PASSWORD=...                # 30+ chars
BETTER_AUTH_SECRET=...               # 64 hex chars (openssl rand -hex 32)
APP_ENCRYPTION_KEY=...               # 32 bytes base64 (openssl rand -base64 32)
GITHUB_OAUTH_CLIENT_ID=              # optional, enables "Connect GitHub"
GITHUB_OAUTH_CLIENT_SECRET=
GITLAB_OAUTH_CLIENT_ID=              # optional, enables "Connect GitLab"
GITLAB_OAUTH_CLIENT_SECRET=
```
