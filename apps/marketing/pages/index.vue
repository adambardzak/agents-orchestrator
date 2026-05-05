<template>
  <div>
    <!-- ═══════════════════════════════════════════════════════════════════
         HERO
         ═══════════════════════════════════════════════════════════════ -->
    <section class="relative overflow-hidden">
      <!-- background: grid + glow -->
      <div class="absolute inset-0 -z-10 grid-bg radial-fade" />
      <div class="absolute top-0 left-1/2 -translate-x-1/2 -z-10 w-[900px] h-[900px] glow-orb opacity-70" />

      <div class="container-page pt-24 pb-28 lg:pt-36 lg:pb-40 text-center">
        <a
          href="https://opencode.ai"
          target="_blank"
          rel="noopener"
          class="eyebrow hover:bg-surface-hover transition"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          Built on OpenCode runtime
          <Icon name="ph:arrow-up-right-light" class="w-3 h-3" />
        </a>

        <h1
          class="mt-7 text-5xl sm:text-6xl lg:text-display-2xl font-semibold
                 tracking-tight text-gradient max-w-4xl mx-auto"
        >
          Multi-agent coding,
          <span class="text-gradient-indigo">organized.</span>
        </h1>

        <p class="mt-6 text-lg text-text-secondary max-w-2xl mx-auto leading-relaxed">
          Plan, run and monitor parallel AI coding agents with the precision of
          a modern issue tracker. One workspace. One budget. Zero context
          switching.
        </p>

        <div class="mt-9 flex items-center justify-center gap-3">
          <NuxtLink to="/get-started" class="btn-primary h-11 px-5">
            Start free
            <Icon name="ph:arrow-right-light" class="w-4 h-4" />
          </NuxtLink>
          <NuxtLink to="/features" class="btn-secondary h-11 px-5">
            See how it works
          </NuxtLink>
        </div>

        <p class="mt-5 text-xs text-text-faint">
          Self-hostable · MIT-friendly · Works with GitHub Copilot models
        </p>

        <!-- Floating 3D icons cluster -->
        <div class="relative mt-20 h-72 hidden md:block">
          <div class="absolute left-[6%]  top-2  animate-float">
            <Emoji3D name="File folder" size="xl" glow />
          </div>
          <div class="absolute left-[22%] top-24 animate-float-slow">
            <Emoji3D name="Robot" size="lg" />
          </div>
          <div class="absolute left-1/2 -translate-x-1/2 top-0 animate-float">
            <Emoji3D name="Brain" size="2xl" glow />
          </div>
          <div class="absolute right-[22%] top-24 animate-float-slow">
            <Emoji3D name="Gear" size="lg" />
          </div>
          <div class="absolute right-[6%] top-2 animate-float">
            <Emoji3D name="Rocket" size="xl" glow />
          </div>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════════════
         LOGO / CRED STRIP
         ═══════════════════════════════════════════════════════════════ -->
    <section class="border-y border-border bg-surface-elevated/30">
      <div class="container-page py-8 flex flex-wrap items-center justify-center gap-x-12 gap-y-4 text-sm text-text-faint">
        <span class="text-[11px] uppercase tracking-wider">Compatible with</span>
        <span class="flex items-center gap-2 text-text-secondary">
          <Icon name="ph:github-logo-light" class="w-4 h-4" /> GitHub Copilot
        </span>
        <span class="flex items-center gap-2 text-text-secondary">
          <Icon name="ph:cube-light" class="w-4 h-4" /> Claude · GPT-5 · Gemini · Grok
        </span>
        <span class="flex items-center gap-2 text-text-secondary">
          <Icon name="ph:terminal-window-light" class="w-4 h-4" /> OpenCode
        </span>
        <span class="flex items-center gap-2 text-text-secondary">
          <Icon name="ph:code-light" class="w-4 h-4" /> code-server
        </span>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════════════
         FEATURES — split layout
         ═══════════════════════════════════════════════════════════════ -->
    <section class="container-page py-28">
      <div class="max-w-2xl">
        <span class="eyebrow">Workflow</span>
        <h2 class="mt-5 text-display-lg font-semibold tracking-tight text-gradient">
          Built for the way you actually ship.
        </h2>
        <p class="mt-4 text-text-secondary text-lg leading-relaxed">
          Specialized agents collaborate on architecture, backend, frontend and
          infra in parallel — under your supervision, against your budget.
        </p>
      </div>

      <div class="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <div
          v-for="f in features"
          :key="f.title"
          class="card p-7 hover:border-border-strong transition group"
        >
          <Emoji3D :name="f.icon" size="md" />
          <h3 class="mt-5 font-semibold text-[15px] text-text-primary">
            {{ f.title }}
          </h3>
          <p class="mt-2 text-sm text-text-secondary leading-relaxed">
            {{ f.body }}
          </p>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════════════
         AGENT SHOWCASE
         ═══════════════════════════════════════════════════════════════ -->
    <section class="container-page py-28">
      <div class="grid lg:grid-cols-2 gap-16 items-center">
        <div>
          <span class="eyebrow">Agents</span>
          <h2 class="mt-5 text-display-lg font-semibold tracking-tight text-gradient">
            A team of specialists, not a single chat.
          </h2>
          <p class="mt-4 text-text-secondary leading-relaxed">
            Each agent runs as its own OpenCode process with a tailored prompt,
            tool surface and model. The orchestrator plans the work, schedules
            it, and merges the result.
          </p>
          <div class="mt-7 space-y-3">
            <div
              v-for="b in bullets"
              :key="b"
              class="flex items-start gap-3 text-text-secondary"
            >
              <Icon name="ph:check-circle-fill" class="w-5 h-5 mt-0.5 text-indigo-400 shrink-0" />
              <span class="text-sm">{{ b }}</span>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div
            v-for="(a, i) in agents"
            :key="a.name"
            class="card p-6 flex flex-col items-start gap-3"
            :class="i % 2 === 1 ? 'translate-y-6' : ''"
          >
            <Emoji3D :name="a.icon" size="md" />
            <div>
              <p class="font-semibold text-sm">{{ a.name }}</p>
              <p class="mt-1 text-xs text-text-secondary">{{ a.role }}</p>
            </div>
            <span
              class="mt-auto text-[10px] font-mono uppercase tracking-wider
                     px-1.5 py-0.5 rounded bg-surface-hover text-text-secondary"
            >
              {{ a.model }}
            </span>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════════════
         COCKPIT MOCKUP
         ═══════════════════════════════════════════════════════════════ -->
    <section class="container-page py-28">
      <div class="text-center max-w-2xl mx-auto">
        <span class="eyebrow">Cockpit</span>
        <h2 class="mt-5 text-display-lg font-semibold tracking-tight text-gradient">
          Watch every step. Stop on a dime.
        </h2>
        <p class="mt-4 text-text-secondary leading-relaxed">
          Live event stream, per-task cost meter, approval gates and a
          one-keystroke kill switch.
        </p>
      </div>

      <div class="mt-14 relative">
        <div class="absolute -inset-x-20 -inset-y-10 -z-10 glow-orb opacity-40" />

        <div class="card overflow-hidden shadow-pop">
          <!-- fake topbar -->
          <div class="flex items-center justify-between h-10 px-4 border-b border-border bg-surface">
            <div class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-red-400/70" />
              <span class="w-2.5 h-2.5 rounded-full bg-yellow-400/70" />
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-400/70" />
            </div>
            <span class="text-xs text-text-faint font-mono">orchestrator.app/monitor</span>
            <span class="text-xs text-text-faint">$ 0.184 / 5.000</span>
          </div>

          <div class="grid grid-cols-12 min-h-[420px]">
            <!-- mini sidebar -->
            <div class="col-span-3 border-r border-border p-4 space-y-1.5 bg-surface-elevated/40">
              <div
                v-for="(item, i) in sidebar"
                :key="item"
                class="flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm"
                :class="i === 1 ? 'bg-surface-active text-text-primary' : 'text-text-secondary'"
              >
                <Icon :name="sidebarIcons[i]" class="w-4 h-4" />
                {{ item }}
              </div>
            </div>

            <!-- task lanes -->
            <div class="col-span-9 p-5 space-y-2.5">
              <div
                v-for="t in tasks"
                :key="t.title"
                class="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-surface"
              >
                <span
                  class="w-2 h-2 rounded-full shrink-0"
                  :class="{
                    'bg-emerald-400': t.status === 'done',
                    'bg-blue-400 animate-pulse': t.status === 'running',
                    'bg-amber-400': t.status === 'wait',
                  }"
                />
                <span
                  class="text-[10px] font-mono uppercase tracking-wider
                         px-1.5 py-0.5 rounded bg-surface-hover text-text-secondary"
                >
                  {{ t.agent }}
                </span>
                <span class="text-sm flex-1 truncate">{{ t.title }}</span>
                <div class="hidden sm:block w-32 h-1.5 rounded-full bg-surface-hover overflow-hidden">
                  <div
                    class="h-full bg-gradient-to-r from-indigo-500 to-violet-500"
                    :style="{ width: t.progress + '%' }"
                  />
                </div>
                <span class="text-xs tabular-nums text-text-secondary w-14 text-right">
                  ${{ t.cost.toFixed(3) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════════════
         METRICS
         ═══════════════════════════════════════════════════════════════ -->
    <section class="container-page py-20">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-2xl overflow-hidden">
        <div
          v-for="s in stats"
          :key="s.label"
          class="bg-surface p-7 text-center"
        >
          <p class="text-display-md font-semibold tracking-tight text-gradient">
            {{ s.value }}
          </p>
          <p class="mt-1 text-xs uppercase tracking-wider text-text-faint">
            {{ s.label }}
          </p>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════════════
         CTA
         ═══════════════════════════════════════════════════════════════ -->
    <section class="container-page py-28">
      <div class="card p-12 text-center relative overflow-hidden">
        <div class="absolute inset-0 -z-10 grid-bg radial-fade opacity-50" />
        <div class="absolute -top-20 left-1/2 -translate-x-1/2 -z-10 w-[600px] h-[400px] glow-orb opacity-50" />

        <Emoji3D name="Rocket" size="xl" glow class="mx-auto" />
        <h2 class="mt-6 text-display-lg font-semibold tracking-tight text-gradient">
          Ship more, supervise less.
        </h2>
        <p class="mt-4 text-text-secondary max-w-xl mx-auto">
          Spin up the orchestrator on your machine in two minutes. Bring your
          GitHub Copilot subscription. Keep your code local.
        </p>
        <div class="mt-8 flex items-center justify-center gap-3">
          <NuxtLink to="/get-started" class="btn-primary h-11 px-5">
            Start free
            <Icon name="ph:arrow-right-light" class="w-4 h-4" />
          </NuxtLink>
          <NuxtLink to="/docs" class="btn-secondary h-11 px-5">
            Read the docs
          </NuxtLink>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
const features = [
  { icon: 'File folder',         title: 'One workspace, many agents',
    body: 'Shared filesystem, shared git, shared knowledge base. Agents see the same project — no copy-paste between chats.' },
  { icon: 'Brain',               title: 'Specialist prompts',
    body: 'Architect, Backend, Frontend, Infra and Reviewer agents with curated prompts and tool surfaces.' },
  { icon: 'Gear',                title: 'Per-agent model routing',
    body: 'Route cheap subtasks to free tier, escalate to Claude or GPT-5 when complexity demands it.' },
  { icon: 'Money bag',           title: 'Hard budget caps',
    body: 'Per-session USD budget with live tracking and an instant cap-reached kill switch.' },
  { icon: 'Books',               title: 'Project knowledge base',
    body: 'ADRs, decisions and code chunks indexed automatically — agents recall, you don’t repeat.' },
  { icon: 'Magic wand',          title: 'Approval gates',
    body: 'Risky actions pause for your one-click confirmation. Everything else just runs.' },
];

const bullets = [
  'Pluggable agent definitions — add your own in YAML.',
  'Live WebSocket event stream from each OpenCode process.',
  'code-server integration — open the workspace in VS Code in your browser.',
  'Self-hosted by default. Your secrets never leave the box.',
];

const agents = [
  { name: 'Architect',  role: 'Plans the system, writes ADRs',           icon: 'Brain',                  model: 'claude-opus-4' },
  { name: 'Backend',    role: 'APIs, database, business logic',           icon: 'Gear',                   model: 'claude-sonnet-4' },
  { name: 'Frontend',   role: 'UI, design system, accessibility',         icon: 'Artist palette',         model: 'gpt-5' },
  { name: 'Infra',      role: 'Docker, CI/CD, deploy pipelines',          icon: 'Package',                model: 'gemini-2.5-pro' },
];

const sidebar       = ['Chat', 'Monitor', 'Projects', 'Files', 'Costs', 'Settings'];
const sidebarIcons  = [
  'ph:chat-circle-text-light',
  'ph:pulse-light',
  'ph:folders-light',
  'ph:file-code-light',
  'ph:currency-dollar-light',
  'ph:gear-six-light',
];

const tasks = [
  { agent: 'arch',     title: 'Draft system architecture & ADR-0007',          status: 'done',    progress: 100, cost: 0.042 },
  { agent: 'backend',  title: 'Implement /api/sessions cancel endpoint',       status: 'running', progress: 68,  cost: 0.071 },
  { agent: 'frontend', title: 'Build cost meter component (Vue 3)',            status: 'running', progress: 41,  cost: 0.034 },
  { agent: 'infra',    title: 'Add docker-compose.prod with code-server',      status: 'wait',    progress: 12,  cost: 0.018 },
  { agent: 'review',   title: 'Lint + type-check whole monorepo',              status: 'wait',    progress: 0,   cost: 0.000 },
];

const stats = [
  { value: '4×',     label: 'Parallel agents' },
  { value: '75+',    label: 'LLM providers' },
  { value: '$0.18',  label: 'Avg session cost' },
  { value: '< 2 m',  label: 'To first agent' },
];

useSeoMeta({
  title: 'Orchestrator — Multi-agent coding, organized.',
  ogTitle: 'Orchestrator — Multi-agent coding, organized.',
  description:
    'Plan, run and monitor parallel AI coding agents with the precision of a modern issue tracker.',
});
</script>
