<template>
  <div class="p-6 max-w-5xl mx-auto">
    <!-- Header -->
    <div class="flex flex-wrap items-start justify-between gap-3 mb-6">
      <div class="min-w-0">
        <h1 class="text-2xl font-heading font-semibold">Projects</h1>
        <p class="text-sm text-text-secondary mt-0.5">Manage workspaces and associated agent sessions.</p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <UButton
          icon="i-ph-git-branch-light"
          size="sm"
          variant="outline"
          @click="openImportFromGit"
        >
          Import from Git
        </UButton>
        <UButton icon="i-ph-plus-light" size="sm" @click="openNewProject">
          New Project
        </UButton>
      </div>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <Skeleton v-for="n in 6" :key="n" class="h-44" />
    </div>

    <!-- Empty state -->
    <EmptyState
      v-else-if="projects.length === 0"
      icon="i-ph-folder-open-light"
      title="No projects yet"
      description="Create your first project to link a workspace directory."
      action-label="New Project"
      action-icon="i-ph-plus-light"
      @action="openNewProject"
    />

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
        <div class="flex items-center gap-1 mt-auto pt-2 border-t border-border flex-wrap">
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
            :href="buildCodeServerLink({ workspacePath: project.workspacePath })"
            target="_blank"
            rel="noopener"
            @click.stop
          >
            VS Code
          </UButton>
          <UButton
            size="xs"
            variant="ghost"
            icon="i-ph-git-branch-light"
            @click.stop="openWorkingTree(project)"
          >
            <span class="hidden xl:inline">Working tree</span>
            <span class="xl:hidden">Tree</span>
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
          <p class="font-semibold text-base">
            {{ form.gitMode === 'link' ? 'Import from Git' : 'New Project' }}
          </p>
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

          <!-- Git integration -->
          <UFormGroup label="Git repository" hint="Optionally link a Git remote so agent changes are pushed automatically.">
            <USelect
              v-model="form.gitMode"
              :options="[
                { label: 'No git (local only)',          value: 'none'   },
                { label: 'Create new repo',              value: 'create' },
                { label: 'Link existing repo (clone)',   value: 'link'   },
              ]"
            />
          </UFormGroup>

          <template v-if="form.gitMode !== 'none'">
            <UFormGroup label="Connection" required>
              <USelect
                v-model="form.gitConnectionId"
                :options="connectionOptions"
                placeholder="Select connected account"
              />
              <p v-if="connections.length === 0" class="text-xs text-pending mt-1">
                No connections — <NuxtLink to="/settings/connections" class="underline">connect a provider</NuxtLink> first.
              </p>
            </UFormGroup>

            <template v-if="form.gitMode === 'create'">
              <UFormGroup label="Repo name" required>
                <UInput v-model="form.repoName" placeholder="my-project" />
              </UFormGroup>
              <UFormGroup label="Visibility">
                <USelect v-model="form.visibility" :options="['private', 'public', 'internal']" />
              </UFormGroup>
              <UFormGroup label="Namespace" hint="Org/group/workspace. Leave blank for personal account.">
                <UInput v-model="form.namespace" placeholder="my-org" />
              </UFormGroup>
            </template>

            <template v-if="form.gitMode === 'link'">
              <UFormGroup label="Repository" required>
                <USelect
                  v-model="form.linkedRepoFullName"
                  :options="repoOptions"
                  :loading="reposLoading"
                  placeholder="Select a repo"
                />
              </UFormGroup>
            </template>
          </template>

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

    <!-- ── Working Tree Modal ───────────────────────────────────────────── -->
    <UModal v-model="showWorkingTreeModal" :ui="{ width: 'sm:max-w-3xl' }">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <p class="font-semibold text-base">Working tree — {{ workingTreeProject?.name }}</p>
            <UButton variant="ghost" icon="i-ph-x-light" @click="showWorkingTreeModal = false" />
          </div>
        </template>
        <WorkingTreePanel v-if="workingTreeProject" :project-id="workingTreeProject.id" />
      </UCard>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { useProjectStore } from '~/stores/project';
import { useOrchestratorApi } from '~/composables/useOrchestratorApi';
import { useCodeServerLink } from '~/composables/useCodeServerLink';
import type { Project } from '~/composables/useOrchestratorApi';

useHead({ title: 'Projects — Agent Orchestrator' });

