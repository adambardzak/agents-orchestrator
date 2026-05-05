/**
 * Smoke Test 2: Cost Tracker
 *
 * Tests that usage events correctly accumulate into cost estimates.
 */

import { describe, it, expect, vi } from 'vitest';
import { CostTracker } from '../services/cost-tracker/tracker.js';
import type { FastifyBaseLogger } from 'fastify';

const mockLogger = {
  info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  trace: vi.fn(), fatal: vi.fn(), child: () => mockLogger,
} as unknown as FastifyBaseLogger;

describe('Cost Tracker', () => {
  it('tracks usage and returns correct costs for free model', () => {
    const tracker = new CostTracker(mockLogger);

    const { taskCost, sessionTotal } = tracker.trackUsage(
      'task-1', 'session-1',
      100_000, 10_000,
      'github-copilot/gpt-4o', // free model
    );

    expect(taskCost).toBe(0);
    expect(sessionTotal).toBe(0);
  });

  it('calculates correct cost for claude-sonnet-4.6', () => {
    const tracker = new CostTracker(mockLogger);

    // 1M input tokens @ $3/1M = $3, 200k output @ $15/1M = $3 → total $6
    const { taskCost } = tracker.trackUsage(
      'task-2', 'session-2',
      1_000_000, 200_000,
      'github-copilot/claude-sonnet-4.6',
    );

    // $3 input + $3 output = $6
    expect(taskCost).toBeCloseTo(6.0, 4);
  });

  it('accumulates costs across multiple usage events from same task', () => {
    const tracker = new CostTracker(mockLogger);
    const sessionId = 'session-3';
    const taskId = 'task-3';

    // Event 1: 5000 input + 500 output @ haiku rates (0.8/4 per 1M)
    tracker.trackUsage(taskId, sessionId, 5_000, 500, 'github-copilot/claude-haiku-4.5');
    // Event 2: 3000 input + 1000 output
    const { taskCost, sessionTotal } = tracker.trackUsage(taskId, sessionId, 3_000, 1_000, 'github-copilot/claude-haiku-4.5');

    // Total: 8000 input @ 0.8/1M = $0.0064, 1500 output @ 4/1M = $0.006 → ~$0.0124
    expect(taskCost).toBeGreaterThan(0);
    expect(sessionTotal).toBe(taskCost); // Same task = same session total

    const details = tracker.getTaskDetails(taskId);
    expect(details?.inputTokens).toBe(8_000);
    expect(details?.outputTokens).toBe(1_500);
  });

  it('tracks multiple tasks in same session independently', () => {
    const tracker = new CostTracker(mockLogger);
    const sessionId = 'session-4';

    tracker.trackUsage('task-a', sessionId, 100_000, 10_000, 'github-copilot/claude-sonnet-4.6');
    tracker.trackUsage('task-b', sessionId, 50_000, 5_000, 'github-copilot/claude-sonnet-4.6');

    const taskACost = tracker.getTaskCost('task-a');
    const taskBCost = tracker.getTaskCost('task-b');
    const sessionTotal = tracker.getSessionTotal(sessionId);

    expect(taskACost).toBeGreaterThan(0);
    expect(taskBCost).toBeGreaterThan(0);
    expect(taskBCost).toBeLessThan(taskACost); // task-b has fewer tokens
    expect(sessionTotal).toBeCloseTo(taskACost + taskBCost, 10);
  });

  it('detects budget cap exceeded', () => {
    const tracker = new CostTracker(mockLogger);

    // $3 + $3 = $6 total (see test above)
    tracker.trackUsage('task-5', 'session-5', 1_000_000, 200_000, 'github-copilot/claude-sonnet-4.6');

    expect(tracker.isOverBudget('session-5', 5.0)).toBe(true);
    expect(tracker.isOverBudget('session-5', 10.0)).toBe(false);
  });

  it('clearSession removes all task costs for that session', () => {
    const tracker = new CostTracker(mockLogger);

    tracker.trackUsage('task-6a', 'session-6', 100_000, 10_000, 'github-copilot/claude-sonnet-4.6');
    tracker.trackUsage('task-6b', 'session-6', 50_000, 5_000, 'github-copilot/claude-sonnet-4.6');

    // Different session — should not be cleared
    tracker.trackUsage('task-other', 'session-other', 50_000, 5_000, 'github-copilot/claude-sonnet-4.6');

    tracker.clearSession('session-6');

    expect(tracker.getSessionTotal('session-6')).toBe(0);
    expect(tracker.getTaskCost('task-6a')).toBe(0);
    expect(tracker.getTaskCost('task-6b')).toBe(0);

    // Other session unaffected
    expect(tracker.getSessionTotal('session-other')).toBeGreaterThan(0);
  });
});
