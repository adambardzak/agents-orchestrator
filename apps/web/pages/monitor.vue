<template>
  <div class="flex h-[calc(100vh-57px)]">

    <!-- ── Sidebar: pipeline list ──────────────────────────────────────────── -->
    <aside class="w-72 border-r border-border bg-surface-elevated flex flex-col shrink-0">
      <div class="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 class="text-sm font-semibold">Pipelines</h2>
        <div class="flex items-center gap-2">
          <span
            v-if="runningSessionCount > 0"
            class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium tabular-nums bg-running-bg text-running"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-running animate-pulse" />
            {{ runningSessionCount }} live
          </span>
          <UButton
            size="xs"
            variant="ghost"
            icon="i-ph-arrows-clockwise-light"
            :loading="loadingList"
            @click="reloadList"
          />
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-2">
        <div v-if="loadingList && sessionList.length === 0" class="flex items-center justify-center py-12 text-text-muted text-sm gap-2">
          <UIcon name="i-ph-circle-notch-light" class="w-4 h-4 animate-spin" />
          Loading…
        </div>
        <div v-else-if="sessionList.length === 0" class="text-center text-text-muted text-sm py-12">
          No pipelines yet
        </div>

        <button
          v-for="s in sessionList"
          :key="s.id"
          class="w-full text-left px-3 py-2.5 rounded-md mb-1 transition-colors relative border"
          :class="s.id === selectedSessionId
            ? 'bg-surface-active border-border-strong text-text-primary'
            : isRunning(s)
            ? 'bg-running-bg border-running/20 hover:bg-surface-hover text-text-primary'
            : 'border-transparent hover:bg-surface-hover text-text-secondary'"
          @click="selectSession(s.id)"
        >
          <!-- Running pulse indicator -->
          <span
            v-if="isRunning(s)"
            class="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-running animate-pulse"
          />

          <div class="flex items-center gap-2 pr-4">
            <span
              class="w-1.5 h-1.5 rounded-full flex-shrink-0"
              :class="{
                'bg-running': isRunning(s),
                'bg-completed': s.status === 'completed',
                'bg-failed':   s.status === 'failed',
                'bg-pending': s.status === 'active' && !isRunning(s),
              }"
            />
            <span class="text-xs font-medium truncate flex-1">{{ s.userPrompt }}</span>
          </div>

          <div class="flex items-center justify-between mt-1 text-[11px] text-text-muted pl-3.5">
            <span>{{ formatDate(s.createdAt) }}</span>
            <span v-if="Number(s.totalCostUsd) > 0" class="tabular-nums">${{ Number(s.totalCostUsd).toFixed(3) }}</span>
            <span
              v-else
              class="capitalize"
              :class="{
                'text-completed': s.status === 'completed',
                'text-failed':   s.status === 'failed',
                'text-running':  isRunning(s),
                'text-pending': s.status === 'active',
              }"
            >{{ s.status }}</span>
          </div>
        </button>
      </div>
    </aside>

    <!-- ── Main panel ──────────────────────────────────────────────────────── -->
    <div class="flex-1 flex flex-col overflow-hidden">

      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-3 border-b border-border bg-surface-elevated shrink-0">
        <div class="flex items-center gap-3">
          <h1 class="text-sm font-semibold">Agent Monitor</h1>
          <span v-if="selectedSession" class="text-text-muted font-mono text-xs">
            {{ selectedSession.id.slice(0, 8) }}
          </span>
          <span v-if="selectedSession" class="text-xs font-medium tabular-nums">
            ${{ selectedTotalCost.toFixed(4) }}
            <span class="text-text-muted">/ ${{ selectedSession.budgetCapUsd }}</span>
          </span>
          <span v-if="hasRunningTasks" class="flex items-center gap-1.5 text-running text-xs font-medium">
            <span class="w-1.5 h-1.5 rounded-full bg-running animate-pulse" />
            Live
          </span>
        </div>
        <div v-if="selectedSession" class="flex items-center gap-2">
          <!-- View toggle -->
          <UButtonGroup size="xs">
            <UButton
              :variant="viewMode === 'tree' ? 'solid' : 'ghost'"
              icon="i-ph-tree-light"
              @click="viewMode = 'tree'"
            >Tree</UButton>
            <UButton
              :variant="viewMode === 'board' ? 'solid' : 'ghost'"
              icon="i-ph-kanban-light"
              @click="viewMode = 'board'"
            >Board</UButton>
          </UButtonGroup>
          <UButton size="xs" variant="ghost" icon="i-ph-play-circle-light" @click="openReplay">Replay</UButton>
          <UButton size="xs" variant="ghost" icon="i-ph-arrows-clockwise-light" :loading="refreshing" @click="refreshSelected">Refresh</UButton>
          <UButton
            v-if="vsCodeLink"
            size="xs"
            variant="ghost"
            icon="i-ph-code-light"
            :to="vsCodeLink"
            target="_blank"
            rel="noopener"
          >VS Code</UButton>
        </div>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-6">

        <!-- No session selected -->
        <div v-if="!selectedSessionId" class="flex flex-col items-center justify-center h-full text-text-muted">
          <UIcon name="i-ph-git-branch-light" class="w-12 h-12 mb-3 opacity-40" />
          <p class="text-sm">Select a pipeline from the sidebar</p>
          <UButton to="/" variant="ghost" size="sm" class="mt-3">Start a new session</UButton>
        </div>

        <!-- Loading selected session -->
        <div v-else-if="loadingSelected" class="flex items-center justify-center h-full text-text-muted text-sm gap-2">
          <UIcon name="i-ph-circle-notch-light" class="w-4 h-4 animate-spin" />
          Loading pipeline…
        </div>

        <!-- Board view -->
        <div v-else-if="viewMode === 'board'" class="h-full flex flex-col">
          <!-- Prompt banner -->
          <div v-if="selectedSession" class="mb-4 px-4 py-2.5 rounded-lg bg-surface-elevated border border-border text-sm text-text-secondary shrink-0">
            <span class="text-text-muted text-xs mr-2">prompt</span>{{ selectedSession.userPrompt }}
          </div>

          <div v-if="tickets.length === 0" class="flex-1 flex flex-col items-center justify-center text-text-muted text-sm gap-2">
            <UIcon name="i-ph-list-checks-light" class="w-10 h-10 opacity-40" />
            <p>No tickets yet — the planner agents haven't produced any.</p>
            <p class="text-xs opacity-70">Tickets are auto-generated when the pipeline runs.</p>
          </div>

          <TicketBoard
            v-else
            :tickets="tickets"
            class="flex-1 min-h-0"
            @open="openTicket"
            @move="onTicketMove"
          />
        </div>

        <!-- Task tree -->
        <div v-else-if="viewMode === 'tree'" class="space-y-1">
          <!-- Prompt banner -->
          <div v-if="selectedSession" class="mb-4 px-4 py-2.5 rounded-lg bg-surface-elevated border border-border text-sm text-text-secondary">
            <span class="text-text-muted text-xs mr-2">prompt</span>{{ selectedSession.userPrompt }}
          </div>

          <!-- Waiting for orchestrator -->
          <div v-if="selectedTasks.length === 0" class="flex items-center gap-2 text-text-muted text-sm py-8 justify-center">
            <UIcon name="i-ph-circle-notch-light" class="w-4 h-4 animate-spin" />
            Waiting for orchestrator to create tasks…
          </div>

          <!-- Real DAG view -->
          <div v-else class="overflow-x-auto pb-4">
            <TaskTreeGraph
              :tasks="selectedTasks"
              :events-by-task="taskEventsMap"
              @inspect="onInspectTask"
              @inject="openInject"
              @stop="onStopTask"
            />
          </div>
        </div>

      </div>
    </div>

    <!-- ── Context Inspector slide-over ──────────────────────────────────── -->
    <USlideover v-model="showInspector">
      <ContextInspector
        v-if="inspectedTask"
        :task="inspectedTask"
        :events="getTaskEvents(inspectedTask.id)"
        @close="inspectedTaskId = null"
        @inject="openInject(inspectedTask)"
      />
    </USlideover>

    <!-- ── Context Inject modal ───────────────────────────────────────────── -->
    <UModal v-model="showInjectModal" :ui="{ width: 'sm:max-w-lg' }">
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-ph-chat-circle-plus-light" class="w-4 h-4 text-primary" />
            <p class="font-semibold text-sm">Inject Message</p>
            <UBadge v-if="injectTarget" color="blue" variant="subtle" size="xs" class="ml-1 capitalize">
              {{ injectTarget.agentType }}
            </UBadge>
          </div>
        </template>
        <div class="space-y-3">
          <p class="text-xs text-text-secondary">
            This message will be written to the agent's context inject file
            (<code class="font-mono">.opencode/context-inject.md</code>).
          </p>
          <UTextarea v-model="injectMessage" placeholder="E.g.: Also add error handling for network timeouts..." :rows="4" autofocus />
          <p v-if="injectError" class="text-xs text-failed">{{ injectError }}</p>
        </div>
        <template #footer>
          <div class="flex justify-end gap-3">
            <UButton variant="ghost" @click="showInjectModal = false">Cancel</UButton>
            <UButton icon="i-ph-paper-plane-tilt-light" :loading="injecting" :disabled="!injectMessage.trim()" @click="sendInject">Inject</UButton>
          </div>
        </template>
      </UCard>
    </UModal>

    <!-- ── Session Replay drawer ──────────────────────────────────────────── -->
    <USlideover v-model="showReplay" side="right" :ui="{ width: 'w-[600px]' }">
      <div class="flex flex-col h-full bg-surface overflow-hidden">
        <div class="px-5 py-4 border-b border-border flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-ph-play-circle-light" class="w-4 h-4 text-primary" />
            <p class="font-semibold text-sm">Session Replay</p>
            <UBadge color="gray" variant="subtle" size="xs">{{ replayEvents.length }} events</UBadge>
          </div>
          <div class="flex items-center gap-2">
            <USelect v-model="replayTaskFilter" :options="replayTaskOptions" placeholder="All tasks" size="xs" class="w-40" />
            <UButton size="xs" variant="ghost" icon="i-ph-x-light" @click="showReplay = false" />
          </div>
        </div>
        <div class="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
          <div v-if="replayLoading" class="flex items-center justify-center py-12 text-text-muted text-sm gap-2">
            <UIcon name="i-ph-circle-notch-light" class="w-4 h-4 animate-spin" />
            Loading events…
          </div>
          <div v-else-if="filteredReplayEvents.length === 0" class="py-12 text-center text-text-muted text-sm">
            No events found.
          </div>
          <div v-for="(evt, idx) in filteredReplayEvents" :key="idx" class="flex gap-3 text-xs group">
            <span class="text-text-muted font-mono w-20 shrink-0 pt-0.5">{{ fmtTime(evt.created_at) }}</span>
            <span class="shrink-0 w-4 pt-0.5" :class="replayEventColor(evt.event_type)">{{ replayEventIcon(evt.event_type) }}</span>
            <div class="min-w-0 flex-1">
              <span class="text-text-muted capitalize">{{ evt.event_type }}</span>
              <span v-if="evt.agent_type" class="ml-1 text-text-muted opacity-60">· {{ evt.agent_type }}</span>
              <div
                v-if="replayEventContent(evt)"
                class="mt-0.5 text-text-secondary font-mono text-[11px] break-all leading-relaxed max-h-24 overflow-hidden group-hover:max-h-none transition-all"
              >{{ replayEventContent(evt) }}</div>
            </div>
          </div>
        </div>
      </div>
    </USlideover>

    <!-- ── Ticket detail slide-over ────────────────────────────────────────── -->
    <USlideover v-model="showTicketDetail" side="right" :ui="{ width: 'w-[640px]' }">
      <TicketDetail
        :ticket="selectedTicket"
        :vs-code-url="vsCodeLink"
        @close="showTicketDetail = false"
        @updated="onTicketUpdated"
      />
    </USlideover>
  </div>
