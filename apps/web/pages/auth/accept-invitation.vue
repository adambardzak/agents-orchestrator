<!--
  Accept-invitation page (`/auth/accept-invitation?token=...`).
  If the user is signed in, calls POST /api/invitations/accept with the token
  and redirects to the new org. If not signed in, prompts them to sign in
  first and round-trips back here.
-->
<template>
  <div class="w-full max-w-sm">
    <div class="border border-border rounded-xl bg-surface-elevated shadow-pop overflow-hidden">
      <div class="px-6 py-6 text-center">
        <UIcon
          :name="status === 'success' ? 'i-ph-check-circle-light' : status === 'error' ? 'i-ph-warning-circle-light' : 'i-ph-envelope-simple-light'"
          :class="['w-10 h-10 mx-auto mb-3', status === 'success' ? 'text-completed' : status === 'error' ? 'text-failed' : 'text-accent']"
        />
        <h1 class="font-heading text-lg font-semibold tracking-tight">
          {{ heading }}
        </h1>
        <p class="text-sm text-text-secondary mt-2">{{ message }}</p>

        <button
          v-if="status === 'idle' && auth.isAuthenticated.value"
          :disabled="loading"
          class="mt-5 inline-flex h-9 px-4 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition disabled:opacity-60"
          @click="accept"
        >
          {{ loading ? 'Accepting…' : 'Accept invitation' }}
        </button>

        <NuxtLink
          v-else-if="status === 'idle' && !auth.isAuthenticated.value"
          :to="`/auth/login?redirect=${encodeURIComponent(`/auth/accept-invitation?token=${token}`)}`"
          class="mt-5 inline-flex h-9 px-4 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition items-center"
        >
          Sign in to accept
        </NuxtLink>

        <NuxtLink
          v-else-if="status === 'success'"
          to="/"
          class="mt-5 inline-flex h-9 px-4 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition items-center"
        >
          Go to workspace
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth', auth: { public: true } });

const route = useRoute();
const auth  = useAuth();
const config = useRuntimeConfig();

const token   = computed(() => String(route.query['token'] ?? ''));
const status  = ref<'idle' | 'success' | 'error'>('idle');
const message = ref('');
const loading = ref(false);

const heading = computed(() => {
  if (status.value === 'success') return 'Welcome aboard';
  if (status.value === 'error') return 'Invitation invalid';
  return 'You\'re invited';
});

if (!token.value) {
  status.value = 'error';
  message.value = 'No invitation token in URL.';
} else if (auth.isAuthenticated.value) {
  message.value = 'Click below to join the workspace you were invited to.';
} else {
  message.value = 'Sign in or create an account to accept this invitation.';
}

async function accept() {
  if (!token.value) return;
  loading.value = true;
  try {
    const res = await fetch(`${config.public.apiBase as string}/api/invitations/accept`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.value }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `Accept failed (${res.status})`);
    }
    const { organization } = (await res.json()) as { organization: { id: string; name: string } };
    await auth.refresh();
    await auth.setActiveOrg(organization.id);
    status.value = 'success';
    message.value = `You've joined "${organization.name}".`;
  } catch (e: unknown) {
    status.value = 'error';
    message.value = e instanceof Error ? e.message : 'Failed to accept invitation.';
  } finally {
    loading.value = false;
  }
}
</script>
