// ============================================================
// OpenCode event types — JSON output from `opencode -f json`
// ============================================================

export type OpencodeEvent =
  | { type: 'message'; role: 'assistant'; content: string }
  | { type: 'tool_use'; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; name: string; output: string; error?: string }
  | { type: 'usage'; input_tokens: number; output_tokens: number; model: string }
  | { type: 'complete'; summary: string }
  | { type: 'error'; message: string };

// ============================================================
// Task complexity & model routing
// ============================================================

export type TaskComplexity = 'trivial' | 'simple' | 'standard' | 'complex' | 'expert';

export type AgentType =
  | 'orchestrator'
  | 'planner'
  | 'architect'
  | 'backend'
  | 'frontend'
  | 'design'
  | 'qa'
  | 'seo'
  | 'infra'
  | 'document';

// ============================================================
// Agent definitions
// ============================================================

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  knowledgeBlock: string;
  requiredMcpServers: string[];
  rules: string[];
}

export interface AgentTriggers {
  taskTypes: string[];
  contextTypes: ContextType[];
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: AgentType;

  // Model routing
  defaultComplexity: TaskComplexity;
  canEscalateTo: TaskComplexity;

  // Persona
  systemPrompt: string;
  rules: string[];

  // Skills
  skills: AgentSkill[];

  // Tools
  allowedMcpServers: string[];
  allowedTools: string[];

  // Limits
  maxSteps: number;
  timeoutMinutes: number;

  // Triggers
  triggers: AgentTriggers;

