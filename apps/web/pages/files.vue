<template>
  <div class="flex h-[calc(100vh-57px)] overflow-hidden">
    <!-- ── Sidebar ──────────────────────────────────────────────────────── -->
    <aside class="w-64 shrink-0 flex flex-col border-r border-border bg-surface-elevated overflow-hidden">
      <!-- Project selector -->
      <div class="p-3 border-b border-border space-y-2">
        <USelect
          :model-value="selectedProjectId"
          :options="projectOptions"
          placeholder="Select project…"
          size="sm"
          @update:model-value="selectProject"
        />
        <div v-if="activeProjectPath" class="text-xs text-text-muted font-mono truncate" :title="activeProjectPath">
          {{ activeProjectPath }}
        </div>
      </div>

      <!-- Tab toggle: Explorer / Vault -->
      <div class="flex border-b border-border">
        <button
          v-for="tab in ['Explorer', 'Vault']"
          :key="tab"
          class="flex-1 py-1.5 text-xs font-medium transition-colors"
          :class="sidebarTab === tab
            ? 'text-text-primary border-b-2 border-accent bg-surface'
            : 'text-text-muted hover:text-text-secondary'"
          @click="sidebarTab = tab as 'Explorer' | 'Vault'"
        >
          {{ tab }}
          <span v-if="tab === 'Vault' && vaultFiles.length" class="ml-1 text-[10px] text-accent">({{ vaultFiles.length }})</span>
        </button>
      </div>

      <!-- Explorer: full file tree -->
      <div v-if="sidebarTab === 'Explorer'" class="flex-1 overflow-y-auto py-1">
        <div class="flex justify-end px-2 py-1">
          <button class="text-xs text-text-muted hover:text-text-secondary flex items-center gap-1" @click="loadTree">
            <UIcon name="i-ph-arrows-clockwise-light" class="w-3 h-3" />Refresh
          </button>
        </div>
        <div v-if="treeLoading" class="p-4 text-xs text-text-muted">Loading…</div>
        <div v-else-if="treeError" class="p-4 text-xs text-failed">{{ treeError }}</div>
        <div v-else-if="!fileTree.length" class="p-4 text-xs text-text-muted">No files.</div>
        <FileTreeNode
          v-for="node in fileTree"
          :key="node.path"
          :node="node"
          :selected-path="selectedFilePath"
          :depth="0"
          @select="openFile"
        />
      </div>

      <!-- Vault: only .obsidian-vault/ files, grouped by type -->
      <div v-else class="flex-1 overflow-y-auto py-1">
        <div v-if="treeLoading" class="p-4 text-xs text-text-muted">Loading…</div>
        <EmptyState
          v-else-if="!vaultFiles.length"
          icon="i-ph-book-open-light"
          title="No vault documents yet"
          description="Documents are created automatically by the Document Agent after each session."
          size="sm"
        />
        <template v-else>
          <!-- Daily notes -->
          <div v-if="vaultDaily.length">
            <div class="px-3 py-1 text-[10px] text-text-muted uppercase tracking-wider">Daily Notes</div>
            <button
              v-for="f in vaultDaily"
              :key="f.path"
              class="w-full text-left px-3 py-2 text-xs hover:bg-surface transition-colors border-b border-border/40"
              :class="selectedFilePath === f.path ? 'bg-surface text-text-primary' : 'text-text-secondary'"
              @click="openFile(f)"
            >
              <div class="font-medium">{{ f.name.replace('.md', '') }}</div>
              <div class="text-text-muted text-[10px] mt-0.5">{{ f.path }}</div>
            </button>
          </div>
          <!-- Architecture ADRs -->
          <div v-if="vaultArch.length">
            <div class="px-3 py-1 mt-1 text-[10px] text-text-muted uppercase tracking-wider">Architecture</div>
            <button
              v-for="f in vaultArch"
              :key="f.path"
              class="w-full text-left px-3 py-2 text-xs hover:bg-surface transition-colors border-b border-border/40"
              :class="selectedFilePath === f.path ? 'bg-surface text-text-primary' : 'text-text-secondary'"
              @click="openFile(f)"
            >
              <div class="font-medium">{{ f.name }}</div>
              <div class="text-text-muted text-[10px] mt-0.5">{{ f.path }}</div>
            </button>
          </div>
          <!-- Other vault files -->
          <div v-if="vaultOther.length">
            <div class="px-3 py-1 mt-1 text-[10px] text-text-muted uppercase tracking-wider">Other</div>
            <button
              v-for="f in vaultOther"
              :key="f.path"
              class="w-full text-left px-3 py-2 text-xs hover:bg-surface transition-colors border-b border-border/40"
              :class="selectedFilePath === f.path ? 'bg-surface text-text-primary' : 'text-text-secondary'"
              @click="openFile(f)"
            >
              <div class="font-medium">{{ f.name }}</div>
              <div class="text-text-muted text-[10px] mt-0.5">{{ f.path }}</div>
            </button>
          </div>
        </template>
      </div>
    </aside>

    <!-- ── Editor area ─────────────────────────────────────────────────── -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Tab bar -->
      <div class="flex items-center gap-0 border-b border-border bg-surface-elevated px-2 h-9 overflow-x-auto">
        <div
          v-for="tab in openTabs"
          :key="tab.path"
          class="flex items-center gap-1.5 px-3 py-1 text-xs border-r border-border cursor-pointer shrink-0 max-w-40 group"
          :class="tab.path === selectedFilePath
            ? 'bg-surface text-text-primary'
            : 'text-text-secondary hover:bg-surface/50'"
          @click="selectedFilePath = tab.path"
        >
          <UIcon v-if="tab.path.startsWith('.obsidian-vault/')" name="i-ph-book-light" class="w-3 h-3 text-accent shrink-0" />
          <span class="truncate font-mono">{{ tab.name }}</span>
          <button
            class="opacity-0 group-hover:opacity-60 hover:!opacity-100 ml-auto"
            @click.stop="closeTab(tab.path)"
          >
            ✕
          </button>
        </div>
        <div v-if="openTabs.length === 0" class="text-xs text-text-muted px-3 py-1">
          No file open
        </div>
      </div>

      <!-- File content area -->
      <div class="flex-1 overflow-hidden relative">
        <div v-if="fileLoading" class="absolute inset-0 flex items-center justify-center text-text-muted text-sm">
          Loading file…
        </div>
        <div v-else-if="!selectedFilePath" class="absolute inset-0 flex items-center justify-center text-text-muted text-sm">
          Select a file from the tree
        </div>
        <!-- Image preview -->
        <div v-else-if="currentTabIsImage" class="absolute inset-0 flex items-center justify-center overflow-auto bg-surface p-4">
          <img
            :src="currentFileContent"
            :alt="currentTab?.name"
            class="max-w-full max-h-full object-contain rounded shadow-lg"
            style="image-rendering: auto;"
          />
        </div>
        <!-- Code editor -->
        <ClientOnly v-else>
          <VueMonacoEditor
            :value="currentFileContent"
            :language="currentFileLanguage"
            theme="vs-dark"
            :options="monacoOptions"
            class="w-full h-full"
          />
          <template #fallback>
            <pre class="p-4 text-xs font-mono text-text-secondary overflow-auto h-full">{{ currentFileContent }}</pre>
          </template>
        </ClientOnly>
      </div>

      <!-- Status bar -->
      <div v-if="currentTab" class="flex items-center gap-4 px-4 py-1 border-t border-border bg-surface-elevated text-xs text-text-muted font-mono">
        <span>{{ currentTab.path }}</span>
        <span class="ml-auto">{{ currentTab.size ? formatSize(currentTab.size) : '' }}</span>
        <span>{{ currentTab.ext?.toUpperCase() }}</span>
        <span v-if="currentTab.modifiedAt">{{ new Date(currentTab.modifiedAt).toLocaleString() }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { VueMonacoEditor } from '@guolao/vue-monaco-editor';
import { useProjectStore } from '~/stores/project';
import { useOrchestratorApi } from '~/composables/useOrchestratorApi';
import type { FileNode } from '~/composables/useOrchestratorApi';

useHead({ title: 'Files — Agent Orchestrator' });

const api = useOrchestratorApi();
const projectStore = useProjectStore();
const route = useRoute();
const router = useRouter();

// ── Sidebar tab ────────────────────────────────────────────────────────────────
const sidebarTab = ref<'Explorer' | 'Vault'>('Explorer');

// ── Project selection ─────────────────────────────────────────────────────────

const projectOptions = computed(() =>
  projectStore.projects.map((p) => ({ label: p.name, value: p.id })),
);

// Prefer ?project= query param, fall back to active project store
const selectedProjectId = ref<string>(
  (route.query['project'] as string | undefined) ?? projectStore.activeProject?.id ?? '',
);

const activeProjectPath = computed(
  () => projectStore.projects.find((p) => p.id === selectedProjectId.value)?.workspacePath ?? '',
);

async function selectProject(id: string) {
  selectedProjectId.value = id;
  const project = projectStore.projects.find((p) => p.id === id);
  if (project) projectStore.setActiveProject(project);
  await router.replace({ query: { ...route.query, project: id } });
  await loadTree();
}

// Load projects if store is empty
onMounted(async () => {
  if (projectStore.projects.length === 0) {
    try {
      const { projects } = await api.listProjects();
      projectStore.setProjects(projects);
      if (!selectedProjectId.value && projects[0]) {
        selectedProjectId.value = projects[0].id;
      }
    } catch { /* ignore */ }
  }
  if (selectedProjectId.value) await loadTree();
});

// ── File tree ─────────────────────────────────────────────────────────────────

const fileTree = ref<FileNode[]>([]);
const treeLoading = ref(false);
const treeError = ref('');

async function loadTree() {
  if (!selectedProjectId.value) return;
  treeLoading.value = true;
  treeError.value = '';
  try {
    const { tree } = await api.listProjectFiles(selectedProjectId.value);
    fileTree.value = tree;
  } catch (e) {
    treeError.value = (e as Error).message;
  } finally {
    treeLoading.value = false;
  }
}

// ── Vault helpers ─────────────────────────────────────────────────────────────

/** Flatten a FileNode tree into a flat list of file nodes only */
function flattenFiles(nodes: FileNode[], acc: FileNode[] = []): FileNode[] {
  for (const n of nodes) {
    if (n.type === 'file') acc.push(n);
    else if (n.children) flattenFiles(n.children, acc);
  }
  return acc;
}

const vaultNode = computed(() =>
  fileTree.value.find((n) => n.name === '.obsidian-vault'),
);

const vaultFiles = computed(() => {
  if (!vaultNode.value?.children) return [];
  return flattenFiles(vaultNode.value.children);
});

const vaultDaily = computed(() =>
  vaultFiles.value
    .filter((f) => f.path.includes('/Daily/') || f.path.includes('\\Daily\\'))
    .sort((a, b) => b.name.localeCompare(a.name)), // newest first
);

const vaultArch = computed(() =>
  vaultFiles.value.filter(
    (f) => f.path.includes('/Architecture/') || f.path.includes('/ADR'),
  ),
);

const vaultOther = computed(() =>
  vaultFiles.value.filter(
    (f) => !vaultDaily.value.includes(f) && !vaultArch.value.includes(f),
  ),
);

// Auto-refresh when Document Agent completes (vault update notification)
watch(
  () => projectStore.vaultUpdateTick,
  async (tick) => {
    if (tick > 0 && selectedProjectId.value) {
      await loadTree();
      // Auto-switch to Vault tab so the user sees new docs
      sidebarTab.value = 'Vault';
    }
  },
);

// ── Tabs + open files ─────────────────────────────────────────────────────────

interface OpenTab {
  path: string;
  name: string;
  content: string;
  size?: number;
  ext?: string;
  modifiedAt?: string;
  isImage?: boolean;
}

const openTabs = ref<OpenTab[]>([]);
const selectedFilePath = ref<string>('');
const fileLoading = ref(false);

const currentTab = computed(
  () => openTabs.value.find((t) => t.path === selectedFilePath.value) ?? null,
);
const currentFileContent = computed(() => currentTab.value?.content ?? '');
const currentFileLanguage = computed(() => extToLanguage(currentTab.value?.ext ?? ''));
const currentTabIsImage = computed(() => currentTab.value?.isImage === true);

async function openFile(node: FileNode) {
  if (node.type === 'dir') return;
  if (!selectedProjectId.value) return;

  // Switch to already-open tab
  const existing = openTabs.value.find((t) => t.path === node.path);
  if (existing) {
    selectedFilePath.value = node.path;
    return;
  }

  fileLoading.value = true;
  try {
    const data = await api.getFileContent(selectedProjectId.value, node.path);
    openTabs.value.push({
      path: node.path,
      name: node.name,
      content: data.content,
      size: data.size,
      ext: data.ext,
      modifiedAt: data.modifiedAt,
      isImage: data.isImage,
    });
    selectedFilePath.value = node.path;
  } catch (e) {
    console.error('Failed to open file:', e);
  } finally {
    fileLoading.value = false;
  }
}

function closeTab(path: string) {
  const idx = openTabs.value.findIndex((t) => t.path === path);
  openTabs.value.splice(idx, 1);
  if (selectedFilePath.value === path) {
    selectedFilePath.value = openTabs.value[idx]?.path ?? openTabs.value[idx - 1]?.path ?? '';
  }
}

// ── Monaco options ────────────────────────────────────────────────────────────

const monacoOptions = {
  readOnly: true,
  minimap: { enabled: true },
  fontSize: 13,
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  scrollBeyondLastLine: false,
  wordWrap: 'on' as const,
  lineNumbers: 'on' as const,
  renderLineHighlight: 'all' as const,
  smoothScrolling: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const EXT_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  vue: 'html', svelte: 'html', html: 'html', css: 'css', scss: 'scss', less: 'less',
  json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  md: 'markdown', mdx: 'markdown', sh: 'shell', bash: 'shell', zsh: 'shell',
  py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  dockerfile: 'dockerfile', env: 'ini', ini: 'ini', conf: 'ini',
  xml: 'xml', proto: 'protobuf', tf: 'hcl', hcl: 'hcl',
};

function extToLanguage(ext: string): string {
  return EXT_MAP[ext.toLowerCase()] ?? 'plaintext';
}
</script>
