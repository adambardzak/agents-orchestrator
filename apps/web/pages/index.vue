<template>
  <div class="flex h-[calc(100vh-57px)]">
    <!-- Sidebar — session history -->
    <aside class="w-64 border-r border-border bg-surface-elevated flex flex-col">
      <div class="p-4 border-b border-border">
        <UButton
          block
          icon="i-ph-plus-light"
          @click="startNewSession"
          :loading="sessionStore.isCreatingSession"
        >
          New Session
        </UButton>
      </div>

      <div class="flex-1 overflow-y-auto p-2">
        <div v-if="filteredHistory.length === 0" class="text-center text-text-muted text-sm py-8">
          {{ projectStore.activeProject ? 'No sessions for this project' : 'No previous sessions' }}
        </div>
        <div
          v-for="session in filteredHistory"
          :key="session.id"
          class="w-full text-left p-3 rounded-lg hover:bg-surface mb-1 group transition-opacity relative"
          :class="loadingSessionId === session.id ? 'opacity-60 cursor-wait' : 'cursor-pointer'"
          @click="loadingSessionId === null && loadSession(session.id)"
        >
          <div class="flex items-center gap-1.5 pr-5">
            <UIcon
              v-if="loadingSessionId === session.id"
              name="i-ph-circle-notch-light"
              class="w-3 h-3 animate-spin text-text-muted flex-shrink-0"
            />
            <span class="text-sm font-medium truncate">{{ session.userPrompt }}</span>
          </div>
          <div class="text-xs text-text-muted mt-1 flex justify-between">
            <span>{{ formatDate(session.createdAt) }}</span>
            <span
              v-if="Number(session.totalCostUsd) > 0"
              class="tabular-nums"
            >${{ Number(session.totalCostUsd).toFixed(3) }}</span>
            <span
              v-else
              class="capitalize"
              :class="session.status === 'completed' ? 'text-completed' : session.status === 'failed' ? 'text-failed' : 'text-pending'"
            >{{ session.status }}</span>
          </div>
          <!-- Delete button — visible on hover -->
          <button
            class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-failed/20 text-text-muted hover:text-failed"
            :class="deletingSessionId === session.id ? 'opacity-100' : ''"
            :disabled="deletingSessionId === session.id"
            title="Delete session"
            @click="deleteSession($event, session.id)"
          >
            <UIcon
              :name="deletingSessionId === session.id ? 'i-ph-circle-notch-light' : 'i-ph-trash-light'"
              class="w-3.5 h-3.5"
              :class="deletingSessionId === session.id ? 'animate-spin' : ''"
            />
          </button>
        </div>
      </div>
    </aside>

    <!-- Chat area -->
    <div class="flex-1 flex flex-col">
      <!-- Messages -->
      <div ref="messagesContainer" class="flex-1 overflow-y-auto p-6 space-y-4">
        <!-- Welcome state -->
        <div v-if="!sessionStore.currentSession && messages.length === 0" class="flex items-center justify-center h-full">
          <div class="text-center max-w-md">
            <h1 class="text-display-md font-heading font-bold mb-3">What do you want to build?</h1>
            <p class="text-text-secondary text-md">
              Describe your project and the orchestrator will delegate tasks to specialized agents.
            </p>
          </div>
        </div>

        <!-- Message history -->
        <div
          v-for="msg in messages"
          :key="msg.id"
          class="flex gap-3"
          :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <!-- User bubble -->
          <div
            v-if="msg.role === 'user'"
            class="max-w-2xl rounded-md px-4 py-3 bg-accent text-white"
          >
            <p class="text-sm whitespace-pre-wrap">{{ msg.content }}</p>
          </div>

          <!-- Assistant: orchestrator plan card (msg.plan set on new msgs; tryParsePlan for legacy msgs) -->
          <OrchestratorPlanCard
            v-else-if="msg.plan || tryParsePlan(msg.content)"
            :plan="(msg.plan || tryParsePlan(msg.content))!"
          />

          <!-- Assistant: plain text bubble (markdown rendered) -->
          <div
            v-else
            class="max-w-2xl rounded-md px-4 py-3 bg-surface-elevated border border-border"
          >
            <div class="prose-chat text-sm" v-html="renderMarkdown(msg.content)" />
          </div>
        </div>

        <!-- Thinking indicator -->
        <div v-if="sessionStore.isCreatingSession" class="flex gap-3">
          <div class="bg-surface-elevated border border-border rounded-md px-4 py-3">
            <div class="flex items-center gap-2 text-text-muted text-sm">
              <span class="animate-pulse">Planning tasks...</span>
            </div>
          </div>
        </div>

        <!-- Clarification questions from orchestrator -->
        <div v-if="sessionStore.pendingClarification" class="flex gap-3">
          <div class="w-full max-w-2xl rounded-md border border-pending/40 bg-pending-bg px-5 py-4 space-y-4">
            <div class="flex items-center gap-2 text-pending font-semibold text-sm">
              <UIcon name="i-ph-question-light" class="w-4 h-4" />
              Orchestrator needs clarification before planning
            </div>
            <div class="space-y-3">
              <div
                v-for="(q, i) in sessionStore.pendingClarification.questions"
                :key="i"
                class="space-y-1"
              >
                <label class="text-xs text-text-secondary">{{ q }}</label>
                <UInput
                  v-model="clarificationAnswers[i]"
                  :placeholder="`Answer ${i + 1}…`"
                  size="sm"
                />
              </div>
            </div>
            <div class="flex justify-end gap-2">
              <UButton variant="ghost" size="sm" @click="dismissClarification">Skip</UButton>
              <UButton
                icon="i-ph-paper-plane-tilt-light"
                size="sm"
                color="yellow"
                :loading="clarificationLoading"
                :disabled="clarificationAnswers.every(a => !a?.trim())"
                @click="submitClarification"
              >
                Submit answers
              </UButton>
            </div>
          </div>
        </div>
      </div>

      <!-- Inject context modal -->
      <UModal v-model="showInjectModal">
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-ph-syringe-light" class="w-4 h-4 text-accent" />
              <span class="font-semibold">Inject context</span>
            </div>
          </template>
          <div class="space-y-3">
            <p class="text-sm text-text-muted">Send additional context to the running agent. It will be appended to the active task's prompt.</p>
            <UTextarea
              v-model="injectMessage"
              placeholder="e.g. Use Tailwind v4 syntax, not v3…"
              :rows="4"
              autofocus
            />
            <div v-if="injectResult" class="text-xs" :class="injectResult.ok ? 'text-completed' : 'text-failed'">
              {{ injectResult.msg }}
            </div>
          </div>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton variant="ghost" @click="showInjectModal = false">Cancel</UButton>
              <UButton
                icon="i-ph-syringe-light"
                color="cyan"
                :loading="injectLoading"
                :disabled="!injectMessage.trim()"
                @click="doInject"
              >Inject</UButton>
            </div>
          </template>
        </UCard>
      </UModal>

      <!-- Input area -->
      <div class="border-t border-border p-4">
        <UAlert
          v-if="!apiStore.githubToken"
          icon="i-ph-warning-light"
          color="yellow"
          variant="subtle"
          title="GitHub token required"
          description="Set your GitHub token in Settings to use the orchestrator."
          class="mb-3"
        />

        <div class="flex gap-2">
          <UTextarea
            v-model="inputPrompt"
            placeholder="Describe what you want to build..."
            :rows="3"
            class="flex-1"
            :disabled="sessionStore.isCreatingSession"
            @keydown.meta.enter="sendMessage"
            @keydown.ctrl.enter="sendMessage"
          />
          <div class="flex flex-col gap-2">
            <UButton
              icon="i-ph-paper-plane-tilt-light"
              :loading="sessionStore.isCreatingSession"
              :disabled="!inputPrompt.trim() || !apiStore.githubToken"
              @click="sendMessage"
            >
              Send
            </UButton>
            <UButton
              v-if="sessionStore.runningTasks.length > 0"
              icon="i-ph-syringe-light"
              color="cyan"
              variant="outline"
              size="sm"
              @click="openInjectModal"
            >
              Inject
            </UButton>
            <USelect
              :model-value="selectedProjectId"
              :options="projectOptions"
              placeholder="Project"
              size="sm"
              @update:model-value="(id: string) => {
                const p = projectStore.projects.find(x => x.id === id);
                if (p) projectStore.setActiveProject(p);
              }"
            />
          </div>
        </div>
        <p class="text-xs text-text-muted mt-2">⌘/Ctrl + Enter to send</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSessionStore } from '~/stores/session';
