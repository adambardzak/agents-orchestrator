# Knowledge Base

> **Coming soon.** The knowledge base lets you feed documents (markdown,
> code conventions, ADRs, runbooks) to the agents so they don't have to
> rediscover context every prompt.

## Quick reference

- **Scope: My KB vs. Workspace KB** — toggle in topbar. My KB is private to
  you; Workspace KB is shared with your active organization. The two scopes
  are **mutually exclusive per document** — a doc lives in either one.
- **Where to manage** — `/settings/knowledge` in the web UI.
- **Retrieval** — agents query both your scope and your project's owner
  scope automatically. You don't need to think about which KB the doc lives
  in at retrieval time.

## Common pitfall

If the topbar shows a yellow warning **"KB scope is set to Workspace but no
workspace is active"** — pick a workspace from the top-left switcher first,
or switch the KB scope back to My KB. KB queries won't return anything in
that mismatched state.