const api = useOrchestratorApi();
const projectStore = useProjectStore();
const config = useRuntimeConfig();
const codeServerUrl = computed(() => config.public.codeServerUrl as string | undefined);
// Code-server runs in Docker; rebase host workspace paths to the path
// visible inside the code-server container before opening.
const { buildLink: buildCodeServerLink } = useCodeServerLink();

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
  gitMode:           'none' as 'none' | 'create' | 'link',
  gitConnectionId:   '',
  repoName:          '',
  visibility:        'private' as 'private' | 'public' | 'internal',
  namespace:         '',
  linkedRepoFullName: '',
});

// Git connections + repos loaded lazily when modal opens
const gitApi = useGitConnections();
const connections = ref<Array<{ id: string; provider: string; accountLogin: string }>>([]);
const repos = ref<Array<{ id: string; fullName: string; cloneUrl: string; defaultBranch: string; private: boolean }>>([]);
const reposLoading = ref(false);

const connectionOptions = computed(() =>
  connections.value.map((c) => ({
    label: `${c.accountLogin} (${c.provider})`,
    value: c.id,
  })),
);
const repoOptions = computed(() =>
  repos.value.map((r) => ({ label: r.fullName, value: r.fullName })),
);

watch(
  () => form.gitConnectionId,
  async (id) => {
    if (!id || form.gitMode !== 'link') return;
    reposLoading.value = true;
    try {
      const list = await gitApi.listRepos(id);
      repos.value = list;
    } finally {
      reposLoading.value = false;
    }
  },
);

function resetForm() {
  form.name = '';
  form.description = '';
  form.contextType = 'personal';
  form.workspacePath = '';
  form.gitMode = 'none';
  form.gitConnectionId = '';
  form.repoName = '';
  form.visibility = 'private';
  form.namespace = '';
  form.linkedRepoFullName = '';
  createError.value = '';
}

/** Open the modal in default "New Project" mode (no git). */
function openNewProject() {
  resetForm();
  showNewProjectModal.value = true;
}

/**
 * Open the modal pre-configured for importing an existing repo. If exactly one
 * git connection is available it gets pre-selected so the user can immediately
 * pick a repo from the list.
 */
async function openImportFromGit() {
  resetForm();
  form.gitMode = 'link';
  showNewProjectModal.value = true;
  // The watch() on showNewProjectModal loads connections; wait a tick then
  // auto-select the only/first one for nicer UX.
  await nextTick();
  if (connections.value.length === 1) {
    form.gitConnectionId = connections.value[0]!.id;
  }
}

watch(showNewProjectModal, async (open) => {
  if (!open) {
    resetForm();
    return;
  }
  // Load connections when opening the modal
  try {
    const list = await gitApi.listConnections();
    connections.value = list;
  } catch (err) {
    console.warn('Failed to load git connections', err);
  }
});

async function createProject() {
  if (!form.name.trim()) return;
  creating.value = true;
  createError.value = '';
  try {
    let git: Parameters<typeof api.createProject>[0]['git'] | undefined;
    if (form.gitMode === 'create') {
      if (!form.gitConnectionId || !form.repoName.trim()) {
        throw new Error('Connection and repo name are required for "Create new repo"');
      }
      git = {
        action:          'create',
        gitConnectionId: form.gitConnectionId,
        repoName:        form.repoName.trim(),
        visibility:      form.visibility,
        ...(form.namespace.trim() ? { namespace: form.namespace.trim() } : {}),
      };
    } else if (form.gitMode === 'link') {
      const repo = repos.value.find((r) => r.fullName === form.linkedRepoFullName);
      if (!repo) throw new Error('Select a repository to link');
      git = {
        action:          'link',
        gitConnectionId: form.gitConnectionId,
        fullName:        repo.fullName,
        cloneUrl:        repo.cloneUrl,
        defaultBranch:   repo.defaultBranch,
        visibility:      repo.private ? 'private' : 'public',
        externalId:      repo.id,
      };
    }

    const project = await api.createProject({
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      contextType: form.contextType,
      workspacePath: form.workspacePath.trim() || undefined,
      ...(git ? { git } : {}),
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

// ── Working tree modal ────────────────────────────────────────────────────────
const showWorkingTreeModal = ref(false);
const workingTreeProject = ref<Project | null>(null);

function openWorkingTree(project: Project): void {
  workingTreeProject.value = project;
  showWorkingTreeModal.value = true;
}

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