import { useProjectStore } from '~/stores/project';
import { useOrchestratorApi } from '~/composables/useOrchestratorApi';
import type { OpencodeEvent } from '@agent-orchestrator/shared';

const sessionStore = useSessionStore();
const projectStore = useProjectStore();
// reactive() unwraps all Refs inside composable so template can use apiStore.githubToken directly
const apiStore = reactive(useOrchestratorApi());

// Markdown rendering for assistant chat bubbles (sanitized via DOMPurify).
const { renderMarkdown } = useMarkdown();

// messages live in the store so they survive navigation away and back
const messages = computed(() => sessionStore.messages);

const inputPrompt = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const loadingSessionId = ref<string | null>(null);

// Derive selected project ID from the shared project store
const selectedProjectId = computed(() => projectStore.activeProject?.id ?? '');

interface ProjectOption { label: string; value: string }
const projectOptions = computed(() =>
  projectStore.projects.map((p) => ({ label: p.name, value: p.id })),
);

// Load projects into the shared store on mount (if not already loaded)
async function loadProjects() {
  if (projectStore.projects.length > 0) return;
  try {
    const { projects } = await apiStore.listProjects();
    projectStore.setProjects(projects);
  } catch {
    // silently ignore — API may not be ready
  }
}

onMounted(loadProjects);

