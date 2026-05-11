<template>
  <div class="p-6 max-w-6xl">
    <div class="flex items-start justify-between mb-2 gap-4">
      <div>
        <h1 class="text-display-md font-heading font-bold mb-2">Skills</h1>
        <p class="text-text-secondary">
          Reusable knowledge blocks injected into agent system prompts. Pick from
          {{ builtInCount }} built-in skills or create your own custom ones.
          Built-ins can be forked as a starting point.
        </p>
      </div>
      <UButton icon="i-ph-plus-light" @click="openAddModal()">Add custom skill</UButton>
    </div>

    <!-- Filters bar -->
    <div class="mt-6 flex flex-wrap items-center gap-2 mb-6">
      <UInput
        v-model="searchQuery"
        placeholder="Search skills..."
        icon="i-ph-magnifying-glass-light"
        size="sm"
        class="flex-1 min-w-[240px] max-w-md"
      />
      <button
        class="px-3 py-1 text-xs rounded-full border transition"
        :class="categoryFilter === null
          ? 'bg-accent text-white border-accent'
          : 'border-border text-text-secondary hover:bg-surface'"
        @click="categoryFilter = null"
      >
        All <span class="opacity-60">({{ skills.length }})</span>
      </button>
      <button
        v-for="cat in categories"
        :key="cat"
        class="px-3 py-1 text-xs rounded-full border transition capitalize flex items-center gap-1"
        :class="categoryFilter === cat
          ? 'bg-accent text-white border-accent'
          : 'border-border text-text-secondary hover:bg-surface'"
        @click="categoryFilter = cat"
      >
        <UIcon :name="categoryIcon(cat)" class="w-3 h-3" />
        {{ categoryLabel(cat) }}
        <span class="opacity-60">({{ countByCategory(cat) }})</span>
      </button>
    </div>

    <section>
      <div v-if="loading" class="flex items-center gap-2 text-sm text-text-muted">
        <UIcon name="i-ph-circle-notch-light" class="w-4 h-4 animate-spin" />
        Loading skills...
      </div>
      <EmptyState
        v-else-if="filteredSkills.length === 0"
        icon="i-ph-funnel-light"
        title="No skills match the current filter"
        description="Try clearing the search or selecting a different category."
        size="sm"
      />
      <div v-else>
        <div v-for="group in groupedSkills" :key="group.label" class="mb-8">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-text-muted mb-3 flex items-center gap-2">
            <UIcon :name="group.icon" class="w-4 h-4" />
            {{ group.label }}
            <span class="text-text-muted font-normal">({{ group.items.length }})</span>
          </h2>
          <ul class="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <li
              v-for="s in group.items"
              :key="s.id"
              class="border border-border rounded-md p-4 bg-surface-elevated hover:border-accent/50 transition group"
            >
              <div class="flex items-start gap-3">
                <UIcon
                  :name="s.icon || 'i-ph-lightbulb-light'"
                  class="w-5 h-5 mt-0.5 text-accent shrink-0"
                />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap mb-1">
                    <span class="font-semibold truncate">{{ s.name }}</span>
                    <UBadge v-if="s.isBuiltIn" color="gray" variant="subtle" size="xs">built-in</UBadge>
                    <UBadge v-else color="blue" variant="subtle" size="xs">custom</UBadge>
                    <UBadge v-if="s.category" variant="subtle" size="xs" class="capitalize">{{ categoryLabel(s.category) }}</UBadge>
                    <UBadge v-if="!s.isBuiltIn && s.enabled === false" color="orange" variant="subtle" size="xs">disabled</UBadge>
                  </div>
                  <p v-if="s.description" class="text-sm text-text-secondary line-clamp-2 mb-2">
                    {{ s.description }}
                  </p>
                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                    <span><b>{{ s.rules.length }}</b> rules</span>
                    <span><b>{{ s.requiredMcpServers.length }}</b> MCP</span>
                    <span><b>{{ Math.round(s.knowledgeBlock.length / 100) / 10 }}k</b> chars</span>
                  </div>
                </div>
              </div>

              <!-- Actions -->
              <div class="mt-3 pt-3 border-t border-border flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                <UButton size="xs" variant="ghost" icon="i-ph-eye-light" @click="openViewModal(s)">View</UButton>
                <UButton
                  v-if="s.isBuiltIn"
                  size="xs"
                  variant="ghost"
                  icon="i-ph-git-fork-light"
                  @click="openForkModal(s)"
                >
                  Fork
                </UButton>
                <template v-else>
                  <UButton size="xs" variant="ghost" icon="i-ph-pencil-simple-light" @click="openEditModal(s)">Edit</UButton>
                  <UButton size="xs" variant="ghost" color="red" icon="i-ph-trash-light" :loading="deleting[s.dbId!]" @click="onDelete(s)">Delete</UButton>
                </template>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- View modal — read-only -->
    <UModal v-model="showViewModal" :ui="{ width: 'sm:max-w-3xl' }">
      <UCard v-if="viewing">
        <template #header>
          <div class="flex items-center gap-2 flex-wrap">
            <UIcon :name="viewing.icon || 'i-ph-lightbulb-light'" class="w-5 h-5" />
            <p class="font-semibold">{{ viewing.name }}</p>
            <code class="text-xs text-text-muted">{{ viewing.id }}</code>
            <UBadge :color="viewing.isBuiltIn ? 'gray' : 'blue'" variant="subtle" size="xs">
              {{ viewing.isBuiltIn ? 'built-in' : 'custom' }}
            </UBadge>
            <UBadge v-if="viewing.category" variant="subtle" size="xs" class="capitalize">
              {{ categoryLabel(viewing.category) }}
            </UBadge>
          </div>
        </template>
        <div class="space-y-4 text-sm">
          <div v-if="viewing.description">
            <p class="font-semibold mb-1">Description</p>
            <p class="text-text-secondary">{{ viewing.description }}</p>
          </div>
          <div>
            <p class="font-semibold mb-1">Knowledge block</p>
            <div
              class="prose prose-sm dark:prose-invert max-w-none bg-surface p-4 rounded border border-border max-h-96 overflow-y-auto"
              v-html="renderMarkdown(viewing.knowledgeBlock)"
            />
          </div>
          <div>
            <p class="font-semibold mb-1">Rules ({{ viewing.rules.length }})</p>
            <ul class="list-disc pl-5 space-y-1 text-text-secondary">
              <li v-for="(r, i) in viewing.rules" :key="i">{{ r }}</li>
              <li v-if="viewing.rules.length === 0" class="list-none text-text-muted italic">No rules</li>
            </ul>
          </div>
          <div>
            <p class="font-semibold mb-1">Required MCP servers ({{ viewing.requiredMcpServers.length }})</p>
            <div class="flex flex-wrap gap-1">
              <UBadge v-for="m in viewing.requiredMcpServers" :key="m" variant="subtle" size="xs">{{ m }}</UBadge>
              <span v-if="viewing.requiredMcpServers.length === 0" class="text-text-muted text-xs italic">None</span>
            </div>
          </div>
        </div>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              v-if="viewing.isBuiltIn"
              icon="i-ph-git-fork-light"
              variant="soft"
              @click="openForkModal(viewing); showViewModal = false"
            >
              Fork as custom skill
            </UButton>
            <UButton variant="ghost" @click="showViewModal = false">Close</UButton>
          </div>
        </template>
      </UCard>
    </UModal>

    <!-- Add / Edit / Fork modal -->
    <UModal v-model="showEditModal" :ui="{ width: 'sm:max-w-5xl' }">
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon :name="form.icon || 'i-ph-lightbulb-light'" class="w-5 h-5" />
            <p class="font-semibold">
              <template v-if="editing">Edit "{{ editing.name }}"</template>
              <template v-else-if="forkingFrom">Fork "{{ forkingFrom.name }}"</template>
              <template v-else>Add custom skill</template>
            </p>
          </div>
        </template>

        <form class="space-y-4" @submit.prevent="onSave">
          <!-- Top row: slug + icon + category -->
          <div class="grid grid-cols-1 md:grid-cols-12 gap-3">
            <UFormGroup label="Slug" required hint="Final id: skill:<slug>" class="md:col-span-5">
              <UInput v-model="form.slug" :disabled="!!editing" placeholder="react-19-rsc" class="font-mono" />
            </UFormGroup>
            <UFormGroup label="Category" class="md:col-span-4">
              <USelect
                v-model="form.category"
                :options="categoryOptions"
                placeholder="Pick category"
              />
            </UFormGroup>
            <UFormGroup label="Icon" class="md:col-span-3">
              <IconPicker v-model="form.icon" />
            </UFormGroup>
          </div>

          <UFormGroup label="Name" required>
            <UInput v-model="form.name" placeholder="React 19 RSC" />
          </UFormGroup>

          <UFormGroup label="Description" hint="One-line summary shown in lists.">
            <UInput v-model="form.description" placeholder="React Server Components patterns for Next 15+" />
          </UFormGroup>

          <!-- Knowledge block: editor + live MD preview side by side -->
          <UFormGroup label="Knowledge block" required hint="Markdown — injected into agent system prompts.">
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <div class="text-xs text-text-muted mb-1 flex items-center justify-between">
                  <span>Editor</span>
                  <span>{{ form.knowledgeBlock.length }} chars</span>
                </div>
                <UTextarea
                  v-model="form.knowledgeBlock"
                  :rows="16"
                  placeholder="### Heading&#10;&#10;Detailed knowledge..."
                  class="font-mono text-xs"
                />
              </div>
              <div>
                <div class="text-xs text-text-muted mb-1">Preview</div>
                <div
                  class="prose prose-sm dark:prose-invert max-w-none bg-surface p-3 rounded border border-border h-[26rem] overflow-y-auto"
                  v-html="renderMarkdown(form.knowledgeBlock || '_Start typing to see preview..._')"
                />
              </div>
            </div>
          </UFormGroup>

          <UFormGroup label="Rules" hint="One rule per line. Merged with the agent's built-in rules.">
            <UTextarea
              v-model="rulesText"
              :rows="4"
              placeholder="Default to Server Components&#10;Use Suspense for streaming"
            />
          </UFormGroup>

          <!-- MCP multi-select -->
          <UFormGroup label="Required MCP servers" hint="Servers that must be available when an agent uses this skill.">
            <div v-if="loadingMcp" class="text-xs text-text-muted">Loading MCP servers...</div>
            <div v-else-if="mcpServers.length === 0" class="text-xs text-text-muted italic">
              No MCP servers registered.
            </div>
            <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto border border-border rounded p-2 bg-surface">
              <label
                v-for="server in mcpServers"
                :key="server.id"
                class="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-surface-elevated cursor-pointer"
              >
                <input
                  type="checkbox"
                  :checked="form.requiredMcpServers.includes(server.id)"
                  class="mt-0.5"
                  @change="toggleMcpServer(server.id)"
                >
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-medium truncate">{{ server.name }}</div>
                  <div class="text-xs text-text-muted truncate">{{ server.description }}</div>
                </div>
              </label>
            </div>
            <div v-if="form.requiredMcpServers.length > 0" class="mt-2 flex flex-wrap gap-1">
              <UBadge v-for="m in form.requiredMcpServers" :key="m" variant="subtle" size="xs">{{ m }}</UBadge>
            </div>
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
              {{ editing ? 'Save' : forkingFrom ? 'Create fork' : 'Add skill' }}
            </UButton>
          </div>
        </template>
      </UCard>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import type { SkillCategory, SkillEntry } from '~/composables/useSkills';

