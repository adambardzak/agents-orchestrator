<!--
  Sign-up page — creates a new user via email/password.
  After sign-up, useAuth.signUp() auto-creates a personal workspace,
  then we redirect to '/'.
-->
<template>
  <div class="w-full max-w-sm">
    <div class="border border-border rounded-xl bg-surface-elevated shadow-pop overflow-hidden">
      <div class="px-6 pt-6 pb-4">
        <h1 class="font-heading text-lg font-semibold tracking-tight">Create account</h1>
        <p class="text-sm text-text-secondary mt-1">
          Spin up your own workspace in under a minute.
        </p>
      </div>

      <div class="px-6 space-y-2">
        <button
          type="button"
          class="w-full flex items-center justify-center gap-2 h-9 rounded-md border border-border bg-surface hover:bg-surface-hover transition text-sm font-medium"
          @click="oauth('github')"
        >
          <UIcon name="i-ph-github-logo-light" class="w-4 h-4" />
          Continue with GitHub
        </button>
        <button
          type="button"
          class="w-full flex items-center justify-center gap-2 h-9 rounded-md border border-border bg-surface hover:bg-surface-hover transition text-sm font-medium"
          @click="oauth('google')"
        >
          <UIcon name="i-ph-google-logo-light" class="w-4 h-4" />
          Continue with Google
        </button>
      </div>

      <div class="flex items-center gap-3 px-6 my-5">
        <div class="flex-1 h-px bg-border" />
        <span class="text-xs uppercase tracking-wider text-text-faint">or email</span>
        <div class="flex-1 h-px bg-border" />
      </div>

      <form class="px-6 pb-6 space-y-3" @submit.prevent="submit">
        <label class="block">
          <span class="block text-xs font-medium text-text-secondary mb-1">Name</span>
          <input
            v-model="name"
            type="text"
            required
            autocomplete="name"
            placeholder="Adam Bardzák"
            class="w-full h-9 px-2.5 rounded-md border border-border bg-surface focus:border-accent focus:outline-none text-sm"
          />
        </label>

        <label class="block">
          <span class="block text-xs font-medium text-text-secondary mb-1">Email</span>
          <input
            v-model="email"
            type="email"
            required
            autocomplete="email"
            placeholder="you@company.com"
            class="w-full h-9 px-2.5 rounded-md border border-border bg-surface focus:border-accent focus:outline-none text-sm"
          />
        </label>

        <label class="block">
          <span class="block text-xs font-medium text-text-secondary mb-1">Password</span>
          <input
            v-model="password"
            type="password"
            required
            minlength="8"
            autocomplete="new-password"
            class="w-full h-9 px-2.5 rounded-md border border-border bg-surface focus:border-accent focus:outline-none text-sm"
          />
          <span class="block text-[11px] text-text-faint mt-1">At least 8 characters.</span>
        </label>

        <p
          v-if="error"
          class="text-xs text-failed bg-failed-bg border border-failed/30 rounded-md px-2.5 py-2"
        >
          {{ error }}
        </p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full h-9 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition disabled:opacity-60"
        >
          {{ loading ? 'Creating account…' : 'Create account' }}
        </button>
      </form>
    </div>

    <p class="text-center text-sm text-text-secondary mt-5">
      Already have one?
      <NuxtLink to="/auth/login" class="text-accent hover:underline">Sign in</NuxtLink>
    </p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth', auth: { public: true } });

const auth = useAuth();

const name     = ref('');
const email    = ref('');
const password = ref('');
const error    = ref<string | null>(null);
const loading  = ref(false);

async function submit() {
  error.value = null;
  loading.value = true;
  try {
    await auth.signUp({ email: email.value, password: password.value, name: name.value });
    await navigateTo('/');
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Sign-up failed';
  } finally {
    loading.value = false;
  }
}

function oauth(provider: 'github' | 'google') {
  auth.signInWithOAuth(provider, '/');
}
</script>
