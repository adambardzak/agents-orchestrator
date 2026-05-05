<template>
  <div v-if="ticket" class="flex flex-col h-full bg-surface-elevated overflow-hidden">

    <!-- Header -->
    <header class="px-5 py-3 border-b border-border shrink-0">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-xs font-mono text-text-faint">{{ ticket.ticketKey }}</span>
        <span
          class="text-[10px] font-semibold uppercase tracking-wider"
          :class="agentColor(ticket.agentType)"
        >
          {{ ticket.agentType }}
        </span>

        <span
          class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-mono"
          :class="statusClass(ticket.status)"
        >
          {{ ticket.status.replace('_', ' ') }}
        </span>

        <span v-if="ticket.iteration > 1" class="text-xs text-running font-mono" title="Reopened">
          ↻ {{ ticket.iteration }}
        </span>

        <span v-if="ticket.totalCostUsd > 0" class="ml-auto text-xs text-text-faint font-mono tabular-nums">
          ${{ ticket.totalCostUsd.toFixed(4) }}
        </span>
        <a
          v-if="vsCodeUrl"
          :href="vsCodeUrl"
          target="_blank"
          rel="noopener"
          class="ml-1 inline-flex items-center gap-1 text-xs text-text-faint hover:text-accent transition"
          title="Open this session in VS Code (web)"
        >
          <UIcon name="i-ph-code-light" class="w-3.5 h-3.5" />
          <span>VS Code</span>
        </a>
        <IconButton icon="i-ph-x-light" title="Close" @click="$emit('close')" />
      </div>

      <h2 class="text-base font-semibold leading-snug">{{ ticket.title }}</h2>
    </header>

    <!-- Body -->
    <div class="flex-1 overflow-y-auto px-5 py-4 space-y-5">
      <!-- Description -->
      <section>
        <h3 class="text-[10px] font-semibold uppercase tracking-wider text-text-faint mb-1.5">Description</h3>
        <div class="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">{{ ticket.description }}</div>
      </section>

      <!-- Iterations -->
      <section v-if="iterations.length > 0">
        <h3 class="text-[10px] font-semibold uppercase tracking-wider text-text-faint mb-2">
          History · {{ iterations.length }} iteration{{ iterations.length === 1 ? '' : 's' }}
        </h3>
        <div class="space-y-1.5">
          <div
            v-for="it in iterations"
            :key="it.id"
            class="rounded-md border border-border bg-surface p-2.5 text-xs"
          >
            <div class="flex items-center gap-2 mb-1">
              <span class="font-mono text-text-faint">#{{ it.iteration }}</span>
              <span
                class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-mono"
                :class="statusClass(it.status as TicketStatus)"
              >
                {{ it.status }}
              </span>
              <span class="text-text-faint ml-auto">{{ formatDate(it.createdAt) }}</span>
              <span v-if="it.costUsd > 0" class="text-text-faint font-mono tabular-nums">${{ it.costUsd.toFixed(4) }}</span>
            </div>
            <div v-if="it.injectedContext" class="text-pending italic mb-1">
              <span class="text-text-faint not-italic">+context:</span> {{ it.injectedContext }}
            </div>
            <div v-if="it.summary" class="text-text-secondary line-clamp-3">{{ it.summary }}</div>
          </div>
        </div>
      </section>

      <!-- Comments -->
      <section>
        <h3 class="text-[10px] font-semibold uppercase tracking-wider text-text-faint mb-2">
          Comments · {{ comments.length }}
        </h3>
        <div v-if="comments.length === 0" class="text-text-faint text-xs italic mb-3">
          No comments yet.
        </div>
        <div class="space-y-1.5 mb-3">
          <div
            v-for="c in comments"
            :key="c.id"
            class="rounded-md border border-border bg-surface p-2.5 text-sm"
          >
            <div class="flex items-center gap-2 mb-1 text-xs">
              <span
                class="font-semibold uppercase tracking-wider text-[10px]"
                :class="{
                  'text-running':        c.author === 'user',
                  'text-completed':      c.author === 'agent',
                  'text-text-faint':     c.author === 'system',
                }"
              >
                {{ c.author }}
              </span>
              <span class="text-text-faint">· {{ formatDate(c.createdAt) }}</span>
            </div>
            <div class="text-text-secondary whitespace-pre-wrap">{{ c.body }}</div>
          </div>
        </div>

        <UTextarea
          v-model="newComment"
          placeholder="Add a comment…"
          :rows="3"
          class="w-full"
        />
        <div class="flex justify-end mt-2">
          <UButton
            size="xs"
            icon="i-ph-paper-plane-tilt-light"
            :loading="postingComment"
            :disabled="!newComment.trim()"
            @click="addComment"
          >
            Comment
          </UButton>
        </div>
      </section>
    </div>

    <!-- Footer -->
    <footer class="px-5 py-3 border-t border-border bg-surface shrink-0">
      <div class="flex items-center gap-2">
        <UButton
          v-if="ticket.status === 'done' || ticket.status === 'failed' || ticket.status === 'cancelled'"
          icon="i-ph-arrow-counter-clockwise-light"
          size="xs"
          color="primary"
          @click="showReopenForm = true"
        >
          Reopen with context
        </UButton>

        <UButton
          v-if="ticket.status === 'todo' || ticket.status === 'backlog'"
          icon="i-ph-play-light"
          size="xs"
          variant="ghost"
          @click="markStatus('in_progress')"
        >
          Mark in progress
        </UButton>

        <UButton
          v-if="ticket.status === 'in_progress'"
          icon="i-ph-check-light"
          size="xs"
          variant="ghost"
          color="green"
          @click="markStatus('done')"
        >
          Mark done
        </UButton>

        <span class="ml-auto text-[10px] text-text-faint font-mono">
          updated {{ formatDate(ticket.updatedAt) }}
        </span>
      </div>
    </footer>

    <!-- Reopen modal -->
    <UModal v-model="showReopenForm">
      <UCard>
        <template #header>
          <p class="font-semibold text-sm">Reopen {{ ticket.ticketKey }}</p>
          <p class="text-xs text-text-faint mt-0.5">Add context for the next iteration</p>
        </template>
        <UTextarea
          v-model="reopenComment"
          placeholder="What needs to change? This will be passed as additional context to the agent."
          :rows="5"
          class="w-full"
        />
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton variant="ghost" size="sm" @click="showReopenForm = false">Cancel</UButton>
            <UButton
              icon="i-ph-arrow-counter-clockwise-light"
              size="sm"
              :loading="reopening"
              :disabled="!reopenComment.trim()"
              @click="reopen"
            >
              Reopen + run
            </UButton>
          </div>
        </template>
      </UCard>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import type { Ticket, TicketComment, TicketIteration, TicketStatus } from '@agent-orchestrator/shared';