definePageMeta({ layout: 'default' });

const api = useSkills();
const orchestratorApi = useOrchestratorApi();
const { renderMarkdown } = useMarkdown();
const toast = useToast();

const skills = ref<SkillEntry[]>([]);
const categories = ref<readonly SkillCategory[]>([]);
const loading = ref(true);
const deleting = reactive<Record<string, boolean>>({});

// Filters
const searchQuery = ref('');
const categoryFilter = ref<SkillCategory | null>(null);

// MCP servers list (for multi-select)
const mcpServers = ref<Array<{ id: string; name: string; description: string }>>([]);
const loadingMcp = ref(false);

// View modal
const showViewModal = ref(false);
const viewing = ref<SkillEntry | null>(null);

// Edit modal (handles add, edit, fork)
const showEditModal = ref(false);
const editing = ref<SkillEntry | null>(null);
const forkingFrom = ref<SkillEntry | null>(null);
const saving = ref(false);
const error = ref('');

const form = reactive<{
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: SkillCategory | '';
  knowledgeBlock: string;
  requiredMcpServers: string[];
}>({
  slug: '',
  name: '',
  description: '',
  icon: '',
  category: '',
  knowledgeBlock: '',
  requiredMcpServers: [],
});
const rulesText = ref('');

const builtInCount = computed(() => skills.value.filter((s) => s.isBuiltIn).length);

