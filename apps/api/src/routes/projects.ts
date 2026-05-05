import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import nodePath from 'node:path';
import { promises as fs } from 'node:fs';
import { env } from '../config/env.js';

// ── Schemas ───────────────────────────────────────────────────────────────────

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  contextType: z.enum(['personal', 'cez']).default('personal'),
  /**
   * Absolute path to the project workspace on the server filesystem.
   * If omitted, auto-generated under WORKSPACES_ROOT/{uuid}.
   */
  workspacePath: z.string().optional(),
});

// ── Ignore patterns for file listing ─────────────────────────────────────────

const IGNORE_DIRS = new Set([
  '.git', 'node_modules', '.next', '.nuxt', 'dist', 'build', '__pycache__',
  '.cache', '.turbo', 'coverage', '.nyc_output', 'vendor', '.svn', '.hg',
]);
const IGNORE_FILES = new Set(['.DS_Store', 'Thumbs.db', '.gitkeep']);
const MAX_DEPTH = 5;
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

const IMAGE_EXTS: Record<string, string> = {
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  gif:  'image/gif',
  webp: 'image/webp',
  bmp:  'image/bmp',
  ico:  'image/x-icon',
  avif: 'image/avif',
  tiff: 'image/tiff',
  tif:  'image/tiff',
};

// ── File tree types ───────────────────────────────────────────────────────────

interface FileNode {
  name: string;
  /** Relative path from workspace root */
  path: string;
  type: 'file' | 'dir';
  size?: number;
  children?: FileNode[];
}

