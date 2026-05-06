/**
 * useGitConnections — thin wrapper around /api/git/* endpoints.
 *
 * Connect/disconnect flows redirect through the API (OAuth requires a real
 * browser navigation), but listing/repos/visibility are fetched via JSON.
 */
import type { Ref } from 'vue';

export interface GitProviderInfo {
  id: 'github' | 'gitlab' | 'bitbucket';
  displayName: string;
}

export interface GitConnection {
  id: string;
  organizationId: string;
  userId: string;
  provider: GitProviderInfo['id'];
  accountLogin: string;
  accountId: string;
  scopes: string[];
  defaultVisibility: 'private' | 'public' | 'internal';
  tokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GitRepo {
  id: string;
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string | null;
  updatedAt: string;
}

export function useGitConnections() {
  const config = useRuntimeConfig();
  const baseUrl = config.public.apiBase as string;

  function req(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  }

  async function listProviders(): Promise<GitProviderInfo[]> {
    const res = await req('/api/git/providers');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { providers: GitProviderInfo[] };
    return data.providers;
  }

  async function listConnections(): Promise<GitConnection[]> {
    const res = await req('/api/git/connections');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { connections: GitConnection[] };
    return data.connections;
  }

  async function disconnect(id: string): Promise<void> {
    const res = await req(`/api/git/connections/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function setDefaultVisibility(
    id: string,
    visibility: 'private' | 'public' | 'internal',
  ): Promise<void> {
    const res = await req(`/api/git/connections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ defaultVisibility: visibility }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function listRepos(connectionId: string, page = 1): Promise<GitRepo[]> {
    const res = await req(`/api/git/connections/${connectionId}/repos?page=${page}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { repos: GitRepo[] };
    return data.repos;
  }

  /** Browser navigation to start OAuth — must be a top-level navigation. */
  function connect(provider: GitProviderInfo['id'], redirect = '/settings/connections'): void {
    const url = `${baseUrl}/api/git/connect/${provider}?redirect=${encodeURIComponent(redirect)}`;
    window.location.href = url;
  }

  return {
    listProviders,
    listConnections,
    disconnect,
    setDefaultVisibility,
    listRepos,
    connect,
  } as { 
    listProviders: () => Promise<GitProviderInfo[]>;
    listConnections: () => Promise<GitConnection[]>;
    disconnect: (id: string) => Promise<void>;
    setDefaultVisibility: (id: string, v: 'private' | 'public' | 'internal') => Promise<void>;
    listRepos: (id: string, page?: number) => Promise<GitRepo[]>;
    connect: (provider: GitProviderInfo['id'], redirect?: string) => void;
  };
}

export type UseGitConnectionsReturn = ReturnType<typeof useGitConnections>;
export type GitConnectionsRef = Ref<GitConnection[]>;
