/**
 * project_repositories CRUD — links a project to a Git remote owned by one
 * of the org's git connections. 1:1 with project (UNIQUE constraint).
 *
 * Also writes session_commits rows when the worker auto-commits per-task
 * changes inside a session workspace.
 */
import type { Pool } from 'pg';
import type { GitProviderId } from './provider.js';
import type { CommitResult } from './workspace-git.js';

export interface ProjectRepository {
  id:               string;
  projectId:        string;
  gitConnectionId:  string;
  provider:         GitProviderId;
  remoteUrl:        string;
  defaultBranch:    string;
  fullName:         string;
  visibility:       'private' | 'public' | 'internal';
  externalId:       string | null;
  createdAt:        Date;
}

export interface SessionCommit {
  id:           string;
  sessionId:    string;
  projectId:    string;
  sha:          string;
  message:      string;
  branch:       string;
  filesChanged: number;
  insertions:   number;
  deletions:    number;
  pushedAt:     Date | null;
  createdAt:    Date;
}

export class ProjectRepoService {
  constructor(private readonly pool: Pool) {}

  async create(args: {
    projectId:       string;
    gitConnectionId: string;
    provider:        GitProviderId;
    remoteUrl:       string;
    defaultBranch:   string;
    fullName:        string;
    visibility:      'private' | 'public' | 'internal';
    externalId:      string | null;
  }): Promise<ProjectRepository> {
    const { rows: [r] } = await this.pool.query(
      `INSERT INTO project_repositories
         (project_id, git_connection_id, provider, remote_url, default_branch,
          full_name, visibility, external_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        args.projectId, args.gitConnectionId, args.provider, args.remoteUrl,
        args.defaultBranch, args.fullName, args.visibility, args.externalId,
      ],
    );
    return this.mapRepo(r);
  }

  async getByProject(projectId: string): Promise<ProjectRepository | null> {
    const { rows: [r] } = await this.pool.query(
      `SELECT * FROM project_repositories WHERE project_id = $1`,
      [projectId],
    );
    return r ? this.mapRepo(r) : null;
  }

  async deleteByProject(projectId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM project_repositories WHERE project_id = $1`,
      [projectId],
    );
  }

  // ── session_commits ───────────────────────────────────────────────────────
  async recordCommit(args: {
    sessionId: string;
    projectId: string;
    commit:    CommitResult;
    pushed:    boolean;
  }): Promise<SessionCommit> {
    const { rows: [r] } = await this.pool.query(
      `INSERT INTO session_commits
         (session_id, project_id, sha, message, branch,
          files_changed, insertions, deletions, pushed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        args.sessionId, args.projectId, args.commit.sha, args.commit.message,
        args.commit.branch, args.commit.filesChanged, args.commit.insertions,
        args.commit.deletions, args.pushed ? new Date() : null,
      ],
    );
    return this.mapCommit(r);
  }

  async listForSession(sessionId: string): Promise<SessionCommit[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM session_commits WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId],
    );
    return rows.map((r) => this.mapCommit(r));
  }

  // ── private ──────────────────────────────────────────────────────────────
  private mapRepo(r: Record<string, unknown>): ProjectRepository {
    return {
      id:              String(r['id']),
      projectId:       String(r['project_id']),
      gitConnectionId: String(r['git_connection_id']),
      provider:        r['provider'] as GitProviderId,
      remoteUrl:       String(r['remote_url']),
      defaultBranch:   String(r['default_branch']),
      fullName:        String(r['full_name']),
      visibility:      r['visibility'] as 'private' | 'public' | 'internal',
      externalId:      (r['external_id'] as string | null) ?? null,
      createdAt:       new Date(r['created_at'] as string),
    };
  }

  private mapCommit(r: Record<string, unknown>): SessionCommit {
    return {
      id:           String(r['id']),
      sessionId:    String(r['session_id']),
      projectId:    String(r['project_id']),
      sha:          String(r['sha']),
      message:      String(r['message']),
      branch:       String(r['branch']),
      filesChanged: Number(r['files_changed']),
      insertions:   Number(r['insertions']),
      deletions:    Number(r['deletions']),
      pushedAt:     r['pushed_at'] ? new Date(r['pushed_at'] as string) : null,
      createdAt:    new Date(r['created_at'] as string),
    };
  }
}