// Scroll to bottom whenever messages change (e.g. returning to this page)
watch(messages, () => scrollToBottom(), { flush: 'post' });

// Try to parse a string as an orchestrator plan JSON
function tryParsePlan(content: string) {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (Array.isArray(parsed['tasks']) && (parsed['tasks'] as unknown[]).length > 0) {
      return parsed as { analysis?: string; tasks: Array<{ id: string; agentType: string; prompt: string; complexity: string; dependsOn: string[] }> };
    }
  } catch { /* not JSON */ }
  return null;
}

// Filter session history to active project
const filteredHistory = computed(() => {
  const pid = projectStore.activeProject?.id;
  if (!pid) return sessionStore.sessionHistory;
  return sessionStore.sessionHistory.filter((s) => s.projectId === pid);
});

// ── Inject modal ─────────────────────────────────────────────────────────────
const showInjectModal = ref(false);
const injectMessage = ref('');
const injectLoading = ref(false);
const injectResult = ref<{ ok: boolean; msg: string } | null>(null);

function openInjectModal() {
  injectMessage.value = '';
  injectResult.value = null;
  showInjectModal.value = true;
}

async function doInject() {
  const runningTask = sessionStore.runningTasks[0];
  if (!runningTask || !injectMessage.value.trim()) return;

  injectLoading.value = true;
  injectResult.value = null;
  try {
    const { injected } = await apiStore.injectToTask(runningTask.id, injectMessage.value.trim());
    injectResult.value = { ok: true, msg: injected ? 'Context injected successfully.' : 'Task completed before inject arrived.' };
    injectMessage.value = '';
    setTimeout(() => { showInjectModal.value = false; injectResult.value = null; }, 1500);
  } catch (e) {
    injectResult.value = { ok: false, msg: `Failed: ${(e as Error).message}` };
  } finally {
    injectLoading.value = false;
  }
}

// ── Clarification flow ────────────────────────────────────────────────────────
const clarificationAnswers = ref<string[]>([]);
const clarificationLoading = ref(false);

// Initialise answer slots whenever a new clarification arrives
watch(
  () => sessionStore.pendingClarification,
  (c) => {
    if (c) clarificationAnswers.value = c.questions.map(() => '');
  },
  { immediate: true },
);

function dismissClarification() {
  sessionStore.clearClarification();
  clarificationAnswers.value = [];
}

async function submitClarification() {
  const clarification = sessionStore.pendingClarification;
  if (!clarification || !sessionStore.currentSession) return;

  clarificationLoading.value = true;
  try {
    // Build answers record: question text → answer
    const answers: Record<string, string> = {};
    clarification.questions.forEach((q, i) => {
      answers[q] = clarificationAnswers.value[i] ?? '';
    });

    await apiStore.clarifySession(sessionStore.currentSession.id, answers);

    // Add user-visible message
    sessionStore.addMessage({
      id: `clarify-ans-${Date.now()}`,
      role: 'user',
      content: Object.entries(answers).map(([q, a]) => `${q}\n→ ${a}`).join('\n\n'),
      timestamp: new Date().toISOString(),
    });
    sessionStore.addMessage({
      id: `clarify-ack-${Date.now()}`,
      role: 'assistant',
      content: 'Got it — re-planning with your answers...',
      timestamp: new Date().toISOString(),
    });

    sessionStore.clearClarification();
    clarificationAnswers.value = [];
  } catch (e) {
    sessionStore.addMessage({
      id: `clarify-err-${Date.now()}`,
      role: 'assistant',
      content: `Failed to submit answers: ${(e as Error).message}`,
      timestamp: new Date().toISOString(),
    });
  } finally {
    clarificationLoading.value = false;
  }
}



