# Branch Chats

Branch chats are **focused sub-sessions forked from a main chat**. Use them
when you want the agent to work on a narrow piece of code (a single page,
component, or refactor) without polluting the broader conversation context
or risking unrelated changes.

## Mental model

```
main chat                    ← long-running session, broad context
 ├── branch chat: settings   ← focused on apps/web/pages/settings/**
 ├── branch chat: auth fix   ← focused on apps/api/src/auth/*
 └── branch chat: README     ← scoped to docs only
```

Each branch chat:
- Lives on its own **git branch** (`agent/branch-<slug>-<id>`)
- Has its own **scope hint** (file globs the agent is told to focus on)
- Can be **merged back** into the parent's branch (local merge) or **opened
  as a Pull Request** if your project has a GitHub remote

## Creating a branch chat

There are three entry points:

### 1. Sidebar fork button

Hover any main chat in the sidebar → click the **fork** icon. A modal opens:

- **Name** *(optional)*: a short label, e.g. "Settings page polish". Shows
  in the sidebar under the parent and is used as the PR title later.
- **Scope globs** *(optional, one per line)*: file patterns the agent should
  focus on. Examples:
  ```
  apps/web/pages/settings/**
  apps/web/components/Settings*.vue
  ```
  These are injected into every task's system prompt as a "Branch Chat Scope"
  block. The agent is told to focus on these paths but can still read others
  if needed — this is a **soft hint**, not a hard sandbox.

### 2. Auto-suggest banner

When you type a prompt in a main chat that mentions a focused scope keyword
(English: "only", "just", "this file"; Czech: "jen", "pouze", "jenom") plus
a path or filename, a banner appears above the input:

> 🌿 This looks narrowly scoped — fork as a branch chat? `apps/web/pages/agents.vue`
> [ Fork as branch ] [ Dismiss ]

Clicking "Fork as branch" pre-fills the modal with the detected path as the
scope hint. Dismiss to ignore for the current draft (resets when you clear
the input).

### 3. Edit scope after creation

Click the scope text in the branch chat header band to edit name + scope
globs in place. Changes take effect on the next prompt — no restart needed.

## Working in a branch chat

Once created, the chat looks like a normal session, but with a header band
showing the branch name and scope. Every agent task receives a system-prompt
addition like:

```
## Branch Chat Scope
You are working in a focused sub-session. Prioritize these paths:
  - apps/web/pages/settings/**
  - apps/web/components/Settings*.vue
Avoid changes outside these paths unless strictly necessary.
```

All commits land on the dedicated `agent/branch-<slug>-<id>` git branch. The
parent chat's branch (usually `main` of the workspace) is untouched until
you merge.

## Merging back

Click **Merge** in the branch chat header → opens the merge preview modal
showing the unified diff vs. the target branch.

### Local merge (default)

- Performs `git merge --no-ff --no-edit` into the parent branch.
- Marks the session as **merged** in the sidebar (with a badge).
- The session row stays in history — you can still reopen it to read the chat,
  but it's effectively read-only.
- Fails with a 409 + clear error if there are merge conflicts. Resolve in the
  workspace and retry, or fix via a new branch chat.

### Open as Pull Request *(GitHub only, opt-in)*

Toggle **"Open as Pull Request instead of local merge"** in the modal:

- Pushes the branch to origin (using your connected GitHub credentials).
- Opens a PR via the GitHub API with title `Branch chat: <name>` and a body
  summarizing the scope.
- The session is **NOT** marked merged — that happens when the PR itself is
  merged on GitHub (out of scope here).
- Requires a connected GitHub provider and the project linked to a remote.
  Without these, the request returns 400 and you fall back to local merge.

GitLab and Bitbucket PR/MR support is on the roadmap.

## Limitations

- **No fork-of-fork.** Only main chats can be forked. Branch-of-branch was
  rejected to keep merge logic simple — fork a sibling instead.
- **Soft scope only.** The scope is a system-prompt hint, not a workspace
  filter. The agent can still read and modify files outside the scope if
  it judges them necessary; the hint just biases attention.
- **One workspace, multiple branches.** All branch chats share the project's
  workspace directory — the agent checks out branches as needed. Don't run
  two branch chats on the same project simultaneously, you'll see weird
  state.

## Common workflows

**"I want to fix one bug without disturbing my exploratory main chat"**
→ Fork a branch chat with the bug's file as scope. Merge when done.

**"I want the agent to refactor a module"**
→ Fork with the module's directory glob. Use PR mode for a real review trail.

**"I want to try two approaches in parallel"**
→ Fork two sibling branch chats from the same main. Compare diffs, merge
the better one, discard the other (delete the chat to clean the branch).

**"I made changes I don't want"**
→ Just delete the branch chat from the sidebar. The git branch stays in the
workspace until you `git branch -D` it manually.
