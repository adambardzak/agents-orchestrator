# Skills

> **Coming soon.** Skills are reusable agent behaviors — short markdown
> instructions that get injected into agent system prompts.

## Quick reference

- **Built-in catalog** — 22 ready-to-use skills (commit-style, testing,
  refactoring, security review, etc.) at `/settings/skills`.
- **Custom skills** — fork any built-in or create from scratch. Custom
  skills with the same slug as a built-in **override** it.
- **Per-agent assignment** — when defining an agent at `/agents`, pick which
  skills it should always have. Skills snapshot to the agent definition so
  later edits don't silently change agent behavior.
- **Categories** — skills are grouped (Code Quality, Git, Testing, etc.) for
  filtering in the UI. Custom skills can pick any category from a fixed list.
