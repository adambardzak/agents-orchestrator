/**
 * Skill service — CRUD for org-scoped, user-defined skills.
 *
 * The application also ships with a built-in skill catalog
 * (`apps/api/src/agents/skills.ts`) that's hard-coded because skills can
 * reference MCP servers registered at app startup. Built-ins are read-only
 * and exposed alongside DB-backed skills via `listForOrg()`.
 *
 * Lookup precedence: when both a built-in and a custom skill share the same
 * id, the custom (DB) entry wins. This lets users override built-ins per org
 * without forking the codebase.
 */
import type { Pool } from 'pg';
import type { AgentSkill, SkillCategory } from '@agent-orchestrator/shared';
import { SKILL_CATALOG, getSkillById } from '../../agents/skills.js';

export interface CustomSkillRow extends AgentSkill {
  /** Internal database UUID — used for PATCH/DELETE addressing. */
  dbId:           string;
  organizationId: string;
  createdBy:      string | null;
  enabled:        boolean;
  isBuiltIn:      false;
  createdAt:      Date;
  updatedAt:      Date;
}

export interface BuiltInSkillRow extends AgentSkill {
  isBuiltIn: true;
}

export type SkillListEntry = CustomSkillRow | BuiltInSkillRow;

export interface CreateSkillInput {
  organizationId:     string;
  createdBy:          string | null;
  slug:               string;
  name:               string;
  description?:       string;
  icon?:              string;
  category?:          SkillCategory;
  knowledgeBlock:     string;
  rules?:             string[];
  requiredMcpServers?: string[];
  enabled?:           boolean;
}

export interface UpdateSkillInput {
  name?:              string;
  description?:       string;
  icon?:              string | null;
  category?:          SkillCategory | null;
  knowledgeBlock?:    string;
  rules?:             string[];
  requiredMcpServers?: string[];
  enabled?:           boolean;
}

export class SkillService {
  constructor(private readonly pool: Pool) {}

  /**
   * Returns built-in skills + this org's custom skills, with custom entries
   * overriding built-ins of the same id.
   */
  async listForOrg(organizationId: string): Promise<SkillListEntry[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM skills WHERE organization_id = $1 ORDER BY name ASC`,
      [organizationId],
    );
    const custom = rows.map((r) => this.mapRow(r as Record<string, unknown>));
    const customIds = new Set(custom.map((c) => c.id));
    const builtIn: BuiltInSkillRow[] = SKILL_CATALOG
      .filter((s) => !customIds.has(s.id))
      .map((s) => ({ ...s, isBuiltIn: true }));
    return [...builtIn, ...custom];
  }

  /**
   * Resolves a list of skill ids to full AgentSkill objects, looking in the
   * org's custom skills first then falling back to the built-in catalog.
   * Used by agent-worker when expanding an agent definition's skill ids.
   */
  async resolveByIds(organizationId: string, ids: readonly string[]): Promise<AgentSkill[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.pool.query(
      `SELECT * FROM skills
        WHERE organization_id = $1
          AND ('skill:' || slug) = ANY($2::text[])
          AND enabled = TRUE`,
      [organizationId, ids],
    );
    const customByGlobalId = new Map<string, AgentSkill>(
      rows.map((r) => {
        const skill = this.mapRow(r as Record<string, unknown>);
        return [skill.id, skill];
      }),
    );
    return ids
      .map((id) => customByGlobalId.get(id) ?? getSkillById(id))
      .filter((s): s is AgentSkill => s !== undefined);
  }

  async getById(id: string): Promise<CustomSkillRow | null> {
    const { rows: [r] } = await this.pool.query(
      `SELECT * FROM skills WHERE id = $1`,
      [id],
    );
    return r ? this.mapRow(r as Record<string, unknown>) : null;
  }

  async create(input: CreateSkillInput): Promise<CustomSkillRow> {
    const { rows: [r] } = await this.pool.query(
      `INSERT INTO skills
         (organization_id, created_by, slug, name, description, icon, category,
          knowledge_block, rules, required_mcp_servers, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
       RETURNING *`,
      [
        input.organizationId,
        input.createdBy,
        input.slug,
        input.name,
        input.description ?? '',
        input.icon ?? null,
        input.category ?? null,
        input.knowledgeBlock,
        JSON.stringify(input.rules ?? []),
        JSON.stringify(input.requiredMcpServers ?? []),
        input.enabled ?? true,
      ],
    );
    return this.mapRow(r as Record<string, unknown>);
  }

  async update(id: string, input: UpdateSkillInput): Promise<CustomSkillRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (input.name              !== undefined) { sets.push(`name = $${i++}`);                 params.push(input.name); }
    if (input.description       !== undefined) { sets.push(`description = $${i++}`);          params.push(input.description); }
    if (input.icon              !== undefined) { sets.push(`icon = $${i++}`);                 params.push(input.icon); }
    if (input.category          !== undefined) { sets.push(`category = $${i++}`);             params.push(input.category); }
    if (input.knowledgeBlock    !== undefined) { sets.push(`knowledge_block = $${i++}`);      params.push(input.knowledgeBlock); }
    if (input.rules             !== undefined) { sets.push(`rules = $${i++}::jsonb`);         params.push(JSON.stringify(input.rules)); }
    if (input.requiredMcpServers!== undefined) { sets.push(`required_mcp_servers = $${i++}::jsonb`); params.push(JSON.stringify(input.requiredMcpServers)); }
    if (input.enabled           !== undefined) { sets.push(`enabled = $${i++}`);              params.push(input.enabled); }

    if (sets.length === 0) return await this.getById(id);

    sets.push(`updated_at = NOW()`);
    params.push(id);
    const { rows: [r] } = await this.pool.query(
      `UPDATE skills SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params,
    );
    return r ? this.mapRow(r as Record<string, unknown>) : null;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM skills WHERE id = $1`, [id]);
  }

  // ── private ────────────────────────────────────────────────────────────────
  private mapRow(r: Record<string, unknown>): CustomSkillRow {
    const slug = String(r['slug']);
    const icon = (r['icon'] as string | null) ?? undefined;
    const category = (r['category'] as SkillCategory | null) ?? undefined;
    return {
      id:                 `skill:${slug}`,
      dbId:               String(r['id']),
      name:               String(r['name']),
      description:        String(r['description'] ?? ''),
      knowledgeBlock:     String(r['knowledge_block']),
      rules:              (r['rules'] as string[]) ?? [],
      requiredMcpServers: (r['required_mcp_servers'] as string[]) ?? [],
      ...(icon     !== undefined ? { icon }     : {}),
      ...(category !== undefined ? { category } : {}),
      organizationId:     String(r['organization_id']),
      createdBy:          (r['created_by'] as string | null) ?? null,
      enabled:            Boolean(r['enabled']),
      isBuiltIn:          false,
      createdAt:          new Date(r['created_at'] as string),
      updatedAt:          new Date(r['updated_at'] as string),
    };
  }
}