async function sendMessage() {
  if (!inputPrompt.value.trim() || sessionStore.isCreatingSession) return;
  if (!selectedProjectId.value) {
    sessionStore.addMessage({
      id: `err-${Date.now()}`,
      role: 'assistant',
      content: 'Please select or create a project first.',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const prompt = inputPrompt.value.trim();
  inputPrompt.value = '';

  // Clear previous session's messages before starting a new conversation
  sessionStore.clearMessages();

  sessionStore.addMessage({
    id: `user-${Date.now()}`,
    role: 'user',
    content: prompt,
    timestamp: new Date().toISOString(),
  });

  scrollToBottom();

  sessionStore.isCreatingSession = true;
  sessionStore.error = null;

  try {
    const result = await apiStore.createSession({
      projectId: selectedProjectId.value,
      contextType: 'personal',
      userPrompt: prompt,
      budgetCapUsd: 5,
    });

    sessionStore.setSession(result.session, result.tasks);

    sessionStore.addMessage({
      id: `sys-${Date.now()}`,
      role: 'assistant',
      content: `Orchestrator started. Analyzing your request...`,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    sessionStore.error = (err as Error).message;
    sessionStore.addMessage({
      id: `err-${Date.now()}`,
      role: 'assistant',
      content: `Error: ${(err as Error).message}`,
      timestamp: new Date().toISOString(),
    });
  } finally {
    sessionStore.isCreatingSession = false;
    scrollToBottom();
  }
}

async function startNewSession() {
  sessionStore.clearSession();
}

/**
 * Loads a previous session from the API:
 * 1. Fetches session metadata + tasks
 * 2. Fetches all persisted events and reconstructs chat messages
 */
async function loadSession(sessionId: string) {
  if (loadingSessionId.value === sessionId) return; // prevent double-click
  loadingSessionId.value = sessionId;

  try {
    // ── 1. Session + tasks ────────────────────────────────────────────────────
    const { session, tasks } = await apiStore.getSession(sessionId);

    // Compute real cost from tasks (session.totalCostUsd may be 0 in old rows)
    const actualCost = tasks.reduce((sum, t) => sum + t.costUsd, 0);
    if (actualCost > 0) session.totalCostUsd = actualCost;

    sessionStore.clearMessages();
    sessionStore.restoreSession(session, tasks);

    // ── 2. User prompt as opening message ────────────────────────────────────
    sessionStore.addMessage({
      id: `hist-prompt-${sessionId}`,
      role: 'user',
      content: session.userPrompt,
      timestamp: session.createdAt.toString(),
    });

    // ── 3. Reconstruct chat messages from persisted events ───────────────────
    const config = useRuntimeConfig();
    const res = await fetch(
      `${config.public.apiBase}/api/sessions/${sessionId}/events?limit=500`,
    );

    if (res.ok) {
      const { events } = await res.json() as {
        events: Array<{ task_id: string; event_type: string; payload: OpencodeEvent; created_at: string }>;
      };

      // Build task map for agent labels
      const taskMap = new Map(tasks.map((t) => [t.id, t]));

      events.forEach((row, i) => {
        const agentLabel = capitalize(taskMap.get(row.task_id)?.agentType ?? 'agent');
        const event = row.payload;

        if (event.type === 'tool_use') {
          const file = (
            (event.input?.['path'] ?? event.input?.['file_path'] ?? event.input?.['filename'] ?? '') as string
          );
          const detail = file ? ` ${file}` : '';
          sessionStore.addMessage({
            id: `hist-tool-${i}-${row.task_id}`,
            role: 'assistant',
            content: `${agentLabel}: ${event.name}${detail}`,
            timestamp: row.created_at,
          });
        } else if (event.type === 'message' && event.content?.trim()) {
          const plan = tryParsePlan(event.content);
          sessionStore.addMessage({
            id: `hist-msg-${i}-${row.task_id}`,
            role: 'assistant',
            content: plan ? '' : event.content,
            plan: plan ?? undefined,
            timestamp: row.created_at,
          });
        }
      });

      if (events.length === 0) {
        sessionStore.addMessage({
          id: `hist-empty-${sessionId}`,
          role: 'assistant',
          content: `No event history found for this session. ${tasks.length} task(s) ran, $${actualCost.toFixed(4)} total cost.`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    scrollToBottom();
  } catch (e) {
    sessionStore.error = (e as Error).message;
  } finally {
    loadingSessionId.value = null;
  }
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
}

function formatDate(date: Date | string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

const deletingSessionId = ref<string | null>(null);

async function deleteSession(e: Event, sessionId: string) {
  e.stopPropagation();
  deletingSessionId.value = sessionId;
  try {
    await apiStore.deleteSession(sessionId);
    sessionStore.removeFromHistory(sessionId);
    // If the deleted session was active, clear it
    if (sessionStore.currentSession?.id === sessionId) {
      sessionStore.clearSession();
    }
  } catch (err) {
    console.error('Failed to delete session:', err);
  } finally {
    deletingSessionId.value = null;
  }
}
</script>

<style scoped>
/* Markdown bubble styling — keeps the chat look consistent with the rest of
   the UI (no heavy "prose" defaults from typography plugins). */
.prose-chat :deep(h1),
.prose-chat :deep(h2),
.prose-chat :deep(h3),
.prose-chat :deep(h4) {
  font-weight: 600;
  margin: 0.75em 0 0.35em;
  line-height: 1.25;
}
.prose-chat :deep(h1) { font-size: 1.15em; }
.prose-chat :deep(h2) { font-size: 1.08em; }
.prose-chat :deep(h3) { font-size: 1em; }
.prose-chat :deep(h4) { font-size: 0.95em; color: var(--color-text-secondary, #a3a3a3); }

.prose-chat :deep(p) {
  margin: 0.4em 0;
  line-height: 1.55;
}
.prose-chat :deep(p:first-child) { margin-top: 0; }
.prose-chat :deep(p:last-child)  { margin-bottom: 0; }

.prose-chat :deep(ul),
.prose-chat :deep(ol) {
  margin: 0.4em 0;
  padding-left: 1.4em;
}
.prose-chat :deep(ul) { list-style: disc; }
.prose-chat :deep(ol) { list-style: decimal; }
.prose-chat :deep(li) { margin: 0.15em 0; }
.prose-chat :deep(li > ul),
.prose-chat :deep(li > ol) { margin: 0.15em 0; }

.prose-chat :deep(strong) { font-weight: 600; }
.prose-chat :deep(em)     { font-style: italic; }

.prose-chat :deep(code) {
  background: rgba(255, 255, 255, 0.07);
  padding: 0.12em 0.35em;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.88em;
}
.prose-chat :deep(pre) {
  background: rgba(0, 0, 0, 0.35);
  padding: 0.75em 1em;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0.5em 0;
  border: 1px solid var(--color-border, #2a2a2a);
}
.prose-chat :deep(pre code) {
  background: transparent;
  padding: 0;
  font-size: 0.85em;
  line-height: 1.5;
}

.prose-chat :deep(blockquote) {
  border-left: 3px solid var(--color-border, #2a2a2a);
  padding-left: 0.85em;
  margin: 0.5em 0;
  color: var(--color-text-secondary, #a3a3a3);
}

.prose-chat :deep(a) {
  color: var(--color-accent, #6366f1);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
.prose-chat :deep(a:hover) { text-decoration-thickness: 2px; }

.prose-chat :deep(hr) {
  border: 0;
  border-top: 1px solid var(--color-border, #2a2a2a);
  margin: 0.75em 0;
}

.prose-chat :deep(table) {
  border-collapse: collapse;
  margin: 0.5em 0;
  font-size: 0.9em;
}
.prose-chat :deep(th),
.prose-chat :deep(td) {
  border: 1px solid var(--color-border, #2a2a2a);
  padding: 0.35em 0.6em;
  text-align: left;
}
.prose-chat :deep(th) {
  background: rgba(255, 255, 255, 0.04);
  font-weight: 600;
}
</style>
