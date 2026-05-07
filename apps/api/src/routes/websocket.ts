import type { FastifyInstance } from 'fastify';
import type WebSocket from 'ws';
import { assertSessionAccess } from '../services/auth/access.js';

export async function wsRoutes(fastify: FastifyInstance): Promise<void> {
  // WebSocket endpoint: /ws?sessionId=xxx[&taskIds=id1,id2]
  fastify.get(
    '/ws',
    { websocket: true },
    async (socket: WebSocket, request) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
      const sessionId = url.searchParams.get('sessionId');
      const taskIdsParam = url.searchParams.get('taskIds');

      if (!sessionId) {
        socket.close(1008, 'sessionId query parameter required');
        return;
      }

      // Auth & tenant isolation: verify user belongs to the session's org
      try {
        const { orgId } = await request.requireOrg();
        await assertSessionAccess(fastify, sessionId, orgId);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        const code = status === 401 ? 1008 : status === 404 ? 1008 : 1011;
        socket.close(code, status === 401 ? 'Unauthorized' : 'Forbidden');
        return;
      }

      const taskIds = taskIdsParam ? taskIdsParam.split(',').filter(Boolean) : undefined;

      fastify.log.info({ sessionId, taskIds }, 'WebSocket client connected');

      const unsubscribe = fastify.eventBus.subscribe(socket, sessionId, taskIds);

      socket.on('message', (data: Buffer | string) => {
        // Handle client → server messages (e.g., inject message to running agent)
        try {
          const msg = JSON.parse(data.toString()) as { type: string; payload: unknown };

          if (msg.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
          }

          // Future: handle 'inject_message' type for context injection
        } catch {
          fastify.log.warn({ data: data.toString() }, 'Invalid WS message from client');
        }
      });

      socket.on('close', () => {
        fastify.log.info({ sessionId }, 'WebSocket client disconnected');
        unsubscribe();
      });

      socket.on('error', (err) => {
        fastify.log.warn({ sessionId, error: err.message }, 'WebSocket error');
        unsubscribe();
      });

      // Send initial connection acknowledgment
      socket.send(
        JSON.stringify({
          type: 'connected',
          sessionId,
          timestamp: new Date().toISOString(),
        }),
      );
    },
  );
}
