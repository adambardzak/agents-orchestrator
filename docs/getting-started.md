# Getting Started

> **Coming soon** — for now see [setup-local.md](./setup-local.md) for
> installation and the [README](./README.md) for the doc index.

## Quick orientation

The orchestrator is built around four concepts:

- **Project** — a git repo or local-only directory the agents work in
- **Session (chat)** — a conversation with the orchestrator about that project
- **Branch chat** — a focused sub-session for narrow work
  ([details](./branch-chats.md))
- **Agent task** — a single unit of work spawned by the orchestrator
  (planner → workers → QA)

Most of your time you spend in a **chat** describing what you want, and the
orchestrator decomposes it into agent tasks that show up in the right-side
task tree.
