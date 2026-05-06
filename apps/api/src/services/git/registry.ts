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
    }));
  }
  if (env.GITLAB_OAUTH_CLIENT_ID && env.GITLAB_OAUTH_CLIENT_SECRET) {
    map.set('gitlab', new GitLabProvider({
      clientId:     env.GITLAB_OAUTH_CLIENT_ID,
      clientSecret: env.GITLAB_OAUTH_CLIENT_SECRET,
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
