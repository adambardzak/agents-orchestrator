<template>
  <div>
    <!-- Folder node (no doc, has children) -->
    <button
      v-if="!node.doc && node.children.length > 0"
      class="w-full flex items-center gap-1.5 py-1 px-1 rounded hover:bg-surface-elevated text-left"
      @click="expanded = !expanded"
    >
      <UIcon
        :name="expanded ? 'i-ph-caret-down-light' : 'i-ph-caret-right-light'"
        class="w-3.5 h-3.5 text-text-muted flex-shrink-0"
      />
      <UIcon name="i-ph-folder-light" class="w-4 h-4 text-text-muted flex-shrink-0" />
      <span class="truncate">{{ node.label }}</span>
      <span class="text-xs text-text-muted ml-auto">{{ node.children.length }}</span>
    </button>

    <!-- Leaf node (doc) -->
    <button
      v-else-if="node.doc"
      class="w-full flex items-center gap-1.5 py-1 px-1 rounded text-left"
      :class="selectedId === node.doc.id ? 'bg-primary/10 text-primary' : 'hover:bg-surface-elevated'"
      @click="$emit('select', node.doc)"
    >
      <span class="w-3.5 flex-shrink-0" />
      <UIcon name="i-ph-file-text-light" class="w-4 h-4 text-text-muted flex-shrink-0" />
      <span class="truncate">{{ node.doc.title }}</span>
      <UIcon
        v-if="node.doc.indexStatus === 'indexing' || node.doc.indexStatus === 'pending'"
        name="i-ph-circle-notch-light"
        class="w-3 h-3 text-text-muted animate-spin ml-auto flex-shrink-0"
      />
      <UIcon
        v-else-if="node.doc.indexStatus === 'failed'"
        name="i-ph-warning-circle-light"
        class="w-3 h-3 text-failed ml-auto flex-shrink-0"
      />
    </button>

    <!-- Recurse into children -->
    <ul
      v-if="!node.doc && node.children.length > 0 && expanded"
      class="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2"
    >
      <li v-for="child in node.children" :key="child.key">
        <FolderNode :node="child" :selected-id="selectedId" @select="(d) => $emit('select', d)" />
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { KnowledgeDocSummary } from '~/composables/useKnowledge';

interface TreeNode {
  key:      string;
  label:    string;
  doc:      KnowledgeDocSummary | null;
  children: TreeNode[];
}

defineProps<{
  node:       TreeNode;
  selectedId: string | null;
}>();

defineEmits<{
  (e: 'select', doc: KnowledgeDocSummary): void;
}>();

// Folders default to expanded for a flat workspace; users collapse as needed.
const expanded = ref(true);
</script>
