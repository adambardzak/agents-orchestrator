import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyPostgres from '@fastify/postgres';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';

import { env } from './config/env.js';
import { runMigrations } from './db/migrate.js';

// Plugins
import redisPlugin from './plugins/redis.js';
import servicesPlugin from './plugins/services.js';
import authPlugin from './plugins/auth.js';

// Routes
import { sessionRoutes } from './routes/sessions.js';
import { taskRoutes } from './routes/tasks.js';
import { agentRoutes } from './routes/agents.js';
import { projectRoutes } from './routes/projects.js';
import { wsRoutes } from './routes/websocket.js';
import { copilotAuthRoutes } from './routes/auth.js';
import { costRoutes } from './routes/costs.js';
import { ticketRoutes } from './routes/tickets.js';
import { organizationRoutes } from './routes/organizations.js';
import { gitConnectionRoutes } from './routes/git-connections.js';

async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  // CORS
  await fastify.register(cors, {
    origin: env.CORS_ORIGINS.split(','),
    credentials: true,
  });

  // Rate limiting
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // PostgreSQL
  await fastify.register(fastifyPostgres, {
    connectionString: env.DATABASE_URL,
  });

  // WebSocket support
  await fastify.register(websocket);

  // Redis
  await fastify.register(redisPlugin);

  // Services (OpenCodeProcessManager, EventBus, CostTracker, TaskQueue)
  await fastify.register(servicesPlugin);

  // Auth (Better Auth + request.user/session decorators) — must be before routes
  await fastify.register(authPlugin);

  // Routes
  await fastify.register(sessionRoutes);
  await fastify.register(taskRoutes);
  await fastify.register(agentRoutes);
  await fastify.register(projectRoutes);
  await fastify.register(wsRoutes);
  await fastify.register(copilotAuthRoutes);
  await fastify.register(costRoutes);
  await fastify.register(ticketRoutes);
  await fastify.register(organizationRoutes);
  await fastify.register(gitConnectionRoutes);

  // Health check
  fastify.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    runningAgents: fastify.processManager.getRunningCount(),
  }));

  return fastify;
}

async function main() {
  try {
    // Run DB migrations first
    await runMigrations(env.DATABASE_URL);

    const app = await buildApp();

    await app.listen({
      port: env.PORT,
      host: env.HOST,
    });

    app.log.info(`Orchestrator API running on http://${env.HOST}:${env.PORT}`);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      app.log.info({ signal }, 'Shutting down gracefully...');
      await app.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

main();
