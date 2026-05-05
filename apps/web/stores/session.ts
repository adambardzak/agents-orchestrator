import { defineStore } from 'pinia';
import type { Session, AgentTask, OpencodeEvent, TaskStatus, SessionUpdatePayload, ClarificationPayload } from '@agent-orchestrator/shared';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** If content was a valid orchestrator plan JSON, parsed here for rich rendering */
  plan?: {
    analysis?: string;
    tasks: Array<{ id: string; agentType: string; prompt: string; complexity: string; dependsOn: string[] }>;
  };
  timestamp: string; // ISO — serializable
}

export type TimestampedEvent = OpencodeEvent & { timestamp: string };

export const useSessionStore = defineStore('session', () => {
  // ── Core state ──────────────────────────────────────────────────────────────
  const currentSession = ref<Session | null>(null);

  // tasks as a reactive array — mutations via Object.assign on found item
  const tasks = ref<AgentTask[]>([]);

  // taskEventLogs as reactive plain object (Record) instead of ref(Map)
  // Vue tracks property additions/mutations on reactive objects reliably
  const taskEventLogs = reactive<Record<string, TimestampedEvent[]>>({});

  // Chat messages — persisted so they survive navigation
  const messages = ref<ChatMessage[]>([]);

  // Session history (sidebar)
  const sessionHistory = ref<Session[]>([]);

  // Loading / error states
  const isCreatingSession = ref(false);
  const error = ref<string | null>(null);

  // Clarification questions from orchestrator (cleared when user submits answers)
  const pendingClarification = ref<ClarificationPayload | null>(null);

  // ── Computed ────────────────────────────────────────────────────────────────
  const runningTasks = computed(() => tasks.value.filter((t) => t.status === 'running'));
  const pendingTasks = computed(() => tasks.value.filter((t) => t.status === 'pending'));
  const completedTasks = computed(() => tasks.value.filter((t) => t.status === 'completed'));
  const totalCost = computed(() => tasks.value.reduce((sum, t) => sum + t.costUsd, 0));
  const isSessionActive = computed(() => currentSession.value?.status === 'active');

  // ── Actions ─────────────────────────────────────────────────────────────────

  function setSession(session: Session, sessionTasks: AgentTask[]) {
    currentSession.value = session;
    tasks.value = sessionTasks;
    for (const task of sessionTasks) {
      if (!taskEventLogs[task.id]) {
        taskEventLogs[task.id] = [];
      }
    }
  }

  function addTask(task: AgentTask) {
    const idx = tasks.value.findIndex((t) => t.id === task.id);
    if (idx >= 0) {
      // Mutate in place — Vue detects property changes on reactive array items
      Object.assign(tasks.value[idx]!, task);
    } else {
      tasks.value.push(task);
      taskEventLogs[task.id] = [];
    }
  }

  function updateTaskStatus(taskId: string, status: TaskStatus, extra?: Partial<AgentTask>) {
    const task = tasks.value.find((t) => t.id === taskId);
    if (task) {
      Object.assign(task, { status, ...extra });
    }
  }

  function updateTaskCost(taskId: string, inputTokensDelta: number, outputTokensDelta: number, costUsdCumulative: number) {
    const task = tasks.value.find((t) => t.id === taskId);
    if (task) {
      task.inputTokens  += inputTokensDelta;
      task.outputTokens += outputTokensDelta;
      task.costUsd       = costUsdCumulative; // cumulative from server cost tracker
    }
    // keep session total in sync
    if (currentSession.value) {
      currentSession.value.totalCostUsd = tasks.value.reduce((s, t) => s + t.costUsd, 0);
    }
  }

  function appendTaskEvent(taskId: string, event: OpencodeEvent & { timestamp?: string }) {
    if (!taskEventLogs[taskId]) {
      taskEventLogs[taskId] = [];
    }
    const log = taskEventLogs[taskId]!;
    // cap at 500 events per task
    if (log.length >= 500) log.shift();
    log.push({ ...event, timestamp: event.timestamp ?? new Date().toISOString() } as TimestampedEvent);
  }

  function getTaskEvents(taskId: string): TimestampedEvent[] {
    return taskEventLogs[taskId] ?? [];
  }

  function addMessage(msg: ChatMessage) {
    messages.value.push(msg);
  }

  function clearMessages() {
    messages.value = [];
  }

  function clearSession() {
    if (currentSession.value) {
      sessionHistory.value.unshift(currentSession.value);
    }
    currentSession.value = null;
    tasks.value = [];
    // clear event logs by deleting all keys
    for (const key of Object.keys(taskEventLogs)) {
      delete taskEventLogs[key];
    }
    messages.value = [];
    error.value = null;
    pendingClarification.value = null;
  }

  /**
   * Restore a session from API data (used after page refresh or clicking history).
   * Does NOT clear messages — caller decides whether to clear first.
   */
  function restoreSession(session: Session, sessionTasks: AgentTask[]) {
    currentSession.value = session;
    tasks.value = sessionTasks;
    for (const task of sessionTasks) {
      if (!taskEventLogs[task.id]) {
        taskEventLogs[task.id] = [];
      }
    }
  }

  /**
   * Replace the entire session history list (loaded from API on mount).
   * Only keeps sessions that are NOT the current one.
   */
  function setSessionHistory(sessions: Session[]) {
    const currentId = currentSession.value?.id;
    sessionHistory.value = sessions.filter((s) => s.id !== currentId);
  }

  /** Apply a session:update WS payload (status/cost change from server). */
  function applySessionUpdate(payload: SessionUpdatePayload) {
    if (currentSession.value?.id === payload.sessionId) {
      currentSession.value.status = payload.status;
      currentSession.value.totalCostUsd = payload.totalCostUsd;
    }
    const inHistory = sessionHistory.value.find((s) => s.id === payload.sessionId);
    if (inHistory) {
      inHistory.status = payload.status;
      inHistory.totalCostUsd = payload.totalCostUsd;
    }
  }

  function removeFromHistory(sessionId: string) {
    sessionHistory.value = sessionHistory.value.filter((s) => s.id !== sessionId);
  }

  function setClarification(payload: ClarificationPayload) {
    pendingClarification.value = payload;
  }

  function clearClarification() {
    pendingClarification.value = null;
  }

  return {
    currentSession,
    tasks,
    taskEventLogs,
    messages,
    sessionHistory,
    isCreatingSession,
    error,
    pendingClarification,
    runningTasks,
    pendingTasks,
    completedTasks,
    totalCost,
    isSessionActive,
    setSession,
    restoreSession,
    setSessionHistory,
    applySessionUpdate,
    addTask,
    addMessage,
    clearMessages,
    updateTaskStatus,
    updateTaskCost,
    appendTaskEvent,
    getTaskEvents,
    clearSession,
    setClarification,
    clearClarification,
    removeFromHistory,
  };
});