</template>

<script setup lang="ts">
import { useSessionStore } from '~/stores/session';
import { useProjectStore } from '~/stores/project';
import { useOrchestratorApi } from '~/composables/useOrchestratorApi';
import { useCodeServerLink } from '~/composables/useCodeServerLink';
import { useLocalStorage } from '@vueuse/core';
import type { AgentTask, Session, OpencodeEvent, Ticket, TicketStatus } from '@agent-orchestrator/shared';
import type { TimestampedEvent } from '~/stores/session';

useHead({ title: 'Monitor — Agent Orchestrator' });

const sessionStore = useSessionStore();
const projectStore = useProjectStore();
const apiStore     = reactive(useOrchestratorApi());
const config       = useRuntimeConfig();

// ── Session list (sidebar) ─────────────────────────────────────────────────────

const sessionList   = ref<Session[]>([]);
const loadingList   = ref(false);

const runningSessionCount = computed(
  () => sessionList.value.filter((s) => s.status === 'active').length,
);

function isRunning(s: Session): boolean {
  return s.status === 'active';
}

async function reloadList() {
  loadingList.value = true;
  try {
    const pid = projectStore.activeProject?.id;
    const { sessions } = await apiStore.listSessions({ limit: 50, ...(pid ? { projectId: pid } : {}) });
    sessionList.value = sessions;
  } catch (e) {
    console.error('Failed to load session list:', e);
  } finally {
    loadingList.value = false;
  }
}

