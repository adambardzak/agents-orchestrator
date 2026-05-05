<template>
  <div class="h-full flex flex-col bg-surface-elevated">
    <!-- Header -->
    <div class="px-4 py-3 border-b border-border flex items-center justify-between">
      <div class="min-w-0">
        <h2 class="font-semibold text-sm flex items-center gap-2">
          <UIcon name="i-ph-magnifying-glass-light" class="w-4 h-4 text-text-secondary" />
          {{ capitalize(task.agentType) }}
        </h2>
        <p class="text-xs text-text-faint font-mono mt-0.5 truncate">{{ task.model }}</p>
      </div>
      <IconButton icon="i-ph-x-light" title="Close" @click="$emit('close')" />
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-5">
      <!-- Status row -->
      <div class="grid grid-cols-2 gap-3">
        <Stat label="Complexity">
          <span
            class="text-[11px] uppercase tracking-wider px-1.5 py-0.5 rounded font-mono"
            :class="complexityClass"
          >
            {{ task.complexity }}
          </span>
        </Stat>
        <Stat label="Status">
          <span class="flex items-center gap-1.5">
            <span
              class="inline-block w-1.5 h-1.5 rounded-full"
              :style="{ backgroundColor: statusColor }"
            />
            <span class="text-sm">{{ task.status }}</span>
          </span>
        </Stat>
      </div>

      <!-- Context -->
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[10px] uppercase tracking-wider text-text-faint font-semibold">Context</span>
          <span class="text-xs font-mono tabular-nums text-text-secondary">
            {{ formatTokens(task.contextTokens) }} / 200k
            <span class="text-text-faint">({{ contextPercent.toFixed(0) }}%)</span>
          </span>
        </div>
        <div class="h-1.5 bg-surface rounded-full overflow-hidden">
          <div
            class="h-full transition-all"
            :class="contextBarColor"
            :style="{ width: `${contextPercent}%` }"
          />
        </div>
      </div>

      <!-- Cost -->
      <div>
        <div class="text-[10px] uppercase tracking-wider text-text-faint font-semibold mb-2">
          Cost breakdown
        </div>
        <div class="space-y-1.5 text-xs">
          <Row label="Input tokens" :value="formatTokens(task.inputTokens)" />
          <Row label="Output tokens" :value="formatTokens(task.outputTokens)" />
          <div class="h-px bg-border my-2" />
          <Row label="Total cost" :value="`$${task.costUsd.toFixed(6)}`" highlight />
        </div>
      </div>

      <!-- Steps -->
      <div>
        <div class="text-[10px] uppercase tracking-wider text-text-faint font-semibold mb-2">
          Progress
        </div>
        <div class="text-xs tabular-nums">
          Step <span class="text-text-primary">{{ task.currentStep }}</span>
          <span class="text-text-faint"> / {{ task.maxSteps }}</span>
        </div>
      </div>

      <!-- Events -->
      <div>
        <div class="text-[10px] uppercase tracking-wider text-text-faint font-semibold mb-2">
          Recent events
        </div>
        <div class="space-y-1 max-h-96 overflow-y-auto">
          <div
            v-for="(event, i) in recentEvents"
            :key="i"
            class="text-xs font-mono bg-surface rounded-md px-2.5 py-1.5 border border-border"
          >
            <div class="flex items-center gap-2 mb-0.5">
              <span :class="eventTypeColor(event.type)" class="font-medium">{{ event.type }}</span>
              <span class="text-text-faint text-[10px] ml-auto">{{ event.timestamp }}</span>
            </div>
            <div v-if="event.type === 'tool_use'" class="text-text-secondary truncate">
              {{ event.name }}
              <span v-if="event.input?.['path']" class="text-text-faint"> → {{ event.input['path'] }}</span>
            </div>
            <div v-else-if="event.type === 'message'" class="text-text-secondary line-clamp-3 font-body">
              {{ event.content }}
            </div>
            <div v-else-if="event.type === 'error'" class="text-failed">
              {{ event.message }}
            </div>
          </div>
          <div v-if="recentEvents.length === 0" class="text-text-faint text-center py-6 text-xs">
            No events yet
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AgentTask, OpencodeEvent } from '@agent-orchestrator/shared';

const props = defineProps<{
  task: AgentTask;
  events: Array<OpencodeEvent & { timestamp: string }>;
}>();

defineEmits<{ close: [] }>();

const MAX_CONTEXT = 200_000;

const contextPercent = computed(() =>
  Math.min((props.task.contextTokens / MAX_CONTEXT) * 100, 100),
);

const contextBarColor = computed(() => {
  const p = contextPercent.value;
  if (p > 80) return 'bg-failed';
  if (p > 60) return 'bg-pending';
  return 'bg-accent';
});

const complexityClass = computed(() => {
  const map: Record<string, string> = {
    trivial:  'bg-surface text-text-faint',
    simple:   'bg-completed-bg text-completed',
    standard: 'bg-running-bg text-running',
    complex:  'bg-pending-bg text-pending',
    expert:   'bg-failed-bg text-failed',
  };
  return map[props.task.complexity] ?? 'bg-surface text-text-secondary';
});

const statusColor = computed(() => {
  const map: Record<string, string> = {
    running:   'var(--color-running)',
    pending:   'var(--color-pending)',
    paused:    'var(--color-paused)',
    completed: 'var(--color-completed)',
    failed:    'var(--color-failed)',
  };
  return map[props.task.status] ?? 'var(--color-text-faint)';
});

const recentEvents = computed(() => [...props.events].slice(-20).reverse());

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function eventTypeColor(type: string): string {
  const map: Record<string, string> = {
    message:     'text-running',
    tool_use:    'text-pending',
    tool_result: 'text-completed',
    usage:       'text-secondary',
    complete:    'text-completed',
    error:       'text-failed',
  };
  return map[type] ?? 'text-text-secondary';
}
</script>
