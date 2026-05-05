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
    fetch(`${baseUrl}/api/auth/token`)
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

  async function listProjects(): Promise<{ projects: Project[]; codeServerUrl: string }> {
    const res = await fetch(`${baseUrl}/api/projects`, {
      headers: defaultHeaders.value,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ projects: Project[]; codeServerUrl: string }>;
  }

  async function createProject(payload: {
    name: string;
    description?: string;
    contextType?: 'personal' | 'cez';
    workspacePath?: string;
  }): Promise<Project> {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: defaultHeaders.value,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<Project>;
  }

  async function deleteProject(id: string): Promise<void> {
    const res = await fetch(`${baseUrl}/api/projects/${id}`, {
      method: 'DELETE',
      headers: defaultHeaders.value,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function listProjectFiles(
    projectId: string,
  ): Promise<{ workspacePath: string; tree: FileNode[] }> {
    const res = await fetch(`${baseUrl}/api/projects/${projectId}/files`, {
      headers: defaultHeaders.value,
    });
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
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: defaultHeaders.value,
      body: JSON.stringify(payload),
    });

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
    const res = await fetch(`${baseUrl}/api/sessions${qs}`, {
      headers: defaultHeaders.value,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<ListSessionsResponse>;
  }

  async function getSession(sessionId: string): Promise<GetSessionResponse> {
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      headers: defaultHeaders.value,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<GetSessionResponse>;
  }

  async function cancelSession(sessionId: string): Promise<void> {
    await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: defaultHeaders.value,
    });
  }

  async function deleteSession(sessionId: string): Promise<void> {
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: defaultHeaders.value,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function listAgents(): Promise<ListAgentsResponse> {
    const res = await fetch(`${baseUrl}/api/agents`, {
      headers: defaultHeaders.value,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<ListAgentsResponse>;
  }

  async function pauseTask(taskId: string): Promise<void> {
    await fetch(`${baseUrl}/api/tasks/${taskId}/pause`, {
      method: 'POST',
      headers: defaultHeaders.value,
    });
  }

  async function stopTask(taskId: string): Promise<void> {
    await fetch(`${baseUrl}/api/tasks/${taskId}/stop`, {
      method: 'POST',
      headers: defaultHeaders.value,
    });
  }

  async function createAgent(agent: Partial<AgentDefinition>): Promise<AgentDefinition> {
    const res = await fetch(`${baseUrl}/api/agents`, {
      method: 'POST',
      headers: defaultHeaders.value,
      body: JSON.stringify(agent),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<AgentDefinition>;
  }

  async function updateAgent(id: string, updates: Partial<AgentDefinition>): Promise<AgentDefinition> {
    const res = await fetch(`${baseUrl}/api/agents/${id}`, {
      method: 'PATCH',
      headers: defaultHeaders.value,
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<AgentDefinition>;
  }

  async function listSkills(): Promise<{ skills: AgentSkill[] }> {
    const res = await fetch(`${baseUrl}/api/skills`, {
      headers: defaultHeaders.value,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ skills: AgentSkill[] }>;
  }

  async function listMcpServers(): Promise<{
    servers: Array<{ id: string; name: string; description: string; category: string }>;
    categories: Array<{ id: string; label: string; icon: string }>;
  }> {
    const res = await fetch(`${baseUrl}/api/mcp-servers`, {
      headers: defaultHeaders.value,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{
      servers: Array<{ id: string; name: string; description: string; category: string }>;
      categories: Array<{ id: string; label: string; icon: string }>;
    }>;
  }

  async function approveTask(taskId: string): Promise<void> {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/approve`, {
      method: 'POST',
      headers: defaultHeaders.value,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function rejectTask(taskId: string): Promise<void> {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/reject`, {
      method: 'POST',
      headers: defaultHeaders.value,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function injectToTask(taskId: string, message: string): Promise<{ injected: boolean }> {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/inject`, {
      method: 'POST',
      headers: defaultHeaders.value,
      body: JSON.stringify({ message }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ injected: boolean }>;
  }

  async function clarifySession(
    sessionId: string,
    answers: Record<string, string>,
  ): Promise<{ task: unknown }> {
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/clarify`, {
      method: 'POST',
      headers: defaultHeaders.value,
      body: JSON.stringify({ answers }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ task: unknown }>;
  }

  // ── Tickets ──────────────────────────────────────────────────────────────
  async function listTickets(sessionId: string): Promise<ListTicketsResponse> {
    const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/tickets`, {
      headers: defaultHeaders.value,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<ListTicketsResponse>;
  }

  async function getTicket(ticketId: string): Promise<GetTicketResponse> {
    const res = await fetch(`${baseUrl}/api/tickets/${ticketId}`, {
      headers: defaultHeaders.value,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<GetTicketResponse>;
  }

  async function addTicketComment(
    ticketId: string,
    body: string,
  ): Promise<{ comment: TicketComment }> {
    const res = await fetch(`${baseUrl}/api/tickets/${ticketId}/comments`, {
      method: 'POST',
      headers: defaultHeaders.value,
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ comment: TicketComment }>;
  }

  async function updateTicketStatus(
    ticketId: string,
    status: TicketStatus,
  ): Promise<{ ticket: Ticket }> {
    const res = await fetch(`${baseUrl}/api/tickets/${ticketId}/status`, {
      method: 'PATCH',
      headers: defaultHeaders.value,
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ ticket: Ticket }>;
  }

  async function reopenTicket(
    ticketId: string,
    comment?: string,
  ): Promise<{ ticket: Ticket; taskId: string }> {
    const res = await fetch(`${baseUrl}/api/tickets/${ticketId}/reopen`, {
      method: 'POST',
      headers: defaultHeaders.value,
      body: JSON.stringify(comment ? { comment } : {}),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<{ ticket: Ticket; taskId: string }>;
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
  };
}
