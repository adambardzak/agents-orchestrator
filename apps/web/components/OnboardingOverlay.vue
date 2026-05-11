<template>
  <!--
    OnboardingOverlay — fixed pill at bottom-right showing 4-step setup progress.

    Steps are derived from real backend state on mount:
      1. Connect an AI provider   (POST /api/ai-providers exists)
      2. Connect a Git provider   (GET /api/git/connections returns ≥1)
      3. Create your first project
      4. Run your first task      (any session.status === 'completed')

    Behaviour:
      - Hidden if user dismissed (localStorage flag) or all 4 done.
      - Auto-refreshes when window regains focus and after navigation to /,
        so completing a step elsewhere ticks the checkbox without reload.
      - Each step row is clickable → navigates to the relevant page.
      - "Dismiss" button hides until next manual reset (button in settings later).
  -->
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0 translate-y-2"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="visible"
      class="fixed bottom-4 right-4 z-[60] w-80 rounded-lg border border-border bg-surface-elevated shadow-xl"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-3 py-2 border-b border-border">
        <div class="flex items-center gap-2">
          <UIcon name="i-ph-rocket-launch-light" class="w-4 h-4 text-accent" />
          <span class="text-sm font-medium">Get started</span>
          <span class="text-xs text-text-muted tabular-nums">
            {{ completedCount }}/{{ steps.length }}
          </span>
        </div>
        <button
          type="button"
          class="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          aria-label="Dismiss onboarding"
          @click="dismiss"
        >
          <UIcon name="i-ph-x-light" class="w-3.5 h-3.5" />
        </button>
      </div>

      <!-- Progress bar -->
      <div class="h-1 bg-surface">
        <div
          class="h-full bg-accent transition-all duration-300"
          :style="{ width: `${(completedCount / steps.length) * 100}%` }"
        />
      </div>

      <!-- Steps -->
      <ul class="py-1">
        <li v-for="step in steps" :key="step.id">
          <NuxtLink
            :to="step.to"
            class="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-surface-hover transition-colors group"
            :class="step.done ? 'text-text-muted' : 'text-text-primary'"
          >
            <span
              class="flex items-center justify-center w-5 h-5 rounded-full border shrink-0 transition-colors"
              :class="
                step.done
                  ? 'bg-completed border-completed text-white'
                  : 'border-border-strong text-text-muted group-hover:border-accent group-hover:text-accent'
              "
            >
              <UIcon
                v-if="step.done"
                name="i-ph-check-bold"
                class="w-3 h-3"
              />
              <span v-else class="text-[10px] tabular-nums font-medium">
                {{ step.order }}
              </span>
            </span>

            <span
              class="flex-1 truncate"
              :class="step.done ? 'line-through decoration-text-faint' : ''"
            >
              {{ step.label }}
            </span>

            <UIcon
              v-if="!step.done"
              name="i-ph-arrow-right-light"
              class="w-3.5 h-3.5 text-text-faint group-hover:text-accent transition-colors"
            />
          </NuxtLink>
        </li>
      </ul>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useAIProviders } from '~/composables/useAIProviders';
import { useGitConnections } from '~/composables/useGitConnections';
import { useOrchestratorApi } from '~/composables/useOrchestratorApi';
import { useSessionStore } from '~/stores/session';

const DISMISS_KEY = 'onboarding-dismissed-v1';

const ai       = useAIProviders();
const git      = useGitConnections();
const api      = useOrchestratorApi();
const sessions = useSessionStore();

const dismissed = ref(false);

const hasAI       = ref(false);
const hasGit      = ref(false);
const hasProject  = ref(false);
const hasTaskRun  = ref(false);

const steps = computed(() => [
  { id: 'ai',      order: 1, label: 'Connect an AI provider', to: '/settings/ai',          done: hasAI.value },
  { id: 'git',     order: 2, label: 'Connect a Git provider', to: '/settings/connections', done: hasGit.value },
  { id: 'project', order: 3, label: 'Create your first project', to: '/projects',          done: hasProject.value },
  { id: 'task',    order: 4, label: 'Run your first task',    to: '/',                     done: hasTaskRun.value },
]);

const completedCount = computed(() => steps.value.filter((s) => s.done).length);
const allDone        = computed(() => completedCount.value === steps.value.length);

const visible = computed(() => !dismissed.value && !allDone.value);

async function refresh(): Promise<void> {
  // Run in parallel; ignore individual failures so one 401/500 doesn't
  // hide the whole overlay during transient errors.
  const results = await Promise.allSettled([
    ai.list(),
    git.listConnections(),
    api.listProjects(),
  ]);

  if (results[0].status === 'fulfilled') hasAI.value      = results[0].value.length > 0;
  if (results[1].status === 'fulfilled') hasGit.value     = results[1].value.length > 0;
  if (results[2].status === 'fulfilled') hasProject.value = results[2].value.projects.length > 0;

  // Task-run signal: session store already tracks history; if any session
  // ever reached completed, step 4 is done.
  hasTaskRun.value = sessions.sessionHistory.some((s) => s.status === 'completed');
}

function dismiss(): void {
  dismissed.value = true;
  try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore quota / private mode */ }
}

function onFocus(): void {
  if (!dismissed.value) void refresh();
}

onMounted(() => {
  try { dismissed.value = localStorage.getItem(DISMISS_KEY) === '1'; } catch { /* noop */ }
  if (!dismissed.value) void refresh();
  window.addEventListener('focus', onFocus);
});

onBeforeUnmount(() => {
  window.removeEventListener('focus', onFocus);
});
</script>
