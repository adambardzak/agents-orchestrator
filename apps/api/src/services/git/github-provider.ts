/**
 * GitHub provider — uses the OAuth Apps flow + REST v3 API via @octokit/rest.
 *
 * Notes:
 *   • The same OAuth app is reused for sign-in (Better Auth) and for
 *     orchestrator git operations. Better Auth requests `repo` scope at
 *     sign-in, so the access token stored in `auth_account` already lets
 *     us create/push repos. We mirror those tokens into `git_connections`
 *     so they can be revoked/rotated independently.
 *   • GitHub Enterprise Server is supported via `apiBase` in the config —
 *     set `GITHUB_API_BASE=https://github.your-corp.com` in the API env
 *     and the registry will pass it through. The OAuth UI lives at
 *     <host>/login/oauth/* on both SaaS and Enterprise; the REST API
 *     lives at api.github.com on SaaS but at <host>/api/v3 on Enterprise.
 *     Octokit handles the API split via `baseUrl`.
 */
import { Octokit } from '@octokit/rest';
import {
  DEFAULT_SCOPES,
  type GitProvider,
  type GitAccount,
  type GitRepo,
  type OAuthTokens,
  type CreateRepoOptions,
  type CreatePullRequestOptions,
  type PullRequestRef,
} from './provider.js';

export interface GitHubProviderConfig {
  clientId: string;
  clientSecret: string;
  /**
   * Base URL of the GitHub instance. Defaults to https://github.com (SaaS).
   * For GitHub Enterprise Server use the host of your installation,
   * e.g. https://github.your-corp.com — the provider derives the OAuth UI
   * URL and the API URL from it.
   */
  apiBase?: string;
}

export class GitHubProvider implements GitProvider {
  readonly id = 'github' as const;
  readonly displayName: string;
  /** Host of the OAuth UI: github.com or github.your-corp.com */
  private readonly webBase: string;
  /** Host of the REST API: api.github.com or <host>/api/v3 */
  private readonly apiBase: string;

  constructor(private readonly cfg: GitHubProviderConfig) {
    const rawBase = cfg.apiBase ?? 'https://github.com';
    const host = new URL(rawBase).host;
    this.webBase = rawBase.replace(/\/$/, '');
    // SaaS GitHub uses a separate api.github.com; Enterprise Server uses
    // <host>/api/v3 on the same hostname. Octokit accepts both via baseUrl.
    this.apiBase = host === 'github.com'
      ? 'https://api.github.com'
      : `${this.webBase}/api/v3`;
    this.displayName = host === 'github.com' ? 'GitHub' : `GitHub (${host})`;
  }

  authorizeUrl(args: { state: string; redirectUri: string; scopes?: string[] }): string {
    const scopes = (args.scopes ?? DEFAULT_SCOPES.github).join(' ');
    const params = new URLSearchParams({
      client_id:    this.cfg.clientId,
      redirect_uri: args.redirectUri,
      scope:        scopes,
      state:        args.state,
      allow_signup: 'true',
    });
    return `${this.webBase}/login/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(args: { code: string; redirectUri: string }): Promise<OAuthTokens> {
    const res = await fetch(`${this.webBase}/login/oauth/access_token`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        code:          args.code,
        redirect_uri:  args.redirectUri,
      }),
    });
    if (!res.ok) throw new Error(`GitHub token exchange failed: ${res.status}`);
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    };
    if (data.error || !data.access_token) {
      throw new Error(`GitHub OAuth error: ${data.error_description ?? data.error ?? 'no access_token'}`);
    }
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
    const oct = this.octokit(accessToken);
    const { data } = await oct.users.getAuthenticated();
    return {
      id:        String(data.id),
      login:     data.login,
      email:     data.email ?? null,
      avatarUrl: data.avatar_url ?? null,
    };
  }

  async listRepos(accessToken: string, opts?: { perPage?: number; page?: number }): Promise<GitRepo[]> {
    const oct = this.octokit(accessToken);
    const { data } = await oct.repos.listForAuthenticatedUser({
      per_page: opts?.perPage ?? 100,
      page:     opts?.page ?? 1,
      sort:     'updated',
      affiliation: 'owner,collaborator',
    });
    return data.map((r) => this.mapRepo(r));
  }

  async createRepo(accessToken: string, opts: CreateRepoOptions): Promise<GitRepo> {
    const oct = this.octokit(accessToken);
    // GitHub doesn't have an "internal" visibility for normal accounts; map to private.
    const isPrivate = opts.visibility !== 'public';
    const { data } = await oct.repos.createForAuthenticatedUser({
      name:        opts.name,
      description: opts.description,
      private:     isPrivate,
      auto_init:   opts.autoInit ?? true,
    });
    return this.mapRepo(data);
  }

  authenticatedCloneUrl(accessToken: string, repo: GitRepo): string {
    // GitHub accepts x-access-token as the username with PATs/OAuth tokens.
    return repo.cloneUrl.replace(
      'https://',
      `https://x-access-token:${encodeURIComponent(accessToken)}@`,
    );
  }

  async createPullRequest(
    accessToken: string,
    opts: CreatePullRequestOptions,
  ): Promise<PullRequestRef> {
    const oct = this.octokit(accessToken);
    const [owner, repo] = opts.fullName.split('/', 2);
    if (!owner || !repo) {
      throw new Error(`Invalid repo fullName "${opts.fullName}" — expected owner/repo`);
    }
    const { data } = await oct.pulls.create({
      owner,
      repo,
      head:  opts.head,
      base:  opts.base,
      title: opts.title,
      body:  opts.body,
      draft: opts.draft ?? false,
    });
    return {
      number:  data.number,
      htmlUrl: data.html_url,
      state:   data.state === 'closed'
        ? (data.merged_at ? 'merged' : 'closed')
        : 'open',
    };
  }

  /**
   * Build an Octokit client pointed at the configured API base. For SaaS
   * GitHub we leave the default (https://api.github.com); for Enterprise
   * we point at <host>/api/v3.
   */
  private octokit(accessToken: string): Octokit {
    return new Octokit({ auth: accessToken, baseUrl: this.apiBase });
  }

  private mapRepo(r: {
    id: number; name: string; full_name: string; description: string | null;
    private: boolean; default_branch?: string; html_url: string; clone_url: string;
    ssh_url?: string; updated_at?: string | null;
  }): GitRepo {
    return {
      id:            String(r.id),
      name:          r.name,
      fullName:      r.full_name,
      description:   r.description ?? null,
      private:       r.private,
      defaultBranch: r.default_branch ?? 'main',
      htmlUrl:       r.html_url,
      cloneUrl:      r.clone_url,
      sshUrl:        r.ssh_url ?? null,
      updatedAt:     r.updated_at ?? new Date().toISOString(),
    };
  }
}
