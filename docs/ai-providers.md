# AI Providers

> **Coming soon.** Bring your own keys for Anthropic, OpenAI, Gemini,
> OpenRouter, Ollama, GitHub Copilot, Azure OpenAI, or Mistral.

## Quick reference

- **Where to manage** — `/settings/ai` in the web UI.
- **Per-user vs. per-org** — providers added under "My providers" only apply
  to your sessions. Workspace-shared providers fall back to anyone in the
  org who doesn't have their own.
- **Default flag** — ★ icon marks the default per (scope, provider). When
  multiple providers of the same kind exist (e.g. two Anthropic accounts),
  the default is picked first; otherwise newest-first.
- **Resolution order** — for any task, the orchestrator looks up:
  1. Your personal default for the requested provider kind, then
  2. Your most recent personal provider of that kind, then
  3. The org default for that kind, then
  4. The org's most recent.
  First match wins. Falls back across kinds only if explicitly configured.
- **Keys are write-only** — once saved, the API never returns the plaintext.
  Encrypted at rest with `APP_ENCRYPTION_KEY`. Re-enter to rotate.

## Currently supported

| Provider | Auth | Notes |
|---|---|---|
| Anthropic | API key | Claude models |
| OpenAI | API key | GPT-4o, o1, etc. |
| Google Gemini | API key | Gemini 2.x |
| OpenRouter | API key | Aggregator — exposes many models |
| Ollama | URL + model | Local self-hosted |
| GitHub Copilot | OAuth token | Reuses your `~/.local/share/opencode/auth.json` |
| Azure OpenAI | endpoint + key + deployment | Enterprise OpenAI |
| Mistral | API key | Mistral / Codestral models |
