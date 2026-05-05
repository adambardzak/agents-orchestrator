import WebSocket from 'ws';
import type { WsMessage, WsMessageType } from '@agent-orchestrator/shared';
import type { FastifyBaseLogger } from 'fastify';

interface Subscription {
  sessionId: string;
  taskIds: Set<string>; // empty = subscribe to all tasks in session
  ws: WebSocket;
}

/**
 * WebSocket Event Bus
 *
 * Manages WebSocket connections from the dashboard and routes
 * agent events to the correct subscribers.
 *
 * Subscription model:
 *  - Client connects to /ws?sessionId=xxx
 *  - Receives all events for that session
 *  - Optionally filters by specific taskIds
 */
export class EventBus {
  // sessionId → Set of subscriptions
  private subscriptions = new Map<string, Set<Subscription>>();
  private logger: FastifyBaseLogger;

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
  }

  subscribe(ws: WebSocket, sessionId: string, taskIds?: string[]): () => void {
    const sub: Subscription = {
      sessionId,
      taskIds: new Set(taskIds ?? []),
      ws,
    };

    if (!this.subscriptions.has(sessionId)) {
      this.subscriptions.set(sessionId, new Set());
    }
    this.subscriptions.get(sessionId)!.add(sub);

    this.logger.debug({ sessionId, taskIds }, 'WebSocket client subscribed');

    // Return unsubscribe function
    return () => {
      const subs = this.subscriptions.get(sessionId);
      if (subs) {
        subs.delete(sub);
        if (subs.size === 0) {
          this.subscriptions.delete(sessionId);
        }
      }
      this.logger.debug({ sessionId }, 'WebSocket client unsubscribed');
    };
  }

  publish<T>(type: WsMessageType, sessionId: string, payload: T, taskId?: string): void {
    const message: WsMessage<T> = {
      type,
      sessionId,
      taskId,
      payload,
      timestamp: new Date().toISOString(),
    };

    const subs = this.subscriptions.get(sessionId);
    if (!subs || subs.size === 0) return;

    const serialized = JSON.stringify(message);

    for (const sub of subs) {
      // Filter by taskId if subscription has specific task filter
      if (taskId && sub.taskIds.size > 0 && !sub.taskIds.has(taskId)) {
        continue;
      }

          if (sub.ws.readyState === WebSocket.OPEN) {
            sub.ws.send(serialized, (err?: Error) => {
              if (err) {
                this.logger.warn({ sessionId, taskId, error: err.message }, 'Failed to send WS message');
              }
            });
          }
    }
  }

  publishToAll<T>(type: WsMessageType, payload: T): void {
    const message: WsMessage<T> = {
      type,
      sessionId: '*',
      payload,
      timestamp: new Date().toISOString(),
    };
    const serialized = JSON.stringify(message);

    for (const subs of this.subscriptions.values()) {
      for (const sub of subs) {
        if (sub.ws.readyState === WebSocket.OPEN) {
          sub.ws.send(serialized);
        }
      }
    }
  }

  getSubscriberCount(sessionId: string): number {
    return this.subscriptions.get(sessionId)?.size ?? 0;
  }

  closeSession(sessionId: string): void {
    const subs = this.subscriptions.get(sessionId);
    if (!subs) return;

    for (const sub of subs) {
      if (sub.ws.readyState === sub.ws.OPEN) {
        sub.ws.close(1000, 'Session ended');
      }
    }
    this.subscriptions.delete(sessionId);
  }
}
