/**
 * Git provider abstraction.
 *
 * Each provider (GitHub, GitLab, Bitbucket) implements this interface so the
 * rest of the orchestrator can treat them uniformly:
 *   • OAuth code-exchange (callback handler)
 *   • Whoami (resolve account id/login from access token)
 *   • List user's repositories
 *   • Create a new remote repository
 *   • (Later) push/pull helpers via simple-git use the access token directly
 *
 * Tokens themselves are stored encrypted in `git_connections` — the providers
 * here only deal with the plaintext token in memory while making API calls.
 */

export type GitProviderId = 'github' | 'gitlab' | 'bitbucket';

export interface GitAccount {
  id: string;          // provider's stable user id
  login: string;       // human-readable handle / username
  email?: string | null;
  avatarUrl?: string | null;
}

export interface GitRepo {
  id: string;
  name: string;
  fullName: string;     // owner/repo (or namespace/repo for GitLab)
  description: string | null;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  cloneUrl: string;     // HTTPS clone URL (we authenticate via token in URL)
  sshUrl?: string | null;
  updatedAt: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
}

export interface CreateRepoOptions {
  name: string;
  description?: string;
  visibility: 'private' | 'public' | 'internal';
  /** GitLab/Bitbucket: namespace/workspace under which to create the repo. */
  namespace?: string;
  autoInit?: boolean;
}

export interface CreatePullRequestOptions {
  /** owner/repo (or namespace/repo). Comes from GitRepo.fullName. */
  fullName: string;
  /** Branch on the source repo to merge from. */
  head: string;
  /** Branch to merge into (usually `main`). */
  base: string;
  title: string;
  body?: string;
  /** Mark the PR as draft. Default false. */
  draft?: boolean;
}

export interface PullRequestRef {
  number: number;
  htmlUrl: string;
  state: 'open' | 'closed' | 'merged';
}

export interface GitProvider {
  readonly id: GitProviderId;
  readonly displayName: string;

  /** OAuth: build the authorize URL the browser is redirected to. */
  authorizeUrl(args: { state: string; redirectUri: string; scopes?: string[] }): string;

  /** OAuth: exchange the `code` from the callback for an access token. */
  exchangeCode(args: { code: string; redirectUri: string }): Promise<OAuthTokens>;

  /** Resolve the authenticated account from a token. */
  whoami(accessToken: string): Promise<GitAccount>;

  /** List repositories the authenticated user has access to (paginated to 100). */
  listRepos(accessToken: string, opts?: { perPage?: number; page?: number }): Promise<GitRepo[]>;

  /** Create a new remote repository on the provider. */
  createRepo(accessToken: string, opts: CreateRepoOptions): Promise<GitRepo>;

  /**
   * Create a Pull/Merge Request on the provider. Optional — providers that
   * don't implement it should be left undefined; callers must check before
   * invoking and fall back to local merge with a clear UI message.
   */
  createPullRequest?(accessToken: string, opts: CreatePullRequestOptions): Promise<PullRequestRef>;

  /**
   * Build an authenticated HTTPS clone URL for use with `git clone` / `git push`.
   * GitHub: `https://x-access-token:<TOKEN>@github.com/<owner>/<repo>.git`
   * GitLab: `https://oauth2:<TOKEN>@gitlab.com/<ns>/<repo>.git`
   * Bitbucket: `https://x-token-auth:<TOKEN>@bitbucket.org/<ws>/<repo>.git`
   */
  authenticatedCloneUrl(accessToken: string, repo: GitRepo): string;
}

/** Default scopes per provider for "let the orchestrator manage repos for you". */
export const DEFAULT_SCOPES: Record<GitProviderId, string[]> = {
  github:    ['read:user', 'user:email', 'repo'],
  gitlab:    ['read_user', 'api', 'write_repository'],
  bitbucket: ['account', 'repository', 'repository:write'],
};
