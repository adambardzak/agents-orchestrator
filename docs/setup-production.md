# Production Deployment

> **Coming soon.** This guide will cover VPS deployment with Docker,
> Caddy/nginx reverse proxy, Let's Encrypt TLS, Postgres backups, and
> systemd unit files.

## Quick reference for impatient operators

The current production deployment lives at `46.62.209.17` and uses:

- **Bind addresses**: all services bound to `127.0.0.1`, exposed via reverse
  proxy with HTTP basic auth (no public OAuth callback yet)
  - API: `127.0.0.1:33002` → public `:8091`
  - Web: `127.0.0.1:33010` → public `:8091`
  - code-server: `127.0.0.1:8092` → public `:8092`
  - Postgres: `127.0.0.1:5438` (private)
  - Redis: `127.0.0.1:6383` (private)
- **Reverse proxy**: nginx with `auth_basic` for the marketing-facing IP
- **Database**: Postgres 16 with pgvector via Docker
- **Process supervision**: pm2 (planned: systemd units)

A proper guide with Caddy + Let's Encrypt + automated Postgres backups is
the next thing to write here.