const categoryOptions = computed(() => [
  { label: '— None —', value: '' },
  ...categories.value.map((c) => ({ label: categoryLabel(c), value: c })),
]);

// ── Filtering / grouping ─────────────────────────────────────────────────
const filteredSkills = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return skills.value.filter((s) => {
    if (categoryFilter.value && s.category !== categoryFilter.value) return false;
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    );
  });
});

const groupedSkills = computed(() => {
  const custom = filteredSkills.value.filter((s) => !s.isBuiltIn);
  const builtIn = filteredSkills.value.filter((s) => s.isBuiltIn);
  const groups: Array<{ label: string; icon: string; items: SkillEntry[] }> = [];
  if (custom.length > 0) groups.push({ label: 'Custom (this org)', icon: 'i-ph-user-light', items: custom });
  if (builtIn.length > 0) groups.push({ label: 'Built-in', icon: 'i-ph-package-light', items: builtIn });
  return groups;
});

function countByCategory(cat: SkillCategory): number {
  return skills.value.filter((s) => s.category === cat).length;
}

function categoryLabel(cat: SkillCategory): string {
  const map: Record<SkillCategory, string> = {
    'frontend':  'Frontend',
    'backend':   'Backend',
    'database':  'Database',
    'devops':    'DevOps',
    'testing':   'Testing',
    'security':  'Security',
    'ai-llm':    'AI / LLM',
    'seo':       'SEO',
    'tooling':   'Tooling',
    'other':     'Other',
  };
  return map[cat] ?? cat;
}

