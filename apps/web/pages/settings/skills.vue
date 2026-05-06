<template>
  <div class="p-6 max-w-5xl">
    <div class="flex items-start justify-between mb-2">
      <div>
        <h1 class="text-display-md font-heading font-bold mb-2">Skills</h1>
        <p class="text-text-secondary">
          Reusable knowledge blocks injected into agent system prompts. Built-in
          skills ship with the app and can be referenced by any agent. You can
          also define custom skills per organization.
        </p>
      </div>
      <UButton icon="i-ph-plus-light" @click="openAddModal()">Add custom skill</UButton>
    </div>

    <section class="mt-8">
      <div v-if="loading" class="flex items-center gap-2 text-sm text-text-muted">
        <UIcon name="i-ph-circle-notch-light" class="w-4 h-4 animate-spin" />
        Loading skills...
      </div>
      <div v-else>
        <div v-for="group in groupedSkills" :key="group.label" class="mb-8">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-text-muted mb-3">
            {{ group.label }} <span class="text-text-muted font-normal">({{ group.items.length }})</span>
          </h2>
          <ul class="space-y-2">
            <li
              v-for="s in group.items"
              :key="s.id"
              class="border border-border rounded-md p-4 bg-surface-elevated"
            >
              <div class="flex items-start justify-between gap-4">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 mb-1">
                    <UIcon name="i-ph-brain-light" class="w-4 h-4" />
                    <span class="font-semibold">{{ s.name }}</span>
                    <code class="text-xs text-text-muted">{{ s.id }}</code>
                    <UBadge v-if="s.isBuiltIn" color="gray" variant="subtle" size="xs">built-in</UBadge>
                    <UBadge v-else color="blue" variant="subtle" size="xs">custom</UBadge>
                    <UBadge v-if="!s.isBuiltIn && s.enabled === false" color="gray" variant="subtle" size="xs">disabled</UBadge>
                  </div>
                  <p v-if="s.description" class="text-sm text-text-secondary mb-2">{{ s.description }}</p>
                  <div class="flex flex-wrap gap-3 text-xs text-text-muted">
                    <span><b>{{ s.rules.length }}</b> rules</span>
                    <span><b>{{ s.requiredMcpServers.length }}</b> MCP servers</span>
                    <span><b>{{ s.knowledgeBlock.length }}</b> chars knowledge</span>
                  </div>
                </div>
                <div class="flex items-center gap-1">
                  <UButton size="xs" variant="ghost" icon="i-ph-eye-light" @click="openViewModal(s)">View</UButton>
                  <template v-if="!s.isBuiltIn">
                    <UButton size="xs" variant="ghost" icon="i-ph-pencil-simple-light" @click="openEditModal(s)">Edit</UButton>
                    <UButton size="xs" variant="ghost" color="red" icon="i-ph-trash-light" :loading="deleting[s.dbId!]" @click="onDelete(s)">Delete</UButton>
                  </template>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- View modal — read-only, also used for built-ins -->
    <UModal v-model="showViewModal" :ui="{ width: 'sm:max-w-3xl' }">
      <UCard v-if="viewing">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-ph-brain-light" class="w-5 h-5" />
            <p class="font-semibold">{{ viewing.name }}</p>
            <code class="text-xs text-text-muted">{{ viewing.id }}</code>
            <UBadge :color="viewing.isBuiltIn ? 'gray' : 'blue'" variant="subtle" size="xs">
              {{ viewing.isBuiltIn ? 'built-in' : 'custom' }}
            </UBadge>
          </div>
        </template>
        <div class="space-y-4 text-sm">
          <div>
            <p class="font-semibold mb-1">Description</p>
            <p class="text-text-secondary">{{ viewing.description || '—' }}</p>
          </div>
          <div>
            <p class="font-semibold mb-1">Knowledge block</p>
            <pre class="bg-surface text-xs p-3 rounded border border-border overflow-x-auto whitespace-pre-wrap font-mono">{{ viewing.knowledgeBlock }}</pre>
          </div>
          <div>
            <p class="font-semibold mb-1">Rules ({{ viewing.rules.length }})</p>
            <ul class="list-disc pl-5 space-y-1 text-text-secondary">
              <li v-for="(r, i) in viewing.rules" :key="i">{{ r }}</li>
              <li v-if="viewing.rules.length === 0" class="list-none text-text-muted">No rules</li>
            </ul>
          </div>
          <div>
            <p class="font-semibold mb-1">Required MCP servers ({{ viewing.requiredMcpServers.length }})</p>
            <div class="flex flex-wrap gap-1">
              <UBadge v-for="m in viewing.requiredMcpServers" :key="m" variant="subtle" size="xs">{{ m }}</UBadge>
              <span v-if="viewing.requiredMcpServers.length === 0" class="text-text-muted text-xs">None</span>
            </div>
          </div>
        </div>
      </UCard>
    </UModal>

    <!-- Add / Edit modal -->
    <UModal v-model="showEditModal" :ui="{ width: 'sm:max-w-3xl' }">
      <UCard>
        <template #header>
          <p class="font-semibold">{{ editing ? `Edit "${editing.name}"` : 'Add custom skill' }}</p>
        </template>

        <form class="space-y-4" @submit.prevent="onSave">
          <UFormGroup label="Slug" required hint="URL-safe id. Final id will be `skill:<slug>`.">
            <UInput v-model="form.slug" :disabled="!!editing" placeholder="react-19-rsc" font-mono />
          </UFormGroup>

          <UFormGroup label="Name" required>
            <UInput v-model="form.name" placeholder="React 19 RSC" />
          </UFormGroup>

          <UFormGroup label="Description" hint="One-line summary shown in lists.">
            <UInput v-model="form.description" placeholder="React Server Components patterns for Next 15+" />
          </UFormGroup>

          <UFormGroup label="Knowledge block" required hint="Markdown. Injected into agent system prompts as `## Skill: <name>`.">
            <UTextarea v-model="form.knowledgeBlock" :rows="10" placeholder="### Heading&#10;&#10;Detailed knowledge..." class="font-mono text-xs" />
          </UFormGroup>

          <UFormGroup label="Rules" hint="One rule per line. Merged with the agent's built-in rules.">
            <UTextarea v-model="rulesText" :rows="4" placeholder="Default to Server Components&#10;Use Suspense for streaming" />
          </UFormGroup>

          <UFormGroup label="Required MCP servers" hint="Comma-separated MCP server ids that this skill needs available.">
            <UInput v-model="mcpText" placeholder="filesystem, bash" />
          </UFormGroup>

          <p v-if="error" class="text-sm text-failed">{{ error }}</p>
        </form>

        <template #footer>
          <div class="flex justify-end gap-3">
            <UButton variant="ghost" @click="showEditModal = false">Cancel</UButton>
            <UButton
              :loading="saving"
              :disabled="!form.slug.trim() || !form.name.trim() || form.knowledgeBlock.length < 10"
              @click="onSave"
            >
              {{ editing ? 'Save' : 'Add skill' }}
            </UButton>
          </div>
        </template>
      </UCard>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import type { SkillEntry } from '~/composables/useSkills';

