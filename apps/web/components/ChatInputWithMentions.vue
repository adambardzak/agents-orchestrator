<script setup lang="ts">
/**
 * ChatInputWithMentions
 * ─────────────────────
 * Drop-in replacement for `<UTextarea>` in the chat input that adds
 * `@file` autocomplete. Behaviour:
 *
 *   - Type `@` anywhere in the textarea → a popover opens listing
 *     workspace files (fetched once from `/api/projects/:id/files`,
 *     cached for the component's lifetime, refreshable on demand).
 *   - Continue typing to fuzzy-filter (case-insensitive, matches
 *     anywhere in the path; exact-substring beats fuzzy in scoring).
 *   - Arrow Up/Down / Enter / Tab / Esc navigate & confirm/dismiss.
 *     We swallow these keys ONLY while the popover is open so the
 *     parent's `Cmd/Ctrl+Enter` send shortcut still works otherwise.
 *   - Confirming inserts `@<path> ` at the caret and emits
 *     `select(path)` so the parent can track which files were
 *     mentioned (used to build the API's `referencedFiles[]` array).
 *
 * Why a custom popover instead of Tiptap or contenteditable?
 *   - The existing UI uses a plain `<textarea>` everywhere; switching
 *     to a rich editor would ripple through the rest of the chat
 *     surface (paste handling, send shortcuts, focus management).
 *   - A floating popover anchored above the textarea is significantly
 *     less invasive and keeps the prompt as plain text — exactly what
 *     gets POSTed to the API.
 *
 * Mention extraction (parent's responsibility):
 *   The parent component should call `extractMentions(promptText)`
 *   from this file (re-exported below) at send time to obtain the
 *   `referencedFiles[]` array for the API payload.
 */

import { computed, nextTick, ref, watch } from 'vue';

/** Mirrors the API's FileNode shape (apps/api/src/routes/projects.ts). */
interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  children?: FileNode[];
}

const props = defineProps<{
  modelValue: string;
  projectId: string | null;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'select', path: string): void;
  (e: 'submit'): void;
}>();

// ── File catalog (flat list of project files) ──────────────────────────────
interface FlatFile { path: string; name: string; }

const files = ref<FlatFile[]>([]);
const filesLoading = ref(false);
const filesError = ref<string | null>(null);
const filesLoadedFor = ref<string | null>(null); // projectId we cached for

const api = useOrchestratorApi();

async function ensureFilesLoaded(): Promise<void> {
  if (!props.projectId) return;
  if (filesLoadedFor.value === props.projectId) return;
  filesLoading.value = true;
  filesError.value = null;
  try {
    const { tree } = await api.listProjectFiles(props.projectId);
    files.value = flatten(tree);
    filesLoadedFor.value = props.projectId;
  } catch (err) {
    filesError.value = (err as Error).message;
  } finally {
    filesLoading.value = false;
  }
}

function flatten(nodes: FileNode[], acc: FlatFile[] = []): FlatFile[] {
  for (const n of nodes) {
    if (n.type === 'file') acc.push({ path: n.path, name: n.name });
    if (n.children?.length) flatten(n.children, acc);
  }
  return acc;
}

// Reload when project changes
watch(() => props.projectId, () => {
  filesLoadedFor.value = null;
  files.value = [];
});

// ── Popover state ──────────────────────────────────────────────────────────
const popoverOpen = ref(false);
const popoverQuery = ref('');         // characters typed AFTER the @
const popoverAnchorPos = ref(-1);     // index of the `@` in textarea value
const popoverHighlightIdx = ref(0);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

