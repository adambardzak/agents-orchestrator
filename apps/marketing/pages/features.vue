<template>
  <div class="container-page py-24">
    <div class="text-center max-w-2xl mx-auto">
      <span class="eyebrow">Features</span>
      <h1 class="mt-5 text-display-xl font-semibold tracking-tight text-gradient">
        Everything you need to ship with agents.
      </h1>
      <p class="mt-4 text-text-secondary text-lg">
        A single, opinionated workspace built around how real software actually
        gets shipped.
      </p>
    </div>

    <div class="mt-20 space-y-32">
      <section
        v-for="(f, i) in features"
        :key="f.title"
        class="grid lg:grid-cols-2 gap-14 items-center"
        :class="i % 2 === 1 ? 'lg:[&>*:first-child]:order-2' : ''"
      >
        <div>
          <Emoji3D :name="f.icon" size="xl" glow />
          <h2 class="mt-6 text-display-lg font-semibold tracking-tight text-gradient">
            {{ f.title }}
          </h2>
          <p class="mt-4 text-text-secondary leading-relaxed">{{ f.body }}</p>
          <ul class="mt-6 space-y-2.5">
            <li
              v-for="b in f.bullets"
              :key="b"
              class="flex items-start gap-3 text-sm text-text-secondary"
            >
              <Icon name="ph:check-circle-fill" class="w-5 h-5 mt-0.5 text-indigo-400 shrink-0" />
              {{ b }}
            </li>
          </ul>
        </div>

        <div class="card p-6 aspect-[4/3] flex items-center justify-center relative overflow-hidden">
          <div class="absolute inset-0 grid-bg radial-fade opacity-50" />
          <Emoji3D :name="f.icon" size="2xl" glow class="animate-float" />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
const features = [
  {
    icon: 'Brain',
    title: 'Specialist agents, not a single chat',
    body: 'Each agent runs as its own OpenCode process with a curated prompt, tool surface and model. The orchestrator plans the work, schedules it across agents, and merges the result.',
    bullets: [
      'Architect, Backend, Frontend, Infra, Reviewer out of the box.',
      'Add your own agents in YAML — no rebuild required.',
      'Per-agent model overrides for cost or quality.',
    ],
  },
  {
    icon: 'Gear',
    title: 'Smart model routing',
    body: 'A planner inspects each task and routes it to the right model — free tier for trivial work, premium models when complexity justifies the spend.',
    bullets: [
      'Route on complexity, not just keywords.',
      'Hard and soft budget caps per session.',
      'Live cost telemetry in every view.',
    ],
  },
  {
    icon: 'Books',
    title: 'A knowledge base agents actually use',
    body: 'ADRs, decisions, function registries and code chunks indexed automatically. Agents recall context from past work — you stop repeating yourself.',
    bullets: [
      'Obsidian-compatible vault under .obsidian/.',
      'Automatic chunking with semantic embeddings.',
      'Per-project + per-context isolation.',
    ],
  },
  {
    icon: 'Magic wand',
    title: 'Approval gates where they matter',
    body: 'Risky actions — destructive shell commands, large refactors, deploys — pause for one-click approval. Everything else just runs.',
    bullets: [
      'Granular policy per agent and tool.',
      'Cmd+. to stop everything, instantly.',
      'Full audit trail of every approval.',
    ],
  },
];

useSeoMeta({ title: 'Features — Orchestrator' });
</script>