// ── Selected session + tasks (local state, independent of sessionStore) ────────

const selectedSessionId = ref<string | null>(null);
const selectedSession   = ref<Session | null>(null);
const selectedTasks     = ref<AgentTask[]>([]);
const taskEventsMap     = reactive<Map<string, TimestampedEvent[]>>(new Map());
const loadingSelected   = ref(false);

const selectedTotalCost = computed(
  () => selectedTasks.value.reduce((sum, t) => sum + (t.costUsd ?? 0), 0),
);

const hasRunningTasks = computed(
  () => selectedTasks.value.some((t) => t.status === 'running'),
);

// ── VS Code (code-server) deep-link for the current session ────────────────
const { buildLink: buildCodeLink } = useCodeServerLink();
const vsCodeLink = computed(() => {
  const s = selectedSession.value as (Session & { projectWorkspacePath?: string | null }) | null;
  if (!s?.projectWorkspacePath) return '';
  return buildCodeLink({
    workspacePath: s.projectWorkspacePath,
    sessionId: s.id,
  });
});

function getTaskEvents(taskId: string): TimestampedEvent[] {
  return taskEventsMap.get(taskId) ?? [];
}

async function selectSession(sid: string) {
  if (selectedSessionId.value === sid) return;
  selectedSessionId.value = sid;
  selectedSession.value   = null;
  selectedTasks.value     = [];
  taskEventsMap.clear();
  expandedIds.clear();
  await loadSelectedSession();
}

