/**
 * GitLab provider — uses GitLab.com OAuth + REST v4 API directly via fetch.
 *
 * Self-managed GitLab instances are out of scope for v1; we'd later make the
 * `apiBase` configurable per-connection.
 */
import {
  DEFAULT_SCOPES,
  type GitProvider,
  type GitAccount,
  type GitRepo,
  type OAuthTokens,
  type CreateRepoOptions,
} from './provider.js';

export interface GitLabProviderConfig {
  clientId: string;
  clientSecret: string;
  apiBase?: string;     // defaults to https://gitlab.com
}

export class GitLabProvider implements GitProvider {
  readonly id = 'gitlab' as const;
  readonly displayName = 'GitLab';
  private readonly apiBase: string;

  constructor(private readonly cfg: GitLabProviderConfig) {
    this.apiBase = cfg.apiBase ?? 'https://gitlab.com';
  }

  authorizeUrl(args: { state: string; redirectUri: string; scopes?: string[] }): string {
    const scopes = (args.scopes ?? DEFAULT_SCOPES.gitlab).join(' ');
    const params = new URLSearchParams({
      client_id:     this.cfg.clientId,
      redirect_uri:  args.redirectUri,
      response_type: 'code',
      state:         args.state,
      scope:         scopes,
    });
    return `${this.apiBase}/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(args: { code: string; redirectUri: string }): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      client_id:     this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      code:          args.code,
      grant_type:    'authorization_code',
      redirect_uri:  args.redirectUri,
    });
    const res = await fetch(`${this.apiBase}/oauth/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body:    body.toString(),
    });
    if (!res.ok) throw new Error(`GitLab token exchange failed: ${res.status}`);
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    return {
      accessToken: data.access_token,
      ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
      ...(data.expires_in
        ? { expiresAt: new Date(Date.now() + data.expires_in * 1000) }
        : {}),
      scopes: (data.scope ?? '').split(/[ ,]+/).filter(Boolean),
    };
  }

  async whoami(accessToken: string): Promise<GitAccount> {
    const res = await this.api(accessToken, '/api/v4/user');
    const data = (await res.json()) as {
      id: number; username: string; email?: string; avatar_url?: string;
    };
    return {
      id:        String(data.id),
      login:     data.username,
      email:     data.email ?? null,
      avatarUrl: data.avatar_url ?? null,
    };
  }

  async listRepos(accessToken: string, opts?: { perPage?: number; page?: number }): Promise<GitRepo[]> {
    const params = new URLSearchParams({
      membership: 'true',
      order_by:   'updated_at',
      per_page:   String(opts?.perPage ?? 100),
      page:       String(opts?.page ?? 1),
    });
    const res = await this.api(accessToken, `/api/v4/projects?${params.toString()}`);
    const data = (await res.json()) as Array<{
      id: number; name: string; path_with_namespace: string; description: string | null;
      visibility: 'private' | 'internal' | 'public'; default_branch?: string;
      web_url: string; http_url_to_repo: string; ssh_url_to_repo?: string;
      last_activity_at?: string;
    }>;
    return data.map((r) => this.mapRepo(r));
  }

  async createRepo(accessToken: string, opts: CreateRepoOptions): Promise<GitRepo> {
    const body: Record<string, unknown> = {
      name:        opts.name,
      description: opts.description,
      visibility:  opts.visibility, // GitLab natively supports private/internal/public
      initialize_with_readme: opts.autoInit ?? true,
    };
    if (opts.namespace) body['namespace_id'] = opts.namespace;
    const res = await this.api(accessToken, '/api/v4/projects', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitLab createRepo failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as Parameters<GitLabProvider['mapRepo']>[0];
    return this.mapRepo(data);
  }

  authenticatedCloneUrl(accessToken: string, repo: GitRepo): string {
    return repo.cloneUrl.replace(
      'https://',
      `https://oauth2:${encodeURIComponent(accessToken)}@`,
    );
  }

  // ── private ──────────────────────────────────────────────────────────────
  private api(accessToken: string, path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  private mapRepo(r: {
    id: number; name: string; path_with_namespace: string; description: string | null;
    visibility: 'private' | 'internal' | 'public'; default_branch?: string;
    web_url: string; http_url_to_repo: string; ssh_url_to_repo?: string;
    last_activity_at?: string;
  }): GitRepo {
    return {
      id:            String(r.id),
      name:          r.name,
      fullName:      r.path_with_namespace,
      description:   r.description ?? null,
      private:       r.visibility !== 'public',
      defaultBranch: r.default_branch ?? 'main',
      htmlUrl:       r.web_url,
      cloneUrl:      r.http_url_to_repo,
      sshUrl:        r.ssh_url_to_repo ?? null,
      updatedAt:     r.last_activity_at ?? new Date().toISOString(),
    };
  }
}
