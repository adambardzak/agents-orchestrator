/**
 * useMarkdown — render markdown to safe HTML for chat / agent message display.
 *
 * Pipeline:
 *   marked (GFM, breaks=true) → DOMPurify sanitisation → string of HTML
 *
 * We sanitise to be safe against any agent that hallucinates `<script>` etc.;
 * the assistant output is otherwise trusted but always treated as untrusted
 * input on the frontend.
 *
 * Usage:
 *   <div class="prose-chat" v-html="renderMarkdown(msg.content)" />
 */
import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({
  gfm:    true,
  breaks: true,
});

/** Convert markdown to safe HTML. Empty input → empty string. */
export function renderMarkdown(input: string | null | undefined): string {
  if (!input) return '';
  // marked returns string in sync mode by default
  const rawHtml = marked.parse(String(input), { async: false }) as string;
  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    // Disallow target=_self/_top weirdness; allow target=_blank with rel.
    ADD_ATTR: ['target', 'rel'],
  });
}

export function useMarkdown() {
  return { renderMarkdown };
}
