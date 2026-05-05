<template>
  <div class="container-page py-24 max-w-2xl">
    <div class="text-center">
      <Emoji3D name="Rocket" size="xl" glow class="mx-auto" />
      <h1 class="mt-6 text-display-xl font-semibold tracking-tight text-gradient">
        Let’s get you started.
      </h1>
      <p class="mt-4 text-text-secondary text-lg">
        Two paths. Same orchestrator. Pick whichever feels lighter.
      </p>
    </div>

    <div class="mt-14 grid sm:grid-cols-2 gap-5">
      <div class="card p-7 hover:border-border-strong transition flex flex-col">
        <Emoji3D name="House" size="md" />
        <h3 class="mt-5 font-semibold">Self-host</h3>
        <p class="mt-2 text-sm text-text-secondary flex-1">
          Run on your laptop or VPS in two minutes. Your code never leaves the box.
        </p>
        <NuxtLink to="/docs" class="btn-secondary mt-6 w-full justify-center">
          Read quickstart
          <Icon name="ph:arrow-right-light" class="w-4 h-4" />
        </NuxtLink>
      </div>

      <div class="card p-7 hover:border-border-strong transition flex flex-col border-indigo-500/30 shadow-glow">
        <Emoji3D name="Cloud" size="md" />
        <h3 class="mt-5 font-semibold">Try the cloud</h3>
        <p class="mt-2 text-sm text-text-secondary flex-1">
          Hosted code-server, daily backups and zero ops. 14-day free trial.
        </p>
        <a href="#waitlist" class="btn-primary mt-6 w-full justify-center">
          Join waitlist
          <Icon name="ph:arrow-right-light" class="w-4 h-4" />
        </a>
      </div>
    </div>

    <form
      id="waitlist"
      class="mt-16 card p-7"
      @submit.prevent="onSubmit"
    >
      <div class="flex items-start gap-4">
        <Emoji3D name="Envelope" size="md" />
        <div class="flex-1">
          <p class="font-semibold">Get cloud access</p>
          <p class="mt-1 text-sm text-text-secondary">
            We’ll email you when your workspace is ready. No spam.
          </p>
          <div class="mt-4 flex flex-col sm:flex-row gap-2">
            <input
              v-model="email"
              type="email"
              required
              placeholder="you@company.com"
              class="flex-1 h-10 px-3 rounded-lg bg-surface border border-border-strong
                     text-sm placeholder:text-text-faint focus:outline-none focus:border-indigo-500"
            />
            <button type="submit" class="btn-primary h-10">
              {{ submitted ? '✓ On the list' : 'Join waitlist' }}
            </button>
          </div>
        </div>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
const email     = ref('');
const submitted = ref(false);

function onSubmit() {
  submitted.value = true;
  email.value = '';
}

useSeoMeta({ title: 'Get started — Orchestrator' });
</script>
