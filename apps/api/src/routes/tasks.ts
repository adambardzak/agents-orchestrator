import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentTask, AgentType, TaskComplexity } from '@agent-orchestrator/shared';
import { env } from '../config/env.js';

export async function taskRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/tasks/:id/approve — approve a destructive task (awaiting_approval → pending/enqueued)
  fastify.post<{ Params: { id: string } }>('/api/tasks/:id/approve', async (request, reply) => {
    const { id } = request.params;
    const githubToken =
      (request.headers['x-github-token'] as string | undefined) ?? env.GITHUB_TOKEN ?? '';

    const { rows: [row] } = await fastify.pg.query<{
      id: string; session_id: string; project_id: string; context_type: string;
      agent_type: string; agent_id: string; prompt: string;
      status: string; complexity: string; model: string;
      max_steps: number; depends_on: string[];
    }>(
      `SELECT id, session_id, project_id, context_type, agent_type, agent_id, prompt,
              status, complexity, model, max_steps, depends_on
       FROM agent_tasks WHERE id = $1`,
      [id],
    );

    if (!row) return reply.status(404).send({ error: 'Task not found' });
    if (row.status !== 'awaiting_approval') {
      return reply.status(409).send({ error: `Task status is '${row.status}', expected 'awaiting_approval'` });
    }

    // Check if all dependencies are already completed
    let canEnqueueNow = true;
    if (row.depends_on.length > 0) {
      const { rows: deps } = await fastify.pg.query<{ status: string }>(
        `SELECT status FROM agent_tasks WHERE id = ANY($1)`,
        [row.depends_on],
      );
      canEnqueueNow = deps.every((d) => d.status === 'completed');
    }

    // Transition to pending
    await fastify.pg.query(
      `UPDATE agent_tasks SET status = 'pending', updated_at = NOW() WHERE id = $1`,
      [id],
    );

    const task: AgentTask = {
      id: row.id,
      sessionId: row.session_id,
      projectId: row.project_id,
      contextType: (row.context_type as 'personal' | 'cez') ?? 'personal',
      agentType: row.agent_type as AgentType,
      agentId: row.agent_id,
      prompt: row.prompt,
      status: 'pending',
      complexity: row.complexity as TaskComplexity,
      model: row.model,
      currentStep: 0,
      maxSteps: row.max_steps,
      contextTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      dependsOn: row.depends_on,
      createdAt: new Date(),
    };

    // Publish status change to dashboard
    fastify.eventBus.publish('agent:status', row.session_id, {
      taskId: id,
      status: 'pending',
      currentStep: 0,
      maxSteps: row.max_steps,
    }, id);

    if (canEnqueueNow) {
      await fastify.taskQueue.enqueueTask(task, githubToken);
    }

    return { status: 'pending', enqueued: canEnqueueNow };
  });

  // POST /api/tasks/:id/reject — reject a destructive task (awaiting_approval → cancelled)
  fastify.post<{ Params: { id: string } }>('/api/tasks/:id/reject', async (request, reply) => {
    const { id } = request.params;

    const { rows: [row] } = await fastify.pg.query<{
      session_id: string; status: string; max_steps: number;
    }>(
      `SELECT session_id, status, max_steps FROM agent_tasks WHERE id = $1`,
      [id],
    );

    if (!row) return reply.status(404).send({ error: 'Task not found' });
    if (row.status !== 'awaiting_approval') {
      return reply.status(409).send({ error: `Task status is '${row.status}', expected 'awaiting_approval'` });
    }

    await fastify.pg.query(
      `UPDATE agent_tasks
       SET status = 'cancelled', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id],
    );

    fastify.eventBus.publish('agent:status', row.session_id, {
      taskId: id,
      status: 'cancelled',
      currentStep: 0,
      maxSteps: row.max_steps,
    }, id);

    // Check if the session can now be closed (all tasks terminal)
    const { rows: allTasks } = await fastify.pg.query<{ status: string; cost_usd: string }>(
      `SELECT status, cost_usd FROM agent_tasks WHERE session_id = $1`,
      [row.session_id],
    );
    const allDone = allTasks.every((t) =>
      ['completed', 'failed', 'cancelled'].includes(t.status),
    );
    if (allDone && allTasks.length > 0) {
      const totalCostUsd = allTasks.reduce((s, t) => s + parseFloat(t.cost_usd), 0);
      const hasFailed = allTasks.some((t) => t.status === 'failed');
      const finalStatus = hasFailed ? 'failed' : 'completed';

      await fastify.pg.query(
        `UPDATE sessions SET status = $2, total_cost_usd = $3, updated_at = NOW()
         WHERE id = $1 AND status = 'active'`,
        [row.session_id, finalStatus, totalCostUsd],
      );
      fastify.eventBus.publish('session:update', row.session_id, {
        sessionId: row.session_id,
        status: finalStatus,
        totalCostUsd,
      }, undefined);
    }

    return { status: 'cancelled' };
  });

  // POST /api/tasks/:id/inject — inject a message into a running agent
  fastify.post<{ Params: { id: string } }>('/api/tasks/:id/inject', async (request, reply) => {
    const { id } = request.params;
    const { message } = z.object({ message: z.string().min(1).max(4000) }).parse(request.body);

    const { rows: [row] } = await fastify.pg.query<{
      session_id: string; status: string;
    }>(
      'SELECT session_id, status FROM agent_tasks WHERE id = $1',
      [id],
    );

    if (!row) return reply.status(404).send({ error: 'Task not found' });
    if (row.status !== 'running') {
      return reply.status(409).send({ error: `Task status is '${row.status}', expected 'running'` });
    }

    // Inject into running process (best-effort)
    const injected = fastify.taskQueue.injectToTask(id, message);

    // Persist as agent event so it appears in session replay
    await fastify.pg.query(
      `INSERT INTO agent_events (task_id, session_id, event_type, payload)
       VALUES ($1, $2, 'user_inject', $3)`,
      [id, row.session_id, JSON.stringify({ type: 'user_inject', message })],
    );

    // Publish WS event so all dashboard clients see the injection
    fastify.eventBus.publish('context:injected', row.session_id, {
      taskId: id,
      sessionId: row.session_id,
      message,
      injectedAt: new Date().toISOString(),
    }, id);

    return { injected, message };
  });

  // GET /api/tasks/:id
  fastify.get<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const { id } = request.params;

    const { rows: [task] } = await fastify.pg.query(
      'SELECT * FROM agent_tasks WHERE id = $1',
      [id],
    );

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    return task;
  });

  // POST /api/tasks/:id/pause
  fastify.post<{ Params: { id: string } }>('/api/tasks/:id/pause', async (request, reply) => {
    const { id } = request.params;
    const paused = await fastify.taskQueue.pauseTask(id);

    if (!paused) {
      return reply.status(409).send({ error: 'Task is not running or already paused' });
    }

    return { status: 'paused' };
  });

  // POST /api/tasks/:id/resume
  fastify.post<{ Params: { id: string } }>('/api/tasks/:id/resume', async (request, reply) => {
    const { id } = request.params;
    const resumed = fastify.processManager.resumeAgent(id);

    if (!resumed) {
      return reply.status(409).send({ error: 'Task is not paused' });
    }

    await fastify.pg.query(
      `UPDATE agent_tasks SET status = 'running', updated_at = NOW() WHERE id = $1`,
      [id],
    );

    return { status: 'running' };
  });

  // POST /api/tasks/:id/stop
  fastify.post<{ Params: { id: string } }>('/api/tasks/:id/stop', async (request, reply) => {
    const { id } = request.params;
    const stopped = await fastify.taskQueue.stopTask(id);

    if (!stopped) {
      return reply.status(409).send({ error: 'Task is not running' });
    }

    return { status: 'cancelled' };
  });

  // GET /api/tasks/:id/cost
  fastify.get<{ Params: { id: string } }>('/api/tasks/:id/cost', async (request, reply) => {
    const { id } = request.params;

    const { rows: [task] } = await fastify.pg.query<{
      cost_usd: string;
      input_tokens: string;
      output_tokens: string;
      model: string;
    }>(
      'SELECT cost_usd, input_tokens, output_tokens, model FROM agent_tasks WHERE id = $1',
      [id],
    );

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    const live = fastify.costTracker.getTaskDetails(id);

    return {
      taskId: id,
      persisted: {
        costUsd: parseFloat(task.cost_usd),
        inputTokens: parseInt(task.input_tokens, 10),
        outputTokens: parseInt(task.output_tokens, 10),
        model: task.model,
      },
      live: live ?? null,
    };
  });
}
