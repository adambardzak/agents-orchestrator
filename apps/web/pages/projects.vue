<template>
  <div class="p-6 max-w-5xl mx-auto">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-heading font-semibold">Projects</h1>
        <p class="text-sm text-text-secondary mt-0.5">Manage workspaces and associated agent sessions.</p>
      </div>
      <UButton icon="i-ph-plus-light" size="sm" @click="showNewProjectModal = true">
        New Project
      </UButton>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="n in 3"
        :key="n"
        class="h-44 rounded-md bg-surface-elevated border border-border animate-pulse"
      />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="projects.length === 0"
      class="flex flex-col items-center justify-center py-24 text-center"
    >
      <span class="text-5xl mb-4">📁</span>
      <p class="font-semibold text-lg mb-1">No projects yet</p>
      <p class="text-sm text-text-secondary mb-6">Create your first project to link a workspace directory.</p>
      <UButton icon="i-ph-plus-light" @click="showNewProjectModal = true">New Project</UButton>
    </div>

    <!-- Project grid -->
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="project in projects"
        :key="project.id"
        class="group relative flex flex-col gap-3 rounded-md border border-border bg-surface-elevated p-5
               hover:border-border-strong hover:bg-surface-hover transition-colors cursor-pointer"
        :class="{ 'ring-1 ring-accent border-accent/40': projectStore.activeProject?.id === project.id }"
        @click="projectStore.setActiveProject(project)"
      >
        <!-- Active badge -->
        <UBadge
          v-if="projectStore.activeProject?.id === project.id"
          color="primary"
          variant="subtle"
          size="xs"
          class="absolute top-3 right-3"
        >
          Active
        </UBadge>

        <!-- Name + context type -->
        <div class="pr-12">
          <p class="font-semibold text-text-primary truncate">{{ project.name }}</p>
          <p v-if="project.description" class="text-xs text-text-secondary mt-0.5 line-clamp-2">
            {{ project.description }}
          </p>
        </div>

        <!-- Workspace path (monospace, truncated) -->
        <p
          class="text-xs font-mono text-text-muted bg-surface rounded px-2 py-1 truncate"
          :title="project.workspacePath"
        >
          {{ project.workspacePath }}
        </p>

        <!-- Stats row -->
        <div class="flex items-center gap-4 text-xs text-text-secondary">
          <span class="flex items-center gap-1">
            <UIcon name="i-ph-stack-light" class="w-3 h-3" />
            {{ project.sessionCount ?? 0 }} session{{ project.sessionCount !== 1 ? 's' : '' }}
          </span>
          <span class="flex items-center gap-1">
            <UIcon name="i-ph-currency-dollar-light" class="w-3 h-3" />
            ${{ (project.totalCostUsd ?? 0).toFixed(3) }}
          </span>
          <span
            v-if="project.contextType !== 'personal'"
            class="ml-auto px-1.5 py-0.5 rounded bg-accent/10 text-accent uppercase tracking-wide font-semibold"
          >
            {{ project.contextType }}
          </span>
        </div>

        <!-- Action row -->
        <div class="flex items-center gap-2 mt-auto pt-1 border-t border-border">
          <UButton
            size="xs"
            variant="ghost"
            icon="i-ph-folder-open-light"
            :to="`/files?project=${project.id}`"
            @click.stop
          >
            Files
          </UButton>
          <UButton
            v-if="codeServerUrl"
            size="xs"
            variant="ghost"
            icon="i-ph-code-light"
            :href="`${codeServerUrl}/?folder=${encodeURIComponent(project.workspacePath)}`"
            target="_blank"
            rel="noopener"
            @click.stop
          >
            VS Code
          </UButton>
          <UButton
            size="xs"
            variant="ghost"
            color="red"
            icon="i-ph-trash-light"
            class="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
            :loading="deletingId === project.id"
            @click.stop="confirmDelete(project)"
          />
        </div>
      </div>
    </div>

    <!-- ── New Project Modal ──────────────────────────────────────────── -->
    <UModal v-model="showNewProjectModal" :ui="{ width: 'sm:max-w-lg' }">
      <UCard>
        <template #header>
          <p class="font-semibold text-base">New Project</p>
        </template>

        <form class="space-y-4" @submit.prevent="createProject">
          <UFormGroup label="Name" required>
            <UInput v-model="form.name" placeholder="My Project" autofocus />
          </UFormGroup>

          <UFormGroup label="Description">
            <UInput v-model="form.description" placeholder="Optional description" />
          </UFormGroup>

          <UFormGroup label="Context">
            <USelect v-model="form.contextType" :options="['personal', 'cez']" />
          </UFormGroup>

          <UFormGroup
            label="Workspace Path"
            hint="Absolute path on server. Leave blank to auto-generate."
          >
            <UInput v-model="form.workspacePath" placeholder="/home/user/projects/my-project" font-mono />
          </UFormGroup>

          <p v-if="createError" class="text-sm text-failed">{{ createError }}</p>
        </form>

        <template #footer>
          <div class="flex justify-end gap-3">
            <UButton variant="ghost" @click="showNewProjectModal = false">Cancel</UButton>
            <UButton
              icon="i-ph-plus-light"
              :loading="creating"
              :disabled="!form.name.trim()"
              @click="createProject"
            >
              Create
            </UButton>
          </div>
        </template>
      </UCard>
    </UModal>

    <!-- ── Delete confirmation ──────────────────────────────────────── -->
    <UModal v-model="showDeleteModal" :ui="{ width: 'sm:max-w-sm' }">
      <UCard>
        <template #header>
          <p class="font-semibold text-base text-failed">Delete Project?</p>
        </template>
        <p class="text-sm text-text-secondary">
          This removes <strong class="text-text-primary">{{ deleteTarget?.name }}</strong> from the
          orchestrator. The workspace directory on disk is <em>not</em> deleted.
        </p>
        <template #footer>
          <div class="flex justify-end gap-3">
            <UButton variant="ghost" @click="showDeleteModal = false">Cancel</UButton>
            <UButton color="red" :loading="deletingId !== null" @click="doDelete">Delete</UButton>
          </div>
        </template>
      </UCard>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { useProjectStore } from '~/stores/project';
