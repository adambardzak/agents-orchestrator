# Workspaces & Teams

> **Coming soon.** The orchestrator is multi-tenant: users can belong to
> multiple workspaces (organizations) with different roles per workspace.

## Quick reference

- **Workspace switcher** — top-left of the topbar. Switch context to see
  another org's projects, KB, AI providers.
- **Personal workspace** — every user gets one auto-created at signup
  (slug `personal`). Acts as the default for everything you don't share.
- **Roles** — Owner, Admin, Member. Owners can rename / delete the org and
  manage billing (when billing exists). Admins can invite and remove members.
- **Inviting** — `/settings/workspace` → Members tab. Sends an email invite
  with a join link.
- **What's shared per workspace**
  - **Projects** — created in the active workspace
  - **Knowledge Base (Workspace KB scope)** — documents tagged to the org
  - **AI providers (org-shared)** — providers without a `user_id`
  - **Skills** — workspace-scoped custom skills
- **What's strictly per-user, never shared**
  - **Git connections** — your GitHub/GitLab OAuth tokens stay private
  - **Personal KB scope** — docs you tagged to yourself
  - **Personal AI providers** — your default keys
