import type { FastifyBaseLogger } from 'fastify';
import { MODEL_COSTS } from '../../config/models.js';

interface TaskCost {
  taskId: string;
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * In-memory cost tracker.
 * Aggregates token usage from OpenCode 'usage' events.
 * Persisted to DB separately via the task update service.
 */
export class CostTracker {
  // taskId → accumulated cost
  private taskCosts = new Map<string, TaskCost>();
  // sessionId → total cost
  private sessionTotals = new Map<string, number>();
  private logger: FastifyBaseLogger;

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
  }

  trackUsage(
    taskId: string,
    sessionId: string,
    inputTokens: number,
    outputTokens: number,
    model: string,
  ): { taskCost: number; sessionTotal: number } {
    const costs = MODEL_COSTS[model] ?? { inputPer1M: 0, outputPer1M: 0 };
    const eventCost =
      (inputTokens / 1_000_000) * costs.inputPer1M +
      (outputTokens / 1_000_000) * costs.outputPer1M;

    // Accumulate task cost
    const existing = this.taskCosts.get(taskId);
    if (existing) {
      existing.inputTokens += inputTokens;
      existing.outputTokens += outputTokens;
      existing.costUsd += eventCost;
    } else {
      this.taskCosts.set(taskId, {
        taskId,
        sessionId,
        model,
        inputTokens,
        outputTokens,
        costUsd: eventCost,
      });
    }

    // Accumulate session total
    const sessionTotal = (this.sessionTotals.get(sessionId) ?? 0) + eventCost;
    this.sessionTotals.set(sessionId, sessionTotal);

    this.logger.debug(
      { taskId, sessionId, eventCost, sessionTotal, model },
      'Cost tracked',
    );

    return {
      taskCost: this.taskCosts.get(taskId)!.costUsd,
      sessionTotal,
    };
  }

  getTaskCost(taskId: string): number {
    return this.taskCosts.get(taskId)?.costUsd ?? 0;
  }

  getSessionTotal(sessionId: string): number {
    return this.sessionTotals.get(sessionId) ?? 0;
  }

  getTaskDetails(taskId: string): TaskCost | undefined {
    return this.taskCosts.get(taskId);
  }

  isOverBudget(sessionId: string, budgetCapUsd: number): boolean {
    return this.getSessionTotal(sessionId) >= budgetCapUsd;
  }

  clearTask(taskId: string): void {
    this.taskCosts.delete(taskId);
  }

  clearSession(sessionId: string): void {
    for (const [taskId, cost] of this.taskCosts) {
      if (cost.sessionId === sessionId) {
        this.taskCosts.delete(taskId);
      }
    }
    this.sessionTotals.delete(sessionId);
  }
}
