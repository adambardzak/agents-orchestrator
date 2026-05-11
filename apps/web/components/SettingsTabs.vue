<script setup lang="ts">
/**
 * Horizontal tab strip for all /settings/* sub-pages.
 *
 * Rendered once at the top of each settings page so the user can jump
 * between Account, Connections, AI, Skills, Knowledge, and Workspace
 * without going through the sidebar. Mirrors the sidebar's icons and
 * labels for visual continuity.
 *
 * Active tab is derived from the current route — no model prop needed.
 */
interface Tab {
  to:    string;
  label: string;
  icon:  string;
}

const tabs: Tab[] = [
  { to: '/settings',             label: 'Account',     icon: 'i-ph-user-circle-light' },
  { to: '/settings/connections', label: 'Connections', icon: 'i-ph-plug-light' },
  { to: '/settings/ai',          label: 'AI',          icon: 'i-ph-brain-light' },
  { to: '/settings/skills',      label: 'Skills',      icon: 'i-ph-lightbulb-light' },
  { to: '/settings/knowledge',   label: 'Knowledge',   icon: 'i-ph-book-open-light' },
  { to: '/settings/workspace',   label: 'Workspace',   icon: 'i-ph-buildings-light' },
];

const route = useRoute();
const activeTo = computed(() => {
  // Exact match preferred; fallback to startsWith for nested routes.
  const exact = tabs.find((t) => t.to === route.path);
  if (exact) return exact.to;
  // Pick the most specific (longest) matching prefix.
  return [...tabs]
    .sort((a, b) => b.to.length - a.to.length)
    .find((t) => route.path.startsWith(t.to + '/'))?.to ?? '/settings';
});
</script>

<template>
  <nav class="border-b border-border mb-6 -mx-6 px-6 overflow-x-auto">
    <ul class="flex items-center gap-1 min-w-max">
      <li v-for="tab in tabs" :key="tab.to">
        <NuxtLink
          :to="tab.to"
          class="group inline-flex items-center gap-2 px-3 py-2.5 text-sm border-b-2 transition-colors"
          :class="activeTo === tab.to
            ? 'border-accent text-text-primary font-medium'
            : 'border-transparent text-text-muted hover:text-text-secondary hover:border-border-strong'"
        >
          <UIcon
            :name="tab.icon"
            class="w-4 h-4 transition-transform"
            :class="activeTo === tab.to ? 'text-accent' : 'group-hover:scale-110'"
          />
          {{ tab.label }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
