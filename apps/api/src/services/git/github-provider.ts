/**
 * GitHub provider — uses the OAuth Apps flow + REST v3 API via @octokit/rest.
 *
 * Notes:
 *   • The same OAuth app is reused for sign-in (Better Auth) and for
 *     orchestrator git operations. Better Auth requests `repo` scope at
 *     sign-in, so the access token stored in `auth_account` already lets
 *     us create/push repos. We mirror those tokens into `git_connections`
 *     so they can be revoked/rotated independently.
 *   • API base hardcoded to github.com; Enterprise support is a future TODO.
 */
import { Octokit } from '@octokit/rest';
import {
  DEFAULT_SCOPES,
  type GitProvider,
  type GitAccount,
  type GitRepo,
  type OAuthTokens,
  type CreateRepoOptions,
} from './provider.js';

export interface GitHubProviderConfig {
  clientId: string;
  clientSecret: string;
}

export class GitHubProvider implements GitProvider {
  readonly id = 'github' as const;
  readonly displayName = 'GitHub';

  constructor(private readonly cfg: GitHubProviderConfig) {}

  authorizeUrl(args: { state: string; redirectUri: string; scopes?: string[] }): string {
    const scopes = (args.scopes ?? DEFAULT_SCOPES.github).join(' ');
    const params = new URLSearchParams({
      client_id:    this.cfg.clientId,
      redirect_uri: args.redirectUri,
      scope:        scopes,
      state:        args.state,
      allow_signup: 'true',
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(args: { code: string; redirectUri: string }): Promise<OAuthTokens> {
    const res = await fetch('https://github.com/login/oauth/access_token', {
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
    const oct = new Octokit({ auth: accessToken });
    const { data } = await oct.users.getAuthenticated();
    return {
      id:        String(data.id),
      login:     data.login,
      email:     data.email ?? null,
      avatarUrl: data.avatar_url ?? null,
    };
  }

  async listRepos(accessToken: string, opts?: { perPage?: number; page?: number }): Promise<GitRepo[]> {
    const oct = new Octokit({ auth: accessToken });
    const { data } = await oct.repos.listForAuthenticatedUser({
      per_page: opts?.perPage ?? 100,
      page:     opts?.page ?? 1,
      sort:     'updated',
      affiliation: 'owner,collaborator',
    });
    return data.map((r) => this.mapRepo(r));
  }

  async createRepo(accessToken: string, opts: CreateRepoOptions): Promise<GitRepo> {
    const oct = new Octokit({ auth: accessToken });
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