definePageMeta({ layout: 'default' });

const api = useSkills();
const toast = useToast();

const skills = ref<SkillEntry[]>([]);
const loading = ref(true);
const deleting = reactive<Record<string, boolean>>({});

const showViewModal = ref(false);
const viewing = ref<SkillEntry | null>(null);

const showEditModal = ref(false);
const editing = ref<SkillEntry | null>(null);
const saving = ref(false);
const error = ref('');

const form = reactive({
  slug:           '',
  name:           '',
  description:    '',
  knowledgeBlock: '',
});
const rulesText = ref('');
const mcpText = ref('');

const groupedSkills = computed(() => {
  const custom  = skills.value.filter((s) => !s.isBuiltIn);
  const builtIn = skills.value.filter((s) => s.isBuiltIn);
  const groups: { label: string; items: SkillEntry[] }[] = [];
  if (custom.length > 0) groups.push({ label: 'Custom (this org)', items: custom });
  groups.push({ label: 'Built-in', items: builtIn });
  return groups;
});

function resetForm(): void {
  form.slug = '';
  form.name = '';
  form.description = '';
  form.knowledgeBlock = '';
  rulesText.value = '';
  mcpText.value = '';
  error.value = '';
}

function openAddModal(): void {
  editing.value = null;
  resetForm();
  showEditModal.value = true;
}

function openEditModal(s: SkillEntry): void {
  editing.value = s;
  // strip the "skill:" prefix to show just the slug part
  form.slug = s.id.replace(/^skill:/, '');
  form.name = s.name;
  form.description = s.description ?? '';
  form.knowledgeBlock = s.knowledgeBlock;
  rulesText.value = s.rules.join('\n');
  mcpText.value = s.requiredMcpServers.join(', ');
  error.value = '';
  showEditModal.value = true;
}

function openViewModal(s: SkillEntry): void {
  viewing.value = s;
  showViewModal.value = true;
}

function parseRules(): string[] {
  return rulesText.value.split('\n').map((r) => r.trim()).filter((r) => r.length > 0);
}
function parseMcp(): string[] {
  return mcpText.value.split(',').map((m) => m.trim()).filter((m) => m.length > 0);
}

async function onSave(): Promise<void> {
  saving.value = true;
  error.value = '';
  try {
    if (editing.value) {
      const updated = await api.update(editing.value.dbId!, {
        name:               form.name.trim(),
        description:        form.description.trim(),
        knowledgeBlock:     form.knowledgeBlock,
        rules:              parseRules(),
        requiredMcpServers: parseMcp(),
      });
      const idx = skills.value.findIndex((x) => x.id === updated.id);
      if (idx >= 0) skills.value[idx] = updated;
      toast.add({ title: 'Skill updated', color: 'green' });
    } else {
      const created = await api.create({
        slug:               form.slug.trim(),
        name:               form.name.trim(),
        description:        form.description.trim(),
        knowledgeBlock:     form.knowledgeBlock,
        rules:              parseRules(),
        requiredMcpServers: parseMcp(),
      });
      skills.value.unshift(created);
      toast.add({ title: 'Skill created', color: 'green' });
    }
    showEditModal.value = false;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    saving.value = false;
  }
}

async function onDelete(s: SkillEntry): Promise<void> {
  if (!s.dbId) return;
  if (!confirm(`Delete custom skill "${s.name}"? This cannot be undone.`)) return;
  deleting[s.dbId] = true;
  try {
    await api.remove(s.dbId);
    skills.value = skills.value.filter((x) => x.id !== s.id);
    toast.add({ title: 'Skill deleted', color: 'green' });
  } catch (err) {
    toast.add({ title: 'Delete failed', description: (err as Error).message, color: 'red' });
  } finally {
    deleting[s.dbId] = false;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    skills.value = await api.list();
  } catch (err) {
    toast.add({ title: 'Failed to load skills', description: (err as Error).message, color: 'red' });
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>
