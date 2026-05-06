<template>
  <div class="p-6 max-w-4xl">
    <div class="flex items-start justify-between mb-2">
      <div>
        <h1 class="text-display-md font-heading font-bold mb-2">AI Providers</h1>
        <p class="text-text-secondary">
          Configure API keys for AI providers. Keys are encrypted at rest with AES-256-GCM
          and never returned to the browser.
        </p>
      </div>
      <UButton icon="i-ph-plus-light" @click="openAddModal()">Add provider</UButton>
    </div>

    <!-- List of configured providers -->
    <section class="mt-8">
      <div v-if="loading" class="flex items-center gap-2 text-sm text-text-muted">
        <UIcon name="i-ph-circle-notch-light" class="w-4 h-4 animate-spin" />
        Loading providers...
      </div>
      <div v-else-if="providers.length === 0" class="border border-dashed border-border rounded-md p-8 text-center text-text-muted">
        No providers configured yet. Click "Add provider" to get started.
      </div>
      <ul v-else class="space-y-2">
        <li
          v-for="p in providers"
          :key="p.id"
          class="border border-border rounded-md p-4 bg-surface-elevated flex items-start justify-between gap-4"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 mb-1">
              <UIcon :name="iconFor(p.provider)" class="w-4 h-4" />
              <span class="font-semibold">{{ p.label }}</span>
              <UBadge color="gray" variant="subtle" size="xs">{{ displayName(p.provider) }}</UBadge>
              <UBadge :color="p.userId ? 'blue' : 'green'" variant="subtle" size="xs">
                {{ p.userId ? 'personal' : 'org-shared' }}
              </UBadge>
              <UBadge v-if="!p.enabled" color="gray" variant="subtle" size="xs">disabled</UBadge>
              <UBadge v-if="p.hasApiKey" color="completed" variant="subtle" size="xs">key set</UBadge>
              <UBadge v-else-if="needsKey(p.provider)" color="red" variant="subtle" size="xs">no key</UBadge>
            </div>
            <p class="text-xs text-text-muted">
              <span v-if="p.defaultModel">model: <code>{{ p.defaultModel }}</code></span>
              <span v-if="p.baseUrl"> · baseUrl: <code class="break-all">{{ p.baseUrl }}</code></span>
            </p>
            <p v-if="testResults[p.id]" class="text-xs mt-1" :class="testResults[p.id]?.ok ? 'text-completed' : 'text-failed'">
              {{ testResults[p.id]?.ok ? `OK — ${testResults[p.id]?.modelCount ?? 0} models` : `Failed: ${testResults[p.id]?.error}` }}
            </p>
          </div>

          <div class="flex items-center gap-2">
            <UButton size="xs" variant="ghost" icon="i-ph-plug-charging-light" :loading="testing[p.id]" @click="onTest(p)">Test</UButton>
            <UButton size="xs" variant="ghost" icon="i-ph-pencil-simple-light" @click="openEditModal(p)">Edit</UButton>
            <UButton size="xs" variant="ghost" color="red" icon="i-ph-trash-light" :loading="deleting[p.id]" @click="onDelete(p)">Delete</UButton>
          </div>
        </li>
      </ul>
    </section>

    <!-- Add / Edit modal -->
    <UModal v-model="showModal" :ui="{ width: 'sm:max-w-lg' }">
      <UCard>
        <template #header>
          <p class="font-semibold">{{ editing ? 'Edit provider' : 'Add AI provider' }}</p>
        </template>

        <form class="space-y-4" @submit.prevent="onSave">
          <UFormGroup label="Provider" required>
            <USelect
              v-model="form.provider"
              :options="typeOptions"
              :disabled="!!editing"
            />
          </UFormGroup>

          <UFormGroup label="Label" required hint="Friendly name shown in lists.">
            <UInput v-model="form.label" :placeholder="`${displayName(form.provider)} — production`" />
          </UFormGroup>

          <UFormGroup label="Scope">
            <USelect
              v-model="form.scope"
              :options="[
                { label: 'Personal (only you)', value: 'personal' },
                { label: 'Org-shared',          value: 'org'      },
              ]"
              :disabled="!!editing"
            />
          </UFormGroup>

          <UFormGroup
            v-if="currentTypeInfo?.needsApiKey"
            label="API key"
            :required="!editing"
            :hint="editing ? 'Leave blank to keep existing key' : (currentTypeInfo?.apiKeyHelpUrl ? `Get one from ${currentTypeInfo.apiKeyHelpUrl}` : '')"
          >
            <UInput v-model="form.apiKey" type="password" :placeholder="editing && form.hasApiKey ? '••••••••' : 'sk-...'" font-mono />
          </UFormGroup>

          <UFormGroup
            label="Base URL"
            :required="currentTypeInfo?.baseUrlRequired"
            :hint="currentTypeInfo?.defaultBaseUrl ? `Default: ${currentTypeInfo.defaultBaseUrl}` : 'Required for this provider'"
          >
            <UInput v-model="form.baseUrl" :placeholder="currentTypeInfo?.defaultBaseUrl ?? 'https://...'" font-mono />
          </UFormGroup>

          <UFormGroup label="Default model" hint="Used when this provider is selected for an agent.">
            <USelect
              v-model="form.defaultModel"
              :options="modelOptions"
              :placeholder="currentTypeInfo?.popularModels[0] ?? ''"
              creatable
            />
          </UFormGroup>

          <div class="flex items-center justify-between gap-2">
            <UButton size="sm" variant="ghost" icon="i-ph-plug-charging-light" :loading="testingInline" @click="onTestInline">
              Test connection
            </UButton>
            <p v-if="inlineTestResult" class="text-xs" :class="inlineTestResult.ok ? 'text-completed' : 'text-failed'">
              {{ inlineTestResult.ok ? `OK — ${inlineTestResult.modelCount ?? 0} models` : `Failed: ${inlineTestResult.error}` }}
            </p>
          </div>

          <p v-if="error" class="text-sm text-failed">{{ error }}</p>
        </form>

        <template #footer>
          <div class="flex justify-end gap-3">
            <UButton variant="ghost" @click="showModal = false">Cancel</UButton>
            <UButton :loading="saving" :disabled="!form.label.trim()" @click="onSave">
              {{ editing ? 'Save' : 'Add provider' }}
            </UButton>
          </div>
        </template>
      </UCard>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import type { AIProviderRow, AIProviderType, ProviderTypeInfo, TestResult } from '~/composables/useAIProviders';

