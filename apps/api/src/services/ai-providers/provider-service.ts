/**
 * AI provider service — manages org-level AI provider credentials.
 *
 * Two visibility scopes:
 *   - org-shared (user_id = NULL):    available to all org members
 *   - user-personal (user_id != NULL): only that user inside the org
 *
 * API keys are encrypted at rest with AES-256-GCM (`crypto.encryptString`).
 * Plaintext keys never leave the API process.
 *
 * Provider integration with OpenCode/model-router happens elsewhere — this
 * service is just the storage + lookup layer.
 */
import type { Pool } from 'pg';
import { encryptString, decryptString } from '../crypto.js';

export type AIProviderType =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openrouter'
  | 'ollama'
  | 'github-copilot'
  | 'azure-openai'
  | 'mistral';

export interface AIProvider {
  id:             string;
  organizationId: string;
  userId:         string | null; // null = org-shared
  provider:       AIProviderType;
  label:          string;
  baseUrl:        string | null;
  defaultModel:   string | null;
  enabled:        boolean;
  isDefault:      boolean;       // pinned default within (scope, kind)
  hasApiKey:      boolean;       // never expose the key itself
  metadata:       Record<string, unknown>;
  createdAt:      Date;
  updatedAt:      Date;
}

export interface CreateAIProviderInput {
  organizationId: string;
  userId:         string | null;
  provider:       AIProviderType;
  label:          string;
  apiKey?:        string; // plaintext — gets encrypted before write
  baseUrl?:       string;
  defaultModel?:  string;
  metadata?:      Record<string, unknown>;
}

export interface UpdateAIProviderInput {
  label?:        string;
  apiKey?:       string;        // pass to rotate; omit to keep existing
  baseUrl?:      string | null;
  defaultModel?: string | null;
  enabled?:      boolean;
  isDefault?:    boolean;
  metadata?:     Record<string, unknown>;
}

export class AIProviderService {
  constructor(private readonly pool: Pool) {}

