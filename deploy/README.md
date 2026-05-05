# Deployment to VPS

Single-server deployment using Docker Compose, behind nginx with basic auth.

**Target**: `deploy@46.62.209.17`, exposed at `http://46.62.209.17:8091`

## Status

| Component       | Status                                                              |
|-----------------|---------------------------------------------------------------------|
| Source on VPS   | ✅ `/home/deploy/agent-orchestrator/`                               |
| `.env`          | ✅ created (random PG password, GITHUB_TOKEN set)                   |
| OpenCode auth   | ✅ in volume `agent-orchestrator_opencode_auth`                     |
| API container   | ✅ healthy at `127.0.0.1:33002`                                     |
| Web container   | ✅ HTTP 200 at `127.0.0.1:33010`                                    |
| Postgres        | ✅ `127.0.0.1:5438` (volume `postgres_data`)                        |
| Redis           | ✅ `127.0.0.1:6383` (volume `redis_data`)                           |
| nginx vhost     | ⏳ **TODO — manual sudo step below**                                |
| Basic-auth file | ⏳ **TODO — manual sudo step below**                                |
| UFW port 8091   | ⏳ **TODO — manual sudo step below (only if ufw is enabled)**       |

## Final manual setup (needs sudo password)

SSH into the VPS and run:

```bash
ssh deploy@46.62.209.17
sudo apt-get update && sudo apt-get install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd-orchestrator admin   # set password

sudo cp /home/deploy/agent-orchestrator/deploy/nginx-orchestrator.conf \
        /etc/nginx/sites-available/orchestrator
sudo ln -sf /etc/nginx/sites-available/orchestrator \
            /etc/nginx/sites-enabled/orchestrator
sudo nginx -t && sudo systemctl reload nginx

sudo ufw allow 8091/tcp 2>/dev/null || true   # if ufw is on
```

Then browse to `http://46.62.209.17:8091` (login: `admin` + your htpasswd password).

## Day-to-day deployment from your laptop

```bash
./deploy/deploy.sh           # rsync source + rebuild + restart
./deploy/deploy.sh logs api  # tail API logs
./deploy/deploy.sh logs web
./deploy/deploy.sh ps        # container status
./deploy/deploy.sh restart api
./deploy/deploy.sh down      # stop everything
```

## OpenCode auth refresh

If GitHub Copilot OAuth rotates (or you regenerate locally):

```bash
scp ~/.local/share/opencode/auth.json \
    deploy@46.62.209.17:/home/deploy/agent-orchestrator/.opencode-auth.json
ssh deploy@46.62.209.17 \
  "docker run --rm \
     -v agent-orchestrator_opencode_auth:/dst \
     -v /home/deploy/agent-orchestrator/.opencode-auth.json:/src/auth.json:ro \
     busybox cp /src/auth.json /dst/auth.json"
ssh deploy@46.62.209.17 \
  "cd /home/deploy/agent-orchestrator && docker compose -f docker-compose.prod.yml restart api"
```

Also update `GITHUB_TOKEN` in `/home/deploy/agent-orchestrator/.env` if it changed.

## Ports used on VPS

| Service     | Bind                    | External (via nginx)              |
|-------------|-------------------------|-----------------------------------|
| nginx vhost (app)  | `0.0.0.0:8091`   | `http://46.62.209.17:8091`        |
| nginx vhost (code) | `0.0.0.0:8092`   | `http://46.62.209.17:8092`        |
| API         | `127.0.0.1:33002`       | `/api/*`, `/ws`                   |
| Web (Nuxt)  | `127.0.0.1:33010`       | `/`                               |
| code-server | `127.0.0.1:8092`        | `:8092/` (web VS Code)            |
| Postgres    | `127.0.0.1:5438`        | (internal only)                   |
| Redis       | `127.0.0.1:6383`        | (internal only)                   |

## code-server (web VS Code)

`docker-compose.prod.yml` includes a `code-server` service mounting the
shared `workspaces` Docker volume read-write (same volume the API writes
to). The API container exposes its `CODE_SERVER_URL` to the frontend via
`/api/projects` so the dashboard can deep-link `Open in VS Code` to the
correct workspace folder and file.

After the first deploy, configure nginx for the second vhost:

```bash
ssh deploy@46.62.209.17
sudo cp /home/deploy/agent-orchestrator/deploy/nginx-orchestrator.conf \
        /etc/nginx/sites-available/orchestrator
sudo nginx -t && sudo systemctl reload nginx
sudo ufw allow 8092/tcp 2>/dev/null || true
```

Then browse to `http://46.62.209.17:8092` (basic auth: same `admin`
credentials; then code-server's own password prompt = value of
`CODE_SERVER_PASSWORD` in `.env`, default `Vandl123`).

Deep-link format used by the dashboard:
`http://46.62.209.17:8092/?folder=/home/coder/workspaces/<sessionId>&payload=<base64-json-with-openFile>`

## Updating

`deploy.sh` runs an incremental rsync (excludes `node_modules`, build output,
`.git`, `.env`, opencode auth file), then `docker compose build` (uses layer
cache), then `up -d` which only restarts changed containers. Migrations run
automatically on API start (`runMigrations` in `apps/api/src/index.ts`).

## Troubleshooting

- **API not reachable**: `curl http://127.0.0.1:33002/health` on the VPS
- **API restarting**: `./deploy/deploy.sh logs api`
- **Web 502 from nginx**: API container down — check above
- **WebSocket fails**: confirm `/ws` route in nginx, check browser console
- **basic auth prompt loops**: regenerate `/etc/nginx/.htpasswd-orchestrator`
- **OpenCode "no auth"**: re-copy `auth.json` (token may have rotated)
- **DB issues**: `docker exec -it orchestrator-postgres psql -U orchestrator`