definePageMeta({ layout: 'default' });

const api = useAIProviders();
const toast = useToast();

const providers = ref<AIProviderRow[]>([]);
const types = ref<ProviderTypeInfo[]>([]);
const loading = ref(true);
const testing = reactive<Record<string, boolean>>({});
const deleting = reactive<Record<string, boolean>>({});
const testResults = reactive<Record<string, TestResult>>({});

const showModal = ref(false);
const editing = ref<AIProviderRow | null>(null);
const saving = ref(false);
const error = ref('');
const testingInline = ref(false);
const inlineTestResult = ref<TestResult | null>(null);

const form = reactive({
  provider:     'anthropic' as AIProviderType,
  label:        '',
  apiKey:       '',
  baseUrl:      '',
  defaultModel: '',
  scope:        'personal' as 'org' | 'personal',
  hasApiKey:    false, // edit-only flag
});

const typeOptions = computed(() =>
  types.value.map((t) => ({ label: t.displayName, value: t.id })),
);
const currentTypeInfo = computed(() => types.value.find((t) => t.id === form.provider));
const modelOptions = computed(() => currentTypeInfo.value?.popularModels ?? []);

function displayName(t: AIProviderType): string {
  return types.value.find((x) => x.id === t)?.displayName ?? t;
}
function needsKey(t: AIProviderType): boolean {
  return types.value.find((x) => x.id === t)?.needsApiKey ?? true;
}
function iconFor(t: AIProviderType): string {
  switch (t) {
    case 'anthropic':       return 'i-ph-flower-light';
    case 'openai':          return 'i-ph-circle-half-light';
    case 'google':          return 'i-ph-sparkle-light';
    case 'openrouter':      return 'i-ph-shuffle-light';
    case 'ollama':          return 'i-ph-cube-light';
    case 'github-copilot':  return 'i-ph-github-logo-light';
    case 'azure-openai':    return 'i-ph-cloud-light';
    case 'mistral':         return 'i-ph-wind-light';
    default:                return 'i-ph-brain-light';
  }
}

