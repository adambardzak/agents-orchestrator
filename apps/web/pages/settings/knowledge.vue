<template>
  <div class="p-6 max-w-7xl">
    <div class="flex items-start justify-between gap-3 mb-2 flex-wrap">
      <div class="min-w-0">
        <div class="flex items-center gap-2 mb-2 flex-wrap">
          <h1 class="text-display-md font-heading font-bold">Knowledge Base</h1>
          <span
            class="text-xs px-2 py-0.5 rounded-full border flex items-center gap-1"
            :class="kbScope === 'user'
              ? 'bg-accent/10 text-accent border-accent/30'
              : 'bg-surface text-text-muted border-border'"
          >
            <UIcon
              :name="kbScope === 'user' ? 'i-ph-user-light' : 'i-ph-buildings-light'"
              class="w-3 h-3"
            />
            {{ kbScope === 'user' ? 'My personal KB' : 'Workspace KB' }}
          </span>
        </div>
        <p class="text-text-secondary">
          Markdown documents indexed automatically and injected into agent
          prompts via similarity search. Use forward-slash paths
          (e.g. <code class="text-xs">guides/architecture.md</code>) to
          organize documents into folders. Switch scope from the topbar.
        </p>
      </div>
      <UButton icon="i-ph-plus-light" @click="openAddModal()">New document</UButton>
    </div>

    <div v-if="loading" class="mt-8 flex items-center gap-2 text-sm text-text-muted">
      <UIcon name="i-ph-circle-notch-light" class="w-4 h-4 animate-spin" />
      Loading documents...
    </div>

    <EmptyState
      v-else-if="documents.length === 0"
      icon="i-ph-book-open-light"
      title="No documents yet"
      description="Add Markdown documents to your knowledge base — they'll be indexed and injected into agent prompts via similarity search."
      action-label="Create your first document"
      action-icon="i-ph-plus-light"
      @action="openAddModal()"
    />

    <div v-else class="mt-6 grid grid-cols-12 gap-6">
      <!-- Folder tree (left) -->
      <aside class="col-span-4 lg:col-span-3 border-r border-border pr-4">
        <div class="sticky top-0">
          <UInput
            v-model="searchQuery"
            placeholder="Filter..."
            icon="i-ph-magnifying-glass-light"
            size="sm"
            class="mb-3"
          />
          <ul class="space-y-0.5 text-sm">
            <li
              v-for="node in tree"
              :key="node.key"
            >
              <FolderNode :node="node" :selected-id="selectedId" @select="selectDoc" />
            </li>
          </ul>
        </div>
      </aside>

      <!-- Detail (right) -->
      <section class="col-span-8 lg:col-span-9">
        <div v-if="!selected" class="text-text-muted text-sm">
          Select a document from the list, or
          <button class="underline" @click="openAddModal()">create a new one</button>.
        </div>
        <article v-else class="space-y-4">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <h2 class="text-xl font-semibold mb-1">{{ selected.title }}</h2>
              <code class="text-xs text-text-muted">{{ selected.path }}</code>
              <div class="flex flex-wrap items-center gap-2 mt-2">
                <UBadge :color="statusColor(selected.indexStatus)" variant="subtle" size="xs">
                  {{ selected.indexStatus }}
                </UBadge>
                <UBadge v-for="t in selected.tags" :key="t" variant="subtle" size="xs">{{ t }}</UBadge>
                <span class="text-xs text-text-muted">
                  Updated {{ formatRelative(selected.updatedAt) }}
                </span>
              </div>
              <p v-if="selected.indexError" class="text-xs text-failed mt-1">
                Index error: {{ selected.indexError }}
              </p>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
              <UButton size="xs" variant="ghost" icon="i-ph-pencil-simple-light" @click="openEditModal(selected)">Edit</UButton>
              <UButton size="xs" variant="ghost" icon="i-ph-arrow-clockwise-light" :loading="reindexing" @click="onReindex(selected)">Re-index</UButton>
              <UButton size="xs" variant="ghost" color="red" icon="i-ph-trash-light" :loading="deleting" @click="onDelete(selected)">Delete</UButton>
            </div>
          </div>
          <pre class="bg-surface text-xs p-4 rounded border border-border overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">{{ selected.content }}</pre>
        </article>
      </section>
    </div>

    <!-- Add / Edit modal -->
    <UModal v-model="showEditModal" :ui="{ width: 'sm:max-w-4xl' }">
      <UCard>
        <template #header>
          <p class="font-semibold">{{ editing ? `Edit "${editing.title}"` : 'New document' }}</p>
        </template>

        <form class="space-y-4" @submit.prevent="onSave">
          <UFormGroup label="Title" required>
            <UInput v-model="form.title" placeholder="Architecture Overview" />
          </UFormGroup>

          <UFormGroup label="Path" required hint="Folder-style path. Use / to nest.">
            <UInput v-model="form.path" placeholder="guides/architecture.md" font-mono />
          </UFormGroup>

          <UFormGroup label="Tags" hint="Comma-separated.">
            <UInput v-model="tagsText" placeholder="architecture, backend" />
          </UFormGroup>

          <UFormGroup label="Content" required hint="Markdown. Re-indexed on save when changed.">
            <UTextarea
              v-model="form.content"
              :rows="20"
              placeholder="# Heading&#10;&#10;Document content..."
              class="font-mono text-xs leading-relaxed"
            />
          </UFormGroup>

          <p v-if="error" class="text-sm text-failed">{{ error }}</p>
        </form>

        <template #footer>
          <div class="flex justify-end gap-3">
            <UButton variant="ghost" @click="showEditModal = false">Cancel</UButton>
            <UButton
              :loading="saving"
              :disabled="!form.title.trim() || !form.path.trim() || form.content.length < 5"
              @click="onSave"
            >
              {{ editing ? 'Save' : 'Create' }}
            </UButton>
          </div>
        </template>
      </UCard>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import type { KnowledgeDocSummary, KnowledgeDocument } from '~/composables/useKnowledge';

