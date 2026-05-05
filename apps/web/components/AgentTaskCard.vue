<template>
  <div
    class="rounded-md border bg-surface-elevated px-3 py-2.5 flex flex-col gap-2 transition group hover:border-border-strong"
    :class="cardClass"
  >
    <!-- Header: agent + status -->
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2 min-w-0">
        <span class="relative flex h-2 w-2 shrink-0">
          <span
            v-if="task.status === 'running'"
            class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50"
            :style="{ backgroundColor: statusDotColor }"
          />
          <span
            class="relative inline-flex rounded-full h-2 w-2"
            :style="{ backgroundColor: statusDotColor }"
          />
        </span>
        <span class="font-medium text-sm truncate">{{ capitalize(task.agentType) }}</span>
        <span class="text-[10px] uppercase tracking-wider text-text-faint font-mono shrink-0">
          {{ task.status }}
        </span>
      </div>
      <span class="text-[10px] text-text-faint font-mono shrink-0">
        {{ task.model.split('/')[1] || task.model }}
      </span>
    </div>

    <!-- Current activity -->
    <div
      v-if="lastToolUse"
      class="text-xs text-text-secondary font-mono truncate"
    >
      <span class="text-text-faint">▸</span> {{ lastToolUse.name }}
      <span v-if="lastToolUseFile" class="text-text-faint">{{ lastToolUseFile }}</span>
    </div>

    <div
      v-else-if="lastMessage"
      class="text-xs text-text-secondary line-clamp-2"
    >
      {{ lastMessage.content }}
    </div>

    <!-- Progress bar -->
    <div
      v-if="task.status === 'running' || (task.status === 'completed' && task.currentStep > 0)"
      class="space-y-1"
    >
      <div class="flex justify-between text-[11px] text-text-faint tabular-nums">
        <span>{{ task.currentStep }}/{{ task.maxSteps }} steps</span>
        <span class="text-text-secondary">${{ task.costUsd.toFixed(4) }}</span>
      </div>
      <div class="h-1 bg-surface rounded-full overflow-hidden">
        <div
          class="h-full transition-all duration-300"
          :class="task.status === 'completed' ? 'bg-completed' : 'bg-running'"
          :style="{ width: `${stepProgress}%` }"
        />
      </div>
    </div>

    <!-- Context tokens -->
    <div v-if="task.contextTokens > 0" class="space-y-1">
      <div class="flex justify-between text-[11px] text-text-faint tabular-nums">
        <span>Context</span>
        <span>{{ formatTokens(task.contextTokens) }} / {{ formatTokens(MAX_CONTEXT_TOKENS) }}</span>
      </div>
      <div class="h-0.5 bg-surface rounded-full overflow-hidden">
        <div
          class="h-full transition-all"
          :class="contextUsageColor"
          :style="{ width: `${contextUsagePercent}%` }"
        />
      </div>
    </div>

    <!-- Action row -->
    <div
      v-if="task.status === 'running' || task.status === 'paused'"
      class="flex items-center gap-1 pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
    >
      <IconButton
        v-if="task.status === 'running'"
        icon="i-ph-pause-light"
        title="Pause"
        @click="$emit('pause')"
      />
      <IconButton
        v-if="task.status === 'paused'"
        icon="i-ph-play-light"
        title="Resume"
        @click="$emit('resume')"
      />
      <IconButton
        icon="i-ph-stop-light"
        title="Stop"
        variant="danger"
        @click="$emit('stop')"
      />
      <IconButton
        v-if="task.status === 'running'"
        icon="i-ph-chat-circle-plus-light"
        title="Inject message"
        @click="$emit('inject')"
      />
      <IconButton
        icon="i-ph-magnifying-glass-light"
        title="Inspect"
        class="ml-auto"
        @click="$emit('inspect')"
      />
    </div>

    <div
      v-else-if="task.status === 'completed'"
      class="flex items-center justify-between text-[11px] text-text-faint tabular-nums"
    >
      <span class="flex items-center gap-1 text-completed">
        <UIcon name="i-ph-check-circle-light" class="w-3.5 h-3.5" />
        Completed
      </span>
      <span>${{ task.costUsd.toFixed(4) }} · {{ task.currentStep }} steps</span>
    </div>

    <div
      v-else-if="task.status === 'failed'"
      class="flex items-center gap-1 text-[11px] text-failed"
    >
      <UIcon name="i-ph-x-circle-light" class="w-3.5 h-3.5" />
      Failed
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AgentTask, OpencodeEvent } from '@agent-orchestrator/shared';

const props = defineProps<{
  task: AgentTask;
  events: Array<OpencodeEvent & { timestamp: string }>;
}>();

defineEmits<{
  pause: [];
  resume: [];
  stop: [];
  inject: [];
  inspect: [];
}>();

const MAX_CONTEXT_TOKENS = 200_000;

const cardClass = computed(() => ({
  'border-running/30 bg-running-bg':       props.task.status === 'running',
  'border-border':                          props.task.status !== 'running',
  'opacity-60':                             props.task.status === 'pending',
}));

const statusDotColor = computed(() => {
  const map: Record<string, string> = {
    running:   'var(--color-running)',
    pending:   'var(--color-pending)',
    paused:    'var(--color-paused)',
    completed: 'var(--color-completed)',
    failed:    'var(--color-failed)',
    cancelled: 'var(--color-text-faint)',
    planning:  'var(--color-running)',
  };
  return map[props.task.status] ?? 'var(--color-text-faint)';
});

const stepProgress = computed(() => {
  if (props.task.maxSteps === 0) return 0;
  return Math.min((props.task.currentStep / props.task.maxSteps) * 100, 100);
});

const contextUsagePercent = computed(() =>
  Math.min((props.task.contextTokens / MAX_CONTEXT_TOKENS) * 100, 100),
);

const contextUsageColor = computed(() => {
  const pct = contextUsagePercent.value;
  if (pct > 80) return 'bg-failed';
  if (pct > 60) return 'bg-pending';
  return 'bg-accent';
});

const lastToolUse = computed(() => {
  const events = [...props.events].reverse();
  return events.find((e) => e.type === 'tool_use') as
    | (Extract<OpencodeEvent, { type: 'tool_use' }> & { timestamp: string })
    | undefined;
});

const lastToolUseFile = computed(() => {
  if (!lastToolUse.value) return null;
  const input = lastToolUse.value.input;
  return (input['path'] ?? input['file_path'] ?? input['filename'] ?? null) as string | null;
});

const lastMessage = computed(() => {
  const events = [...props.events].reverse();
  return events.find((e) => e.type === 'message') as
    | (Extract<OpencodeEvent, { type: 'message' }> & { timestamp: string })
    | undefined;
});

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
</script>
