<template>
  <div class="container-page py-24 max-w-4xl">
    <span class="eyebrow">Docs</span>
    <h1 class="mt-5 text-display-xl font-semibold tracking-tight text-gradient">
      Quickstart in two minutes.
    </h1>
    <p class="mt-4 text-text-secondary text-lg">
      Spin up the orchestrator on your machine. Bring your GitHub Copilot
      subscription. Keep your code local.
    </p>

    <div class="mt-12 space-y-10">
      <div
        v-for="(step, i) in steps"
        :key="step.title"
        class="flex gap-5"
      >
        <div class="shrink-0">
          <Emoji3D :name="step.icon" size="md" />
        </div>
        <div class="flex-1">
          <p class="text-[11px] uppercase tracking-wider text-text-faint font-semibold">
            Step {{ i + 1 }}
          </p>
          <h3 class="mt-1 font-semibold text-lg">{{ step.title }}</h3>
          <p class="mt-2 text-text-secondary leading-relaxed">{{ step.body }}</p>
          <pre
            v-if="step.code"
            class="mt-4 p-4 rounded-lg bg-surface-elevated border border-border
                   text-sm font-mono text-text-secondary overflow-x-auto"
          ><code>{{ step.code }}</code></pre>
        </div>
      </div>
    </div>

    <div class="mt-16 card p-7 flex items-center gap-5">
      <Emoji3D name="Light bulb" size="md" />
      <div class="flex-1">
        <p class="font-semibold">Need the full reference?</p>
        <p class="text-sm text-text-secondary mt-0.5">
          API, agent YAML schema, deployment topology and troubleshooting.
        </p>
      </div>
      <a href="https://github.com" target="_blank" rel="noopener" class="btn-secondary">
        Read on GitHub
        <Icon name="ph:arrow-up-right-light" class="w-4 h-4" />
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
const steps = [
  {
    icon: 'File folder',
    title: 'Clone the repo',
    body: 'Grab the source. The monorepo includes both API and dashboard.',
    code: 'git clone https://github.com/anomalyco/orchestrator\ncd orchestrator',
  },
  {
    icon: 'Gear',
    title: 'Configure your environment',
    body: 'Copy the example env file and fill in your GitHub Copilot token (or any OpenCode-supported provider).',
    code: 'cp .env.example .env\n$EDITOR .env',
  },
  {
    icon: 'Package',
    title: 'Boot the stack',
    body: 'docker-compose brings up the API, the dashboard, code-server, Postgres and Redis.',
    code: 'docker compose up -d',
  },
  {
    icon: 'Rocket',
    title: 'Open the dashboard',
    body: 'Visit http://localhost:3010, create a project, and dispatch your first multi-agent task.',
    code: 'open http://localhost:3010',
  },
];

useSeoMeta({ title: 'Docs — Orchestrator' });
</script>