definePageMeta({ layout: 'default' });

const api = useKnowledge();
const toast = useToast();
const { scope: kbScope } = useKbScope();

const documents = ref<KnowledgeDocSummary[]>([]);
const loading = ref(true);

const selectedId = ref<string | null>(null);
const selected = ref<KnowledgeDocument | null>(null);
const reindexing = ref(false);
const deleting = ref(false);

const showEditModal = ref(false);
const editing = ref<KnowledgeDocument | null>(null);
const saving = ref(false);
const error = ref('');
const searchQuery = ref('');

const form = reactive({
  title:   '',
  path:    '',
  content: '',
});
const tagsText = ref('');

// Folder-tree data structure: documents grouped by their path components.
interface TreeNode {
  key:      string;
  label:    string;
  doc:      KnowledgeDocSummary | null; // null = folder
  children: TreeNode[];
}

const filteredDocs = computed(() =>
  searchQuery.value.trim() === ''
    ? documents.value
    : documents.value.filter((d) => {
        const q = searchQuery.value.toLowerCase();
        return d.title.toLowerCase().includes(q) || d.path.toLowerCase().includes(q);
      }),
);

const tree = computed<TreeNode[]>(() => {
  const root: TreeNode = { key: '', label: '', doc: null, children: [] };
  for (const doc of filteredDocs.value) {
    const segments = doc.path.split('/').filter(Boolean);
    let cursor = root;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      const isLeaf = i === segments.length - 1;
      const key = segments.slice(0, i + 1).join('/');
      let next = cursor.children.find((c) => c.key === key);
      if (!next) {
        next = { key, label: segment, doc: isLeaf ? doc : null, children: [] };
        cursor.children.push(next);
      } else if (isLeaf) {
        next.doc = doc;
      }
      cursor = next;
    }
  }
  // Folders first, then files; alphabetical within each.
  const sortRecursive = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      const aIsFolder = a.children.length > 0 && a.doc === null;
      const bIsFolder = b.children.length > 0 && b.doc === null;
      if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    nodes.forEach((n) => sortRecursive(n.children));
    return nodes;
  };
  return sortRecursive(root.children);
});

