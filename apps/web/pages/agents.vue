<template>
  <div class="p-6 max-w-6xl mx-auto">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-display-md font-heading font-bold">Agent Studio</h1>
        <p class="text-text-secondary mt-1">Manage built-in agents and create custom ones.</p>
      </div>
      <UButton icon="i-ph-plus-light" @click="openCreateEditor">New Agent</UButton>
    </div>

    <div v-if="loading" class="text-center py-16 text-text-muted">
      <UIcon name="i-ph-circle-notch-light" class="w-5 h-5 animate-spin mx-auto mb-2" />
      Loading agents...
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="agent in agents"
        :key="agent.id"
        class="border border-border rounded-md p-4 bg-surface-elevated flex items-center gap-4 hover:border-border-strong hover:bg-surface-hover transition-colors"
      >
        <!-- Icon + Name -->
        <div class="flex items-center gap-3 flex-1 min-w-0">
          <div class="w-9 h-9 rounded-md bg-surface flex items-center justify-center flex-shrink-0">
            <UIcon :name="agentIcon(agent)" class="w-5 h-5 text-accent" />
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-semibold font-heading">{{ agent.name }}</span>
              <UBadge v-if="agent.isBuiltIn" size="xs" variant="subtle" color="gray">built-in</UBadge>
              <UBadge v-if="!agent.isActive" size="xs" variant="subtle" color="red">inactive</UBadge>
            </div>
            <p class="text-sm text-text-secondary truncate">{{ agent.description }}</p>
          </div>
        </div>

        <!-- Meta -->
        <div class="hidden md:flex items-center gap-4 text-sm text-text-muted flex-shrink-0">
          <span class="capitalize font-mono text-xs">{{ agent.defaultComplexity }}</span>
          <span class="text-xs">{{ agent.maxSteps }} steps</span>
          <div class="flex gap-1">
            <span
              v-for="mcp in agent.allowedMcpServers.slice(0, 3)"
              :key="mcp"
              class="text-xs bg-surface px-1.5 py-0.5 rounded font-mono"
            >{{ mcp }}</span>
            <span v-if="agent.allowedMcpServers.length > 3" class="text-xs text-text-muted">
              +{{ agent.allowedMcpServers.length - 3 }}
            </span>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-2 flex-shrink-0">
          <UButton
            size="xs"
            variant="ghost"
            icon="i-ph-eye-light"
            @click="openViewEditor(agent)"
          >
            {{ agent.isBuiltIn ? 'View' : 'Edit' }}
          </UButton>
          <UButton
            v-if="!agent.isBuiltIn"
            size="xs"
            variant="ghost"
            color="red"
            icon="i-ph-trash-light"
            @click="deleteAgent(agent.id)"
          />
        </div>
      </div>
    </div>

    <!-- ── Editor slide-over ── -->
    <USlideover v-model="showEditor" :ui="{ width: 'max-w-2xl' }">
      <div class="flex flex-col h-full">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <h2 class="font-heading font-semibold text-lg">
            {{ editingAgent?.isBuiltIn ? 'View Agent' : (editingAgent ? 'Edit Agent' : 'New Agent') }}
          </h2>
          <UButton size="sm" variant="ghost" icon="i-ph-x-light" @click="showEditor = false" />
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <!-- Identity -->
          <section>
            <h3 class="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">Identity</h3>
            <div class="grid grid-cols-2 gap-3">
              <UFormGroup label="Name">
                <UInput v-model="form.name" :disabled="isReadOnly" placeholder="My Agent" />
              </UFormGroup>
              <UFormGroup label="Agent Type">
                <USelect
                  v-model="form.type"
                  :disabled="isReadOnly"
                  :options="agentTypeOptions"
                />
              </UFormGroup>
            </div>
            <UFormGroup label="Description" class="mt-3">
              <UTextarea v-model="form.description" :disabled="isReadOnly" :rows="2" />
            </UFormGroup>
          </section>

          <!-- Model Routing -->
          <section>
            <h3 class="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">Model Routing</h3>
            <div class="grid grid-cols-2 gap-3">
              <UFormGroup label="Default Complexity">
                <USelect
                  v-model="form.defaultComplexity"
                  :disabled="isReadOnly"
                  :options="complexityOptions"
                />
              </UFormGroup>
              <UFormGroup label="Can Escalate To">
                <USelect
                  v-model="form.canEscalateTo"
                  :disabled="isReadOnly"
                  :options="complexityOptions"
                />
              </UFormGroup>
            </div>
            <!-- Model preview -->
            <div class="mt-2 text-xs text-text-muted flex gap-4">
              <span>Default model: <code class="font-mono">{{ modelForComplexity(form.defaultComplexity) }}</code></span>
              <span>Escalation: <code class="font-mono">{{ modelForComplexity(form.canEscalateTo) }}</code></span>
            </div>
          </section>

          <!-- System Prompt -->
          <section>
            <h3 class="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">System Prompt</h3>
            <textarea
              v-model="form.systemPrompt"
              :disabled="isReadOnly"
              class="w-full h-48 bg-surface border border-border rounded-md p-3 text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
              placeholder="You are a ..."
            />
          </section>

          <!-- Rules -->
          <section>
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-sm font-semibold text-text-muted uppercase tracking-wide">Rules</h3>
              <UButton
                v-if="!isReadOnly"
                size="xs"
                variant="ghost"
                icon="i-ph-plus-light"
                @click="addRule"
              >
                Add Rule
              </UButton>
            </div>
            <div class="space-y-2">
              <div v-for="(rule, i) in form.rules" :key="i" class="flex gap-2 items-start">
                <div class="flex-shrink-0 w-5 h-5 rounded bg-surface flex items-center justify-center mt-2 text-xs text-text-muted font-mono">
                  {{ i + 1 }}
                </div>
                <UInput
                  v-model="form.rules[i]"
                  :disabled="isReadOnly"
                  class="flex-1"
                  size="sm"
                />
                <UButton
                  v-if="!isReadOnly"
                  size="xs"
                  variant="ghost"
                  color="red"
                  icon="i-ph-x-light"
                  class="mt-1"
                  @click="removeRule(i)"
                />
              </div>
              <div v-if="form.rules.length === 0" class="text-sm text-text-muted italic">No rules defined.</div>
            </div>
          </section>

          <!-- Skills -->
          <section>
            <h3 class="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">Skills</h3>
            <p class="text-xs text-text-muted mb-3">
              Skills inject specialized knowledge blocks + rules into the agent's system prompt at spawn time.
            </p>
            <div v-if="skillsLoading" class="text-xs text-text-muted">Loading skills...</div>
            <div v-else class="space-y-2">
              <button
                v-for="skill in availableSkills"
                :key="skill.id"
                :disabled="isReadOnly"
                class="w-full text-left p-3 rounded-md border transition-colors"
                :class="isSkillEnabled(skill.id)
                  ? 'border-accent bg-accent/10'
                  : 'border-border hover:border-border-strong hover:bg-surface-hover'"
                @click="toggleSkill(skill)"
              >
                <div class="flex items-center justify-between">
                  <span class="text-sm font-medium" :class="isSkillEnabled(skill.id) ? 'text-accent' : 'text-text-primary'">
                    {{ skill.name }}
                  </span>
                  <span v-if="isSkillEnabled(skill.id)" class="text-xs text-accent">✓ enabled</span>
                </div>
                <p class="text-xs text-text-muted mt-0.5">{{ skill.description }}</p>
                <div v-if="skill.requiredMcpServers.length" class="flex gap-1 mt-1.5">
                  <span
                    v-for="mcp in skill.requiredMcpServers"
                    :key="mcp"
                    class="text-xs bg-surface px-1.5 py-0.5 rounded font-mono text-text-muted"
                  >{{ mcp }}</span>
                </div>
              </button>
            </div>
          </section>

          <!-- MCP Servers -->
          <section>
            <h3 class="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">MCP Servers</h3>
            <div v-if="mcpLoading" class="text-xs text-text-muted">Loading catalog...</div>
            <div v-else class="space-y-4">
              <div v-for="cat in mcpCategories" :key="cat.id">
                <div class="flex items-center gap-2 mb-2">
                  <UIcon :name="cat.icon" class="w-3.5 h-3.5 text-text-muted" />
                  <span class="text-xs font-medium text-text-muted uppercase tracking-wide">{{ cat.label }}</span>
                </div>
                <div class="flex flex-wrap gap-2 pl-5">
                  <button
                    v-for="server in mcpServersByCategory(cat.id)"
                    :key="server.id"
                    :disabled="isReadOnly"
                    :title="server.description"
                    class="px-3 py-1.5 rounded-md border text-sm transition-colors"
                    :class="form.allowedMcpServers.includes(server.id)
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-text-muted hover:border-border-strong hover:bg-surface-hover'"
                    @click="toggleMcp(server.id)"
                  >
                    {{ server.name }}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <!-- Limits -->
          <section>
            <h3 class="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">Limits</h3>
            <div class="grid grid-cols-2 gap-3">
              <UFormGroup label="Max Steps">
                <UInput
                  v-model.number="form.maxSteps"
                  :disabled="isReadOnly"
                  type="number"
                  min="1"
                  max="100"
                />
              </UFormGroup>
              <UFormGroup label="Timeout (minutes)">
                <UInput
                  v-model.number="form.timeoutMinutes"
                  :disabled="isReadOnly"
                  type="number"
                  min="1"
                  max="120"
                />
              </UFormGroup>
            </div>
          </section>
        </div>

        <!-- Footer -->
        <div class="px-6 py-4 border-t border-border flex items-center justify-between flex-shrink-0">
          <div v-if="isReadOnly" class="text-xs text-text-muted">
            Built-in agents cannot be modified.
          </div>
          <div v-else class="flex gap-2 ml-auto">
            <UButton variant="ghost" @click="showEditor = false">Cancel</UButton>
            <UButton
              :loading="saving"
              @click="saveAgent"
            >
              {{ editingAgent ? 'Save Changes' : 'Create Agent' }}
            </UButton>
          </div>
          <UButton v-if="isReadOnly" variant="ghost" @click="showEditor = false">Close</UButton>
        </div>
      </div>
    </USlideover>
  </div>
