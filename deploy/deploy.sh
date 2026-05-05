#!/usr/bin/env bash
# deploy/deploy.sh — sync source to VPS and (re)build Docker stack.
#
# Usage:
#   ./deploy/deploy.sh             # rsync + build + up
#   ./deploy/deploy.sh restart     # only restart containers
#   ./deploy/deploy.sh logs [svc]  # tail logs
#   ./deploy/deploy.sh down        # stop stack
#
# Prereqs on VPS (one-time, see README):
#   - Docker + Compose
#   - /home/deploy/agent-orchestrator/.env with secrets
#   - /etc/nginx/sites-enabled/orchestrator + /etc/nginx/.htpasswd-orchestrator

set -euo pipefail

REMOTE="${REMOTE:-deploy@46.62.209.17}"
REMOTE_DIR="${REMOTE_DIR:-/home/deploy/agent-orchestrator}"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cmd="${1:-deploy}"

case "$cmd" in
  deploy|sync)
    echo "→ Syncing source to ${REMOTE}:${REMOTE_DIR}"
    ssh "$REMOTE" "mkdir -p $REMOTE_DIR"
    rsync -az --delete \
      --exclude='node_modules' \
      --exclude='.git' \
      --exclude='**/dist' \
      --exclude='**/.output' \
      --exclude='**/.nuxt' \
      --exclude='**/.cache' \
      --exclude='*.log' \
      --exclude='.env' \
      --exclude='.env.local' \
      --exclude='.opencode-auth.json' \
      --exclude='/test/workspaces' \
      --exclude='/data' \
      "$LOCAL_DIR/" "$REMOTE:$REMOTE_DIR/"
    echo "→ Building images on VPS"
    ssh "$REMOTE" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml build"
    echo "→ Starting stack"
    ssh "$REMOTE" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml up -d"
    echo "→ Waiting for API health"
    sleep 5
    ssh "$REMOTE" "curl -fsS http://127.0.0.1:33002/health" && echo
    echo "✓ Done. Visit http://46.62.209.17:8091"
    ;;
  restart)
    ssh "$REMOTE" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml restart ${2:-}"
    ;;
  down)
    ssh "$REMOTE" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml down"
    ;;
  logs)
    svc="${2:-}"
    ssh -t "$REMOTE" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml logs -f --tail=200 $svc"
    ;;
  ps)
    ssh "$REMOTE" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml ps"
    ;;
  *)
    echo "Unknown command: $cmd"
    echo "Usage: $0 [deploy|restart|down|logs|ps]"
    exit 1
    ;;
esac