async function loadSelectedSession() {
  const sid = selectedSessionId.value;
  if (!sid) return;
  loadingSelected.value = true;
  try {
    const { session, tasks } = await apiStore.getSession(sid);
    selectedSession.value = session;
    selectedTasks.value   = tasks;

    // Update cost in sidebar list too
    const listEntry = sessionList.value.find((s) => s.id === sid);
    if (listEntry) Object.assign(listEntry, { totalCostUsd: session.totalCostUsd, status: session.status });

    // Load events for tasks that don't have them yet
    await Promise.all(
      tasks
        .filter((t) => t.status !== 'pending' && !taskEventsMap.has(t.id))
        .map((t) => loadTaskEvents(t.id, sid)),
    );

    // Also load tickets for board view
    await loadTickets(sid);
  } catch (e) {
    console.error('Failed to load session:', e);
  } finally {
    loadingSelected.value = false;
  }
}

// ── Tickets / Board view ─────────────────────────────────────────────────────
const viewMode = useLocalStorage<'tree' | 'board'>('monitor-view-mode', 'tree');
const tickets = ref<Ticket[]>([]);
const selectedTicket = ref<Ticket | null>(null);
const showTicketDetail = ref(false);

async function loadTickets(sid: string) {
  try {
    const { tickets: list } = await apiStore.listTickets(sid);
    tickets.value = list;
  } catch (e) {
    console.warn('Failed to load tickets:', e);
    tickets.value = [];
  }
}

function openTicket(t: Ticket) {
  selectedTicket.value = t;
  showTicketDetail.value = true;
}

async function onTicketMove(ticketId: string, status: TicketStatus) {
  // Optimistic local update
  const idx = tickets.value.findIndex((t) => t.id === ticketId);
  if (idx === -1) return;
  const prevStatus = tickets.value[idx]!.status;
  tickets.value[idx] = { ...tickets.value[idx]!, status };
  try {
    await apiStore.updateTicketStatus(ticketId, status);
  } catch (e) {
    console.error('Failed to move ticket', e);
    // revert
    tickets.value[idx] = { ...tickets.value[idx]!, status: prevStatus };
  }
}