function categoryIcon(cat: SkillCategory): string {
  const map: Record<SkillCategory, string> = {
    'frontend':  'i-ph-paint-brush-light',
    'backend':   'i-ph-lightning-light',
    'database':  'i-ph-database-light',
    'devops':    'i-ph-cube-light',
    'testing':   'i-ph-test-tube-light',
    'security':  'i-ph-shield-check-light',
    'ai-llm':    'i-ph-brain-light',
    'seo':       'i-ph-magnifying-glass-light',
    'tooling':   'i-ph-wrench-light',
    'other':     'i-ph-tag-light',
  };
  return map[cat] ?? 'i-ph-tag-light';
}

// ── Form helpers ──────────────────────────────────────────────────────────
function resetForm(): void {
  form.slug = '';
  form.name = '';
  form.description = '';
  form.icon = '';
  form.category = '';
  form.knowledgeBlock = '';
  form.requiredMcpServers = [];
  rulesText.value = '';
  error.value = '';
}

function openAddModal(): void {
  editing.value = null;
  forkingFrom.value = null;
  resetForm();
  showEditModal.value = true;
}

function openEditModal(s: SkillEntry): void {
  editing.value = s;
  forkingFrom.value = null;
  form.slug = s.id.replace(/^skill:/, '');
  form.name = s.name;
  form.description = s.description ?? '';
  form.icon = s.icon ?? '';
  form.category = s.category ?? '';
  form.knowledgeBlock = s.knowledgeBlock;
  form.requiredMcpServers = [...s.requiredMcpServers];
  rulesText.value = s.rules.join('\n');
  error.value = '';
  showEditModal.value = true;
}

