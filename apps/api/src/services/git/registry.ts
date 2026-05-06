/**
 * Git provider registry — instantiates providers from env config and looks
 * them up by id. Lets routes do `registry.get('github')` without caring
 * about constructor wiring.
 *
 * Providers are only registered when the corresponding *_OAUTH_CLIENT_ID and
 * *_OAUTH_CLIENT_SECRET env vars are present, so the API stays runnable
 * even with no OAuth apps configured (you just can't connect new providers).
 */
import { env } from '../../config/env.js';
import type { GitProvider, GitProviderId } from './provider.js';
import { GitHubProvider }    from './github-provider.js';
import { GitLabProvider }    from './gitlab-provider.js';
import { BitbucketProvider } from './bitbucket-provider.js';

let cached: Map<GitProviderId, GitProvider> | null = null;

function build(): Map<GitProviderId, GitProvider> {
  const map = new Map<GitProviderId, GitProvider>();

  if (env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET) {
    map.set('github', new GitHubProvider({
      clientId:     env.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
      // Set GITHUB_API_BASE=https://github.your-corp.com to point at a
      // GitHub Enterprise Server. Omit for SaaS github.com (default).
      ...(env.GITHUB_API_BASE ? { apiBase: env.GITHUB_API_BASE } : {}),
    }));
  }
  if (env.GITLAB_OAUTH_CLIENT_ID && env.GITLAB_OAUTH_CLIENT_SECRET) {
    map.set('gitlab', new GitLabProvider({
      clientId:     env.GITLAB_OAUTH_CLIENT_ID,
      clientSecret: env.GITLAB_OAUTH_CLIENT_SECRET,
      // Set GITLAB_API_BASE=https://gitlab.your-corp.com for self-hosted.
      ...(env.GITLAB_API_BASE ? { apiBase: env.GITLAB_API_BASE } : {}),
    }));
  }
  if (env.BITBUCKET_OAUTH_CLIENT_ID && env.BITBUCKET_OAUTH_CLIENT_SECRET) {
    map.set('bitbucket', new BitbucketProvider({
      clientId:     env.BITBUCKET_OAUTH_CLIENT_ID,
      clientSecret: env.BITBUCKET_OAUTH_CLIENT_SECRET,
    }));
  }
  return map;
}

export function gitProviderRegistry(): Map<GitProviderId, GitProvider> {
  if (!cached) cached = build();
  return cached;
}

export function getGitProvider(id: GitProviderId): GitProvider | undefined {
  return gitProviderRegistry().get(id);
}

export function listConfiguredProviders(): Array<{ id: GitProviderId; displayName: string }> {
  return Array.from(gitProviderRegistry().values()).map((p) => ({
    id:          p.id,
    displayName: p.displayName,
  }));
}