async function onTicketUpdated() {
  if (selectedSessionId.value) await loadTickets(selectedSessionId.value);
  if (selectedTicket.value) {
    const fresh = tickets.value.find((t) => t.id === selectedTicket.value!.id);
    if (fresh) selectedTicket.value = fresh;
  }
}

async function loadTaskEvents(taskId: string, sid: string) {
  try {
    const res = await fetch(
      `${config.public.apiBase}/api/sessions/${sid}/events?taskId=${taskId}&limit=100`,
    );
    if (!res.ok) return;
    const { events } = await res.json() as { events: Array<{ event_type: string; payload: unknown; created_at: string }> };
    const mapped: TimestampedEvent[] = events.map((row) => ({
      ...(row.payload as OpencodeEvent),
      timestamp: row.created_at,
    }));
    taskEventsMap.set(taskId, mapped);
  } catch { /* ignore */ }
}

const refreshing = ref(false);

async function refreshSelected() {
  const sid = selectedSessionId.value;
  if (!sid) return;
  refreshing.value = true;
  try {
    const { session, tasks } = await apiStore.getSession(sid);
    selectedSession.value = session;

    for (const serverTask of tasks) {
      const existing = selectedTasks.value.find((t) => t.id === serverTask.id);
      if (existing) {
        Object.assign(existing, serverTask);
      } else {
        selectedTasks.value.push(serverTask);
      }
    }

    // Reload events for tasks without them
    await Promise.all(
      tasks
        .filter((t) => t.status !== 'pending' && (!taskEventsMap.has(t.id) || taskEventsMap.get(t.id)!.length === 0))
        .map((t) => loadTaskEvents(t.id, sid)),
    );
  } catch (e) {
    console.error('Monitor refresh failed:', e);
  } finally {
    refreshing.value = false;
  }
}

// ── Tree view ──────────────────────────────────────────────────────────────────

interface TreeRow { task: AgentTask; depth: number; }

const treeRows = computed((): TreeRow[] => {
  const tasks = selectedTasks.value;
  if (!tasks.length) return [];

  const rows: TreeRow[] = [];
  const orchestrator = tasks.find((t) => t.agentType === 'orchestrator');
  if (orchestrator) rows.push({ task: orchestrator, depth: 0 });

  const rest = tasks
    .filter((t) => t.agentType !== 'orchestrator')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  for (const t of rest) rows.push({ task: t, depth: 1 });

  return rows;
});

const expandedIds = reactive<Set<string>>(new Set());
function toggleExpand(taskId: string) {
  if (expandedIds.has(taskId)) expandedIds.delete(taskId);
  else expandedIds.add(taskId);
}

// ── Task summary line ──────────────────────────────────────────────────────────

function getTaskSummaryLine(task: AgentTask): string {
  const events = getTaskEvents(task.id);

  if (task.status === 'pending') {
    if (task.dependsOn.length > 0) {
      const depLabels = task.dependsOn
        .map((depId) => {
          const dep = selectedTasks.value.find((t) => t.id === depId);
          return dep ? dep.agentType : depId.slice(0, 6);
        })
        .join(', ');
      return `Waiting for: ${depLabels}`;
    }
    return 'Queued — starting soon…';
  }
  if (task.status === 'awaiting_approval') return 'Waiting for user approval before proceeding.';
  if (events.length === 0) return task.status === 'running' ? 'Starting…' : '';

  if (task.status === 'completed') {
    const completeEvt = [...events].reverse().find((e) => e.type === 'complete');
    if (completeEvt?.summary) return truncate(completeEvt.summary, 100);
  }

  const lastTool = [...events].reverse().find((e) => e.type === 'tool_use');
  const lastMsg  = [...events].reverse().find((e) => e.type === 'message' && e.content?.trim());

  if (lastTool) {
    const path = (lastTool.input?.['path'] ?? lastTool.input?.['file_path'] ?? lastTool.input?.['filename'] ?? '') as string;
    return path ? `${lastTool.name}: ${path}` : lastTool.name ?? '';
  }
  if (lastMsg?.content) return truncate(lastMsg.content, 100);
  return '';
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// ── Style helpers ──────────────────────────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  orchestrator: 'text-accent',
  architect:    'text-violet-400',
  backend:      'text-sky-400',
  frontend:     'text-cyan-400',
  design:       'text-pink-400',
  qa:           'text-amber-400',
  'visual-qa':  'text-orange-400',
  document:     'text-text-muted',
  infra:        'text-teal-400',
};

