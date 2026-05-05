import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import type { AgentTask, AgentType, TaskComplexity } from '@agent-orchestrator/shared';
import { TicketService } from '../services/tickets/ticket-service.js';
import { getAgentByType } from '../agents/definitions.js';
import { resolveModel } from '../services/model-router/router.js';
import { env } from '../config/env.js';

const reopenSchema = z.object({
  comment: z.string().min(1).max(10_000).optional(),
});

const addCommentSchema = z.object({
  body: z.string().min(1).max(10_000),
});

const updateStatusSchema = z.object({
  status: z.enum(['backlog', 'todo', 'in_progress', 'done', 'failed', 'cancelled']),
});

export async function ticketRoutes(fastify: FastifyInstance): Promise<void> {
  const tickets = new TicketService(fastify.dbPool, fastify.log);

  // ── List tickets for a session ─────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/sessions/:id/tickets', async (req) => {
    const list = await tickets.listBySession(req.params.id);
    return { tickets: list };
  });

  // ── Get ticket detail (with comments + iterations) ─────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/tickets/:id', async (req, reply) => {
    const ticket = await tickets.getById(req.params.id);
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });
    const [comments, iterations] = await Promise.all([
      tickets.listComments(ticket.id),
      tickets.listIterations(ticket.id),
    ]);
    return { ticket, comments, iterations };
  });

  // ── Add comment ────────────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string }; Body: { body: string } }>(
    '/api/tickets/:id/comments',
    async (req, reply) => {
      const body = addCommentSchema.parse(req.body);
      const ticket = await tickets.getById(req.params.id);
      if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });
      const comment = await tickets.addComment({
        ticketId: ticket.id,
        author: 'user',
        body: body.body,
      });
      return { comment };
    },
  );

  // ── Manually update status (drag-and-drop on board) ─────────────────────────
  fastify.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/api/tickets/:id/status',
    async (req, reply) => {
      const body = updateStatusSchema.parse(req.body);
      const ticket = await tickets.getById(req.params.id);
      if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });
      const updated = await tickets.updateStatus(ticket.id, body.status);
      if (updated) {
        fastify.eventBus.publish('ticket:updated', ticket.sessionId, {
          ticketId: ticket.id,
          sessionId: ticket.sessionId,
          status: updated.status,
          iteration: updated.iteration,
        });
      }
      return { ticket: updated };
    },
  );

  // ── Reopen a ticket: bump iteration, status → todo, spawn new worker task ──
  fastify.post<{ Params: { id: string }; Body: { comment?: string } }>(
    '/api/tickets/:id/reopen',
    async (req, reply) => {
      const body = reopenSchema.parse(req.body ?? {});
      const githubToken =
        (req.headers['x-github-token'] as string) ?? env.GITHUB_TOKEN ?? '';
      if (!githubToken) {
        return reply.status(401).send({ error: 'GitHub token required' });
      }

      const ticket = await tickets.getById(req.params.id);
      if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });

      const targetAgent = getAgentByType(ticket.agentType);
      if (!targetAgent) {
        return reply.status(400).send({ error: `Unknown agent type: ${ticket.agentType}` });
      }

      // Persist user comment (if provided) — becomes injected context
      let injectedContext: string | null = null;
      if (body.comment) {
        await tickets.addComment({
          ticketId: ticket.id,
          author: 'user',
          body: body.comment,
        });
        injectedContext = body.comment;
      }

      // Bump iteration counter and reset status
      const newIteration = ticket.iteration + 1;
      await fastify.pg.query(
        `UPDATE tickets SET iteration = $2, status = 'todo', completed_at = NULL WHERE id = $1`,
        [ticket.id, newIteration],
      );

      // Spawn a new agent_task for this ticket with injected context
      const taskId = uuid();
      const complexity = ticket.complexity as TaskComplexity;
      const model = resolveModel(complexity, complexity, targetAgent.canEscalateTo);

      const reopenPrompt = injectedContext
        ? `[Ticket ${ticket.ticketKey} — Iteration ${newIteration}] ${ticket.title}

${ticket.description}

## Additional context from user (reopen reason):
${injectedContext}`
        : `[Ticket ${ticket.ticketKey} — Iteration ${newIteration}] ${ticket.title}

${ticket.description}`;

      // Look up project context_type
      const { rows: tRows } = await fastify.pg.query<{ context_type: string }>(
        'SELECT context_type FROM tickets t JOIN sessions s ON s.id = t.session_id WHERE t.id = $1',
        [ticket.id],
      );
      const contextType = (tRows[0]?.context_type as 'personal' | 'cez') ?? 'personal';

      await fastify.pg.query(
        `INSERT INTO agent_tasks
           (id, session_id, project_id, context_type, agent_type, agent_id, prompt,
            status, complexity, model, max_steps, depends_on, ticket_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, '{}', $11)`,
        [
          taskId,
          ticket.sessionId,
          ticket.projectId,
          contextType,
          targetAgent.type,
          targetAgent.id,
          reopenPrompt,
          complexity,
          model,
          targetAgent.maxSteps,
          ticket.id,
        ],
      );

      // Update ticket pointer + create iteration row
      await tickets.updateStatus(ticket.id, 'todo', { currentTaskId: taskId });
      await tickets.createIteration({
        ticketId: ticket.id,
        taskId,
        iteration: newIteration,
        injectedContext,
        status: 'pending',
      });

      // Re-open session if it was closed
      await fastify.pg.query(
        `UPDATE sessions SET status = 'active' WHERE id = $1 AND status != 'active'`,
        [ticket.sessionId],
      );

      const newTask: AgentTask = {
        id: taskId,
        sessionId: ticket.sessionId,
        projectId: ticket.projectId,
        contextType,
        agentType: targetAgent.type as AgentType,
        agentId: targetAgent.id,
        prompt: reopenPrompt,
        status: 'pending',
        complexity,
        model,
        currentStep: 0,
        maxSteps: targetAgent.maxSteps,
        contextTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        dependsOn: [],
        ticketId: ticket.id,
        createdAt: new Date(),
      };

      fastify.eventBus.publish('task:created', ticket.sessionId, newTask, taskId);
      fastify.eventBus.publish('ticket:updated', ticket.sessionId, {
        ticketId: ticket.id,
        sessionId: ticket.sessionId,
        status: 'todo',
        iteration: newIteration,
      });

      await fastify.taskQueue.enqueueTask(newTask, githubToken);

      return { ticket: await tickets.getById(ticket.id), taskId };
    },
  );
}
