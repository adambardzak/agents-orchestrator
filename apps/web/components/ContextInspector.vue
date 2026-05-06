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

      <!-- QA Results (deterministic post-task validation) -->
      <div v-if="qaResults.length > 0 || qaLoading">
        <div class="text-[10px] uppercase tracking-wider text-text-faint font-semibold mb-2 flex items-center gap-2">
          QA Validation
          <UIcon v-if="qaLoading" name="i-ph-circle-notch-light" class="w-3 h-3 animate-spin" />
        </div>
        <div class="space-y-1.5">
          <div
            v-for="r in qaResults"
            :key="r.tool"
            class="text-xs bg-surface rounded-md px-2.5 py-2 border border-border"
          >
            <div class="flex items-center gap-2 mb-1">
              <span :class="qaStatusClass(r.status)" class="w-1.5 h-1.5 rounded-full flex-shrink-0" />
              <span class="font-mono font-semibold uppercase tracking-wide text-[10px]">{{ r.tool }}</span>
              <span class="text-text-secondary truncate flex-1">{{ r.summary }}</span>
              <span class="text-text-faint text-[10px]">{{ formatDuration(r.durationMs) }}</span>
            </div>
            <div
              v-if="r.details.problems && r.details.problems.length > 0"
              class="space-y-0.5 mt-1.5 max-h-40 overflow-y-auto"
            >
              <div
                v-for="(p, i) in r.details.problems.slice(0, 8)"
                :key="i"
                class="font-mono text-[11px] leading-tight"
                :class="p.severity === 'error' ? 'text-failed' : 'text-pending'"
              >
                <span v-if="p.file" class="text-text-faint">{{ shortPath(p.file) }}</span>
                <span v-if="p.line" class="text-text-faint">:{{ p.line }}</span>
                <span class="ml-1">{{ p.message }}</span>
                <span v-if="p.rule" class="text-text-faint"> [{{ p.rule }}]</span>
              </div>
              <div v-if="r.details.problems.length > 8" class="text-text-faint text-[10px] italic">
                +{{ r.details.problems.length - 8 }} more
              </div>
            </div>
          </div>
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
import type { QaResult } from '~/composables/useTaskQa';

const props = defineProps<{
  task: AgentTask;
  events: Array<OpencodeEvent & { timestamp: string }>;
}>();

defineEmits<{ close: [] }>();

// ── QA validation results ──────────────────────────────────────────────────
const qaApi = useTaskQa();
const qaResults = ref<QaResult[]>([]);
const qaLoading = ref(false);

async function loadQa(taskId: string): Promise<void> {
  qaLoading.value = true;
  try {
    qaResults.value = await qaApi.fetchForTask(taskId);
  } catch {
    qaResults.value = [];
  } finally {
    qaLoading.value = false;
  }
}

// Re-fetch when the inspected task changes; also poll once when status flips
// to completed (QA runs async after the task settles).
watch(() => props.task.id, (id) => { if (id) void loadQa(id); }, { immediate: true });
watch(() => props.task.status, (status) => {
  if (status === 'completed') {
    // Poll twice with backoff — QA usually finishes within ~10s for small projects.
    setTimeout(() => void loadQa(props.task.id), 3000);
    setTimeout(() => void loadQa(props.task.id), 12000);
  }
});

function qaStatusClass(status: QaResult['status']): string {
  switch (status) {
    case 'passed':  return 'bg-completed';
    case 'failed':  return 'bg-failed';
    case 'error':   return 'bg-failed';
    case 'skipped': return 'bg-text-faint';
    default:        return 'bg-text-faint';
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function shortPath(path: string): string {
  // Keep last 2 segments
  const parts = path.split('/');
  return parts.length > 2 ? '.../' + parts.slice(-2).join('/') : path;
}

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