function agentTypeColor(type: string): string { return AGENT_COLORS[type] ?? 'text-text-primary'; }

function statusBadgeColor(status: string): 'green' | 'blue' | 'yellow' | 'red' | 'gray' {
  if (status === 'completed') return 'green';
  if (status === 'running')   return 'blue';
  if (status === 'pending' || status === 'awaiting_approval') return 'yellow';
  if (status === 'failed')    return 'red';
  return 'gray';
}

const EVT_ICONS:  Record<string, string> = { message: '💬', tool_use: '🔧', tool_result: '✅', usage: '💰', complete: '🏁', error: '❌', user_inject: '💉' };
const EVT_COLORS: Record<string, string> = { message: 'text-sky-400', tool_use: 'text-amber-400', tool_result: 'text-completed', usage: 'text-violet-400', complete: 'text-completed', error: 'text-failed', user_inject: 'text-cyan-400' };

function eventIcon(type: string)      { return EVT_ICONS[type]  ?? '•'; }
function eventIconColor(type: string) { return EVT_COLORS[type] ?? 'text-text-muted'; }

function fmtEventTime(evt: TimestampedEvent): string {
  try { return new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return ''; }
}

function eventSummary(evt: TimestampedEvent): string {
  if (evt.type === 'message')     return truncate(evt.content ?? '', 120);
  if (evt.type === 'tool_use') {
    const path = (evt.input?.['path'] ?? evt.input?.['file_path'] ?? evt.input?.['filename'] ?? '') as string;
    return path ? `${evt.name} → ${path}` : (evt.name ?? '');
  }
  if (evt.type === 'tool_result') return truncate((evt.output as string) ?? '', 100);
  if (evt.type === 'usage')       return `in: ${evt.input_tokens ?? 0}  out: ${evt.output_tokens ?? 0}`;
  if (evt.type === 'complete')    return truncate(evt.summary ?? '', 120);
  if (evt.type === 'error')       return truncate((evt as unknown as Record<string,string>)['message'] ?? '', 120);
  return '';
}

// ── Inspector ──────────────────────────────────────────────────────────────────

const inspectedTaskId = ref<string | null>(null);
const showInspector   = computed({
  get: () => inspectedTaskId.value !== null,
  set: (v) => { if (!v) inspectedTaskId.value = null; },
});
const inspectedTask = computed(() =>
  inspectedTaskId.value
    ? selectedTasks.value.find((t) => t.id === inspectedTaskId.value) ?? null
    : null,
);

// ── Context Inject ─────────────────────────────────────────────────────────────

const showInjectModal = ref(false);
const injectTarget    = ref<AgentTask | null>(null);
const injectMessage   = ref('');
const injectError     = ref('');
const injecting       = ref(false);

function openInject(task: AgentTask) {
  injectTarget.value    = task;
  injectMessage.value   = '';
  injectError.value     = '';
  showInjectModal.value = true;
}

function onInspectTask(task: AgentTask) {
  inspectedTaskId.value = task.id;
}

async function onStopTask(task: AgentTask) {
  const ok = window.confirm(
    `Stop ${task.agentType} task?\n\nThis cancels the running agent immediately. The task will be marked as cancelled and any in-flight work will be lost.`,
  );
  if (!ok) return;
  try {
    await apiStore.stopTask(task.id);
    // Optimistically reflect cancellation; SSE/poll will reconcile soon.
    const fresh = selectedTasks.value.find((t) => t.id === task.id);
    if (fresh) fresh.status = 'cancelled';
  } catch (e) {
    window.alert(`Failed to stop task: ${(e as Error).message}`);
  }
}

async function sendInject() {
  if (!injectTarget.value || !injectMessage.value.trim()) return;
  injecting.value   = true;
  injectError.value = '';
  try {
    await apiStore.injectToTask(injectTarget.value.id, injectMessage.value.trim());
    showInjectModal.value = false;
    injectMessage.value   = '';
  } catch (e) {
    injectError.value = (e as Error).message;
  } finally {
    injecting.value = false;
  }
}

// ── Session Replay ─────────────────────────────────────────────────────────────

interface ReplayEvent {
  id: string; task_id: string; session_id: string;
  event_type: string; payload: Record<string, unknown>;
  created_at: string; agent_type?: string;
}

