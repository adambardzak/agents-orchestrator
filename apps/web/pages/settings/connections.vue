<template>
  <div class="p-6 max-w-4xl">
    <h1 class="text-display-md font-heading font-bold mb-2">Git Connections</h1>
    <p class="text-text-secondary mb-8">
      Connect Git providers to push generated code to your own repositories.
      Tokens are encrypted at rest with AES-256-GCM and never leave the API.
    </p>

    <!-- Provider connect buttons -->
    <section class="border border-border rounded-md p-5 bg-surface-elevated mb-8">
      <div class="flex items-center gap-2 mb-4">
        <UIcon name="i-ph-plug-light" class="w-4 h-4" />
        <h2 class="font-semibold">Available providers</h2>
      </div>

      <div v-if="providersLoading" class="flex items-center gap-2 text-sm text-text-muted">
        <UIcon name="i-ph-circle-notch-light" class="w-4 h-4 animate-spin" />
        Loading providers...
      </div>
      <div v-else-if="providers.length === 0">
        <EmptyState
          icon="i-ph-warning-light"
          title="No OAuth providers configured"
          size="sm"
        >
          Set
          <code class="text-xs bg-surface px-1 py-0.5 rounded">GITHUB_OAUTH_CLIENT_ID</code> /
          <code class="text-xs bg-surface px-1 py-0.5 rounded">_SECRET</code>
          (and similarly for GitLab/Bitbucket) in the API <code>.env</code> and restart.
        </EmptyState>
      </div>
      <div v-else class="flex flex-wrap gap-3">
        <UButton
          v-for="p in providers"
          :key="p.id"
          :icon="iconFor(p.id)"
          color="gray"
          variant="solid"
          @click="onConnect(p.id)"
        >
          Connect {{ p.displayName }}
        </UButton>
      </div>
    </section>

    <!-- Existing connections -->
    <section class="border border-border rounded-md p-5 bg-surface-elevated">
      <div class="flex items-center gap-2 mb-4">
        <UIcon name="i-ph-link-light" class="w-4 h-4" />
        <h2 class="font-semibold">Connected accounts</h2>
        <UBadge v-if="connections.length > 0" color="gray" variant="subtle" size="xs">
          {{ connections.length }}
        </UBadge>
      </div>

      <div v-if="connectionsLoading" class="flex items-center gap-2 text-sm text-text-muted">
        <UIcon name="i-ph-circle-notch-light" class="w-4 h-4 animate-spin" />
        Loading connections...
      </div>
      <EmptyState
        v-else-if="connections.length === 0"
        icon="i-ph-link-break-light"
        title="No accounts connected"
        description="Click a provider above to start the OAuth flow and link your Git account."
        size="sm"
      />
      <ul v-else class="divide-y divide-border">
        <li
          v-for="conn in connections"
          :key="conn.id"
          class="py-4 flex items-start justify-between gap-4"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 mb-1">
              <UIcon :name="iconFor(conn.provider)" class="w-4 h-4" />
              <span class="font-semibold">{{ conn.accountLogin }}</span>
              <UBadge color="gray" variant="subtle" size="xs">{{ conn.provider }}</UBadge>
              <UBadge
                v-if="conn.tokenExpiresAt && isExpired(conn.tokenExpiresAt)"
                color="red"
                variant="subtle"
                size="xs"
              >Expired</UBadge>
            </div>
            <p class="text-xs text-text-muted mb-2">
              Connected {{ formatDate(conn.createdAt) }} ·
              Scopes: <code class="text-xs">{{ conn.scopes.join(', ') || '—' }}</code>
            </p>

            <div class="flex items-center gap-2 mt-2">
              <label class="text-xs text-text-secondary">Default visibility:</label>
              <USelect
                :model-value="conn.defaultVisibility"
                :options="visibilityOptions(conn.provider)"
                size="xs"
                class="w-32"
                @update:model-value="onVisibilityChange(conn.id, $event)"
              />
              <UButton
                size="xs"
                color="gray"
                variant="ghost"
                icon="i-ph-folders-light"
                :loading="reposLoading[conn.id]"
                @click="toggleRepos(conn.id)"
              >{{ openRepos[conn.id] ? 'Hide' : 'Show' }} repos</UButton>
            </div>

            <!-- Repo list -->
            <div v-if="openRepos[conn.id]" class="mt-3 border border-border rounded-md p-3 bg-surface">
              <div v-if="reposByConn[conn.id]?.length === 0" class="text-xs text-text-muted">
                No repositories found.
              </div>
              <ul v-else class="space-y-1 text-xs max-h-64 overflow-y-auto">
                <li
                  v-for="repo in reposByConn[conn.id]"
                  :key="repo.id"
                  class="flex items-center gap-2"
                >
                  <UIcon
                    :name="repo.private ? 'i-ph-lock-light' : 'i-ph-globe-light'"
                    class="w-3 h-3 text-text-muted"
                  />
                  <a :href="repo.htmlUrl" target="_blank" class="font-mono hover:underline">
                    {{ repo.fullName }}
                  </a>
                  <span class="text-text-muted truncate">{{ repo.description }}</span>
                </li>
              </ul>
            </div>
          </div>

          <UButton
            size="xs"
            color="red"
            variant="ghost"
            icon="i-ph-trash-light"
            :loading="disconnecting[conn.id]"
            @click="onDisconnect(conn.id)"
          >Disconnect</UButton>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { GitConnection, GitProviderInfo, GitRepo } from '~/composables/useGitConnections';

