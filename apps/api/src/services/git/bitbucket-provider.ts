/**
 * Bitbucket Cloud provider — OAuth 2.0 + REST API 2.0.
 *
 * Bitbucket repositories live in "workspaces" (formerly "teams") rather than
 * a flat user namespace. We default to the user's personal workspace when no
 * namespace is given.
 */
import {
  DEFAULT_SCOPES,
  type GitProvider,
  type GitAccount,
  type GitRepo,
  type OAuthTokens,
  type CreateRepoOptions,
} from './provider.js';

export interface BitbucketProviderConfig {
  clientId: string;
  clientSecret: string;
}

export class BitbucketProvider implements GitProvider {
  readonly id = 'bitbucket' as const;
  readonly displayName = 'Bitbucket';
  private readonly authBase = 'https://bitbucket.org/site/oauth2';
  private readonly apiBase  = 'https://api.bitbucket.org/2.0';

  constructor(private readonly cfg: BitbucketProviderConfig) {}

  authorizeUrl(args: { state: string; redirectUri: string; scopes?: string[] }): string {
    // Bitbucket scopes are space-separated; redirect_uri must match the OAuth
    // consumer config in Bitbucket exactly.
    const params = new URLSearchParams({
      client_id:     this.cfg.clientId,
      response_type: 'code',
      state:         args.state,
      // Bitbucket OAuth2 does NOT actually accept a `scope` query param —
      // scopes are configured in the consumer settings — but we keep this
      // signature consistent with the other providers.
    });
    if (args.scopes && args.scopes.length > 0) {
      params.set('scope', args.scopes.join(' '));
    } else {
      params.set('scope', DEFAULT_SCOPES.bitbucket.join(' '));
    }
    return `${this.authBase}/authorize?${params.toString()}`;
  }

  async exchangeCode(args: { code: string; redirectUri: string }): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      grant_type:   'authorization_code',
      code:         args.code,
      redirect_uri: args.redirectUri,
    });
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    const res = await fetch(`${this.authBase}/access_token`, {
      method:  'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type':  'application/x-www-form-urlencoded',
        'Accept':        'application/json',
      },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`Bitbucket token exchange failed: ${res.status}`);
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scopes?: string;
    };
    return {
      accessToken: data.access_token,
      ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
      ...(data.expires_in
        ? { expiresAt: new Date(Date.now() + data.expires_in * 1000) }
        : {}),
      scopes: (data.scopes ?? '').split(/[ ,]+/).filter(Boolean),
    };
  }

  async whoami(accessToken: string): Promise<GitAccount> {
    const res = await this.api(accessToken, '/user');
    const data = (await res.json()) as {
      uuid: string; username: string; display_name?: string;
      links?: { avatar?: { href?: string } };
    };
    // Bitbucket no longer exposes email on /user; would need /user/emails (extra scope).
    return {
      id:        data.uuid,
      login:     data.username,
      email:     null,
      avatarUrl: data.links?.avatar?.href ?? null,
    };
  }

  async listRepos(accessToken: string, opts?: { perPage?: number; page?: number }): Promise<GitRepo[]> {
    const params = new URLSearchParams({
      role:     'member',
      sort:     '-updated_on',
      pagelen:  String(opts?.perPage ?? 100),
      page:     String(opts?.page ?? 1),
    });
    const res = await this.api(accessToken, `/repositories?${params.toString()}`);
    const data = (await res.json()) as {
      values: Array<{
        uuid: string; name: string; full_name: string; description: string | null;
        is_private: boolean; mainbranch?: { name: string };
        links: { html: { href: string }; clone: Array<{ name: string; href: string }> };
        updated_on?: string;
      }>;
    };
    return data.values.map((r) => this.mapRepo(r));
  }

  async createRepo(accessToken: string, opts: CreateRepoOptions): Promise<GitRepo> {
    // Bitbucket needs a workspace; fall back to current user's workspace if not given.
    let workspace = opts.namespace;
    if (!workspace) {
      const me = await this.whoami(accessToken);
      workspace = me.login;
    }
    const body = {
      scm:         'git',
      is_private:  opts.visibility !== 'public',
      description: opts.description,
      // Bitbucket has no per-repo "auto_init" — repos are empty until first push.
    };
    const res = await this.api(accessToken, `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(opts.name)}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bitbucket createRepo failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as Parameters<BitbucketProvider['mapRepo']>[0];
    return this.mapRepo(data);
  }

  authenticatedCloneUrl(accessToken: string, repo: GitRepo): string {
    return repo.cloneUrl.replace(
      'https://',
      `https://x-token-auth:${encodeURIComponent(accessToken)}@`,
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
    uuid: string; name: string; full_name: string; description: string | null;
    is_private: boolean; mainbranch?: { name: string };
    links: { html: { href: string }; clone: Array<{ name: string; href: string }> };
    updated_on?: string;
  }): GitRepo {
    const httpsClone = r.links.clone.find((c) => c.name === 'https')?.href ?? '';
    const sshClone   = r.links.clone.find((c) => c.name === 'ssh')?.href ?? null;
    return {
      id:            r.uuid,
      name:          r.name,
      fullName:      r.full_name,
      description:   r.description ?? null,
      private:       r.is_private,
      defaultBranch: r.mainbranch?.name ?? 'main',
      htmlUrl:       r.links.html.href,
      cloneUrl:      httpsClone,
      sshUrl:        sshClone,
      updatedAt:     r.updated_on ?? new Date().toISOString(),
    };
  }
}
