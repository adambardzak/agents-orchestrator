/**
 * Smoke Test 4: WebSocket Event Bus
 *
 * Tests event routing to subscribers.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../websocket/event-bus.js';
import type { FastifyBaseLogger } from 'fastify';
import { WebSocket, WebSocketServer } from 'ws';

const mockLogger = {
  info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  trace: vi.fn(), fatal: vi.fn(), child: () => mockLogger,
} as unknown as FastifyBaseLogger;

/**
 * Creates a pair of connected WebSocket instances using a real ws server.
 */
async function createWsPair(): Promise<{ server: WebSocket; client: WebSocket; cleanup: () => void }> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: 0 });

    wss.on('error', reject);
    wss.on('listening', () => {
      const addr = wss.address() as { port: number };
      const client = new WebSocket(`ws://127.0.0.1:${addr.port}`);

      wss.once('connection', (serverSock) => {
        client.once('open', () => {
          resolve({
            server: serverSock,
            client,
            cleanup: () => {
              client.close();
              wss.close();
            },
          });
        });
      });

      client.on('error', reject);
    });
  });
}

describe('WebSocket Event Bus', () => {
  it('routes published events to subscribed client', async () => {
    const { server, client, cleanup } = await createWsPair();
    const eventBus = new EventBus(mockLogger);

    const received: unknown[] = [];
    client.on('message', (data) => {
      received.push(JSON.parse(data.toString()));
    });

    const unsubscribe = eventBus.subscribe(server, 'session-1');
    eventBus.publish('agent:event', 'session-1', { type: 'message', role: 'assistant', content: 'Hello' });

    await new Promise((r) => setTimeout(r, 50));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: 'agent:event',
      sessionId: 'session-1',
      payload: { type: 'message', content: 'Hello' },
    });

    unsubscribe();
    cleanup();
  });

  it('does not route events for different sessionId', async () => {
    const { server, client, cleanup } = await createWsPair();
    const eventBus = new EventBus(mockLogger);

    const received: unknown[] = [];
    client.on('message', (data) => received.push(JSON.parse(data.toString())));

    eventBus.subscribe(server, 'session-A');
    eventBus.publish('agent:event', 'session-B', { type: 'message', role: 'assistant', content: 'Wrong session' });

    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(0);

    cleanup();
  });

  it('filters events by taskId when taskIds filter is set', async () => {
    const { server: server1, client: client1, cleanup: cleanup1 } = await createWsPair();
    const { server: server2, client: client2, cleanup: cleanup2 } = await createWsPair();
    const eventBus = new EventBus(mockLogger);

    const received1: unknown[] = [];
    const received2: unknown[] = [];
    client1.on('message', (d) => received1.push(JSON.parse(d.toString())));
    client2.on('message', (d) => received2.push(JSON.parse(d.toString())));

    // client1 subscribes to all tasks, client2 only to task-A
    eventBus.subscribe(server1, 'session-X');
    eventBus.subscribe(server2, 'session-X', ['task-A']);

    eventBus.publish('agent:event', 'session-X', { data: 'for task-A' }, 'task-A');
    eventBus.publish('agent:event', 'session-X', { data: 'for task-B' }, 'task-B');

    await new Promise((r) => setTimeout(r, 50));

    // client1 gets both
    expect(received1).toHaveLength(2);
    // client2 gets only task-A
    expect(received2).toHaveLength(1);
    expect((received2[0] as { taskId: string }).taskId).toBe('task-A');

    cleanup1();
    cleanup2();
  });

  it('includes ISO timestamp in all messages', async () => {
    const { server, client, cleanup } = await createWsPair();
    const eventBus = new EventBus(mockLogger);

    const received: unknown[] = [];
    client.on('message', (d) => received.push(JSON.parse(d.toString())));

    eventBus.subscribe(server, 'ts-session');
    eventBus.publish('cost:update', 'ts-session', { cost: 0.01 });

    await new Promise((r) => setTimeout(r, 50));

    const msg = received[0] as { timestamp: string };
    expect(msg.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    cleanup();
  });

  it('handles client disconnect gracefully', async () => {
    const { server, client, cleanup } = await createWsPair();
    const eventBus = new EventBus(mockLogger);

    eventBus.subscribe(server, 'disc-session');
    expect(eventBus.getSubscriberCount('disc-session')).toBe(1);

    // Close client — event bus should not throw when trying to publish
    cleanup();
    await new Promise((r) => setTimeout(r, 100));

    expect(() => {
      eventBus.publish('agent:event', 'disc-session', { type: 'message', role: 'assistant', content: 'After disconnect' });
    }).not.toThrow();
  });
});
