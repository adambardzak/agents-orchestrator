<!--
  IconPicker — phosphor icon palette for skill/agent customization.

  Props:
    modelValue (string | null) — current iconify id, e.g. "i-ph-brain-light"

  Emits:
    update:modelValue — new icon id (or empty string to clear)

  Phosphor icons are loaded via @nuxt/ui's iconify integration; we hand-pick
  a curated set that covers the most common skill/tool/topic metaphors.
-->
<template>
  <div>
    <button
      type="button"
      class="flex items-center gap-2 px-3 py-1.5 border border-border rounded-md bg-surface hover:bg-surface-elevated transition text-sm"
      @click="open = !open"
    >
      <UIcon :name="modelValue || 'i-ph-question-light'" class="w-5 h-5" />
      <span class="text-text-secondary">{{ modelValue || 'Pick icon' }}</span>
      <UIcon name="i-ph-caret-down-light" class="w-3 h-3 text-text-muted" />
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/50"
        @click.self="open = false"
      >
        <div class="bg-surface-elevated border border-border rounded-md p-4 w-full max-w-2xl mx-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold">Pick an icon</h3>
            <UButton size="xs" variant="ghost" icon="i-ph-x-light" @click="open = false" />
          </div>

          <UInput
            v-model="filter"
            placeholder="Filter (e.g. brain, code, cloud)..."
            icon="i-ph-magnifying-glass-light"
            size="sm"
            class="mb-3"
            autofocus
          />

          <div class="grid grid-cols-10 gap-1.5 max-h-80 overflow-y-auto">
            <button
              v-for="icon in filteredIcons"
              :key="icon"
              type="button"
              class="flex items-center justify-center aspect-square border rounded-md p-2 hover:bg-surface transition"
              :class="modelValue === icon
                ? 'border-accent ring-2 ring-accent/30'
                : 'border-border'"
              :title="icon"
              @click="select(icon)"
            >
              <UIcon :name="icon" class="w-5 h-5" />
            </button>
          </div>

          <div class="mt-3 flex justify-between items-center">
            <button
              v-if="modelValue"
              type="button"
              class="text-xs text-text-muted hover:text-failed"
              @click="select('')"
            >
              Clear icon
            </button>
            <span v-else />
            <span class="text-xs text-text-muted">{{ filteredIcons.length }} icons</span>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
defineProps<{ modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const open = ref(false);
const filter = ref('');

// Curated phosphor icon palette covering common skill / tool / topic metaphors.
// Names follow the @nuxt/ui convention (i-ph-<name>-light).
const ICONS = [
  // Code & dev
  'i-ph-code-light', 'i-ph-terminal-light', 'i-ph-bracket-curly-light',
  'i-ph-file-code-light', 'i-ph-git-branch-light', 'i-ph-git-commit-light',
  'i-ph-git-merge-light', 'i-ph-git-pull-request-light', 'i-ph-git-fork-light',
  'i-ph-bug-light', 'i-ph-test-tube-light', 'i-ph-play-circle-light',

  // Data & DB
  'i-ph-database-light', 'i-ph-table-light', 'i-ph-rows-light',
  'i-ph-tree-structure-light', 'i-ph-network-light', 'i-ph-graph-light',
  'i-ph-chart-line-light', 'i-ph-chart-bar-light',

  // AI / brain
  'i-ph-brain-light', 'i-ph-atom-light', 'i-ph-lightning-light',
  'i-ph-magic-wand-light', 'i-ph-sparkle-light', 'i-ph-robot-light',

  // UI / design
  'i-ph-paint-brush-light', 'i-ph-palette-light', 'i-ph-eyedropper-light',
  'i-ph-square-light', 'i-ph-eye-light', 'i-ph-image-light',
  'i-ph-layout-light', 'i-ph-mountains-light',

  // Cloud / DevOps
  'i-ph-cloud-light', 'i-ph-cube-light', 'i-ph-shipping-container-light',
  'i-ph-cpu-light', 'i-ph-hard-drives-light', 'i-ph-cell-tower-light',

  // Security
  'i-ph-shield-check-light', 'i-ph-lock-light', 'i-ph-key-light',
  'i-ph-fingerprint-light',

  // Comms / web
  'i-ph-globe-light', 'i-ph-link-light', 'i-ph-paper-plane-tilt-light',
  'i-ph-envelope-light', 'i-ph-chat-circle-light', 'i-ph-megaphone-light',

  // SEO / search
  'i-ph-magnifying-glass-light', 'i-ph-funnel-light', 'i-ph-target-light',
  'i-ph-trend-up-light',

  // General
  'i-ph-lightbulb-light', 'i-ph-book-open-light', 'i-ph-bookmark-light',
  'i-ph-tag-light', 'i-ph-star-light', 'i-ph-heart-light',
  'i-ph-fire-light', 'i-ph-rocket-launch-light', 'i-ph-flag-light',
  'i-ph-trophy-light', 'i-ph-medal-light', 'i-ph-gear-six-light',
  'i-ph-wrench-light', 'i-ph-hammer-light', 'i-ph-toolbox-light',
  'i-ph-package-light', 'i-ph-puzzle-piece-light', 'i-ph-stack-light',
  'i-ph-queue-light', 'i-ph-clock-light', 'i-ph-calendar-light',
  'i-ph-snake-light', 'i-ph-fish-light', 'i-ph-bird-light',
  'i-ph-leaf-light', 'i-ph-tree-light', 'i-ph-flower-light',
] as const;

const filteredIcons = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return ICONS as readonly string[];
  return (ICONS as readonly string[]).filter((i) => i.includes(q));
});

function select(icon: string) {
  emit('update:modelValue', icon);
  open.value = false;
}
</script>
