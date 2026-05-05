<template>
  <div class="p-6 max-w-2xl">
    <h1 class="text-display-md font-heading font-bold mb-2">Settings</h1>
    <p class="text-text-secondary mb-8">Configure your GitHub token and orchestrator preferences.</p>

    <!-- GitHub Token -->
    <section class="border border-border rounded-md p-5 bg-surface-elevated mb-6">
      <div class="flex items-center gap-2 mb-1">
        <UIcon name="i-ph-key-light" class="w-4 h-4" />
        <h2 class="font-semibold">GitHub Copilot Token</h2>
        <UBadge v-if="tokenSaved" color="green" variant="subtle" size="xs">Active</UBadge>
      </div>
      <p class="text-sm text-text-secondary mb-4">
        Required to authenticate OpenCode agents. Auto-detected from
        <code class="text-xs bg-surface px-1 py-0.5 rounded">~/.local/share/opencode/auth.json</code>
        if available.
      </p>

      <!-- Auto-detect status -->
      <div v-if="autoDetectStatus === 'loading'" class="flex items-center gap-2 text-sm text-text-muted mb-3">
        <UIcon name="i-ph-circle-notch-light" class="w-4 h-4 animate-spin" />
        Detecting token from auth.json...
      </div>
      <div v-else-if="autoDetectStatus === 'found'" class="flex items-center gap-2 text-sm text-completed mb-3">
        <UIcon name="i-ph-check-circle-light" class="w-4 h-4" />
        Token auto-loaded from <code class="text-xs">auth.json</code>
      </div>
      <div v-else-if="autoDetectStatus === 'not-found'" class="flex items-center gap-2 text-sm text-pending mb-3">
        <UIcon name="i-ph-warning-circle-light" class="w-4 h-4" />
        auth.json not found — enter token manually
      </div>

      <!-- Manual token input -->
      <div class="flex gap-2">
        <UInput
          v-model="tokenInput"
          type="password"
          placeholder="gho_..."
          class="flex-1 font-mono text-sm"
        />
        <UButton @click="saveToken" :disabled="!tokenInput.trim()">Save</UButton>
        <UButton v-if="tokenSaved" color="red" variant="ghost" @click="clearToken">Clear</UButton>
      </div>

      <p v-if="tokenSaved" class="text-xs text-text-muted mt-2">
        Token stored in browser localStorage. Reload to re-detect from auth.json.
      </p>
    </section>

    <!-- Budget defaults -->
    <section class="border border-border rounded-md p-5 bg-surface-elevated mb-6">
      <div class="flex items-center gap-2 mb-1">
        <UIcon name="i-ph-currency-dollar-light" class="w-4 h-4" />
        <h2 class="font-semibold">Default Budget Cap</h2>
      </div>
      <p class="text-sm text-text-secondary mb-4">Maximum spend per session in USD.</p>
      <div class="flex items-center gap-3">
        <UInput v-model="defaultBudget" type="number" min="0.5" max="100" step="0.5" class="w-32" />
        <span class="text-sm text-text-secondary">USD</span>
        <UButton size="sm" @click="saveBudget">Save</UButton>
      </div>
    </section>

    <!-- API connection -->
    <section class="border border-border rounded-md p-5 bg-surface-elevated">
      <div class="flex items-center gap-2 mb-1">
        <UIcon name="i-ph-hard-drives-light" class="w-4 h-4" />
        <h2 class="font-semibold">API Connection</h2>
        <UBadge :color="apiHealthy ? 'green' : 'red'" variant="subtle" size="xs">
          {{ apiHealthy ? 'Connected' : 'Disconnected' }}
        </UBadge>
      </div>
      <p class="text-sm text-text-muted font-mono">{{ apiBase }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core';

const config = useRuntimeConfig();
const apiBase = config.public.apiBase as string;

const tokenInput = ref('');
const githubToken = useLocalStorage<string>('github_token', '');
const defaultBudget = useLocalStorage<number>('default_budget_usd', 5);
const tokenSaved = computed(() => !!githubToken.value);
const autoDetectStatus = ref<'loading' | 'found' | 'not-found' | 'idle'>('idle');
const apiHealthy = ref(false);

// Auto-detect token from server-side auth.json on mount
onMounted(async () => {
  // Check API health
  try {
    const r = await fetch(`${apiBase}/health`);
    apiHealthy.value = r.ok;
  } catch { apiHealthy.value = false; }

  // If no token saved yet, try auto-loading from auth.json
  if (!githubToken.value) {
    autoDetectStatus.value = 'loading';
    try {
      const res = await fetch(`${apiBase}/api/copilot/token`);
      if (res.ok) {
        const data = await res.json() as { token: string };
        githubToken.value = data.token;
        tokenInput.value = data.token;
        autoDetectStatus.value = 'found';
      } else {
        autoDetectStatus.value = 'not-found';
      }
    } catch {
      autoDetectStatus.value = 'not-found';
    }
  } else {
    tokenInput.value = githubToken.value;
    autoDetectStatus.value = 'idle';
  }
});

function saveToken() {
  githubToken.value = tokenInput.value.trim();
}

function clearToken() {
  githubToken.value = '';
  tokenInput.value = '';
}

function saveBudget() {
  // defaultBudget is already reactive via useLocalStorage
}
</script>
