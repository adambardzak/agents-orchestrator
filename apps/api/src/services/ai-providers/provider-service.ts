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
   */
  async resolveActiveForOrg(
    organizationId: string,
  ): Promise<{ provider: AIProvider; apiKey: string } | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM ai_providers
        WHERE organization_id = $1
          AND enabled = true
          AND api_key_enc IS NOT NULL
        ORDER BY user_id NULLS FIRST, created_at ASC
        LIMIT 1`,
      [organizationId],
    );
    if (rows.length === 0) return null;
    const provider = this.mapRow(rows[0] as Record<string, unknown>);
    const apiKey = decryptString(String(rows[0]['api_key_enc']));
    return { provider, apiKey };
  }

  // ── private ──────────────────────────────────────────────────────────────
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
      hasApiKey:      r['api_key_enc'] !== null && r['api_key_enc'] !== undefined,
      metadata:       (r['metadata'] as Record<string, unknown>) ?? {},
      createdAt:      new Date(r['created_at'] as string),
      updatedAt:      new Date(r['updated_at'] as string),
    };
  }
}
