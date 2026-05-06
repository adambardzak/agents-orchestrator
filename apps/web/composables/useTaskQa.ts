/**
 * useTaskQa — fetch deterministic QA validation results for a single task.
 *
 * Results are populated by the post-task hook in agent-worker. Returns an
 * empty array while a task is still in flight, or for non-code agent types
 * (orchestrator/document/qa) where QA isn't run.
 */
export interface QaResult {
  tool:         'tsc' | 'eslint' | 'vitest' | 'playwright';
  status:       'passed' | 'failed' | 'skipped' | 'error';
  summary:      string;
  errorCount:   number;
  warningCount: number;
  durationMs:   number;
  details: {
    stdout?: string;
    stderr?: string;
    problems?: Array<{
      file?:     string;
      line?:     number;
      column?:   number;
      severity?: 'error' | 'warning';
      message:   string;
      rule?:     string;
    }>;
    [key: string]: unknown;
  };
}

export function useTaskQa() {
  const config  = useRuntimeConfig();
  const baseUrl = config.public.apiBase as string;

  async function fetchForTask(taskId: string): Promise<QaResult[]> {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}/qa`, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { results: QaResult[] };
    return data.results;
  }

  return { fetchForTask };
}
