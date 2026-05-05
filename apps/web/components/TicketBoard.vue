<template>
  <div class="flex gap-3 h-full overflow-x-auto p-4">
    <div
      v-for="col in columns"
      :key="col.status"
      class="flex flex-col w-[280px] shrink-0 rounded-lg bg-surface-elevated border border-border"
      @dragover.prevent
      @drop="onDrop(col.status, $event)"
    >
      <!-- Column header -->
      <div class="px-3 py-2.5 border-b border-border flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span
            class="w-1.5 h-1.5 rounded-full"
            :class="{
              'bg-text-faint':            col.status === 'backlog',
              'bg-pending':               col.status === 'todo',
              'bg-running animate-pulse': col.status === 'in_progress',
              'bg-completed':             col.status === 'done',
            }"
          />
          <span class="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            {{ col.label }}
          </span>
          <span class="ml-auto text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-surface text-text-faint font-mono">
            {{ col.tickets.length }}
          </span>
        </div>
      </div>

      <!-- Column body -->
      <div class="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-[200px]">
        <div
          v-if="col.tickets.length === 0"
          class="text-text-faint text-[11px] text-center py-8 italic"
        >
          drop here
        </div>

        <article
          v-for="t in col.tickets"
          :key="t.id"
          class="rounded-md bg-surface border border-border hover:border-border-strong hover:bg-surface-hover transition cursor-pointer p-2.5 group"
          draggable="true"
          @dragstart="onDragStart(t.id, $event)"
          @click="$emit('open', t)"
        >
          <header class="flex items-center gap-2 mb-1">
            <span class="text-[10px] font-mono text-text-faint">{{ t.ticketKey }}</span>
            <span
              class="text-[10px] font-semibold uppercase tracking-wider"
              :class="agentColor(t.agentType)"
            >
              {{ t.agentType }}
            </span>
            <span
              v-if="t.iteration > 1"
              class="ml-auto text-[10px] text-running font-mono"
              title="Reopened"
            >
              ↻ {{ t.iteration }}
            </span>
            <span
              v-if="t.priority === 'high' || t.priority === 'urgent'"
              class="text-[10px] uppercase font-semibold tracking-wider"
              :class="t.priority === 'urgent' ? 'text-failed' : 'text-pending'"
            >
              {{ t.priority }}
            </span>
          </header>

          <h3 class="text-sm font-medium leading-snug line-clamp-2 text-text-primary">{{ t.title }}</h3>

          <p class="text-[11px] text-text-secondary mt-1 line-clamp-2">{{ t.description }}</p>

          <footer class="flex items-center justify-between mt-2 text-[10px] text-text-faint font-mono tabular-nums">
            <span class="capitalize">{{ t.complexity }}</span>
            <span v-if="t.totalCostUsd > 0">${{ t.totalCostUsd.toFixed(4) }}</span>
          </footer>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Ticket, TicketStatus } from '@agent-orchestrator/shared';

const props = defineProps<{ tickets: Ticket[] }>();
const emit  = defineEmits<{
  (e: 'open', ticket: Ticket): void;
  (e: 'move', ticketId: string, status: TicketStatus): void;
}>();

interface Column {
  status: TicketStatus;
  label: string;
  tickets: Ticket[];
}

const columns = computed<Column[]>(() => {
  const buckets: Record<string, Ticket[]> = {
    backlog: [], todo: [], in_progress: [], done: [],
  };
  for (const t of props.tickets) {
    if (t.status === 'failed' || t.status === 'cancelled') {
      buckets['backlog']!.push(t);
    } else if (buckets[t.status]) {
      buckets[t.status]!.push(t);
    }
  }
  return [
    { status: 'backlog',     label: 'Backlog',     tickets: buckets['backlog']! },
    { status: 'todo',        label: 'Todo',        tickets: buckets['todo']! },
    { status: 'in_progress', label: 'In progress', tickets: buckets['in_progress']! },
    { status: 'done',        label: 'Done',        tickets: buckets['done']! },
  ];
});

function agentColor(t: string): string {
  const map: Record<string, string> = {
    architect: 'text-secondary',
    backend:   'text-completed',
    frontend:  'text-running',
    design:    'text-pending',
    qa:        'text-pending',
    seo:       'text-running',
    document:  'text-text-secondary',
    planner:   'text-completed',
  };
  return map[t] ?? 'text-text-secondary';
}

function onDragStart(ticketId: string, e: DragEvent) {
  if (e.dataTransfer) {
    e.dataTransfer.setData('text/plain', ticketId);
    e.dataTransfer.effectAllowed = 'move';
  }
}

function onDrop(status: TicketStatus, e: DragEvent) {
  const ticketId = e.dataTransfer?.getData('text/plain');
  if (!ticketId) return;
  emit('move', ticketId, status);
}
</script>
