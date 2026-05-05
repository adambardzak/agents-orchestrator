<template>
  <header
    :class="[
      'sticky top-0 z-40 transition-colors',
      scrolled
        ? 'bg-bg/80 backdrop-blur-md border-b border-border'
        : 'bg-transparent',
    ]"
  >
    <div class="container-page flex items-center justify-between h-16">
      <NuxtLink to="/" class="flex items-center gap-2.5 group">
        <span
          class="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600
                 flex items-center justify-center shadow-md group-hover:shadow-glow transition"
        >
          <Icon name="ph:graph-light" class="w-4 h-4 text-white" />
        </span>
        <span class="font-semibold text-[15px] tracking-tight">
          Orchestrator
        </span>
      </NuxtLink>

      <nav class="hidden md:flex items-center gap-7">
        <NuxtLink
          v-for="link in nav"
          :key="link.to"
          :to="link.to"
          class="text-sm text-text-secondary hover:text-text-primary transition"
          active-class="!text-text-primary"
        >
          {{ link.label }}
        </NuxtLink>
      </nav>

      <div class="flex items-center gap-2">
        <a
          href="https://github.com"
          target="_blank"
          rel="noopener"
          class="hidden sm:inline-flex btn-ghost"
        >
          <Icon name="ph:github-logo-light" class="w-4 h-4" />
          GitHub
        </a>
        <NuxtLink to="/get-started" class="btn-primary">
          Get started
          <Icon name="ph:arrow-right-light" class="w-4 h-4" />
        </NuxtLink>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
const nav = [
  { to: '/features', label: 'Features' },
  { to: '/agents',   label: 'Agents' },
  { to: '/pricing',  label: 'Pricing' },
  { to: '/docs',     label: 'Docs' },
];

const scrolled = ref(false);
const onScroll = () => { scrolled.value = window.scrollY > 8; };

onMounted(() => {
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
});
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll));
</script>