function statusColor(s: KnowledgeDocSummary['indexStatus']): string {
  switch (s) {
    case 'indexed':  return 'green';
    case 'indexing': return 'blue';
    case 'pending':  return 'gray';
    case 'failed':   return 'red';
    default:         return 'gray';
  }
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

async function selectDoc(doc: KnowledgeDocSummary): Promise<void> {
  selectedId.value = doc.id;
  try {
    selected.value = await api.get(doc.id);
  } catch (err) {
    toast.add({ title: 'Failed to load document', description: (err as Error).message, color: 'red' });
  }
}

function resetForm(): void {
  form.title = '';
  form.path = '';
  form.content = '';
  tagsText.value = '';
  error.value = '';
}

function openAddModal(): void {
  editing.value = null;
  resetForm();
  showEditModal.value = true;
}

function openEditModal(doc: KnowledgeDocument): void {
  editing.value = doc;
  form.title = doc.title;
  form.path = doc.path;
  form.content = doc.content;
  tagsText.value = doc.tags.join(', ');
  error.value = '';
  showEditModal.value = true;
}

function parseTags(): string[] {
  return tagsText.value.split(',').map((t) => t.trim()).filter(Boolean);
}

async function onSave(): Promise<void> {
  saving.value = true;
  error.value = '';
  try {
    if (editing.value) {
      const updated = await api.update(editing.value.id, {
        title:   form.title.trim(),
        path:    form.path.trim(),
        content: form.content,
        tags:    parseTags(),
      });
      // refresh list summary entry
      const idx = documents.value.findIndex((d) => d.id === updated.id);
      if (idx >= 0) {
        documents.value[idx] = {
          ...documents.value[idx]!,
          title:          updated.title,
          path:           updated.path,
          tags:           updated.tags,
          indexStatus:    updated.indexStatus,
          contentPreview: updated.content.slice(0, 200),
          updatedAt:      updated.updatedAt,
        };
      }
      selected.value = updated;
      toast.add({ title: 'Document updated', color: 'green' });
    } else {
      const created = await api.create(kbScope.value, {
        title:   form.title.trim(),
        path:    form.path.trim(),
        content: form.content,
        tags:    parseTags(),
      });
      // append to list as summary
      documents.value.push({
        id:             created.id,
        scope:          created.scope,
        createdBy:      created.createdBy,
        title:          created.title,
        path:           created.path,
        tags:           created.tags,
        indexStatus:    created.indexStatus,
        indexError:     created.indexError,
        indexedAt:      created.indexedAt,
        contentPreview: created.content.slice(0, 200),
        chunkCount:     0,
        createdAt:      created.createdAt,
        updatedAt:      created.updatedAt,
      });
      selectedId.value = created.id;
      selected.value = created;
      toast.add({ title: 'Document created', color: 'green' });
    }
    showEditModal.value = false;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    saving.value = false;
  }
}

async function onReindex(doc: KnowledgeDocument): Promise<void> {
  reindexing.value = true;
  try {
    await api.reindex(doc.id);
    toast.add({ title: 'Re-indexing started', color: 'blue' });
    // Poll once for status update after a short delay
    setTimeout(async () => {
      try {
        selected.value = await api.get(doc.id);
        const idx = documents.value.findIndex((d) => d.id === doc.id);
        if (idx >= 0 && selected.value) {
          documents.value[idx] = {
            ...documents.value[idx]!,
            indexStatus: selected.value.indexStatus,
            indexError:  selected.value.indexError,
          };
        }
      } catch {
        // ignore
      }
    }, 2500);
  } catch (err) {
    toast.add({ title: 'Re-index failed', description: (err as Error).message, color: 'red' });
  } finally {
    reindexing.value = false;
  }
}

async function onDelete(doc: KnowledgeDocument): Promise<void> {
  if (!confirm(`Delete "${doc.title}"? This also removes its chunks. Cannot be undone.`)) return;
  deleting.value = true;
  try {
    await api.remove(doc.id);
    documents.value = documents.value.filter((d) => d.id !== doc.id);
    selected.value = null;
    selectedId.value = null;
    toast.add({ title: 'Document deleted', color: 'green' });
  } catch (err) {
    toast.add({ title: 'Delete failed', description: (err as Error).message, color: 'red' });
  } finally {
    deleting.value = false;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  selected.value = null;
  selectedId.value = null;
  try {
    documents.value = await api.list(kbScope.value);
  } catch (err) {
    toast.add({ title: 'Failed to load documents', description: (err as Error).message, color: 'red' });
  } finally {
    loading.value = false;
  }
}

onMounted(load);

// Reload list when topbar scope switches.
watch(kbScope, load);
</script>
