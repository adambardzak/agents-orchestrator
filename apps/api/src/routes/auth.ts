import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const AUTH_JSON_PATH = path.join(
  os.homedir(),
  '.local',
  'share',
  'opencode',
  'auth.json',
);

interface AuthJson {
  'github-copilot'?: {
    type: string;
    access: string;
    refresh?: string;
    expires?: number;
  };
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/auth/token
   *
   * Reads the OpenCode auth.json from the server filesystem and returns
   * the GitHub Copilot access token. This lets the web frontend auto-populate
   * the token without the user having to paste it manually.
   *
   * Only available in development (NODE_ENV !== 'production').
   * In production, tokens should be passed via env var or a proper secret store.
   */
  fastify.get('/api/auth/token', async (_request, reply) => {
    try {
      const raw = await fs.readFile(AUTH_JSON_PATH, 'utf-8');
      const auth = JSON.parse(raw) as AuthJson;
      const copilot = auth['github-copilot'];

      if (!copilot?.access) {
        return reply.status(404).send({ error: 'No GitHub Copilot token found in auth.json' });
      }

      return {
        token: copilot.access,
        type: copilot.type,
        source: AUTH_JSON_PATH,
      };
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return reply.status(404).send({
          error: `auth.json not found at ${AUTH_JSON_PATH}`,
          hint: 'Set your token manually in Settings.',
        });
      }
      fastify.log.warn({ err }, 'Failed to read auth.json');
      return reply.status(500).send({ error: 'Failed to read auth.json' });
    }
  });
}
