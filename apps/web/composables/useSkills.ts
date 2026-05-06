/**
 * useSkills — wrapper around /api/skills/* endpoints.
 *
 * Returns merged catalog:
 *   - built-in skills (read-only, isBuiltIn=true) coming from app code
 *   - custom skills (CRUD via PATCH/DELETE on `dbId`) defined in active org
 *
 * Built-in entries don't have `dbId` — UI uses `isBuiltIn` to gate the
 * Edit/Delete actions. Custom skills with the same id (`skill:<slug>`) as a
 * built-in shadow it, letting users override built-ins per org.
 */
export type SkillCategory =
  | 'frontend' | 'backend' | 'database' | 'devops' | 'testing'
  | 'security' | 'ai-llm' | 'seo' | 'tooling' | 'other';

export interface SkillEntry {
  id:                 string;       // public id, "skill:<slug>"
  name:               string;
  description:        string;
  knowledgeBlock:     string;
  rules:              string[];
  requiredMcpServers: string[];
  isBuiltIn:          boolean;
  icon?:              string;
  category?:          SkillCategory;
  // custom-only fields
  dbId?:              string;
  organizationId?:    string;
  createdBy?:         string | null;
  enabled?:           boolean;
  createdAt?:         string;
  updatedAt?:         string;
}

export interface SkillCreateInput {
  slug:               string;
  name:               string;
  description?:       string;
  icon?:              string;
  category?:          SkillCategory;
  knowledgeBlock:     string;
  rules?:             string[];
  requiredMcpServers?: string[];
}

export interface SkillUpdateInput {
  name?:              string;
  description?:       string;
  icon?:              string | null;
  category?:          SkillCategory | null;
  knowledgeBlock?:    string;
  rules?:             string[];
  requiredMcpServers?: string[];
  enabled?:           boolean;
}

export function useSkills() {
  const config = useRuntimeConfig();
  const baseUrl = config.public.apiBase as string;

  function req(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  }

  async function unwrap<T>(res: Response): Promise<T> {
    if (res.ok) return (await res.json()) as T;
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }

  async function list(): Promise<{ skills: SkillEntry[]; categories: readonly SkillCategory[] }> {
    return unwrap(await req('/api/skills'));
  }

  /** Read-only built-in catalog. Powers the "fork as template" UX. */
  async function catalog(): Promise<{ skills: SkillEntry[]; categories: readonly SkillCategory[] }> {
    return unwrap(await req('/api/skills/catalog'));
  }

  async function create(input: SkillCreateInput): Promise<SkillEntry> {
    const data = await unwrap<{ skill: SkillEntry }>(
      await req('/api/skills', { method: 'POST', body: JSON.stringify(input) }),
    );
    return data.skill;
  }

  async function update(dbId: string, patch: SkillUpdateInput): Promise<SkillEntry> {
    const data = await unwrap<{ skill: SkillEntry }>(
      await req(`/api/skills/${dbId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    );
    return data.skill;
  }

  async function remove(dbId: string): Promise<void> {
    const res = await req(`/api/skills/${dbId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  return { list, catalog, create, update, remove };
}