</template>

<script setup lang="ts">
import { useOrchestratorApi } from '~/composables/useOrchestratorApi';
import type { AgentDefinition, AgentSkill, TaskComplexity, AgentType } from '@agent-orchestrator/shared';

// MCP catalog types (mirrors API response)
interface McpServerEntry { id: string; name: string; description: string; category: string; }
interface McpCategoryEntry { id: string; label: string; icon: string; }

const apiStore = useOrchestratorApi();
const agents = ref<AgentDefinition[]>([]);
const loading = ref(true);
const showEditor = ref(false);
const saving = ref(false);
const editingAgent = ref<AgentDefinition | null>(null);

// ── MCP Catalog ────────────────────────────────────────────────────────────
const mcpServers = ref<McpServerEntry[]>([]);
const mcpCategories = ref<McpCategoryEntry[]>([]);
const mcpLoading = ref(false);

function mcpServersByCategory(categoryId: string) {
  return mcpServers.value.filter((s) => s.category === categoryId);
}

// ── Skills ─────────────────────────────────────────────────────────────────
const availableSkills = ref<AgentSkill[]>([]);
const skillsLoading = ref(false);

onMounted(async () => {
  skillsLoading.value = true;
  mcpLoading.value = true;
  try {
    const [skillRes, mcpRes] = await Promise.all([
      apiStore.listSkills(),
      apiStore.listMcpServers(),
    ]);
    availableSkills.value = skillRes.skills;
    mcpServers.value = mcpRes.servers;
    mcpCategories.value = mcpRes.categories;
  } catch { /* silently ignore */ } finally {
    skillsLoading.value = false;
    mcpLoading.value = false;
  }
});

