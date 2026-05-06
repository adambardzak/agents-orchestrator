/**
 * Workspace Git helper — wraps simple-git for clone / commit / push against
 * a project workspace directory.
 *
 * All remote operations use a per-call authenticated URL derived from the
 * connection's plaintext token (decrypted on demand). We never persist the
 * token in the git config (no `credential.helper`), so even if a workspace
 * is leaked the token stays in the encrypted DB column.
 *
 * Branch convention:
 *   - main project workspace tracks the repo's default branch
 *   - per-session work happens on `agent/session-<sessionId>` branches that
 *     get pushed to the same remote and auto-merged via PR (later)
 */
import { simpleGit, type SimpleGit } from 'simple-git';
import { promises as fs } from 'node:fs';
import nodePath from 'node:path';

export interface CommitResult {
  sha: string;
  message: string;
  branch: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface WorkingTreeStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: string[];
  modified: string[];
  untracked: string[];
  deleted: string[];
  clean: boolean;
}

/**
 * Clone a remote into `targetDir`. The directory must NOT exist yet, or must
 * be empty — simple-git's clone will fail otherwise. We delete an existing
 * empty dir before cloning to keep the call idempotent for fresh project
 * workspaces.
 */
export async function cloneRepo(args: {
  authenticatedUrl: string;
  targetDir: string;
  branch?: string;
}): Promise<void> {
  // If targetDir exists and is empty, remove it so clone can create it fresh.
  // If it exists and is non-empty, throw — caller should use `initInPlace` instead.
  try {
    const entries = await fs.readdir(args.targetDir);
    if (entries.length > 0) {
      throw new Error(`Cannot clone into non-empty directory: ${args.targetDir}`);
    }
    await fs.rmdir(args.targetDir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Re-throw anything that isn't "doesn't exist".
      if ((err as Error).message?.startsWith('Cannot clone')) throw err;
    }
  }
  await fs.mkdir(nodePath.dirname(args.targetDir), { recursive: true });

  const git = simpleGit();
  const opts = args.branch ? ['--branch', args.branch] : [];
  await git.clone(args.authenticatedUrl, args.targetDir, opts);
}

/**
 * Initialize a repo in-place when the workspace already has files (e.g. from
 * agent work) and we want to attach it to a fresh remote.
 */
export async function initAndPushInitial(args: {
  workspaceDir: string;
  authenticatedUrl: string;
  branch: string;
  authorName: string;
  authorEmail: string;
}): Promise<CommitResult> {
  const git = simpleGit(args.workspaceDir);
  await git.init();
  await git.addConfig('user.name',  args.authorName,  false, 'local');
  await git.addConfig('user.email', args.authorEmail, false, 'local');
  await git.checkoutLocalBranch(args.branch);
  await git.add('.');
  const commit = await git.commit('Initial commit from Agent Orchestrator');
  await git.addRemote('origin', args.authenticatedUrl);
  await git.push(['-u', 'origin', args.branch]);
  return await describeCommit(git, commit.commit, args.branch);
}

/**
 * Stage all changes in the workspace and commit on the given branch.
 * Returns null if nothing to commit (clean tree).
 */
export async function commitAll(args: {
  workspaceDir: string;
  branch: string;
  message: string;
  authorName: string;
  authorEmail: string;
  /** Create the branch if it doesn't exist yet. */
  createBranchIfMissing?: boolean;
}): Promise<CommitResult | null> {
  const git = simpleGit(args.workspaceDir);
  await git.addConfig('user.name',  args.authorName,  false, 'local');
  await git.addConfig('user.email', args.authorEmail, false, 'local');

  const branches = await git.branchLocal();
  if (branches.current !== args.branch) {
    if (branches.all.includes(args.branch)) {
      await git.checkout(args.branch);
    } else if (args.createBranchIfMissing) {
      await git.checkoutLocalBranch(args.branch);
    } else {
      throw new Error(`Branch ${args.branch} does not exist`);
    }
  }

  const status = await git.status();
  if (status.files.length === 0) return null;

  await git.add('.');
  const commit = await git.commit(args.message);
  if (!commit.commit) return null;

  return await describeCommit(git, commit.commit, args.branch);
}

/**
 * Push a local branch to origin. Re-points the remote URL to use the
 * current access token in case the previous push used a stale one.
 */
export async function pushBranch(args: {
  workspaceDir: string;
  branch: string;
  authenticatedUrl: string;
}): Promise<void> {
  const git = simpleGit(args.workspaceDir);
  // Update the remote URL to inject the fresh authenticated URL — tokens may
  // have rotated since clone time. setRemoteUrl writes to .git/config which
  // is fine because the token will be removed on session cleanup.
  await git.remote(['set-url', 'origin', args.authenticatedUrl]);
  await git.push(['-u', 'origin', args.branch]);
}

export async function getStatus(workspaceDir: string): Promise<WorkingTreeStatus> {
  const git = simpleGit(workspaceDir);
  const status = await git.status();
  return {
    branch:    status.current ?? 'HEAD',
    ahead:     status.ahead,
    behind:    status.behind,
    staged:    status.staged,
    modified:  status.modified,
    untracked: status.not_added,
    deleted:   status.deleted,
    clean:     status.isClean(),
  };
}

/**
 * Returns a unified diff for the working tree (or for a specific commit
 * range if `from`/`to` are provided). Truncates to ~200KB to avoid
 * blowing up the response — the UI can request a paginated/per-file
 * diff later if needed.
 */
export async function getDiff(args: {
  workspaceDir: string;
  from?: string;
  to?: string;
  maxBytes?: number;
}): Promise<string> {
  const git = simpleGit(args.workspaceDir);
  const range = args.from && args.to ? [`${args.from}..${args.to}`] : [];
  const out = await git.diff(range);
  const cap = args.maxBytes ?? 200_000;
  return out.length > cap ? out.slice(0, cap) + '\n...[diff truncated]' : out;
}

// ── private ──────────────────────────────────────────────────────────────────
async function describeCommit(git: SimpleGit, sha: string, branch: string): Promise<CommitResult> {
  // `git show --stat --format="%H%n%s"` gives us the header + per-file stats.
  const raw = await git.show(['--stat', '--format=%H%n%s', sha]);
  const lines = raw.split('\n');
  const message = lines[1] ?? '';
  // Last non-empty line is the summary "N files changed, X insertions(+), Y deletions(-)".
  const summaryLine = lines.reverse().find((l) => /files? changed/.test(l)) ?? '';
  const filesChanged = parseInt(/(\d+) files? changed/.exec(summaryLine)?.[1] ?? '0', 10);
  const insertions   = parseInt(/(\d+) insertions?\(\+\)/.exec(summaryLine)?.[1] ?? '0', 10);
  const deletions    = parseInt(/(\d+) deletions?\(-\)/.exec(summaryLine)?.[1] ?? '0', 10);
  return { sha, message, branch, filesChanged, insertions, deletions };
}