// Top-30 matches; cheap substring match + minor scoring.
const matches = computed<FlatFile[]>(() => {
  const q = popoverQuery.value.toLowerCase();
  if (!files.value.length) return [];
  if (!q) return files.value.slice(0, 30);
  const scored: { f: FlatFile; score: number }[] = [];
  for (const f of files.value) {
    const p = f.path.toLowerCase();
    const n = f.name.toLowerCase();
    const idxName = n.indexOf(q);
    const idxPath = p.indexOf(q);
    if (idxName === -1 && idxPath === -1) continue;
    // Lower score = better; prefer name-prefix > name-substring > path.
    let score = 1000;
    if (idxName === 0)       score = 0;
    else if (idxName > 0)    score = 100 + idxName;
    else if (idxPath === 0)  score = 200;
    else                     score = 300 + idxPath;
    scored.push({ f, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, 30).map((s) => s.f);
});

watch(matches, () => { popoverHighlightIdx.value = 0; });

// ── Textarea event wiring ──────────────────────────────────────────────────
// onInput is the source of truth: after every keystroke we look at the
// substring left of the caret and decide whether to open/close/update the
// popover. This avoids the brittleness of trying to intercept individual
// key events for `@`.
function onInput(e: Event): void {
  const ta = e.target as HTMLTextAreaElement;
  emit('update:modelValue', ta.value);
  recomputePopoverFromCaret(ta);
}

function recomputePopoverFromCaret(ta: HTMLTextAreaElement): void {
  const caret = ta.selectionStart ?? ta.value.length;
  const left = ta.value.slice(0, caret);
  // Find the most recent `@` that's either at start or preceded by whitespace
  const m = left.match(/(?:^|\s)@([^\s@]*)$/);
  if (!m) {
    popoverOpen.value = false;
    return;
  }
  popoverAnchorPos.value = caret - (m[1].length + 1); // index of `@`
  popoverQuery.value = m[1];
  if (!popoverOpen.value) {
    popoverOpen.value = true;
    void ensureFilesLoaded();
  }
}

function onKeydown(e: KeyboardEvent): void {
  // Submit shortcut still works regardless of popover state
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    closePopover();
    emit('submit');
    return;
  }

  if (!popoverOpen.value) return;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      popoverHighlightIdx.value = Math.min(popoverHighlightIdx.value + 1, matches.value.length - 1);
      return;
    case 'ArrowUp':
      e.preventDefault();
      popoverHighlightIdx.value = Math.max(popoverHighlightIdx.value - 1, 0);
      return;
    case 'Enter':
    case 'Tab': {
      const pick = matches.value[popoverHighlightIdx.value];
      if (pick) {
        e.preventDefault();
        applyMention(pick.path);
      }
      return;
    }
    case 'Escape':
      e.preventDefault();
      closePopover();
      return;
  }
}

function applyMention(path: string): void {
  const ta = textareaRef.value;
  if (!ta || popoverAnchorPos.value < 0) return;
  const before = props.modelValue.slice(0, popoverAnchorPos.value);
  const afterStart = (ta.selectionStart ?? popoverAnchorPos.value);
  const after = props.modelValue.slice(afterStart);
  const inserted = `@${path} `;
  const next = before + inserted + after;
  emit('update:modelValue', next);
  emit('select', path);
  closePopover();
  // Restore caret right after the inserted mention
  void nextTick(() => {
    const newCaret = (before + inserted).length;
    ta.focus();
    ta.setSelectionRange(newCaret, newCaret);
  });
}

function closePopover(): void {
  popoverOpen.value = false;
  popoverQuery.value = '';
  popoverAnchorPos.value = -1;
}

function onBlur(): void {
  // Delay so click-on-popover-item still registers
  setTimeout(closePopover, 120);
}

function pickByClick(idx: number): void {
  const pick = matches.value[idx];
  if (pick) applyMention(pick.path);
}
</script>

<template>
  <div class="relative">
    <textarea
      ref="textareaRef"
      :value="modelValue"
      :rows="rows ?? 3"
      :placeholder="placeholder ?? 'Describe what you want to build... (type @ to reference files)'"
      :disabled="disabled"
      class="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
      @input="onInput"
      @keydown="onKeydown"
      @blur="onBlur"
    />

    <!-- Mention popover -->
    <div
      v-if="popoverOpen"
      class="absolute bottom-full left-0 z-50 mb-1 w-full max-w-md overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
    >
      <div class="border-b border-gray-100 px-3 py-1.5 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
        <span v-if="filesLoading">Loading files…</span>
        <span v-else-if="filesError" class="text-red-500">Error: {{ filesError }}</span>
        <span v-else>
          {{ matches.length }} of {{ files.length }} files
          <span v-if="popoverQuery"> · matching <code class="rounded bg-gray-100 px-1 text-xs dark:bg-gray-700">{{ popoverQuery }}</code></span>
        </span>
      </div>
      <ul v-if="matches.length > 0" class="max-h-64 overflow-y-auto py-1 text-sm">
        <li
          v-for="(f, i) in matches"
          :key="f.path"
          :class="[
            'cursor-pointer px-3 py-1.5',
            i === popoverHighlightIdx
              ? 'bg-blue-50 text-blue-900 dark:bg-blue-900/30 dark:text-blue-100'
              : 'hover:bg-gray-50 dark:hover:bg-gray-700',
          ]"
          @mousedown.prevent="pickByClick(i)"
        >
          <div class="font-medium">{{ f.name }}</div>
          <div class="truncate text-xs text-gray-500 dark:text-gray-400">{{ f.path }}</div>
        </li>
      </ul>
      <div
        v-else-if="!filesLoading && !filesError"
        class="px-3 py-3 text-sm text-gray-500 dark:text-gray-400"
      >
        No matching files.
      </div>
    </div>
  </div>
</template>
