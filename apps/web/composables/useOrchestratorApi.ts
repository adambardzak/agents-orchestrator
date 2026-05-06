import { useLocalStorage } from '@vueuse/core';
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  GetSessionResponse,
  ListSessionsResponse,
  ListAgentsResponse,
  AgentDefinition,
  AgentSkill,
  Ticket,
  TicketComment,
  TicketIteration,
  ListTicketsResponse,
  GetTicketResponse,
  TicketStatus,
} from '@agent-orchestrator/shared';

import type { Project } from '~/stores/project';

export type { Project };

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  children?: FileNode[];
}

export function useOrchestratorApi() {
  const config = useRuntimeConfig();
  const baseUrl = config.public.apiBase as string;

  // GitHub token — stored in localStorage, auto-loaded from auth.json on first use
  const githubToken = useLocalStorage<string>('github_token', '');

  // Auto-load token from server auth.json if not set (runs once per app session)
  if (!githubToken.value && import.meta.client) {
    fetch(`${baseUrl}/api/copilot/token`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((data: { token: string } | null) => {
        if (data?.token) githubToken.value = data.token;
      })
      .catch(() => undefined); // silently ignore — user can set manually in Settings
  }

  const defaultHeaders = computed(() => ({
    'Content-Type': 'application/json',
    ...(githubToken.value ? { 'x-github-token': githubToken.value } : {}),
  }));

  /**
   * Wrapper around fetch() that always sends credentials (cookies) so that
   * Better Auth's session cookie travels with every API call, and merges in
   * the default headers (Content-Type + GitHub token).
   */
  function req(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...defaultHeaders.value,
        ...(init.headers ?? {}),
      },
    });
  }

  async function listProjects(): Promise<{ projects: Project[]; codeServerUrl: string }> {
    const res = await req('/api/projects');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ projects: Project[]; codeServerUrl: string }>;
  }

  async function createProject(payload: {
    name: string;
    description?: string;
    contextType?: 'personal' | 'cez';
    workspacePath?: string;
    git?:
      | { action: 'create'; gitConnectionId: string; repoName: string; visibility: 'private' | 'public' | 'internal'; namespace?: string }
      | { action: 'link';   gitConnectionId: string; fullName: string; cloneUrl: string; defaultBranch: string; visibility: 'private' | 'public' | 'internal'; externalId?: string };
  }): Promise<Project> {
    const res = await req('/api/projects', { method: 'POST',
      
      body: JSON.stringify(payload) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<Project>;
  }

  async function deleteProject(id: string): Promise<void> {
    const res = await req(`/api/projects/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function listProjectFiles(
    projectId: string,
  ): Promise<{ workspacePath: string; tree: FileNode[] }> {
    const res = await req(`/api/projects/${projectId}/files`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ workspacePath: string; tree: FileNode[] }>;
  }

  async function getFileContent(
    projectId: string,
    filePath: string,
  ): Promise<{ path: string; content: string; size: number; ext: string; modifiedAt: string; isImage: boolean }> {
    const res = await fetch(
      `${baseUrl}/api/projects/${projectId}/files/content?path=${encodeURIComponent(filePath)}`,
      { headers: defaultHeaders.value },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ path: string; content: string; size: number; ext: string; modifiedAt: string; isImage: boolean }>;
  }

  async function createSession(payload: CreateSessionRequest): Promise<CreateSessionResponse> {
    const res = await req('/api/sessions', { method: 'POST',
      
      body: JSON.stringify(payload) });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error((err as { message?: string }).message ?? `HTTP ${res.status}`);
    }

    return res.json() as Promise<CreateSessionResponse>;
  }

  async function listSessions(opts?: { limit?: number; projectId?: string }): Promise<ListSessionsResponse> {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.projectId) params.set('projectId', opts.projectId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await req(`/api/sessions${qs}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<ListSessionsResponse>;
  }

  async function getSession(sessionId: string): Promise<GetSessionResponse> {
    const res = await req(`/api/sessions/${sessionId}`);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<GetSessionResponse>;
  }

  async function cancelSession(sessionId: string): Promise<void> {
    await req(`/api/sessions/${sessionId}`, { method: 'DELETE' });
  }

  async function deleteSession(sessionId: string): Promise<void> {
    const res = await req(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function listAgents(): Promise<ListAgentsResponse> {
    const res = await req('/api/agents');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<ListAgentsResponse>;
  }

  async function pauseTask(taskId: string): Promise<void> {
    await req(`/api/tasks/${taskId}/pause`, { method: 'POST' });
  }

  async function stopTask(taskId: string): Promise<void> {
    await req(`/api/tasks/${taskId}/stop`, { method: 'POST' });
  }

  async function createAgent(agent: Partial<AgentDefinition>): Promise<AgentDefinition> {
    const res = await req('/api/agents', { method: 'POST',
      
      body: JSON.stringify(agent) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<AgentDefinition>;
  }

  async function updateAgent(id: string, updates: Partial<AgentDefinition>): Promise<AgentDefinition> {
    const res = await req(`/api/agents/${id}`, { method: 'PATCH',
      
      body: JSON.stringify(updates) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<AgentDefinition>;
  }

  async function listSkills(): Promise<{ skills: AgentSkill[] }> {
    const res = await req('/api/skills');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ skills: AgentSkill[] }>;
  }

  async function listMcpServers(): Promise<{
    servers: Array<{ id: string; name: string; description: string; category: string }>;
    categories: Array<{ id: string; label: string; icon: string }>;
  }> {
    const res = await req('/api/mcp-servers');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{
      servers: Array<{ id: string; name: string; description: string; category: string }>;
      categories: Array<{ id: string; label: string; icon: string }>;
    }>;
  }

  async function approveTask(taskId: string): Promise<void> {
    const res = await req(`/api/tasks/${taskId}/approve`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function rejectTask(taskId: string): Promise<void> {
    const res = await req(`/api/tasks/${taskId}/reject`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function injectToTask(taskId: string, message: string): Promise<{ injected: boolean }> {
    const res = await req(`/api/tasks/${taskId}/inject`, { method: 'POST',
      
      body: JSON.stringify({ message }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ injected: boolean }>;
  }

  async function clarifySession(
    sessionId: string,
    answers: Record<string, string>,
  ): Promise<{ task: unknown }> {
    const res = await req(`/api/sessions/${sessionId}/clarify`, { method: 'POST',
      
      body: JSON.stringify({ answers }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ task: unknown }>;
  }

  // ── Tickets ──────────────────────────────────────────────────────────────
  async function listTickets(sessionId: string): Promise<ListTicketsResponse> {
    const res = await req(`/api/sessions/${sessionId}/tickets`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<ListTicketsResponse>;
  }

  async function getTicket(ticketId: string): Promise<GetTicketResponse> {
    const res = await req(`/api/tickets/${ticketId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<GetTicketResponse>;
  }

  async function addTicketComment(
    ticketId: string,
    body: string,
  ): Promise<{ comment: TicketComment }> {
    const res = await req(`/api/tickets/${ticketId}/comments`, { method: 'POST',
      
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ comment: TicketComment }>;
  }

  async function updateTicketStatus(
    ticketId: string,
    status: TicketStatus,
  ): Promise<{ ticket: Ticket }> {
    const res = await req(`/api/tickets/${ticketId}/status`, { method: 'PATCH',
      
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ ticket: Ticket }>;
  }

  async function reopenTicket(
    ticketId: string,
    comment?: string,
  ): Promise<{ ticket: Ticket; taskId: string }> {
    const res = await req(`/api/tickets/${ticketId}/reopen`, {
      method: 'POST',
      body: JSON.stringify(comment ? { comment } : {}),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ ticket: Ticket; taskId: string }>;
  }

  // ── Git: project repo + working tree ─────────────────────────────────────
  async function getProjectRepo(projectId: string): Promise<{ repo: unknown | null }> {
    const res = await req(`/api/projects/${projectId}/repo`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ repo: unknown | null }>;
  }

  async function getGitStatus(projectId: string): Promise<{
    status: {
      branch: string; ahead: number; behind: number;
      staged: string[]; modified: string[]; untracked: string[]; deleted: string[];
      clean: boolean;
    } | null;
    error?: string;
  }> {
    const res = await req(`/api/projects/${projectId}/git/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as ReturnType<typeof getGitStatus> extends Promise<infer T> ? Promise<T> : never;
  }

  async function getGitDiff(projectId: string, opts?: { from?: string; to?: string }): Promise<{ diff: string }> {
    const params = new URLSearchParams();
    if (opts?.from) params.set('from', opts.from);
    if (opts?.to)   params.set('to',   opts.to);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await req(`/api/projects/${projectId}/git/diff${qs}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ diff: string }>;
  }

  async function getSessionCommits(sessionId: string): Promise<{
    commits: Array<{
      id: string; sha: string; message: string; branch: string;
      filesChanged: number; insertions: number; deletions: number;
      pushedAt: string | null; createdAt: string;
    }>;
  }> {
    const res = await req(`/api/sessions/${sessionId}/commits`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as ReturnType<typeof getSessionCommits> extends Promise<infer T> ? Promise<T> : never;
  }

  return {
    githubToken,
    createSession,
    listSessions,
    getSession,
    cancelSession,
    deleteSession,
    listAgents,
    listSkills,
    listMcpServers,
    listProjects,
    createProject,
    deleteProject,
    listProjectFiles,
    getFileContent,
    pauseTask,
    stopTask,
    createAgent,
    updateAgent,
    approveTask,
    rejectTask,
    injectToTask,
    clarifySession,
    listTickets,
    getTicket,
    addTicketComment,
    updateTicketStatus,
    reopenTicket,
    getProjectRepo,
    getGitStatus,
    getGitDiff,
    getSessionCommits,
  };
}
