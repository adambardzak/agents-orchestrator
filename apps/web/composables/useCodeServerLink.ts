/**
 * useCodeServerLink — builds deep links into the code-server (web VS Code)
 * instance that's deployed alongside the orchestrator.
 *
 * The API returns `codeServerUrl` and `workspacePath` (host filesystem path,
 * e.g. `/workspaces` on the API container, which maps to `/home/coder/workspaces`
 * inside the code-server container — same Docker volume).
 *
 * To deep-link to a specific session subfolder we re-base the absolute API
 * workspace path to the code-server-visible path.
 */
import { computed } from 'vue';
import { useRuntimeConfig } from '#app';

export interface CodeServerLinkOptions {
  /** Absolute path on API container (e.g. /workspaces/proj-x) */
  workspacePath?: string | null;
  /** Optional session id; appended to the workspace folder. */
  sessionId?: string | null;
  /** Optional file path RELATIVE to the session workspace, opened on load. */
  filePath?: string | null;
  /** Optional 1-based line to focus when filePath is given. */
  line?: number | null;
}

/** Known API workspace roots → code-server workspace root. */
const CODER_WORKSPACE_ROOT = '/home/coder/workspaces';
const REBASE_FROM = ['/workspaces', '/tmp/orchestrator-workspaces'];

function rebase(apiPath: string): string {
  for (const from of REBASE_FROM) {
    if (apiPath === from || apiPath.startsWith(from + '/')) {
      return CODER_WORKSPACE_ROOT + apiPath.slice(from.length);
    }
  }
  return apiPath;
}

export function useCodeServerLink() {
  const config = useRuntimeConfig();
  const baseUrl = computed(
    () => (config.public.codeServerUrl as string | undefined) ?? '',
  );

  function buildLink(opts: CodeServerLinkOptions): string {
    if (!baseUrl.value || !opts.workspacePath) return '';

    let folder = rebase(opts.workspacePath);
    if (opts.sessionId) {
      folder = `${folder.replace(/\/+$/, '')}/sessions/${opts.sessionId}`;
    }

    const params = new URLSearchParams();
    params.set('folder', folder);

    // code-server supports ?payload= with `openFile`.
    // Format: array of `[filePath, options]` tuples.
    if (opts.filePath) {
      const filePath = opts.filePath.startsWith('/')
        ? opts.filePath
        : `${folder.replace(/\/+$/, '')}/${opts.filePath}`;
      const payload: Array<[string, Record<string, unknown>]> = [
        [
          'gotoLine',
          {
            file: filePath,
            line: opts.line ?? 1,
            column: 1,
          },
        ],
      ];
      try {
        params.set('payload', JSON.stringify(payload));
      } catch {
        // ignore — folder open still works
      }
    }

    return `${baseUrl.value}/?${params.toString()}`;
  }

  return { baseUrl, buildLink };
}
