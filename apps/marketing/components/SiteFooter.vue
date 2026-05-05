<template>
  <footer class="border-t border-border mt-32">
    <div class="container-page py-14 grid grid-cols-2 md:grid-cols-5 gap-10">
      <div class="col-span-2">
        <NuxtLink to="/" class="flex items-center gap-2.5">
          <span
            class="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600
                   flex items-center justify-center shadow-md"
          >
            <Icon name="ph:graph-light" class="w-4 h-4 text-white" />
          </span>
          <span class="font-semibold tracking-tight">Orchestrator</span>
        </NuxtLink>
        <p class="mt-4 text-sm text-text-secondary max-w-sm">
          Plan, run and monitor multi-agent coding workflows with the precision
          of a modern issue tracker.
        </p>
      </div>

      <div v-for="col in columns" :key="col.title">
        <p class="text-[11px] uppercase tracking-wider text-text-faint font-semibold mb-3">
          {{ col.title }}
        </p>
        <ul class="space-y-2">
          <li v-for="link in col.links" :key="link.label">
            <NuxtLink
              :to="link.to"
              class="text-sm text-text-secondary hover:text-text-primary transition"
            >
              {{ link.label }}
            </NuxtLink>
          </li>
        </ul>
      </div>
    </div>

    <div class="border-t border-border">
      <div class="container-page py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p class="text-xs text-text-faint">
          © {{ new Date().getFullYear() }} Orchestrator. Built on OpenCode.
        </p>
        <div class="flex items-center gap-4 text-xs text-text-faint">
          <NuxtLink to="/privacy" class="hover:text-text-secondary transition">Privacy</NuxtLink>
          <NuxtLink to="/terms"   class="hover:text-text-secondary transition">Terms</NuxtLink>
          <a href="https://github.com" target="_blank" rel="noopener" class="hover:text-text-secondary transition">GitHub</a>
        </div>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
const columns = [
  {
    title: 'Product',
    links: [
      { label: 'Features',   to: '/features' },
      { label: 'Agents',     to: '/agents' },
      { label: 'Pricing',    to: '/pricing' },
      { label: 'Changelog',  to: '/changelog' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Documentation', to: '/docs' },
      { label: 'Quickstart',    to: '/docs/quickstart' },
      { label: 'OpenCode',      to: 'https://opencode.ai' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About',   to: '/about' },
      { label: 'Contact', to: '/contact' },
      { label: 'Blog',    to: '/blog' },
    ],
  },
];
</script>