function resetForm(): void {
  form.provider = 'anthropic';
  form.label = '';
  form.apiKey = '';
  form.baseUrl = '';
  form.defaultModel = '';
  form.scope = 'personal';
  form.hasApiKey = false;
  error.value = '';
  inlineTestResult.value = null;
}

function openAddModal(): void {
  editing.value = null;
  resetForm();
  showModal.value = true;
}

function openEditModal(p: AIProviderRow): void {
  editing.value = p;
  form.provider = p.provider;
  form.label = p.label;
  form.apiKey = '';
  form.baseUrl = p.baseUrl ?? '';
  form.defaultModel = p.defaultModel ?? '';
  form.scope = p.userId ? 'personal' : 'org';
  form.hasApiKey = p.hasApiKey;
  error.value = '';
  inlineTestResult.value = null;
  showModal.value = true;
}

async function onSave(): Promise<void> {
  saving.value = true;
  error.value = '';
  try {
    if (editing.value) {
      const patch: Parameters<typeof api.update>[1] = { label: form.label.trim() };
      if (form.apiKey)            patch.apiKey       = form.apiKey;
      patch.baseUrl      = form.baseUrl.trim() || null;
      patch.defaultModel = form.defaultModel.trim() || null;
      const updated = await api.update(editing.value.id, patch);
      const idx = providers.value.findIndex((p) => p.id === updated.id);
      if (idx >= 0) providers.value[idx] = updated;
      toast.add({ title: 'Provider updated', color: 'green' });
    } else {
      const created = await api.create({
        provider:     form.provider,
        label:        form.label.trim(),
        scope:        form.scope,
        ...(form.apiKey       ? { apiKey:       form.apiKey       } : {}),
        ...(form.baseUrl      ? { baseUrl:      form.baseUrl      } : {}),
        ...(form.defaultModel ? { defaultModel: form.defaultModel } : {}),
      });
      providers.value.unshift(created);
      toast.add({ title: 'Provider added', color: 'green' });
    }
    showModal.value = false;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    saving.value = false;
  }
}

async function onDelete(p: AIProviderRow): Promise<void> {
  if (!confirm(`Delete "${p.label}"? This cannot be undone.`)) return;
  deleting[p.id] = true;
  try {
    await api.remove(p.id);
    providers.value = providers.value.filter((x) => x.id !== p.id);
    toast.add({ title: 'Provider deleted', color: 'green' });
  } catch (err) {
    toast.add({ title: 'Delete failed', description: (err as Error).message, color: 'red' });
  } finally {
    deleting[p.id] = false;
  }
}

async function onTest(p: AIProviderRow): Promise<void> {
  testing[p.id] = true;
  try {
    testResults[p.id] = await api.testStored(p.id);
  } catch (err) {
    testResults[p.id] = { ok: false, error: (err as Error).message };
  } finally {
    testing[p.id] = false;
  }
}

async function onTestInline(): Promise<void> {
  testingInline.value = true;
  inlineTestResult.value = null;
  try {
    inlineTestResult.value = await api.testInline({
      provider: form.provider,
      ...(form.apiKey ? { apiKey: form.apiKey } : {}),
      ...(form.baseUrl ? { baseUrl: form.baseUrl } : {}),
    });
  } catch (err) {
    inlineTestResult.value = { ok: false, error: (err as Error).message };
  } finally {
    testingInline.value = false;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    [types.value, providers.value] = await Promise.all([api.listTypes(), api.list()]);
  } catch (err) {
    toast.add({ title: 'Failed to load', description: (err as Error).message, color: 'red' });
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>