import { useOrchestratorApi } from '~/composables/useOrchestratorApi';
import type { Project } from '~/composables/useOrchestratorApi';

useHead({ title: 'Projects — Agent Orchestrator' });

const api = useOrchestratorApi();
const projectStore = useProjectStore();
const config = useRuntimeConfig();
const codeServerUrl = computed(() => config.public.codeServerUrl as string | undefined);

const projects = computed(() => projectStore.projects);
const loading = ref(false);

// ── Load projects ─────────────────────────────────────────────────────────────
onMounted(async () => {
  loading.value = true;
  try {
    const { projects: list, codeServerUrl: serverUrl } = await api.listProjects();
    projectStore.setProjects(list);
    // Prefer backend-provided URL (env might differ in docker)
    if (serverUrl) {
      // store in a composable-level ref for this page; nuxt config is the fallback
      backendCodeServerUrl.value = serverUrl;
    }
  } finally {
    loading.value = false;
  }
});

// code-server URL: backend takes precedence over runtimeConfig
const backendCodeServerUrl = ref<string>('');
const resolvedCodeServerUrl = computed(
  () => backendCodeServerUrl.value || (codeServerUrl.value ?? ''),
);

// ── New Project form ──────────────────────────────────────────────────────────
const showNewProjectModal = ref(false);
const creating = ref(false);
const createError = ref('');

const form = reactive({
  name: '',
  description: '',
  contextType: 'personal' as 'personal' | 'cez',
  workspacePath: '',
});

function resetForm() {
  form.name = '';
  form.description = '';
  form.contextType = 'personal';
  form.workspacePath = '';
  createError.value = '';
}

watch(showNewProjectModal, (open) => {
  if (!open) resetForm();
});

async function createProject() {
  if (!form.name.trim()) return;
  creating.value = true;
  createError.value = '';
  try {
    const project = await api.createProject({
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      contextType: form.contextType,
      workspacePath: form.workspacePath.trim() || undefined,
    });
    projectStore.upsertProject(project);
    projectStore.setActiveProject(project);
    showNewProjectModal.value = false;
  } catch (e) {
    createError.value = (e as Error).message;
  } finally {
    creating.value = false;
  }
}

// ── Delete project ────────────────────────────────────────────────────────────
const showDeleteModal = ref(false);
const deleteTarget = ref<Project | null>(null);
const deletingId = ref<string | null>(null);

function confirmDelete(project: Project) {
  deleteTarget.value = project;
  showDeleteModal.value = true;
}

async function doDelete() {
  if (!deleteTarget.value) return;
  deletingId.value = deleteTarget.value.id;
  try {
    await api.deleteProject(deleteTarget.value.id);
    projectStore.removeProject(deleteTarget.value.id);
    showDeleteModal.value = false;
    deleteTarget.value = null;
  } catch (e) {
    console.error('Delete failed:', e);
  } finally {
    deletingId.value = null;
  }
}
</script>