  /**
   * Lists providers visible to the current user inside an org:
   * org-shared (user_id IS NULL) ∪ this user's personal entries.
   */
  async listForUser(organizationId: string, userId: string): Promise<AIProvider[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM ai_providers
        WHERE organization_id = $1 AND (user_id IS NULL OR user_id = $2)
        ORDER BY user_id NULLS FIRST, provider ASC, created_at ASC`,
      [organizationId, userId],
    );
    return rows.map(this.mapRow);
  }

  async getById(id: string): Promise<AIProvider | null> {
    const { rows: [r] } = await this.pool.query(
      `SELECT * FROM ai_providers WHERE id = $1`,
      [id],
    );
    return r ? this.mapRow(r) : null;
  }

  async create(input: CreateAIProviderInput): Promise<AIProvider> {
    const apiKeyEnc = input.apiKey ? encryptString(input.apiKey) : null;
    const { rows: [r] } = await this.pool.query(
      `INSERT INTO ai_providers
         (organization_id, user_id, provider, label, api_key_enc, base_url,
          default_model, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING *`,
      [
        input.organizationId, input.userId, input.provider, input.label,
        apiKeyEnc, input.baseUrl ?? null, input.defaultModel ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return this.mapRow(r);
  }

  async update(id: string, input: UpdateAIProviderInput): Promise<AIProvider | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (input.label !== undefined) { sets.push(`label = $${i++}`); params.push(input.label); }
    if (input.apiKey !== undefined) {
      sets.push(`api_key_enc = $${i++}`);
      params.push(input.apiKey ? encryptString(input.apiKey) : null);
    }
    if (input.baseUrl !== undefined) { sets.push(`base_url = $${i++}`); params.push(input.baseUrl); }
    if (input.defaultModel !== undefined) { sets.push(`default_model = $${i++}`); params.push(input.defaultModel); }
    if (input.enabled !== undefined) { sets.push(`enabled = $${i++}`); params.push(input.enabled); }
    if (input.isDefault !== undefined) { sets.push(`is_default = $${i++}`); params.push(input.isDefault); }
    if (input.metadata !== undefined) { sets.push(`metadata = $${i++}::jsonb`); params.push(JSON.stringify(input.metadata)); }

    if (sets.length === 0) return await this.getById(id);

    sets.push(`updated_at = NOW()`);
    params.push(id);
    const { rows: [r] } = await this.pool.query(
      `UPDATE ai_providers SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params,
    );
    return r ? this.mapRow(r) : null;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM ai_providers WHERE id = $1`, [id]);
  }

  /**
   * Returns the plaintext API key for a provider. Use sparingly — never log,
   * never echo to client. Returns null if no key was stored (Ollama, OAuth).
   */
  async getApiKey(id: string): Promise<string | null> {
    const { rows: [r] } = await this.pool.query(
      `SELECT api_key_enc FROM ai_providers WHERE id = $1`,
      [id],
    );
    if (!r || !r['api_key_enc']) return null;
    return decryptString(String(r['api_key_enc']));
  }

  /**
   * Resolves the AI provider that should be used at agent-spawn time for a
   * given organization. Picks the first **enabled** provider that has an API
   * key, preferring org-shared (user_id IS NULL) over personal entries.
   *
   * Returns null when the org has no usable provider configured — caller
   * should fall back to the default GitHub Copilot routing.
   *
   * @deprecated Prefer `resolveForUser(userId, orgId, kind?)` which honors the
   *             "user wins, org fallback" precedence and per-kind defaults.
   *             Kept for backwards compatibility with old worker code paths.
   */
  async resolveActiveForOrg(
    organizationId: string,
  ): Promise<{ provider: AIProvider; apiKey: string } | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM ai_providers
        WHERE organization_id = $1
          AND enabled = true
          AND api_key_enc IS NOT NULL
        ORDER BY user_id NULLS FIRST, is_default DESC, created_at ASC
        LIMIT 1`,
      [organizationId],
    );
    if (rows.length === 0) return null;
    const provider = this.mapRow(rows[0] as Record<string, unknown>);
    const apiKey = decryptString(String(rows[0]['api_key_enc']));
    return { provider, apiKey };
  }

  /**
   * "User wins, org fallback" resolver.
   *
   * Two-phase lookup:
   *   1. user-owned entries for this user (any org) — preferring is_default,
   *      then most-recent. If a row matches, return it.
   *   2. org-shared entries for `organizationId` — same preference order.
   *
   * When `kind` is omitted we pick across all provider kinds (worker uses
   * this to find *any* configured provider; UI debug endpoint passes a
   * specific kind to show which entry would win).
   *
   * Only entries that are `enabled = true` AND have an API key are
   * candidates. Returns null when nothing matches — caller should fall back
   * to the default Copilot path.
   */
  async resolveForUser(
    userId:         string,
    organizationId: string | null,
    kind?:          AIProviderType,
  ): Promise<{ provider: AIProvider; apiKey: string } | null> {
    // Phase 1 — user-owned (highest precedence, regardless of org).
    const userRow = await this.pickOne(
      `WHERE user_id = $1
         AND enabled = true
         AND api_key_enc IS NOT NULL
         ${kind ? 'AND provider = $2' : ''}`,
      kind ? [userId, kind] : [userId],
    );
    if (userRow) return userRow;

    // Phase 2 — org-shared fallback.
    if (!organizationId) return null;
    return this.pickOne(
      `WHERE organization_id = $1
         AND user_id IS NULL
         AND enabled = true
         AND api_key_enc IS NOT NULL
         ${kind ? 'AND provider = $2' : ''}`,
      kind ? [organizationId, kind] : [organizationId],
    );
  }

  /**
   * Pins `id` as the default for its (scope, provider) pair. Atomically
   * clears any other default in the same scope first so the partial unique
   * index never trips.
   *
   * Returns the updated row (or null if id not found).
   */
  async setDefault(id: string): Promise<AIProvider | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Clear any sibling defaults in the same scope+kind.
      if (existing.userId) {
        await client.query(
          `UPDATE ai_providers SET is_default = FALSE
             WHERE user_id = $1 AND provider = $2 AND id <> $3`,
          [existing.userId, existing.provider, id],
        );
      } else {
        await client.query(
          `UPDATE ai_providers SET is_default = FALSE
             WHERE organization_id = $1 AND user_id IS NULL
               AND provider = $2 AND id <> $3`,
          [existing.organizationId, existing.provider, id],
        );
      }
      const { rows: [r] } = await client.query(
        `UPDATE ai_providers
            SET is_default = TRUE, updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [id],
      );
      await client.query('COMMIT');
      return r ? this.mapRow(r) : null;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ── private ──────────────────────────────────────────────────────────────

  /**
   * Internal helper for resolveForUser — runs a SELECT with the given WHERE
   * fragment, ordered by `is_default DESC, created_at DESC` so default wins,
   * then most-recent. Returns the decrypted key alongside the row, or null.
   */
  private async pickOne(
    whereClause: string,
    params:      unknown[],
  ): Promise<{ provider: AIProvider; apiKey: string } | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM ai_providers
        ${whereClause}
        ORDER BY is_default DESC, created_at DESC
        LIMIT 1`,
      params,
    );
    if (rows.length === 0) return null;
    const provider = this.mapRow(rows[0] as Record<string, unknown>);
    const apiKey = decryptString(String(rows[0]['api_key_enc']));
    return { provider, apiKey };
  }

  private mapRow(r: Record<string, unknown>): AIProvider {
    return {
      id:             String(r['id']),
      organizationId: String(r['organization_id']),
      userId:         (r['user_id'] as string | null) ?? null,
      provider:       r['provider'] as AIProviderType,
      label:          String(r['label']),
      baseUrl:        (r['base_url'] as string | null) ?? null,
      defaultModel:   (r['default_model'] as string | null) ?? null,
      enabled:        Boolean(r['enabled']),
      isDefault:      Boolean(r['is_default']),
      hasApiKey:      r['api_key_enc'] !== null && r['api_key_enc'] !== undefined,
      metadata:       (r['metadata'] as Record<string, unknown>) ?? {},
      createdAt:      new Date(r['created_at'] as string),
      updatedAt:      new Date(r['updated_at'] as string),
    };
  }
}