  // Metadata
  isBuiltIn: boolean;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// Project context (CEZ vs Personal)
// ============================================================

export type ContextType = 'personal' | 'cez';

export interface ProjectContext {
  id: string;
  type: ContextType;
  name: string;
  description?: string;
  secrets: Record<string, string>; // injected at runtime, never stored
}

// ============================================================
// Task & session
// ============================================================

export type TaskStatus =
  | 'pending'
  | 'planning'
  | 'running'
  | 'paused'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentTask {
  id: string;
  sessionId: string;
  projectId: string;
  contextType: ContextType;
  agentType: AgentType;
  agentId: string;
  prompt: string;
  status: TaskStatus;
  complexity: TaskComplexity;
  model: string;

  // Runtime stats
  currentStep: number;
  maxSteps: number;
  contextTokens: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;

  // Dependency management
  dependsOn: string[]; // task IDs this task waits for
  /** If this task is executing a ticket, the ticket's UUID */
  ticketId?: string | null;
  /** For Planner tasks: the worker agent type whose tickets will be generated */
  targetAgentType?: AgentType | null;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

export interface Session {
  id: string;
  projectId: string;
  contextType: ContextType;
  status: 'active' | 'completed' | 'failed';
  userPrompt: string;
  totalCostUsd: number;
  budgetCapUsd: number;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// WebSocket event bus messages (orchestrator → dashboard)
// ============================================================

export type WsMessageType =
  | 'agent:event'         // OpenCode event for a task
  | 'agent:status'        // Task status change
  | 'agent:context'       // Context size update
  | 'task:created'        // New task spawned by orchestrator
  | 'session:update'      // Session-level update (status, cost)
  | 'cost:update'         // Cost tracker update
  | 'budget:alert'        // Session cost crossed a budget threshold
  | 'approval:required'   // Destructive task awaiting user approval
  | 'context:injected'    // User injected a message into a running task
  | 'clarification:needed' // Orchestrator needs answers before planning
  | 'ticket:created'
  | 'ticket:updated'
  | 'qa:completed'        // Deterministic QA validation finished for a task
  | 'error';

export interface SessionUpdatePayload {
  sessionId: string;
  status: 'active' | 'completed' | 'failed';
  totalCostUsd: number;
}

export interface WsMessage<T = unknown> {
  type: WsMessageType;
  sessionId: string;
  taskId?: string;
  payload: T;
  timestamp: string; // ISO 8601
}

export interface AgentStatusPayload {
  taskId: string;
  status: TaskStatus;
  currentStep: number;
  maxSteps: number;
}

export interface AgentContextPayload {
  taskId: string;
  totalTokens: number;
  breakdown: {
    systemPrompt: number;
    projectConventions: number;
    taskDescription: number;
    ragResults: number;
    conversationHistory: number;
    toolResults: number;
  };
}

export interface CostUpdatePayload {
  taskId: string;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  costUsd: number;
  sessionTotalUsd: number;
}

export interface BudgetAlertPayload {
  sessionId: string;
  currentCostUsd: number;
  budgetCapUsd: number;
  /** Threshold that was crossed: 80 or 100 */
  thresholdPct: number;
}

export interface ApprovalRequiredPayload {
  taskId: string;
  sessionId: string;
  agentType: string;
  prompt: string;
  /** Short human-readable reason why this task needs approval */
  reason: string;
}

export interface ContextInjectedPayload {
  taskId: string;
  sessionId: string;
  message: string;
  injectedAt: string; // ISO
}

export interface ClarificationPayload {
  sessionId: string;
  /** The orchestrator task that is waiting for answers */
  taskId: string;
  questions: string[];
  /** Original user prompt that triggered the clarification */
  originalPrompt: string;
}

// ============================================================
// OpenCode config — real OpenCode binary schema
// Passed via OPENCODE_CONFIG_CONTENT env var at spawn time
// ============================================================

/** Local (stdio) MCP server — command must be an array */
export interface McpLocalServerConfig {
  type: 'local';
  command: string[];            // e.g. ["npx", "-y", "@mcp/server-filesystem", "/workspace"]
  enabled?: boolean;
  environment?: Record<string, string>;
}

/** Remote (HTTP/SSE) MCP server */
export interface McpRemoteServerConfig {
  type: 'remote';
  url: string;
  enabled?: boolean;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpLocalServerConfig | McpRemoteServerConfig;

/** Per-agent config block inside opencode.json */
export interface OpencodeAgentConfig {
  model?: string;
  prompt?: string;
  description?: string;
  mode?: 'primary' | 'subagent' | 'all';
}

/** Full opencode.json / OPENCODE_CONFIG_CONTENT schema */
export interface OpencodeConfig {
  $schema?: string;
  model?: string;
  /** Provider credentials — nested under provider name */
  provider?: Record<string, {
    options?: {
      apiKey?: string;
      baseURL?: string;
      [key: string]: unknown;
    };
  }>;
  mcp?: Record<string, McpServerConfig>;
  /** Named agent definitions (system prompt, model override) */
  agent?: Record<string, OpencodeAgentConfig>;
  /** Tool permission overrides — { "*": "allow" } for non-interactive use */
  permission?: Record<string, 'allow' | 'deny'>;
  autoupdate?: boolean;
}

// ============================================================
// API request/response shapes
// ============================================================

export interface CreateSessionRequest {
  projectId: string;
  contextType: ContextType;
  userPrompt: string;
  budgetCapUsd?: number;
}

export interface CreateSessionResponse {
  session: Session;
  tasks: AgentTask[];
}

export interface GetSessionResponse {
  session: Session;
  tasks: AgentTask[];
}

export interface ListAgentsResponse {
  agents: AgentDefinition[];
}

export interface ListSessionsResponse {
  sessions: Session[];
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}

// ============================================================
// Tickets — Linear-like atomic units of work
// ============================================================

export type TicketStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'done'
  | 'failed'
  | 'cancelled';

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Ticket {
  id: string;
  ticketKey: string;            // e.g. "AGT-1"
  sessionId: string;
  projectId: string;
  parentTaskId: string | null;  // the planner/agent task that produced this ticket
  currentTaskId: string | null; // the currently executing agent_task
  title: string;
  description: string;
  agentType: AgentType;
  complexity: TaskComplexity;
  priority: TicketPriority;
  labels: string[];
  status: TicketStatus;
  iteration: number;
  totalCostUsd: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  author: 'user' | 'agent' | 'system';
  body: string;
  iterationTaskId: string | null;
  createdAt: Date;
}

export interface TicketIteration {
  id: string;
  ticketId: string;
  taskId: string;
  iteration: number;
  injectedContext: string | null;
  status: string;
  costUsd: number;
  summary: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface ListTicketsResponse {
  tickets: Ticket[];
}

export interface GetTicketResponse {
  ticket: Ticket;
  comments: TicketComment[];
  iterations: TicketIteration[];
}

export interface CreateTicketCommentRequest {
  body: string;
}

export interface ReopenTicketRequest {
  /** Optional comment that becomes injected context for the new iteration */
  comment?: string;
}

// ============================================================
// WS payloads for tickets
// ============================================================

export interface TicketUpdatedPayload {
  ticketId: string;
  sessionId: string;
  status: TicketStatus;
  iteration: number;
}

export interface TicketCreatedPayload {
  ticket: Ticket;
}