const MCP_CATALOG = [
  'filesystem', 'shell', 'git', 'browser', 'postgres',
  'github', 'gitlab', 'google-search-console', 'google-analytics',
  'vercel', 'hetzner', 'vault', 'openshift', 'slack', 'jira', 'obsidian',
];

const agentTypeOptions = [
  'orchestrator', 'architect', 'backend', 'frontend',
  'design', 'qa', 'seo', 'infra', 'document',
].map((v) => ({ label: v, value: v }));

const complexityOptions = [
  { label: 'trivial (gpt-4o, free)', value: 'trivial' },
  { label: 'simple (haiku-4-5)', value: 'simple' },
  { label: 'standard (sonnet-4-6)', value: 'standard' },
  { label: 'complex (opus-4-6)', value: 'complex' },
  { label: 'expert (opus-4-7)', value: 'expert' },
];

const MODEL_MAP: Record<string, string> = {
  trivial:  'github-copilot/gpt-4o',
  simple:   'github-copilot/claude-haiku-4-5',
  standard: 'github-copilot/claude-sonnet-4-6',
  complex:  'github-copilot/claude-opus-4-6',
  expert:   'github-copilot/claude-opus-4-7',
};

function modelForComplexity(c: string) {
  return MODEL_MAP[c] ?? c;
}

// ── Form state ─────────────────────────────────────────────────────────────

interface AgentForm {
  name: string;
  description: string;
  type: string;
  defaultComplexity: string;
  canEscalateTo: string;
  systemPrompt: string;
  rules: string[];
  skills: AgentSkill[];
  allowedMcpServers: string[];
  maxSteps: number;
  timeoutMinutes: number;
}

function blankForm(): AgentForm {
  return {
    name: '',
    description: '',
    type: 'backend',
    defaultComplexity: 'standard',
    canEscalateTo: 'complex',
    systemPrompt: '',
    rules: [],
    skills: [],
    allowedMcpServers: ['filesystem', 'git'],
    maxSteps: 20,
    timeoutMinutes: 10,
  };
}

const form = ref<AgentForm>(blankForm());
const isReadOnly = computed(() => editingAgent.value?.isBuiltIn ?? false);

// ── Load ──────────────────────────────────────────────────────────────────