definePageMeta({ layout: 'default' });

const api = useGitConnections();
const toast = useToast();

const providers = ref<GitProviderInfo[]>([]);
const connections = ref<GitConnection[]>([]);
const providersLoading = ref(true);
const connectionsLoading = ref(true);
const disconnecting = reactive<Record<string, boolean>>({});
const reposLoading = reactive<Record<string, boolean>>({});
const reposByConn = reactive<Record<string, GitRepo[]>>({});
const openRepos = reactive<Record<string, boolean>>({});

async function loadAll(): Promise<void> {
  providersLoading.value = true;
  connectionsLoading.value = true;
  try {
    [providers.value, connections.value] = await Promise.all([
      api.listProviders(),
      api.listConnections(),
    ]);
  } catch (err) {
    toast.add({ title: 'Failed to load', description: String(err), color: 'red' });
  } finally {
    providersLoading.value = false;
    connectionsLoading.value = false;
  }
}

function iconFor(id: GitProviderInfo['id']): string {
  switch (id) {
    case 'github':    return 'i-ph-github-logo-light';
    case 'gitlab':    return 'i-ph-gitlab-logo-light';
    case 'bitbucket': return 'i-ph-git-branch-light';
    default:          return 'i-ph-git-branch-light';
  }
}

function visibilityOptions(provider: GitProviderInfo['id']): Array<{ label: string; value: string }> {
  // GitHub free tier doesn't support "internal", but we still surface the option
  // and let provider createRepo() reject if invalid.
  const base = [
    { label: 'Private', value: 'private' },
    { label: 'Public',  value: 'public'  },
  ];
  if (provider === 'gitlab' || provider === 'github') {
    base.push({ label: 'Internal', value: 'internal' });
  }
  return base;
}

function isExpired(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function onConnect(id: GitProviderInfo['id']): void {
  api.connect(id, '/settings/connections');
}

async function onDisconnect(id: string): Promise<void> {
  if (!confirm('Disconnect this account? Future pushes will fail until you reconnect.')) return;
  disconnecting[id] = true;
  try {
    await api.disconnect(id);
    connections.value = connections.value.filter((c) => c.id !== id);
    delete reposByConn[id];
    delete openRepos[id];
    toast.add({ title: 'Disconnected', color: 'green' });
  } catch (err) {
    toast.add({ title: 'Disconnect failed', description: String(err), color: 'red' });
  } finally {
    disconnecting[id] = false;
  }
}

async function onVisibilityChange(id: string, visibility: string): Promise<void> {
  try {
    await api.setDefaultVisibility(id, visibility as 'private' | 'public' | 'internal');
    const conn = connections.value.find((c) => c.id === id);
    if (conn) conn.defaultVisibility = visibility as 'private' | 'public' | 'internal';
  } catch (err) {
    toast.add({ title: 'Update failed', description: String(err), color: 'red' });
  }
}

async function toggleRepos(id: string): Promise<void> {
  if (openRepos[id]) {
    openRepos[id] = false;
    return;
  }
  openRepos[id] = true;
  if (reposByConn[id]) return; // cached
  reposLoading[id] = true;
  try {
    reposByConn[id] = await api.listRepos(id);
  } catch (err) {
    toast.add({ title: 'Failed to load repos', description: String(err), color: 'red' });
    openRepos[id] = false;
  } finally {
    reposLoading[id] = false;
  }
}

onMounted(loadAll);
</script>
