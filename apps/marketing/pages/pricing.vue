<template>
  <div class="container-page py-24">
    <div class="text-center max-w-2xl mx-auto">
      <span class="eyebrow">Pricing</span>
      <h1 class="mt-5 text-display-xl font-semibold tracking-tight text-gradient">
        Honest pricing. No surprises.
      </h1>
      <p class="mt-4 text-text-secondary text-lg">
        Self-host for free, forever. Pay for managed hosting only when you want
        someone else to run it.
      </p>
    </div>

    <div class="mt-16 grid md:grid-cols-3 gap-5 max-w-5xl mx-auto">
      <div
        v-for="(p, i) in plans"
        :key="p.name"
        :class="[
          'card p-7 flex flex-col relative',
          i === 1 ? 'border-indigo-500/40 shadow-glow' : '',
        ]"
      >
        <div
          v-if="i === 1"
          class="absolute -top-3 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full
                 text-[10px] font-semibold uppercase tracking-wider
                 bg-gradient-to-r from-indigo-500 to-violet-500 text-white"
        >
          Most popular
        </div>
        <Emoji3D :name="p.icon" size="md" />
        <h3 class="mt-5 font-semibold text-lg">{{ p.name }}</h3>
        <p class="mt-1 text-sm text-text-secondary">{{ p.tagline }}</p>

        <div class="mt-6 flex items-baseline gap-1">
          <span class="text-4xl font-semibold tracking-tight">{{ p.price }}</span>
          <span v-if="p.suffix" class="text-sm text-text-secondary">/ {{ p.suffix }}</span>
        </div>

        <ul class="mt-6 space-y-2.5 flex-1">
          <li
            v-for="f in p.features"
            :key="f"
            class="flex items-start gap-2.5 text-sm text-text-secondary"
          >
            <Icon name="ph:check-circle-fill" class="w-4 h-4 mt-0.5 text-indigo-400 shrink-0" />
            {{ f }}
          </li>
        </ul>

        <NuxtLink
          :to="p.cta.to"
          :class="i === 1 ? 'btn-primary mt-7 w-full justify-center h-11' : 'btn-secondary mt-7 w-full justify-center h-11'"
        >
          {{ p.cta.label }}
        </NuxtLink>
      </div>
    </div>

    <p class="mt-10 text-center text-xs text-text-faint">
      LLM costs are billed directly by your provider (e.g. GitHub Copilot,
      Anthropic). Orchestrator never marks them up.
    </p>
  </div>
</template>

<script setup lang="ts">
const plans = [
  {
    icon: 'House',
    name: 'Self-hosted',
    tagline: 'Run on your machine or VPS.',
    price: 'Free',
    suffix: '',
    features: [
      'Unlimited projects, agents and sessions',
      'All agent types included',
      'Full source on GitHub',
      'Community support',
    ],
    cta: { label: 'Get started', to: '/get-started' },
  },
  {
    icon: 'Rocket',
    name: 'Cloud',
    tagline: 'Managed, with one-click setup.',
    price: '$19',
    suffix: 'user / month',
    features: [
      'Everything in Self-hosted',
      'Hosted code-server workspace',
      'Daily encrypted backups',
      'Email support, < 24h',
    ],
    cta: { label: 'Start trial', to: '/get-started' },
  },
  {
    icon: 'Office building',
    name: 'Enterprise',
    tagline: 'On-prem or VPC. Your rules.',
    price: 'Custom',
    suffix: '',
    features: [
      'SSO + SCIM',
      'Dedicated VPC deployment',
      'SLA, security review, DPA',
      'Priority engineering support',
    ],
    cta: { label: 'Contact sales', to: '/contact' },
  },
];

useSeoMeta({ title: 'Pricing — Orchestrator' });
</script>