onMounted(async () => {
  try {
    const res = await apiStore.listAgents();
    agents.value = res.agents;
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
});

// ── Open/close editor ──────────────────────────────────────────────────────

function openViewEditor(agent: AgentDefinition) {
  editingAgent.value = agent;
  form.value = {
    name: agent.name,
    description: agent.description,
    type: agent.type,
    defaultComplexity: agent.defaultComplexity,
    canEscalateTo: agent.canEscalateTo,
    systemPrompt: agent.systemPrompt,
    rules: [...agent.rules],
    skills: [...(agent.skills ?? [])],
    allowedMcpServers: [...agent.allowedMcpServers],
    maxSteps: agent.maxSteps,
    timeoutMinutes: agent.timeoutMinutes,
  };
  showEditor.value = true;
}

function openCreateEditor() {
  editingAgent.value = null;
  form.value = blankForm();
  showEditor.value = true;
}

// ── Skills toggle ───────────────────────────────────────────────────────────

function isSkillEnabled(skillId: string): boolean {
  return form.value.skills.some((s) => s.id === skillId);
}

function toggleSkill(skill: AgentSkill) {
  if (isReadOnly.value) return;
  const idx = form.value.skills.findIndex((s) => s.id === skill.id);
  if (idx >= 0) {
    form.value.skills.splice(idx, 1);
    // Remove skill's MCP servers if no other skill needs them
    for (const mcp of skill.requiredMcpServers) {
      const stillNeeded = form.value.skills.some((s) => s.requiredMcpServers.includes(mcp));
      if (!stillNeeded) {
        const mcpIdx = form.value.allowedMcpServers.indexOf(mcp);
        if (mcpIdx >= 0) form.value.allowedMcpServers.splice(mcpIdx, 1);
      }
    }
  } else {
    form.value.skills.push(skill);
    // Auto-add required MCP servers
    for (const mcp of skill.requiredMcpServers) {
      if (!form.value.allowedMcpServers.includes(mcp)) {
        form.value.allowedMcpServers.push(mcp);
      }
    }
  }
}

// ── Rules CRUD ──────────────────────────────────────────────────────────────

function addRule() { form.value.rules.push(''); }
function removeRule(i: number) { form.value.rules.splice(i, 1); }

// ── MCP toggle ─────────────────────────────────────────────────────────────

function toggleMcp(mcp: string) {
  if (isReadOnly.value) return;
  const idx = form.value.allowedMcpServers.indexOf(mcp);
  if (idx >= 0) {
    form.value.allowedMcpServers.splice(idx, 1);
  } else {
    form.value.allowedMcpServers.push(mcp);
  }
}

// ── Save ───────────────────────────────────────────────────────────────────

async function saveAgent() {
  saving.value = true;
  try {
    const payload = {
      name: form.value.name,
      description: form.value.description,
      type: form.value.type as AgentType,
      defaultComplexity: form.value.defaultComplexity as TaskComplexity,
      canEscalateTo: form.value.canEscalateTo as TaskComplexity,
      systemPrompt: form.value.systemPrompt,
      rules: form.value.rules.filter(Boolean),
      skills: form.value.skills,
      allowedMcpServers: form.value.allowedMcpServers,
      maxSteps: form.value.maxSteps,
      timeoutMinutes: form.value.timeoutMinutes,
    };

    if (editingAgent.value) {
      const updated = await apiStore.updateAgent(editingAgent.value.id, payload);
      const idx = agents.value.findIndex((a) => a.id === editingAgent.value!.id);
      if (idx >= 0) agents.value[idx] = updated;
    } else {
      const created = await apiStore.createAgent(payload);
      agents.value.push(created);
    }

    showEditor.value = false;
  } catch (e) {
    console.error('Save failed:', e);
  } finally {
    saving.value = false;
  }
}

// ── Delete ─────────────────────────────────────────────────────────────────

async function deleteAgent(id: string) {
  if (!confirm('Delete this agent? This cannot be undone.')) return;
  // Optimistic remove
  agents.value = agents.value.filter((a) => a.id !== id);
  try {
    await fetch(`${useRuntimeConfig().public.apiBase}/api/agents/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Delete failed:', e);
    // Restore on failure
    const res = await apiStore.listAgents();
    agents.value = res.agents;
  }
}

// ── Icon helper ────────────────────────────────────────────────────────────

function agentIcon(agent: AgentDefinition) {
  const map: Record<string, string> = {
    orchestrator: 'i-ph-git-branch-light',
    architect:    'i-ph-stack-light',
    backend:      'i-ph-hard-drives-light',
    frontend:     'i-ph-squares-four-light',
    design:       'i-ph-palette-light',
    qa:           'i-ph-shield-check-light',
    seo:          'i-ph-magnifying-glass-light',
    infra:        'i-ph-cloud-light',
    document:     'i-ph-file-text-light',
  };
  return map[agent.type] ?? 'i-ph-robot-light';
}
</script>
