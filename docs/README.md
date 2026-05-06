# Agent Orchestrator — User Documentation

Task-oriented guides for using and operating the Agent Orchestrator.

> The internal architecture / spec lives in `coding-agent-orchestrator-spec-v3.md`
> at the repo root. This `docs/` directory is for **users** — people who want
> to use the product, not extend it.

## For end users

Day-to-day workflows once the orchestrator is set up.

- [**Getting Started**](./getting-started.md) — your first project, first chat, first agent task
- [**Branch Chats**](./branch-chats.md) — fork a focused sub-session for narrow work
- [**Knowledge Base**](./knowledge-base.md) — give the agents your docs, code conventions, ADRs
- [**Skills**](./skills.md) — reusable agent behaviors (catalog + custom)
- [**AI Providers**](./ai-providers.md) — bring your own Anthropic/OpenAI/Copilot/etc. keys
- [**Workspaces & Teams**](./workspaces.md) — invite teammates, share KB and AI providers

## For administrators / deployers

Setting up the orchestrator for yourself or your team.

- [**Local Setup**](./setup-local.md) — run the stack on your laptop in 10 minutes
- [**Production Deployment**](./setup-production.md) — VPS, Docker, reverse proxy, backups
- [**Git Provider Setup**](./setup-git.md) — GitHub, GitLab, Bitbucket, **on-prem GitHub Enterprise / GitLab self-hosted**
- [**Environment Variables Reference**](./env-reference.md) — every env var, what it does, when you need it

## Troubleshooting

- [**Common Issues**](./troubleshooting.md) — symptoms → fixes for the recurring things

---

**Found a doc that's wrong or missing?** Open an issue or send a PR — these
files live in `docs/` next to the code so they get updated together.
