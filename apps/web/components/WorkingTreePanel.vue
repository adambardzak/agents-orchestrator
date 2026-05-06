<template>
  <div class="space-y-3">
    <!-- Repo header -->
    <div v-if="repo" class="flex items-center gap-2 text-sm">
      <UIcon :name="iconFor(repo.provider)" class="w-4 h-4" />
      <a :href="repo.remoteUrl" target="_blank" class="font-mono hover:underline">
        {{ repo.fullName }}
      </a>
      <UBadge color="gray" variant="subtle" size="xs">{{ repo.defaultBranch }}</UBadge>
      <UBadge :color="repo.visibility === 'public' ? 'green' : 'gray'" variant="subtle" size="xs">
        {{ repo.visibility }}
      </UBadge>
    </div>
    <p v-else class="text-sm text-text-muted">No git repository linked.</p>

    <!-- Status -->
    <div v-if="status" class="border border-border rounded-md p-3 bg-surface">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2 text-sm">
          <UIcon name="i-ph-git-branch-light" class="w-4 h-4" />
          <span class="font-mono">{{ status.branch }}</span>
          <UBadge v-if="status.ahead > 0" color="blue" variant="subtle" size="xs">
            ↑{{ status.ahead }}
          </UBadge>
          <UBadge v-if="status.behind > 0" color="orange" variant="subtle" size="xs">
            ↓{{ status.behind }}
          </UBadge>
          <UBadge v-if="status.clean" color="green" variant="subtle" size="xs">clean</UBadge>
          <UBadge v-else color="orange" variant="subtle" size="xs">
            {{ totalChanges }} change{{ totalChanges === 1 ? '' : 's' }}
          </UBadge>
        </div>
        <UButton
          size="xs"
          variant="ghost"
          icon="i-ph-arrows-clockwise-light"
          :loading="loading"
          @click="refresh"
        >Refresh</UButton>
      </div>

      <ul v-if="!status.clean" class="space-y-0.5 text-xs font-mono max-h-48 overflow-y-auto">
        <li v-for="f in status.staged"    :key="`s-${f}`" class="text-completed"><span class="opacity-70">A</span> {{ f }}</li>
        <li v-for="f in status.modified"  :key="`m-${f}`" class="text-pending"><span class="opacity-70">M</span> {{ f }}</li>
        <li v-for="f in status.deleted"   :key="`d-${f}`" class="text-failed"><span class="opacity-70">D</span> {{ f }}</li>
        <li v-for="f in status.untracked" :key="`u-${f}`" class="text-text-muted"><span class="opacity-70">?</span> {{ f }}</li>
      </ul>
    </div>
    <div v-else-if="statusError" class="text-xs text-pending">
      Workspace is not a git repository: {{ statusError }}
    </div>

    <!-- Diff toggle -->
    <div v-if="status && !status.clean">
      <UButton size="xs" variant="ghost" icon="i-ph-file-diff-light" @click="toggleDiff">
        {{ showDiff ? 'Hide' : 'Show' }} diff
      </UButton>
      <pre
        v-if="showDiff"
        class="mt-2 text-xs bg-surface-elevated border border-border rounded-md p-3 overflow-x-auto max-h-96 whitespace-pre font-mono"
      >{{ diff || '(loading...)' }}</pre>
    </div>

    <!-- Session commits -->
    <div v-if="sessionId" class="border border-border rounded-md p-3 bg-surface">
      <div class="flex items-center gap-2 mb-2 text-sm">
        <UIcon name="i-ph-git-commit-light" class="w-4 h-4" />
        <span class="font-semibold">Session commits</span>
        <UBadge color="gray" variant="subtle" size="xs">{{ commits.length }}</UBadge>
      </div>
      <p v-if="commits.length === 0" class="text-xs text-text-muted">
        No auto-commits yet. Commits are created when an agent completes a task.
      </p>
      <ul v-else class="space-y-2 text-xs">
        <li v-for="c in commits" :key="c.id" class="flex items-start gap-2">
          <UIcon
            :name="c.pushedAt ? 'i-ph-cloud-check-light' : 'i-ph-hard-drive-light'"
            :class="c.pushedAt ? 'text-completed' : 'text-pending'"
            class="w-3.5 h-3.5 mt-0.5 shrink-0"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <code class="text-text-muted">{{ c.sha.slice(0, 7) }}</code>
              <span class="font-mono text-text-secondary">{{ c.branch }}</span>
              <span class="text-text-muted">·</span>
              <span class="text-completed">+{{ c.insertions }}</span>
              <span class="text-failed">-{{ c.deletions }}</span>
              <span class="text-text-muted">{{ c.filesChanged }} file{{ c.filesChanged === 1 ? '' : 's' }}</span>
            </div>
            <div class="text-text-secondary truncate">{{ firstLine(c.message) }}</div>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  projectId: string;
  /** Optional — when present, also shows the session's commit history. */
  sessionId?: string;
}>();

const api = useOrchestratorApi();

interface Repo {
  id: string; provider: 'github' | 'gitlab' | 'bitbucket';
  fullName: string; remoteUrl: string; defaultBranch: string;
  visibility: 'private' | 'public' | 'internal';
}
interface Status {
  branch: string; ahead: number; behind: number;
  staged: string[]; modified: string[]; untracked: string[]; deleted: string[];
  clean: boolean;
}
interface Commit {
  id: string; sha: string; message: string; branch: string;
  filesChanged: number; insertions: number; deletions: number;
  pushedAt: string | null; createdAt: string;
}

const repo        = ref<Repo | null>(null);
const status      = ref<Status | null>(null);
const statusError = ref('');
const commits     = ref<Commit[]>([]);
const diff        = ref('');
const showDiff    = ref(false);
const loading     = ref(false);

const totalChanges = computed(() =>
  status.value
    ? status.value.staged.length + status.value.modified.length +
      status.value.untracked.length + status.value.deleted.length
    : 0,
);

function iconFor(provider: string): string {
  switch (provider) {
    case 'github':    return 'i-ph-github-logo-light';
    case 'gitlab':    return 'i-ph-gitlab-logo-light';
    case 'bitbucket': return 'i-ph-git-branch-light';
    default:          return 'i-ph-git-branch-light';
  }
}

function firstLine(s: string): string {
  return s.split('\n')[0] ?? s;
}

async function refresh(): Promise<void> {
  loading.value = true;
  diff.value = '';
  showDiff.value = false;
  try {
    const [repoRes, statusRes] = await Promise.all([
      api.getProjectRepo(props.projectId),
      api.getGitStatus(props.projectId),
    ]);
    repo.value = (repoRes.repo ?? null) as Repo | null;
    status.value = statusRes.status;
    statusError.value = statusRes.error ?? '';

    if (props.sessionId) {
      const c = await api.getSessionCommits(props.sessionId);
      commits.value = c.commits;
    }
  } finally {
    loading.value = false;
  }
}

async function toggleDiff(): Promise<void> {
  showDiff.value = !showDiff.value;
  if (showDiff.value && !diff.value) {
    const res = await api.getGitDiff(props.projectId);
    diff.value = res.diff || '(no changes)';
  }
}

watch(() => props.projectId, refresh, { immediate: true });
watch(() => props.sessionId, refresh);
</script>
