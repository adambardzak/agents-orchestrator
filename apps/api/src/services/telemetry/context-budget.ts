/**
 * Context Budget Tracker
 *
 * Per-spawn accumulator that records every block injected into a sub-agent's
 * `extraContext` (or system prompt) along with its byte size. Emits a single
 * structured log line at spawn time so operators can answer:
 *   "What blew up the prompt for task X?"
 *   "How effective is the skill filter on prompts of type Y?"
 *   "Did this commit reduce average prompt size?"
 *
 * Token estimate uses chars/4 — same heuristic the RAG service uses for chunk
 * sizing. Real per-call token counts come back via OpenCode `usage` events
 * later; this tracker is for the *prompt budget* (input side).
 */

import type { FastifyBaseLogger } from 'fastify';

export interface BlockEntry {
  /** Logical name, e.g. "rag", "kb", "frontend-rules", "branch-scope". */
  name:  string;
  chars: number;
  /** Optional metadata: { kept: 3, of: 5 } for filterable blocks. */
  meta?: Record<string, unknown>;
}

export class ContextBudget {
  private readonly blocks: BlockEntry[] = [];

  /** Record a context block. Call at most once per logical block per spawn. */
  add(name: string, chars: number, meta?: Record<string, unknown>): void {
    if (chars <= 0) return;
    this.blocks.push({ name, chars, ...(meta ? { meta } : {}) });
  }

  /** Total characters across all recorded blocks (excludes base agent system prompt). */
  totalChars(): number {
    return this.blocks.reduce((sum, b) => sum + b.chars, 0);
  }

  /** Rough token estimate (1 token ≈ 4 chars; conservative for English code+text). */
  estimatedTokens(): number {
    return Math.ceil(this.totalChars() / 4);
  }

  /**
   * Emit a single structured INFO log summarizing what landed in the prompt.
   * Safe to call once per spawn — keeps logs greppable without flooding.
   */
  emit(logger: FastifyBaseLogger, ctx: { taskId: string; agentType: string; baseSystemPromptChars: number }): void {
    const breakdown: Record<string, number> = { base: ctx.baseSystemPromptChars };
    const meta:      Record<string, unknown> = {};
    for (const b of this.blocks) {
      breakdown[b.name] = b.chars;
      if (b.meta) meta[b.name] = b.meta;
    }
    const totalChars  = ctx.baseSystemPromptChars + this.totalChars();
    const totalTokens = Math.ceil(totalChars / 4);
    logger.info(
      {
        event:    'context-budget',
        taskId:   ctx.taskId,
        agent:    ctx.agentType,
        chars:    totalChars,
        tokens:   totalTokens,
        breakdown,
        ...(Object.keys(meta).length > 0 ? { filters: meta } : {}),
      },
      `context-budget: agent=${ctx.agentType} ~${totalTokens} tok (${totalChars} chars)`,
    );
  }
}
