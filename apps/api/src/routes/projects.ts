import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import nodePath from 'node:path';
import { promises as fs } from 'node:fs';
import { env } from '../config/env.js';
import { GitConnectionService } from '../services/git/connection-service.js';
import { OrganizationService } from '../services/auth/organization-service.js';
import { ProjectRepoService } from '../services/git/project-repo-service.js';
import { assertProjectAccess, assertSessionAccess } from '../services/auth/access.js';
import { getGitProvider } from '../services/git/registry.js';
import { cloneRepo } from '../services/git/workspace-git.js';

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

  /**
   * Optional Git integration. Three mutually-exclusive flows:
   *   1. omit `git` entirely  → no remote, local-only project
   *   2. `git.action = 'create'` → call provider.createRepo, then clone
   *   3. `git.action = 'link'`   → clone an existing repo by full_name
   */
  git: z.discriminatedUnion('action', [
    z.object({
      action:           z.literal('create'),
      gitConnectionId:  z.string().uuid(),
      repoName:         z.string().min(1).max(100),
      visibility:       z.enum(['private', 'public', 'internal']).default('private'),
      namespace:        z.string().optional(), // org/group/workspace
    }),
    z.object({
      action:           z.literal('link'),
      gitConnectionId:  z.string().uuid(),
      fullName:         z.string().min(1), // "owner/repo"
      cloneUrl:         z.string().url(),
      defaultBranch:    z.string().default('main'),
      visibility:       z.enum(['private', 'public', 'internal']).default('private'),
      externalId:       z.string().optional(),
    }),
  ]).optional(),
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
  // GET /api/projects — list with session stats (filtered to caller's active org)
  fastify.get('/api/projects', async (request) => {
    const { orgId } = await request.requireOrg();
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
      WHERE p.organization_id = $1
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `, [orgId]);

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
  fastify.get<{ Params: { id: string } }>('/api/projects/:id', async (request) => {
    const { orgId } = await request.requireOrg();
    await assertProjectAccess(fastify, request.params.id, orgId);
    const { rows: [project] } = await fastify.pg.query(
      'SELECT * FROM projects WHERE id = $1',
      [request.params.id],
    );
    return {
      ...project,
      workspacePath: project.workspace_path,
      contextType: project.context_type,
      codeServerUrl: env.CODE_SERVER_URL,
    };
  });

  // POST /api/projects — create project + provision workspace + optional git repo
  fastify.post('/api/projects', async (request, reply) => {
    const user  = await request.requireUser();
    let orgId   = request.session?.activeOrganizationId ?? null;

    // Fallback: if the session has no active org (e.g. dev session was reset),
    // pick the user's first membership so project creation doesn't 500 with a
    // NOT NULL violation. The user can move the project later via re-create
    // once we add per-project workspace assignment.
    if (!orgId) {
      const orgs = new OrganizationService(fastify.pg.pool);
      const list = await orgs.listForUser(user.id);
      orgId = list[0]?.id ?? null;
      if (!orgId) {
        return reply.status(400).send({
          error: 'No workspace selected. Create or activate a workspace first.',
        });
      }
    }

    const body = createProjectSchema.parse(request.body);
    const id = uuid();

    // Determine workspace path: user-provided or auto-generated
    const workspacePath = body.workspacePath
      ? nodePath.resolve(body.workspacePath) // normalise, strip trailing slash
      : nodePath.join(env.WORKSPACES_ROOT, id);

    const willClone = !!body.git; // skip mkdir of sub-dirs if cloning
    // Ensure workspace exists (create if needed)
    try {
      const stat = await fs.stat(workspacePath);
      if (!stat.isDirectory()) {
        return reply.status(400).send({ error: `Path exists but is not a directory: ${workspacePath}` });
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        if (willClone) {
          // Clone will create the dir itself; just ensure parent exists.
          await fs.mkdir(nodePath.dirname(workspacePath), { recursive: true });
        } else {
          // Local-only project: scaffold the standard sub-dirs.
          await fs.mkdir(nodePath.join(workspacePath, '.opencode'),       { recursive: true });
          await fs.mkdir(nodePath.join(workspacePath, '.obsidian-vault'), { recursive: true });
          await fs.mkdir(nodePath.join(workspacePath, 'src'),             { recursive: true });
        }
      } else {
        throw err; // unexpected error (e.g. EACCES)
      }
    }

    // ── Optional Git integration ────────────────────────────────────────────
    type RepoInsert = {
      gitConnectionId: string;
      provider:        'github' | 'gitlab' | 'bitbucket';
      remoteUrl:       string;
      defaultBranch:   string;
      fullName:        string;
      visibility:      'private' | 'public' | 'internal';
      externalId:      string | null;
    } | null;
    let repoToInsert: RepoInsert = null;

    if (body.git) {
      const connections = new GitConnectionService(fastify.pg.pool);
      const conn = await connections.getById(body.git.gitConnectionId);
      if (!conn) return reply.status(400).send({ error: 'Unknown git connection' });
      if (conn.userId !== user.id) {
        return reply.status(403).send({ error: 'Connection belongs to a different user' });
      }
      const provider = getGitProvider(conn.provider);
      if (!provider) {
        return reply.status(400).send({ error: `Provider ${conn.provider} not configured` });
      }
      const token = await connections.getAccessToken(conn.id);
      if (!token) return reply.status(500).send({ error: 'Git token unavailable' });

      try {
        if (body.git.action === 'create') {
          const repo = await provider.createRepo(token, {
            name:        body.git.repoName,
            description: body.description ?? '',
            visibility:  body.git.visibility,
            ...(body.git.namespace ? { namespace: body.git.namespace } : {}),
            autoInit:    true, // need an initial commit so we can clone
          });
          await cloneRepo({
            authenticatedUrl: provider.authenticatedCloneUrl(token, repo),
            targetDir:        workspacePath,
            branch:           repo.defaultBranch,
          });
          repoToInsert = {
            gitConnectionId: conn.id,
            provider:        conn.provider,
            remoteUrl:       repo.cloneUrl,
            defaultBranch:   repo.defaultBranch,
            fullName:        repo.fullName,
            visibility:      body.git.visibility,
            externalId:      repo.id,
          };
        } else {
          // link existing repo
          const authedUrl = body.git.cloneUrl.replace(
            'https://',
            `https://x-access-token:${encodeURIComponent(token)}@`,
          );
          await cloneRepo({
            authenticatedUrl: authedUrl,
            targetDir:        workspacePath,
            branch:           body.git.defaultBranch,
          });
          repoToInsert = {
            gitConnectionId: conn.id,
            provider:        conn.provider,
            remoteUrl:       body.git.cloneUrl,
            defaultBranch:   body.git.defaultBranch,
            fullName:        body.git.fullName,
            visibility:      body.git.visibility,
            externalId:      body.git.externalId ?? null,
          };
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'unknown';
        fastify.log.error({ err }, 'Git provisioning failed');
        return reply.status(502).send({ error: `Git provisioning failed: ${msg}` });
      }
    }

    const { rows: [project] } = await fastify.pg.query(
      `INSERT INTO projects (id, name, description, context_type, workspace_path, organization_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, body.name, body.description ?? null, body.contextType, workspacePath, orgId, user.id],
    );

    if (repoToInsert) {
      const repos = new ProjectRepoService(fastify.pg.pool);
      await repos.create({ projectId: id, ...repoToInsert });
    }

    fastify.log.info({ projectId: id, workspacePath, hasRepo: !!repoToInsert }, 'Project created');
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
    async (request) => {
      const { orgId } = await request.requireOrg();
      const project = await assertProjectAccess(fastify, request.params.id, orgId);
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
      const { orgId } = await request.requireOrg();
      const project = await assertProjectAccess(fastify, request.params.id, orgId);

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
    const { orgId } = await request.requireOrg();
    await assertProjectAccess(fastify, request.params.id, orgId);
    await fastify.pg.query(
      'DELETE FROM projects WHERE id = $1 AND organization_id = $2',
      [request.params.id, orgId],
    );
    return reply.status(204).send();
  });

  // POST /api/projects/:id/index — trigger RAG indexing of workspace files
  fastify.post<{ Params: { id: string } }>('/api/projects/:id/index', async (request) => {
    const { orgId } = await request.requireOrg();
    const project = await assertProjectAccess(fastify, request.params.id, orgId);

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
      const { orgId } = await request.requireOrg();
      const { q, k } = request.query;
      if (!q?.trim()) return reply.status(400).send({ error: 'q is required' });

      await assertProjectAccess(fastify, request.params.id, orgId);

      const chunks = await fastify.ragService.retrieveContext(
        request.params.id,
        q,
        undefined,
        k ? parseInt(k, 10) : 5,
      );

      return { chunks };
    },
  );

  // ── Git endpoints ───────────────────────────────────────────────────────

  // GET /api/projects/:id/repo — return linked repository or null
  fastify.get<{ Params: { id: string } }>(
    '/api/projects/:id/repo',
    async (request) => {
      const { orgId } = await request.requireOrg();
      await assertProjectAccess(fastify, request.params.id, orgId);
      const repos = new ProjectRepoService(fastify.pg.pool);
      const repo = await repos.getByProject(request.params.id);
      return { repo };
    },
  );

  // GET /api/projects/:id/git/status — working tree status
  fastify.get<{ Params: { id: string } }>(
    '/api/projects/:id/git/status',
    async (request) => {
      const { orgId } = await request.requireOrg();
      const project = await assertProjectAccess(fastify, request.params.id, orgId);
      try {
        const { getStatus } = await import('../services/git/workspace-git.js');
        const status = await getStatus(project.workspace_path);
        return { status };
      } catch (err: unknown) {
        // No git repo in workspace yet — return empty status rather than 500.
        const msg = err instanceof Error ? err.message : 'unknown';
        return { status: null, error: msg };
      }
    },
  );

  // GET /api/projects/:id/git/diff — working-tree (or commit-range) diff
  fastify.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    '/api/projects/:id/git/diff',
    async (request, reply) => {
      const { orgId } = await request.requireOrg();
      const project = await assertProjectAccess(fastify, request.params.id, orgId);
      try {
        const { getDiff } = await import('../services/git/workspace-git.js');
        const diff = await getDiff({
          workspaceDir: project.workspace_path,
          ...(request.query.from ? { from: request.query.from } : {}),
          ...(request.query.to   ? { to:   request.query.to   } : {}),
        });
        return { diff };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'unknown';
        return reply.status(400).send({ error: msg });
      }
    },
  );

  // GET /api/sessions/:id/commits — list per-session auto-commits
  fastify.get<{ Params: { id: string } }>(
    '/api/sessions/:id/commits',
    async (request) => {
      const { orgId } = await request.requireOrg();
      await assertSessionAccess(fastify, request.params.id, orgId);
      const repos = new ProjectRepoService(fastify.pg.pool);
      const commits = await repos.listForSession(request.params.id);
      return { commits };
    },
  );
}
