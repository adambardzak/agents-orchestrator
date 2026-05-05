import type {
  Session,
  AgentTask,
  AgentType,
  TaskComplexity,
  TaskStatus,
  ContextType,
} from '@agent-orchestrator/shared';

/**
 * Maps a raw postgres row (snake_case) to the shared Session type (camelCase).
 * pg returns column names exactly as in the DB schema.
 */
export function mapSession(row: Record<string, unknown>): Session {
  return {
    id: row['id'] as string,
    projectId: row['project_id'] as string,
    contextType: row['context_type'] as ContextType,
    status: row['status'] as Session['status'],
    userPrompt: row['user_prompt'] as string,
    totalCostUsd: Number(row['total_cost_usd'] ?? 0),
    budgetCapUsd: Number(row['budget_cap_usd'] ?? 5),
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
  };
}

/**
 * Maps a raw postgres row (snake_case) to the shared AgentTask type (camelCase).
 */
export function mapTask(row: Record<string, unknown>): AgentTask {
  return {
    id: row['id'] as string,
    sessionId: row['session_id'] as string,
    projectId: row['project_id'] as string,
    contextType: (row['context_type'] as ContextType) ?? 'personal',
    agentType: row['agent_type'] as AgentType,
    agentId: row['agent_id'] as string,
    prompt: row['prompt'] as string,
    status: row['status'] as TaskStatus,
    complexity: row['complexity'] as TaskComplexity,
    model: row['model'] as string,
    currentStep: Number(row['current_step'] ?? 0),
    maxSteps: Number(row['max_steps'] ?? 20),
    contextTokens: Number(row['context_tokens'] ?? 0),
    inputTokens: Number(row['input_tokens'] ?? 0),
    outputTokens: Number(row['output_tokens'] ?? 0),
    costUsd: Number(row['cost_usd'] ?? 0),
    dependsOn: (row['depends_on'] as string[]) ?? [],
    ticketId: (row['ticket_id'] as string | null) ?? null,
    targetAgentType: (row['target_agent_type'] as AgentType | null) ?? null,
    startedAt: row['started_at'] ? new Date(row['started_at'] as string) : undefined,
    completedAt: row['completed_at'] ? new Date(row['completed_at'] as string) : undefined,
    createdAt: new Date(row['created_at'] as string),
  };
}
