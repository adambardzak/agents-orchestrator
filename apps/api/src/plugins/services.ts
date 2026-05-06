import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { OpenCodeProcessManager } from '../services/opencode/sdk-process-manager.js';
import { EventBus } from '../websocket/event-bus.js';
import { CostTracker } from '../services/cost-tracker/tracker.js';
import { TaskQueue } from '../services/queue/task-queue.js';
import { RagService } from '../services/rag/rag-service.js';
import { env } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    processManager: OpenCodeProcessManager;
    eventBus: EventBus;
    costTracker: CostTracker;
    taskQueue: TaskQueue;
    ragService: RagService;
    dbPool: Pool;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  const processManager = new OpenCodeProcessManager(fastify.log);
  const eventBus = new EventBus(fastify.log);
  const costTracker = new CostTracker(fastify.log);

  // Raw pg Pool for background writes from TaskQueue (non-request-scoped)
  const dbPool = new Pool({ connectionString: env.DATABASE_URL });

  // RAG service must be created before TaskQueue (injected into worker)
  const ragService = new RagService(
    dbPool,
    fastify.log,
    env.GITHUB_TOKEN,  // used as OpenAI-compatible API key for embeddings
    undefined,         // default embedding endpoint
    env.RAG_MIN_SCORE,
  );

  const taskQueue = new TaskQueue(
    fastify.redis,
    dbPool,
    processManager,
    eventBus,
    costTracker,
    fastify.log,
    async (taskId, status, data) => {
      await fastify.pg.query(
        `UPDATE agent_tasks
         SET status = $1,
             updated_at = NOW(),
             started_at = CASE WHEN $1 = 'running' AND started_at IS NULL THEN NOW() ELSE started_at END,
             completed_at = CASE WHEN $1 IN ('completed', 'failed', 'cancelled') THEN NOW() ELSE completed_at END,
             summary = COALESCE($3, summary),
             error_message = COALESCE($4, error_message)
         WHERE id = $2`,
        [
          status,
          taskId,
          (data as { summary?: string })?.summary ?? null,
          (data as { error?: string })?.error ?? null,
        ],
      );
    },
    ragService,
  );

  fastify.decorate('processManager', processManager);
  fastify.decorate('eventBus', eventBus);
  fastify.decorate('costTracker', costTracker);
  fastify.decorate('taskQueue', taskQueue);
  fastify.decorate('ragService', ragService);
  fastify.decorate('dbPool', dbPool);

  fastify.addHook('onClose', async () => {
    await taskQueue.close();
    await dbPool.end();
  });
});
