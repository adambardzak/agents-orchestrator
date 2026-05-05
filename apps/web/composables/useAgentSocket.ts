import type {
  WsMessage,
  OpencodeEvent,
  AgentStatusPayload,
  CostUpdatePayload,
  SessionUpdatePayload,
  BudgetAlertPayload,
  ApprovalRequiredPayload,
  ContextInjectedPayload,
  ClarificationPayload,
  AgentTask,
} from '@agent-orchestrator/shared';

interface UseAgentSocketOptions {
  sessionId: Ref<string | null>;
  onAgentEvent?: (taskId: string, event: OpencodeEvent) => void;
  onStatusChange?: (payload: AgentStatusPayload) => void;
  onCostUpdate?: (payload: CostUpdatePayload) => void;
  onSessionUpdate?: (payload: SessionUpdatePayload) => void;
  onBudgetAlert?: (payload: BudgetAlertPayload) => void;
  onApprovalRequired?: (payload: ApprovalRequiredPayload) => void;
  onContextInjected?: (payload: ContextInjectedPayload) => void;
  onClarificationNeeded?: (payload: ClarificationPayload) => void;
  /** Called when the orchestrator creates a new subtask (task:created WS message). */
  onTaskCreated?: (task: AgentTask) => void;
}

export function useAgentSocket(options: UseAgentSocketOptions) {
  const config = useRuntimeConfig();
  const {
    sessionId, onAgentEvent, onStatusChange, onCostUpdate,
    onSessionUpdate, onBudgetAlert, onApprovalRequired, onContextInjected,
    onClarificationNeeded, onTaskCreated,
  } = options;

  const isConnected = ref(false);
  const error = ref<string | null>(null);
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;

  function connect(sid: string) {
    if (ws?.readyState === WebSocket.OPEN) return;

    const url = `${config.public.wsBase}/ws?sessionId=${sid}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      isConnected.value = true;
      error.value = null;
      reconnectAttempts = 0;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WsMessage;

        switch (msg.type) {
          case 'agent:event':
            onAgentEvent?.(msg.taskId!, msg.payload as OpencodeEvent);
            break;
          case 'agent:status':
            onStatusChange?.(msg.payload as AgentStatusPayload);
            break;
          case 'cost:update':
            onCostUpdate?.(msg.payload as CostUpdatePayload);
            break;
          case 'task:created':
            onTaskCreated?.(msg.payload as AgentTask);
            break;
          case 'session:update':
            onSessionUpdate?.(msg.payload as SessionUpdatePayload);
            break;
          case 'budget:alert':
            onBudgetAlert?.(msg.payload as BudgetAlertPayload);
            break;
          case 'approval:required':
            onApprovalRequired?.(msg.payload as ApprovalRequiredPayload);
            break;
          case 'context:injected':
            onContextInjected?.(msg.payload as ContextInjectedPayload);
            break;
          case 'clarification:needed':
            onClarificationNeeded?.(msg.payload as ClarificationPayload);
            break;
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = (event) => {
      isConnected.value = false;

      // Auto-reconnect unless closed intentionally (code 1000)
      if (event.code !== 1000 && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(1000 * 2 ** reconnectAttempts, 30_000);
        reconnectAttempts++;
        reconnectTimer = setTimeout(() => {
          if (sessionId.value) connect(sessionId.value);
        }, delay);
      }
    };

    ws.onerror = () => {
      error.value = 'WebSocket connection failed';
    };
  }

  function disconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close(1000);
    ws = null;
    isConnected.value = false;
  }

  function sendPing() {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }

  // Auto-connect when sessionId becomes available; disconnect when it clears.
  // IMPORTANT: always disconnect from the old session before connecting to a
  // new one — otherwise connect() sees readyState===OPEN and returns early,
  // leaving the socket subscribed to the previous session's events.
  watch(
    sessionId,
    (sid, oldSid) => {
      if (oldSid !== sid) {
        disconnect(); // closes old WS (code 1000), sets ws = null
      }
      if (sid) {
        connect(sid);
      }
    },
    { immediate: true },
  );

  onUnmounted(() => disconnect());

  return { isConnected, error, disconnect, sendPing };
}
