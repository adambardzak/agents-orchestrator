<template>
  <div class="container-page py-24">
    <div class="text-center max-w-2xl mx-auto">
      <span class="eyebrow">Agents</span>
      <h1 class="mt-5 text-display-xl font-semibold tracking-tight text-gradient">
        A team of specialists.
      </h1>
      <p class="mt-4 text-text-secondary text-lg">
        Each agent is an isolated OpenCode process with its own prompt, tool
        surface and preferred model.
      </p>
    </div>

    <div class="mt-16 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
      <div
        v-for="a in agents"
        :key="a.name"
        class="card p-6 hover:border-border-strong transition flex flex-col"
      >
        <div class="flex items-start justify-between">
          <Emoji3D :name="a.icon" size="md" />
          <span
            class="text-[10px] font-mono uppercase tracking-wider
                   px-1.5 py-0.5 rounded bg-surface-hover text-text-secondary"
          >
            {{ a.model }}
          </span>
        </div>
        <h3 class="mt-5 font-semibold text-[15px]">{{ a.name }}</h3>
        <p class="mt-1.5 text-sm text-text-secondary leading-relaxed">
          {{ a.body }}
        </p>
        <div class="mt-5 pt-4 border-t border-border flex flex-wrap gap-1.5">
          <span
            v-for="t in a.tools"
            :key="t"
            class="text-[11px] px-2 py-0.5 rounded-md bg-surface-hover text-text-secondary"
          >
            {{ t }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const agents = [
  { name: 'Architect',  icon: 'Brain',          model: 'claude-opus-4',
    body: 'Decomposes goals, writes ADRs, designs system boundaries. Reads broadly, writes sparingly.',
    tools: ['read', 'plan', 'adr', 'graph'] },
  { name: 'Backend',    icon: 'Gear',           model: 'claude-sonnet-4',
    body: 'Implements APIs, database schemas and business logic in TypeScript, Python or Go.',
    tools: ['read', 'write', 'shell', 'lsp'] },
  { name: 'Frontend',   icon: 'Artist palette', model: 'gpt-5',
    body: 'Builds UI components, design system primitives and accessible layouts. Vue 3 + React.',
    tools: ['read', 'write', 'lsp', 'preview'] },
  { name: 'Infra',      icon: 'Package',        model: 'gemini-2.5-pro',
    body: 'Docker, docker-compose, CI/CD, deploy pipelines, observability scaffolding.',
    tools: ['read', 'write', 'shell', 'docker'] },
  { name: 'Document',   icon: 'Books',          model: 'gpt-4o-mini',
    body: 'Updates the project knowledge base, writes READMEs, syncs Obsidian vault.',
    tools: ['read', 'write', 'embed'] },
  { name: 'Reviewer',   icon: 'Magnifying glass tilted left', model: 'claude-sonnet-4',
    body: 'Lints, type-checks and reviews diffs before they land. Suggests focused fixes.',
    tools: ['read', 'lsp', 'git', 'shell'] },
];

useSeoMeta({ title: 'Agents — Orchestrator' });
</script>