import { useOrchestratorApi } from '~/composables/useOrchestratorApi';

const props = defineProps<{ ticket: Ticket | null; vsCodeUrl?: string | null }>();
const emit  = defineEmits<{
  (e: 'close'): void;
  (e: 'updated'): void;
}>();

const api = useOrchestratorApi();

const comments       = ref<TicketComment[]>([]);
const iterations     = ref<TicketIteration[]>([]);
const newComment     = ref('');
const postingComment = ref(false);
const showReopenForm = ref(false);
const reopenComment  = ref('');
const reopening      = ref(false);

watch(() => props.ticket?.id, async (id) => {
  if (!id) { comments.value = []; iterations.value = []; return; }
  await loadDetail(id);
}, { immediate: true });

async function loadDetail(ticketId: string) {
  try {
    const { comments: cs, iterations: its } = await api.getTicket(ticketId);
    comments.value = cs;
    iterations.value = its;
  } catch (e) { console.error('Failed to load ticket detail', e); }
}

async function addComment() {
  if (!props.ticket || !newComment.value.trim()) return;
  postingComment.value = true;
  try {
    await api.addTicketComment(props.ticket.id, newComment.value.trim());
    newComment.value = '';
    await loadDetail(props.ticket.id);
  } catch (e) { console.error('Failed to add comment', e); }
  finally { postingComment.value = false; }
}

async function markStatus(status: TicketStatus) {
  if (!props.ticket) return;
  try {
    await api.updateTicketStatus(props.ticket.id, status);
    emit('updated');
  } catch (e) { console.error('Failed to update status', e); }
}

async function reopen() {
  if (!props.ticket || !reopenComment.value.trim()) return;
  reopening.value = true;
  try {
    await api.reopenTicket(props.ticket.id, reopenComment.value.trim());
    reopenComment.value = '';
    showReopenForm.value = false;
    emit('updated');
    await loadDetail(props.ticket.id);
  } catch (e) {
    console.error('Failed to reopen', e);
    alert('Failed to reopen: ' + (e as Error).message);
  } finally { reopening.value = false; }
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function statusClass(s: TicketStatus): string {
  const map: Record<string, string> = {
    backlog:     'bg-surface text-text-faint',
    todo:        'bg-pending-bg text-pending',
    in_progress: 'bg-running-bg text-running',
    done:        'bg-completed-bg text-completed',
    failed:      'bg-failed-bg text-failed',
    cancelled:   'bg-surface text-text-faint',
    completed:   'bg-completed-bg text-completed',
    running:     'bg-running-bg text-running',
  };
  return map[s as string] ?? 'bg-surface text-text-secondary';
}

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

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleString();
}
</script>