const showReplay       = ref(false);
const replayLoading    = ref(false);
const replayEvents     = ref<ReplayEvent[]>([]);
const replayTaskFilter = ref('');

const replayTaskOptions = computed(() => {
  const taskIds = [...new Set(replayEvents.value.map((e) => e.task_id))];
  const opts = taskIds.map((id) => {
    const task = selectedTasks.value.find((t) => t.id === id);
    return { label: task ? `${task.agentType} (${id.slice(0, 6)})` : id.slice(0, 8), value: id };
  });
  return [{ label: 'All tasks', value: '' }, ...opts];
});

const filteredReplayEvents = computed(() =>
  replayTaskFilter.value
    ? replayEvents.value.filter((e) => e.task_id === replayTaskFilter.value)
    : replayEvents.value,
);

async function openReplay() {
  const sid = selectedSessionId.value;
  if (!sid) return;
  showReplay.value    = true;
  replayLoading.value = true;
  try {
    const res = await fetch(`${config.public.apiBase}/api/sessions/${sid}/events?limit=500`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { events: ReplayEvent[] };
    replayEvents.value = data.events.map((e) => ({
      ...e,
      agent_type: selectedTasks.value.find((t) => t.id === e.task_id)?.agentType,
    }));
  } catch (err) {
    console.error('Replay load failed:', err);
  } finally {
    replayLoading.value = false;
  }
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const REPLAY_ICONS:  Record<string, string> = { message: '💬', tool_use: '🔧', tool_result: '✅', usage: '💰', complete: '🏁', error: '❌', user_inject: '💉' };
const REPLAY_COLORS: Record<string, string> = { message: 'text-sky-400', tool_use: 'text-amber-400', tool_result: 'text-completed', usage: 'text-violet-400', complete: 'text-completed', error: 'text-failed', user_inject: 'text-cyan-400' };

function replayEventIcon(type: string)  { return REPLAY_ICONS[type]  ?? '•'; }
function replayEventColor(type: string) { return REPLAY_COLORS[type] ?? 'text-text-muted'; }

function replayEventContent(evt: ReplayEvent): string {
  const p = evt.payload;
  if (evt.event_type === 'message')     return ((p['content'] as string | undefined) ?? '').slice(0, 300);
  if (evt.event_type === 'tool_use') {
    const name  = (p['name']  as string | undefined) ?? '';
    const input = p['input']  as Record<string, unknown> | undefined;
    const path  = input?.['path'] ?? input?.['file_path'] ?? input?.['filename'];
    return path ? `${name} → ${path}` : name;
  }
  if (evt.event_type === 'tool_result') return ((p['output'] as string | undefined) ?? '').slice(0, 200);
  if (evt.event_type === 'usage')       return `in: ${p['input_tokens']} out: ${p['output_tokens']} (${p['model']})`;
  if (evt.event_type === 'complete')    return ((p['summary'] as string | undefined) ?? '').slice(0, 200);
  if (evt.event_type === 'error')       return (p['message'] as string | undefined) ?? '';
  if (evt.event_type === 'user_inject') return (p['message'] as string | undefined) ?? '';
  return '';
}

// ── Polling for running sessions ───────────────────────────────────────────────

let pollTimer: ReturnType<typeof setInterval> | null = null;

watch(hasRunningTasks, (active) => {
  if (active && !pollTimer) {
    pollTimer = setInterval(refreshSelected, 3000);
  } else if (!active && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}, { immediate: true });

// Periodically refresh session list to catch new pipelines started from Chat
let listTimer: ReturnType<typeof setInterval> | null = null;

onUnmounted(() => {
  if (pollTimer)  clearInterval(pollTimer);
  if (listTimer)  clearInterval(listTimer);
});

// ── Date formatter ─────────────────────────────────────────────────────────────

function formatDate(date: Date | string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(date));
}

// ── Mount: load list, auto-select current or first session ────────────────────

onMounted(async () => {
  await reloadList();

  // Auto-select: prefer the current active session from the chat, else first in list
  const currentId = sessionStore.currentSession?.id;
  const autoId = currentId ?? sessionList.value[0]?.id ?? null;
  if (autoId) await selectSession(autoId);

  // Refresh list every 15s to pick up new sessions created from Chat
  listTimer = setInterval(reloadList, 15_000);
});
</script>
