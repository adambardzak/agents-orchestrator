import type { FastifyInstance } from 'fastify';
import { assertProjectAccess } from '../services/auth/access.js';

// Sonnet price — used as "standard" reference for savings calculation
const SONNET_INPUT_PER_1M = 3;
const SONNET_OUTPUT_PER_1M = 15;

export async function costRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/costs/summary
   *
   * Returns aggregated cost data across all sessions IN THE CALLER'S ACTIVE ORG:
   *  - Totals by period (today / this week / this month / all-time)
   *  - Breakdown by model
   *  - Breakdown by agent type
   *  - Savings from model routing vs "all on Sonnet"
   *  - Recent sessions with individual costs
   *
   * Optional ?projectId= further narrows to a single project (must belong to
   * caller's org or 404).
   */
  fastify.get<{ Querystring: { projectId?: string } }>(
    '/api/costs/summary',
    async (request) => {
      const { orgId } = await request.requireOrg();
      const { projectId } = request.query;

      // Validate projectId belongs to org BEFORE running any aggregates.
      if (projectId) {
        await assertProjectAccess(fastify, projectId, orgId);
      }

      // All task/session queries gain a JOIN through projects to filter by org.
      // $1 = orgId, $2 (optional) = projectId.
      const orgFilter = projectId
        ? 'p.organization_id = $1 AND t.project_id = $2'
        : 'p.organization_id = $1';
      const sessionsOrgFilter = projectId
        ? 'p.organization_id = $1 AND s.project_id = $2'
        : 'p.organization_id = $1';
      const params = projectId ? [orgId, projectId] : [orgId];

      // ── Period totals ────────────────────────────────────────────────────────
      const periodQuery = `
        SELECT
          SUM(CASE WHEN t.created_at >= CURRENT_DATE                        THEN t.cost_usd ELSE 0 END) AS today,
          SUM(CASE WHEN t.created_at >= date_trunc('week',  NOW())          THEN t.cost_usd ELSE 0 END) AS this_week,
          SUM(CASE WHEN t.created_at >= date_trunc('month', NOW())          THEN t.cost_usd ELSE 0 END) AS this_month,
          SUM(t.cost_usd)                                                                                AS all_time,
          SUM(t.input_tokens)                                                                            AS total_input_tokens,
          SUM(t.output_tokens)                                                                           AS total_output_tokens
        FROM agent_tasks t
        JOIN projects p ON p.id = t.project_id
        WHERE t.status = 'completed' AND ${orgFilter}`;

      // ── By model ──────────────────────────────────────────────────────────────
      const modelQuery = `
        SELECT
          t.model,
          COUNT(*)::int           AS task_count,
          SUM(t.input_tokens)     AS input_tokens,
          SUM(t.output_tokens)    AS output_tokens,
          SUM(t.cost_usd)         AS cost_usd
        FROM agent_tasks t
        JOIN projects p ON p.id = t.project_id
        WHERE t.status = 'completed' AND ${orgFilter}
        GROUP BY t.model
        ORDER BY cost_usd DESC`;

      // ── By agent type ─────────────────────────────────────────────────────────
      const agentQuery = `
        SELECT
          t.agent_type,
          COUNT(*)::int           AS task_count,
          SUM(t.input_tokens)     AS input_tokens,
          SUM(t.output_tokens)    AS output_tokens,
          SUM(t.cost_usd)         AS cost_usd
        FROM agent_tasks t
        JOIN projects p ON p.id = t.project_id
        WHERE t.status = 'completed' AND ${orgFilter}
        GROUP BY t.agent_type
        ORDER BY cost_usd DESC`;

      // ── Daily trend (last 14 days) ────────────────────────────────────────────
      const trendQuery = `
        SELECT
          DATE(t.created_at)      AS date,
          SUM(t.cost_usd)         AS cost_usd,
          COUNT(DISTINCT t.session_id)::int AS sessions
        FROM agent_tasks t
        JOIN projects p ON p.id = t.project_id
        WHERE t.status = 'completed'
          AND t.created_at >= NOW() - INTERVAL '14 days'
          AND ${orgFilter}
        GROUP BY DATE(t.created_at)
        ORDER BY date ASC`;

      // ── Recent sessions ───────────────────────────────────────────────────────
      const sessionsQuery = `
        SELECT
          s.id,
          s.user_prompt,
          s.status,
          s.created_at,
          COALESCE(SUM(t.cost_usd), 0) AS actual_cost,
          COALESCE(SUM(t.input_tokens), 0) AS input_tokens,
          COALESCE(SUM(t.output_tokens), 0) AS output_tokens
        FROM sessions s
        JOIN projects p ON p.id = s.project_id
        LEFT JOIN agent_tasks t ON t.session_id = s.id AND t.status = 'completed'
        WHERE ${sessionsOrgFilter}
        GROUP BY s.id, s.user_prompt, s.status, s.created_at
        ORDER BY s.created_at DESC
        LIMIT 20`;

      const [periods, byModel, byAgent, trend, recentSessions] = await Promise.all([
        fastify.pg.query(periodQuery, params),
        fastify.pg.query(modelQuery, params),
        fastify.pg.query(agentQuery, params),
        fastify.pg.query(trendQuery, params),
        fastify.pg.query(sessionsQuery, params),
      ]);

      const p = periods.rows[0] as {
        today: string; this_week: string; this_month: string; all_time: string;
        total_input_tokens: string; total_output_tokens: string;
      };

      // ── Savings calculation ───────────────────────────────────────────────────
      // "What would all completed tasks cost if run on claude-sonnet-4-6?"
      const totalInput = Number(p?.total_input_tokens ?? 0);
      const totalOutput = Number(p?.total_output_tokens ?? 0);
      const hypotheticalSonnetCost =
        (totalInput / 1_000_000) * SONNET_INPUT_PER_1M +
        (totalOutput / 1_000_000) * SONNET_OUTPUT_PER_1M;
      const actualAllTime = Number(p?.all_time ?? 0);
      const savedUsd = Math.max(0, hypotheticalSonnetCost - actualAllTime);
      const savedPct = hypotheticalSonnetCost > 0
        ? Math.round((savedUsd / hypotheticalSonnetCost) * 100)
        : 0;

      return {
        periods: {
          today:     Number(p?.today     ?? 0),
          thisWeek:  Number(p?.this_week  ?? 0),
          thisMonth: Number(p?.this_month ?? 0),
          allTime:   actualAllTime,
        },
        savings: {
          hypotheticalSonnetUsd: hypotheticalSonnetCost,
          actualUsd: actualAllTime,
          savedUsd,
          savedPct,
        },
        byModel: (byModel.rows as Array<{
          model: string; task_count: number;
          input_tokens: string; output_tokens: string; cost_usd: string;
        }>).map((r) => ({
          model: r.model.replace('github-copilot/', ''),
          taskCount: r.task_count,
          inputTokens: Number(r.input_tokens),
          outputTokens: Number(r.output_tokens),
          costUsd: Number(r.cost_usd),
        })),
        byAgent: (byAgent.rows as Array<{
          agent_type: string; task_count: number;
          input_tokens: string; output_tokens: string; cost_usd: string;
        }>).map((r) => ({
          agentType: r.agent_type,
          taskCount: r.task_count,
          inputTokens: Number(r.input_tokens),
          outputTokens: Number(r.output_tokens),
          costUsd: Number(r.cost_usd),
        })),
        dailyTrend: (trend.rows as Array<{
          date: string; cost_usd: string; sessions: number;
        }>).map((r) => ({
          date: r.date,
          costUsd: Number(r.cost_usd),
          sessions: r.sessions,
        })),
        recentSessions: (recentSessions.rows as Array<{
          id: string; user_prompt: string; status: string;
          created_at: string; actual_cost: string;
          input_tokens: string; output_tokens: string;
        }>).map((r) => ({
          id: r.id,
          userPrompt: r.user_prompt,
          status: r.status,
          createdAt: r.created_at,
          costUsd: Number(r.actual_cost),
          inputTokens: Number(r.input_tokens),
          outputTokens: Number(r.output_tokens),
        })),
      };
    },
  );
}
