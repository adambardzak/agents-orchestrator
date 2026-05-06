/**
 * extractMentions
 * ───────────────
 * Parse `@path/to/file` mentions out of a chat prompt string and return
 * the unique list of referenced paths (in first-mention order). Used at
 * send-time to populate the API's `referencedFiles[]` array.
 *
 * Matching rules (must agree with `ChatInputWithMentions.vue`):
 *   - A mention starts with `@` that is at the beginning of input or
 *     preceded by whitespace (so emails like `user@host` won't match).
 *   - The path runs until the next whitespace, end of input, or another `@`.
 *   - Empty mentions (`@ `, `@@foo`) are ignored.
 *   - Duplicates are dropped (case-sensitive — paths are case-sensitive
 *     on most filesystems we care about).
 *
 * The mention text is left in the prompt as-is so the agent sees the
 * user's natural phrasing alongside the injected file contents. The
 * worker's `## Referenced Files` block then shows the same paths with
 * full content underneath.
 */
export function extractMentions(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  // (?:^|\s) lookbehind alternative: we use a capturing leading boundary
  // and rely on global match. Using matchAll for clarity over .exec loops.
  const re = /(?:^|\s)@([^\s@]+)/g;
  for (const m of text.matchAll(re)) {
    const p = m[1];
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}
