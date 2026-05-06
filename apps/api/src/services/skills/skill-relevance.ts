/**
 * Skill Relevance Filter
 *
 * Sub-agents are statically configured with a list of skills (e.g. Backend
 * carries 5 skills). Each skill contributes a verbose `knowledgeBlock` to the
 * system prompt — for "fix typo" tasks this is pure overhead.
 *
 * This service trims the skill list at spawn time using cosine similarity
 * between the task prompt and each skill's knowledge block. Skills below a
 * configurable threshold are dropped from the prompt; their `rules` are
 * preserved separately by the caller (rules are short and worth keeping).
 *
 * Embeddings for skills are computed lazily on first use and cached in
 * process memory (skill content is static at runtime). Task prompts are
 * embedded fresh per call — no point caching transient queries.
 *
 * Failure mode: any error in the embedding pipeline returns the original,
 * unfiltered skill list. We never want context optimization to silently
 * starve agents of tools they actually need.
 */

import type { AgentSkill } from '@agent-orchestrator/shared';
import type { FastifyBaseLogger } from 'fastify';

const EMBEDDING_DIMS = 1536;
const DEFAULT_ENDPOINT = 'https://api.githubcopilot.com/embeddings';

export class SkillRelevanceFilter {
  /** skill.id → embedding vector. Populated on first encounter; never evicted. */
  private readonly skillEmbeddings = new Map<string, number[]>();

  constructor(
    private readonly logger:    FastifyBaseLogger,
    private readonly apiKey?:   string,
    private readonly minScore:  number = 0,
    private readonly endpoint:  string = DEFAULT_ENDPOINT,
  ) {}

  /**
   * Returns the subset of `skills` whose knowledge block is similar enough to
   * the task prompt. When filtering is disabled (`minScore <= 0`) or no API
   * key is configured, returns the input unchanged. Same on any embedding
   * error — fail open, never starve the agent.
   */
  async selectRelevant(skills: AgentSkill[], taskPrompt: string): Promise<AgentSkill[]> {
    if (this.minScore <= 0 || !this.apiKey || skills.length === 0) return skills;

    let promptVec: number[] | null;
    try {
      promptVec = await this.embed(taskPrompt);
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'skill-filter: prompt embed failed, keeping all skills');
      return skills;
    }
    if (!promptVec) return skills;

    const scored: Array<{ skill: AgentSkill; score: number }> = [];
    for (const skill of skills) {
      try {
        const skillVec = await this.getSkillEmbedding(skill);
        if (!skillVec) {
          // Embedding unavailable for this skill — keep it (fail open).
          scored.push({ skill, score: 1 });
          continue;
        }
        scored.push({ skill, score: cosine(promptVec, skillVec) });
      } catch (err) {
        this.logger.warn(
          { skillId: skill.id, err: (err as Error).message },
          'skill-filter: skill embed failed, keeping skill',
        );
        scored.push({ skill, score: 1 });
      }
    }

    const kept = scored.filter((s) => s.score >= this.minScore);

    // Safety net: if the filter rejected EVERY skill, the user clearly wanted
    // a generic prompt — but agents declared specific skills for a reason.
    // Keep the single highest-scoring skill so the agent retains some of its
    // declared specialization rather than degrading to a bare prompt.
    if (kept.length === 0 && scored.length > 0) {
      const best = scored.reduce((a, b) => (a.score > b.score ? a : b));
      this.logger.debug(
        { taskPromptPreview: taskPrompt.slice(0, 80), bestScore: best.score, threshold: this.minScore },
        'skill-filter: all skills below threshold, keeping single best',
      );
      return [best.skill];
    }

    if (kept.length !== skills.length) {
      this.logger.debug(
        {
          before:    skills.length,
          after:     kept.length,
          dropped:   scored.filter((s) => s.score < this.minScore).map((s) => ({ id: s.skill.id, score: +s.score.toFixed(3) })),
          minScore:  this.minScore,
        },
        'skill-filter: trimmed skill list',
      );
    }

    return kept.map((s) => s.skill);
  }

  /** Embed a skill's knowledge block, caching the result for the process lifetime. */
  private async getSkillEmbedding(skill: AgentSkill): Promise<number[] | null> {
    const cached = this.skillEmbeddings.get(skill.id);
    if (cached) return cached;
    // Compose name + knowledgeBlock so the embedding captures both the
    // human-readable label and the body. Skills like "TypeScript Strict"
    // benefit from the name being a strong topical signal.
    const text = `${skill.name}\n\n${skill.knowledgeBlock}`;
    const vec = await this.embed(text);
    if (vec) this.skillEmbeddings.set(skill.id, vec);
    return vec;
  }

  private async embed(text: string): Promise<number[] | null> {
    if (!this.apiKey) return null;
    const res = await fetch(this.endpoint, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000),
      }),
    });
    if (!res.ok) {
      this.logger.warn({ status: res.status }, 'skill-filter: embedding API non-ok');
      return null;
    }
    const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
    const vec = data.data[0]?.embedding ?? null;
    if (vec && vec.length !== EMBEDDING_DIMS) {
      this.logger.warn({ got: vec.length, expected: EMBEDDING_DIMS }, 'skill-filter: dim mismatch');
      return null;
    }
    return vec;
  }
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!, bi = b[i]!;
    dot += ai * bi;
    na  += ai * ai;
    nb  += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