function openForkModal(s: SkillEntry): void {
  editing.value = null;
  forkingFrom.value = s;
  // Pre-fill with built-in content but clear slug so user picks a fresh one
  form.slug = '';
  form.name = `${s.name} (custom)`;
  form.description = s.description ?? '';
  form.icon = s.icon ?? '';
  form.category = s.category ?? '';
  form.knowledgeBlock = s.knowledgeBlock;
  form.requiredMcpServers = [...s.requiredMcpServers];
  rulesText.value = s.rules.join('\n');
  error.value = '';
  showEditModal.value = true;
}

function openViewModal(s: SkillEntry): void {
  viewing.value = s;
  showViewModal.value = true;
}

function toggleMcpServer(id: string): void {
  const idx = form.requiredMcpServers.indexOf(id);
  if (idx >= 0) form.requiredMcpServers.splice(idx, 1);
  else form.requiredMcpServers.push(id);
}

function parseRules(): string[] {
  return rulesText.value.split('\n').map((r) => r.trim()).filter((r) => r.length > 0);
}

async function onSave(): Promise<void> {
  saving.value = true;
  error.value = '';
  try {
    const category = form.category === '' ? undefined : form.category;
    const icon = form.icon || undefined;

    if (editing.value) {
      const updated = await api.update(editing.value.dbId!, {
        name:               form.name.trim(),
        description:        form.description.trim(),
        icon:               form.icon || null,
        category:           category ?? null,
        knowledgeBlock:     form.knowledgeBlock,
        rules:              parseRules(),
        requiredMcpServers: form.requiredMcpServers,
      });
      const idx = skills.value.findIndex((x) => x.id === updated.id);
      if (idx >= 0) skills.value[idx] = updated;
      toast.add({ title: 'Skill updated', color: 'green' });
    } else {
      const created = await api.create({
        slug:               form.slug.trim(),
        name:               form.name.trim(),
        description:        form.description.trim(),
        ...(icon     ? { icon }     : {}),
        ...(category ? { category } : {}),
        knowledgeBlock:     form.knowledgeBlock,
        rules:              parseRules(),
        requiredMcpServers: form.requiredMcpServers,
      });
      // Replace built-in if same id (custom shadows built-in); otherwise prepend
      const sameIdIdx = skills.value.findIndex((x) => x.id === created.id);
      if (sameIdIdx >= 0) skills.value[sameIdIdx] = created;
      else skills.value.unshift(created);
      toast.add({ title: forkingFrom.value ? 'Skill forked' : 'Skill created', color: 'green' });
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
    // After deleting a custom skill, the built-in (if any) reappears — reload
    await load();
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
    const data = await api.list();
    skills.value = data.skills;
    categories.value = data.categories;
  } catch (err) {
    toast.add({ title: 'Failed to load skills', description: (err as Error).message, color: 'red' });
  } finally {
    loading.value = false;
  }
}

async function loadMcp(): Promise<void> {
  loadingMcp.value = true;
  try {
    const data = await orchestratorApi.listMcpServers();
    mcpServers.value = data.servers;
  } catch (err) {
    console.error('[skills] failed to load MCP servers:', err);
  } finally {
    loadingMcp.value = false;
  }
}

onMounted(() => {
  void load();
  void loadMcp();
});
</script>
