/**
 * useSkills — wrapper around /api/skills/* endpoints.
 *
 * Returns merged catalog:
 *   - built-in skills (read-only, isBuiltIn=true) coming from app code
 *   - custom skills (CRUD via PATCH/DELETE on `dbId`) defined in active org
 *
 * Built-in entries don't have `dbId` — UI uses `isBuiltIn` to gate the
 * Edit/Delete actions.
 */
export interface SkillEntry {
  id:                 string;       // public id, "skill:<slug>"
  name:               string;
  description:        string;
  knowledgeBlock:     string;
  rules:              string[];
  requiredMcpServers: string[];
  isBuiltIn:          boolean;
  // custom-only fields
  dbId?:              string;
  organizationId?:    string;
  createdBy?:         string | null;
  enabled?:           boolean;
  createdAt?:         string;
  updatedAt?:         string;
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

  async function list(): Promise<SkillEntry[]> {
    const res = await req('/api/skills');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { skills: SkillEntry[] };
    return data.skills;
  }

  async function create(input: {
    slug:               string;
    name:               string;
    description?:       string;
    knowledgeBlock:     string;
    rules?:             string[];
    requiredMcpServers?: string[];
  }): Promise<SkillEntry> {
    const res = await req('/api/skills', { method: 'POST', body: JSON.stringify(input) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { skill: SkillEntry };
    return data.skill;
  }

  async function update(dbId: string, patch: {
    name?:              string;
    description?:       string;
    knowledgeBlock?:    string;
    rules?:             string[];
    requiredMcpServers?: string[];
    enabled?:           boolean;
  }): Promise<SkillEntry> {
    const res = await req(`/api/skills/${dbId}`, { method: 'PATCH', body: JSON.stringify(patch) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { skill: SkillEntry };
    return data.skill;
  }

  async function remove(dbId: string): Promise<void> {
    const res = await req(`/api/skills/${dbId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  return { list, create, update, remove };
}
