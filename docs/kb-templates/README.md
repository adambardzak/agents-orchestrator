# Knowledge Base Templates

Ready-to-use Markdown templates for populating the Knowledge Base (KB) of an
organization or workspace. These templates are written so that the orchestrator's
RAG/KB retrieval (pgvector cosine similarity) returns them with high relevance
when an agent is spawned for a related task.

## Two sets

### `cez-trading/`
Business-domain-specific templates for CEZ Trading (energy trading desk).
Contains placeholders for internal systems, regulations, market data, deployment.
**Replace `__PLACEHOLDER__` markers with real values before importing.**

### `generic/`
Tech-stack-agnostic templates covering common application development concerns:
API design, testing, security, observability, accessibility, etc. Suitable as a
starting point for any project's KB.

## How to use

### Option A: Manual import via UI
1. Open the orchestrator web UI at `/settings/knowledge`
2. Switch scope toggle to **Workspace KB** (organization-shared) or **My KB** (personal)
3. For each template:
   - Click **New Document**
   - Copy `title` from the H1 heading
   - Set `path` to match the filename (e.g. `infrastructure/auth.md`)
   - Paste full Markdown content
   - Add tags (UI organization only — they are NOT used in retrieval scoring)
   - Save → background job indexes content into `knowledge_doc_chunks`

### Option B: Bulk import via API
```bash
curl -X POST http://localhost:3002/api/knowledge/documents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @docs/kb-templates/cez-trading/auth-and-access.md.json
```

## Why these templates are RAG-optimized

Each template follows these principles:

1. **TL;DR in first 200 chars** — first chunk (1600 chars) is most often
   retrieved and most heavily weighted.
2. **Full sentences with context** — embeddings capture semantics, not keywords.
   Bullet-only docs have weaker signal than prose.
3. **Key terms repeated 2-3x naturally** — "auth", "OAuth", "token" repeated
   throughout strengthens cosine similarity for related queries.
4. **Explicit DO NOT sections** — agents have strong priors toward popular
   defaults (Auth0, shadcn, Jest). Negative knowledge prevents wrong choices.
5. **One concept per document** — if a doc covers two unrelated topics,
   retrieval may return it for the wrong query. Split aggressively.
6. **Code examples show OUR pattern** — generic examples are useless;
   project-specific code in docs guides the agent toward correct usage.
7. **Stable, canonical statements** — KB is for facts that change slowly.
   Time-sensitive info belongs in the Obsidian vault (Daily/, Decisions/).

## Placeholder convention

`__PLACEHOLDER__` (double underscores) marks values you must fill in.
Search-and-replace before saving:

```bash
grep -rn "__" docs/kb-templates/cez-trading/
```

## Tags

Tags are saved but **not used by retrieval scoring** (as of v0.3). They are for
UI filtering and organization only. Put important searchable info in the
document body, not in tags.

## Updating vs creating new

- **Update** an existing doc when the underlying fact changes
  (e.g. version bump, URL change, new field added).
- **Create new** when adding a separate concept
  (e.g. new auth flow alongside existing one, post-mortem incident).

Avoid mega-docs that mix multiple concepts — they degrade retrieval quality.

## Token budget impact

After indexing, each retrieval injects ~3-5 chunks (~750 tokens) per agent
spawn. With well-written KB and `KB_MIN_SCORE=0.45`, expect ~30-50% of
spawns to receive relevant KB context.

Monitor via context-budget telemetry:
```bash
grep "context-budget" /tmp/api-server.log | jq .
```
