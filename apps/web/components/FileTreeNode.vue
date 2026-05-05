<template>
  <div>
    <!-- Node row -->
    <div
      class="flex items-center gap-1 px-1.5 py-0.5 rounded cursor-pointer select-none group text-xs transition"
      :style="{ paddingLeft: `${6 + depth * 12}px` }"
      :class="[
        isSelected
          ? 'bg-accent/15 text-accent'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
      ]"
      @click="toggle"
    >
      <UIcon
        v-if="node.type === 'dir'"
        :name="open ? 'i-ph-caret-down-light' : 'i-ph-caret-right-light'"
        class="w-3 h-3 shrink-0 text-text-faint"
      />
      <span v-else class="w-3 h-3 shrink-0" />
      <UIcon
        :name="node.type === 'dir' ? (open ? 'i-ph-folder-open-light' : 'i-ph-folder-light') : fileIcon(node.name)"
        class="w-3.5 h-3.5 shrink-0"
        :class="node.type === 'dir' ? 'text-pending/80' : 'text-text-secondary'"
      />
      <span class="truncate leading-5">{{ node.name }}</span>
      <span v-if="node.type === 'file' && node.size" class="ml-auto text-text-faint opacity-0 group-hover:opacity-100 text-[10px] tabular-nums font-mono">
        {{ formatSize(node.size) }}
      </span>
    </div>

    <!-- Children (recursive) -->
    <template v-if="node.type === 'dir' && open && node.children?.length">
      <FileTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :selected-path="selectedPath"
        :depth="depth + 1"
        @select="$emit('select', $event)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { FileNode } from '~/composables/useOrchestratorApi';

const props = defineProps<{
  node: FileNode;
  selectedPath: string;
  depth: number;
}>();

const emit = defineEmits<{
  (e: 'select', node: FileNode): void;
}>();

const open = ref(props.depth === 0 && props.node.type === 'dir');
const isSelected = computed(() => props.node.path === props.selectedPath);

function toggle() {
  if (props.node.type === 'dir') {
    open.value = !open.value;
  } else {
    emit('select', props.node);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, string> = {
  ts: 'i-ph-file-code-light',  tsx: 'i-ph-file-code-light',
  js: 'i-ph-file-code-light',  jsx: 'i-ph-file-code-light',
  vue: 'i-ph-file-code-light', svelte: 'i-ph-file-code-light',
  json: 'i-ph-curly-braces-light',   jsonc: 'i-ph-curly-braces-light',
  yaml: 'i-ph-file-text-light', yml: 'i-ph-file-text-light',
  md: 'i-ph-file-text-light',  mdx: 'i-ph-file-text-light',
  css: 'i-ph-palette-light',   scss: 'i-ph-palette-light', less: 'i-ph-palette-light',
  sh: 'i-ph-terminal-window-light',   bash: 'i-ph-terminal-window-light',
  py: 'i-ph-file-code-light',  rs: 'i-ph-file-code-light',
  go: 'i-ph-file-code-light',  sql: 'i-ph-database-light',
  env: 'i-ph-key-light',       gitignore: 'i-ph-git-branch-light',
  dockerfile: 'i-ph-cube-light',
};

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const dotName = name.startsWith('.') ? name.slice(1).toLowerCase() : '';
  return ICON_MAP[ext] ?? ICON_MAP[dotName] ?? 'i-ph-file-light';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
</script>