async function buildFileTree(
  absDir: string,
  relBase: string,
  depth: number,
): Promise<FileNode[]> {
  if (depth > MAX_DEPTH) return [];

  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileNode[] = [];

  for (const entry of entries.sort((a, b) => {
    // Directories first, then alphabetical
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  })) {
    if (entry.name.startsWith('.') && IGNORE_DIRS.has(entry.name)) continue;
    if (IGNORE_FILES.has(entry.name)) continue;

    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
    const absPath = nodePath.join(absDir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const children = await buildFileTree(absPath, relPath, depth + 1);
      nodes.push({ name: entry.name, path: relPath, type: 'dir', children });
    } else if (entry.isFile()) {
      let size: number | undefined;
      try {
        const stat = await fs.stat(absPath);
        size = stat.size;
      } catch { /* ignore */ }
      nodes.push({ name: entry.name, path: relPath, type: 'file', size });
    }
  }

  return nodes;
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function projectRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/projects — list with session stats
  fastify.get('/api/projects', async () => {
    const { rows } = await fastify.pg.query<{
      id: string; name: string; description: string | null;
      context_type: string; workspace_path: string;
      created_at: string; updated_at: string;
      session_count: string; total_cost_usd: string; last_session_at: string | null;
    }>(`
      SELECT
        p.*,
        COUNT(s.id)::int                     AS session_count,
        COALESCE(SUM(s.total_cost_usd), 0)   AS total_cost_usd,
        MAX(s.created_at)                    AS last_session_at
      FROM projects p
      LEFT JOIN sessions s ON s.project_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);

    return {
      projects: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        contextType: r.context_type,
        workspacePath: r.workspace_path,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        sessionCount: Number(r.session_count),
        totalCostUsd: Number(r.total_cost_usd),
        lastSessionAt: r.last_session_at,
      })),
      // Expose code-server URL so frontend can construct deep links
      codeServerUrl: env.CODE_SERVER_URL,
    };
  });

  // GET /api/projects/:id
  fastify.get<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    const { rows: [project] } = await fastify.pg.query(
      'SELECT * FROM projects WHERE id = $1',
      [request.params.id],
    );
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    return {
      ...project,
      workspacePath: project.workspace_path,
      contextType: project.context_type,
      codeServerUrl: env.CODE_SERVER_URL,
    };
  });

  // POST /api/projects — create project + provision workspace directory
  fastify.post('/api/projects', async (request, reply) => {
    const body = createProjectSchema.parse(request.body);
    const id = uuid();

    // Determine workspace path: user-provided or auto-generated
    const workspacePath = body.workspacePath
      ? nodePath.resolve(body.workspacePath) // normalise, strip trailing slash
      : nodePath.join(env.WORKSPACES_ROOT, id);

    // Ensure workspace exists (create if needed)
    try {
      const stat = await fs.stat(workspacePath);
      if (!stat.isDirectory()) {
        return reply.status(400).send({ error: `Path exists but is not a directory: ${workspacePath}` });
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Directory doesn't exist — create it with standard sub-dirs
        await fs.mkdir(nodePath.join(workspacePath, '.opencode'), { recursive: true });
        await fs.mkdir(nodePath.join(workspacePath, '.obsidian-vault'), { recursive: true });
        await fs.mkdir(nodePath.join(workspacePath, 'src'), { recursive: true });
      } else {
        throw err; // unexpected error (e.g. EACCES)
      }
    }

    const { rows: [project] } = await fastify.pg.query(
      `INSERT INTO projects (id, name, description, context_type, workspace_path)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, body.name, body.description ?? null, body.contextType, workspacePath],
    );

    fastify.log.info({ projectId: id, workspacePath }, 'Project created');
    return reply.status(201).send({
      ...project,
      workspacePath: project.workspace_path,
      contextType: project.context_type,
      codeServerUrl: env.CODE_SERVER_URL,
    });
  });

  // GET /api/projects/:id/files — recursive directory listing
  fastify.get<{ Params: { id: string } }>(
    '/api/projects/:id/files',
    async (request, reply) => {
      const { rows: [project] } = await fastify.pg.query<{ workspace_path: string }>(
        'SELECT workspace_path FROM projects WHERE id = $1',
        [request.params.id],
      );
      if (!project) return reply.status(404).send({ error: 'Project not found' });

      const workspacePath = project.workspace_path;

      // Auto-create workspace if it doesn't exist yet
      // (e.g. project was created with a custom path before the dir was made)
      try {
        await fs.access(workspacePath);
      } catch {
        await fs.mkdir(nodePath.join(workspacePath, '.opencode'), { recursive: true });
        await fs.mkdir(nodePath.join(workspacePath, '.obsidian-vault'), { recursive: true });
        await fs.mkdir(nodePath.join(workspacePath, 'src'), { recursive: true });
        fastify.log.info({ workspacePath }, 'Workspace directory auto-created on first files access');
      }

      const tree = await buildFileTree(workspacePath, '', 0);
      return { workspacePath, tree };
    },
  );

  // GET /api/projects/:id/files/content?path=src/index.ts — read file content
  fastify.get<{
    Params: { id: string };
    Querystring: { path: string };
  }>(
    '/api/projects/:id/files/content',
    async (request, reply) => {
      const { rows: [project] } = await fastify.pg.query<{ workspace_path: string }>(
        'SELECT workspace_path FROM projects WHERE id = $1',
        [request.params.id],
      );
      if (!project) return reply.status(404).send({ error: 'Project not found' });

      const relPath = request.query.path;
      if (!relPath) return reply.status(400).send({ error: 'path query param required' });

      const workspacePath = nodePath.resolve(project.workspace_path);
      const absPath = nodePath.resolve(workspacePath, relPath);

      // Security: prevent path traversal
      if (!absPath.startsWith(workspacePath + nodePath.sep) && absPath !== workspacePath) {
        return reply.status(403).send({ error: 'Path traversal not allowed' });
      }

      let stat;
      try {
        stat = await fs.stat(absPath);
      } catch {
        return reply.status(404).send({ error: 'File not found' });
      }

      if (!stat.isFile()) {
        return reply.status(400).send({ error: 'Path is not a file' });
      }

      if (stat.size > MAX_FILE_SIZE) {
        return reply.status(413).send({ error: `File too large (max ${MAX_FILE_SIZE / 1024}KB)` });
      }

      const ext = nodePath.extname(absPath).slice(1).toLowerCase();
      const mimeType = IMAGE_EXTS[ext];

      if (mimeType) {
        // Binary image: return as base64 data URL so the browser can render it
        const buf = await fs.readFile(absPath);
        return {
          path: relPath,
          content: `data:${mimeType};base64,${buf.toString('base64')}`,
          size: stat.size,
          ext,
          modifiedAt: stat.mtime.toISOString(),
          isImage: true,
        };
      }

      const content = await fs.readFile(absPath, 'utf-8');

      return {
        path: relPath,
        content,
        size: stat.size,
        ext,
        modifiedAt: stat.mtime.toISOString(),
        isImage: false,
      };
    },
  );

  // DELETE /api/projects/:id
  fastify.delete<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    const { id } = request.params;
    const { rowCount } = await fastify.pg.query(
      'DELETE FROM projects WHERE id = $1',
      [id],
    );
    if (!rowCount) return reply.status(404).send({ error: 'Project not found' });
    return reply.status(204).send();
  });

  // POST /api/projects/:id/index — trigger RAG indexing of workspace files
  fastify.post<{ Params: { id: string } }>('/api/projects/:id/index', async (request, reply) => {
    const { rows: [project] } = await fastify.pg.query<{ workspace_path: string }>(
      'SELECT workspace_path FROM projects WHERE id = $1',
      [request.params.id],
    );
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    // Fire-and-forget — indexing can take a while
    fastify.ragService.indexProjectFiles(request.params.id, project.workspace_path)
      .then((count) => fastify.log.info({ projectId: request.params.id, chunks: count }, 'RAG indexing complete'))
      .catch((err: Error) => fastify.log.warn({ err }, 'RAG indexing failed'));

    return { message: 'Indexing started', projectId: request.params.id };
  });

  // GET /api/projects/:id/rag?q=<query> — retrieve relevant context chunks
  fastify.get<{ Params: { id: string }; Querystring: { q: string; k?: string } }>(
    '/api/projects/:id/rag',
    async (request, reply) => {
      const { q, k } = request.query;
      if (!q?.trim()) return reply.status(400).send({ error: 'q is required' });

      const { rows: [project] } = await fastify.pg.query<{ id: string }>(
        'SELECT id FROM projects WHERE id = $1',
        [request.params.id],
      );
      if (!project) return reply.status(404).send({ error: 'Project not found' });

      const chunks = await fastify.ragService.retrieveContext(
        request.params.id,
        q,
        undefined,
        k ? parseInt(k, 10) : 5,
      );

      return { chunks };
    },
  );
}
