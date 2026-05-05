import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { v4 as uuid } from 'uuid';
import type {
  AgentTask,
  AgentType,
  Ticket,
  TicketComment,
  TicketIteration,
  TicketStatus,
  TaskComplexity,
} from '@agent-orchestrator/shared';

// ─── Planner output shape (parsed from planner agent's JSON) ─────────────────

export interface PlannerTicket {
  title: string;
  description: string;
  complexity?: TaskComplexity;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  /**
   * Optional list of files this ticket reads/writes (relative to repo root).
   * Used by the worker to decide which tickets can run in parallel without
   * stepping on each other. If omitted/empty, the ticket is treated as
   * "unknown scope" and forced to run sequentially for safety.
   */
  files?: string[];
}

export interface PlannerOutput {
  tickets: PlannerTicket[];
}

/**
 * Parse JSON output of the Planner agent.
 * Returns null if the output is not a valid plan.
 */
export function tryParsePlannerOutput(content: string): PlannerOutput | null {
  if (!content?.trim()) return null;

  function isValidPlan(val: unknown): val is PlannerOutput {
    if (typeof val !== 'object' || val === null) return false;
    const obj = val as Record<string, unknown>;
    if (!Array.isArray(obj['tickets']) || obj['tickets'].length === 0) return false;
    return (obj['tickets'] as unknown[]).every((t) => {
      if (typeof t !== 'object' || t === null) return false;
      const tt = t as Record<string, unknown>;
      return typeof tt['title'] === 'string' && typeof tt['description'] === 'string';
    });
  }

  // Direct parse
  try {
    const parsed = JSON.parse(content) as unknown;
    if (isValidPlan(parsed)) return parsed as PlannerOutput;
  } catch { /* not bare JSON */ }

  // Code fence
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch?.[1]) {
    try {
      const parsed = JSON.parse(fenceMatch[1]) as unknown;
      if (isValidPlan(parsed)) return parsed as PlannerOutput;
    } catch { /* not valid */ }
  }

  // Balanced braces containing "tickets"
  if (content.includes('"tickets"')) {
    let depth = 0;
    let start = -1;
    for (let i = 0; i < content.length; i++) {
      const ch = content[i];
      if (ch === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          const candidate = content.slice(start, i + 1);
          try {
            const parsed = JSON.parse(candidate) as unknown;
            if (isValidPlan(parsed)) return parsed as PlannerOutput;
          } catch { /* try next */ }
          start = -1;
        }
      }
    }
  }

  return null;
}

// ─── DB row mappers ───────────────────────────────────────────────────────────

interface TicketRow {
  id: string;
  ticket_key: string;
  session_id: string;
  project_id: string;
  parent_task_id: string | null;
  current_task_id: string | null;
  title: string;
  description: string;
  agent_type: string;
  complexity: string;
  priority: string;
  labels: string[] | null;
  status: string;
  iteration: number;
  total_cost_usd: string;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export function mapTicketRow(r: TicketRow): Ticket {
  return {
    id: r.id,
    ticketKey: r.ticket_key,
    sessionId: r.session_id,
    projectId: r.project_id,
    parentTaskId: r.parent_task_id,
    currentTaskId: r.current_task_id,
    title: r.title,
    description: r.description,
    agentType: r.agent_type as AgentType,
    complexity: r.complexity as TaskComplexity,
    priority: r.priority as Ticket['priority'],
    labels: r.labels ?? [],
    status: r.status as TicketStatus,
    iteration: r.iteration,
    totalCostUsd: parseFloat(r.total_cost_usd),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
  };
}

interface CommentRow {
  id: string;
  ticket_id: string;
  author: string;
  body: string;
  iteration_task_id: string | null;
  created_at: Date;
}

export function mapCommentRow(r: CommentRow): TicketComment {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    author: r.author as TicketComment['author'],
    body: r.body,
    iterationTaskId: r.iteration_task_id,
    createdAt: r.created_at,
  };
}

interface IterationRow {
  id: string;
  ticket_id: string;
  task_id: string;
  iteration: number;
  injected_context: string | null;
  status: string;
  cost_usd: string;
  summary: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export function mapIterationRow(r: IterationRow): TicketIteration {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    taskId: r.task_id,
    iteration: r.iteration,
    injectedContext: r.injected_context,
    status: r.status,
    costUsd: parseFloat(r.cost_usd),
    summary: r.summary,
    completedAt: r.completed_at,
    createdAt: r.created_at,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class TicketService {
  constructor(
    private readonly db: Pool,
    private readonly logger: FastifyBaseLogger,
  ) {}

  /**
   * Allocate the next ticket key for a session, e.g. AGT-1, AGT-2, …
   */
  async nextTicketKey(sessionId: string): Promise<string> {
    const { rows } = await this.db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM tickets WHERE session_id = $1',
      [sessionId],
    );
    const next = parseInt(rows[0]?.count ?? '0', 10) + 1;
    return `AGT-${next}`;
  }

  /**
   * Create one ticket from a planner output entry.
   */
  async createTicket(args: {
    sessionId: string;
    projectId: string;
    parentTaskId: string;
    targetAgentType: AgentType;
    plannerTicket: PlannerTicket;
  }): Promise<Ticket> {
    const id = uuid();
    const ticketKey = await this.nextTicketKey(args.sessionId);
    const complexity = (args.plannerTicket.complexity ?? 'trivial') as TaskComplexity;
    const priority = args.plannerTicket.priority ?? 'normal';

    const { rows } = await this.db.query<TicketRow>(
      `INSERT INTO tickets
         (id, ticket_key, session_id, project_id, parent_task_id,
          title, description, agent_type, complexity, priority, status, iteration)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'todo', 1)
       RETURNING *`,
      [
        id,
        ticketKey,
        args.sessionId,
        args.projectId,
        args.parentTaskId,
        args.plannerTicket.title.slice(0, 200),
        args.plannerTicket.description,
        args.targetAgentType,
        complexity,
        priority,
      ],
    );
    return mapTicketRow(rows[0]!);
  }

  async listBySession(sessionId: string): Promise<Ticket[]> {
    const { rows } = await this.db.query<TicketRow>(
      'SELECT * FROM tickets WHERE session_id = $1 ORDER BY created_at ASC',
      [sessionId],
    );
    return rows.map(mapTicketRow);
  }

  async getById(ticketId: string): Promise<Ticket | null> {
    const { rows } = await this.db.query<TicketRow>(
      'SELECT * FROM tickets WHERE id = $1',
      [ticketId],
    );
    return rows[0] ? mapTicketRow(rows[0]) : null;
  }

  async listComments(ticketId: string): Promise<TicketComment[]> {
    const { rows } = await this.db.query<CommentRow>(
      'SELECT * FROM ticket_comments WHERE ticket_id = $1 ORDER BY created_at ASC',
      [ticketId],
    );
    return rows.map(mapCommentRow);
  }

  async addComment(args: {
    ticketId: string;
    author: 'user' | 'agent' | 'system';
    body: string;
    iterationTaskId?: string;
  }): Promise<TicketComment> {
    const { rows } = await this.db.query<CommentRow>(
      `INSERT INTO ticket_comments (ticket_id, author, body, iteration_task_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [args.ticketId, args.author, args.body, args.iterationTaskId ?? null],
    );
    return mapCommentRow(rows[0]!);
  }

  async listIterations(ticketId: string): Promise<TicketIteration[]> {
    const { rows } = await this.db.query<IterationRow>(
      'SELECT * FROM ticket_iterations WHERE ticket_id = $1 ORDER BY iteration ASC',
      [ticketId],
    );
    return rows.map(mapIterationRow);
  }

  async createIteration(args: {
    ticketId: string;
    taskId: string;
    iteration: number;
    injectedContext?: string | null;
    status?: string;
  }): Promise<TicketIteration> {
    const { rows } = await this.db.query<IterationRow>(
      `INSERT INTO ticket_iterations
         (ticket_id, task_id, iteration, injected_context, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        args.ticketId,
        args.taskId,
        args.iteration,
        args.injectedContext ?? null,
        args.status ?? 'running',
      ],
    );
    return mapIterationRow(rows[0]!);
  }

  async updateStatus(
    ticketId: string,
    status: TicketStatus,
    extra?: { currentTaskId?: string | null },
  ): Promise<Ticket | null> {
    const completedClause = status === 'done' ? ', completed_at = NOW()' : '';
    const sets: string[] = ['status = $2'];
    const values: unknown[] = [ticketId, status];
    if (extra && Object.prototype.hasOwnProperty.call(extra, 'currentTaskId')) {
      values.push(extra.currentTaskId);
      sets.push(`current_task_id = $${values.length}`);
    }

    const { rows } = await this.db.query<TicketRow>(
      `UPDATE tickets SET ${sets.join(', ')}${completedClause} WHERE id = $1 RETURNING *`,
      values,
    );
    return rows[0] ? mapTicketRow(rows[0]) : null;
  }

  /**
   * Aggregate cost: looks at every iteration's task and sums cost_usd.
   */
  async recomputeCost(ticketId: string): Promise<void> {
    await this.db.query(
      `UPDATE tickets t SET total_cost_usd = COALESCE((
         SELECT SUM(at.cost_usd) FROM agent_tasks at
         WHERE at.ticket_id = t.id
       ), 0) WHERE t.id = $1`,
      [ticketId],
    );
  }

  /**
   * Update iteration row at completion.
   */
  async completeIteration(args: {
    ticketId: string;
    taskId: string;
    status: string;
    summary?: string;
    costUsd?: number;
  }): Promise<void> {
    await this.db.query(
      `UPDATE ticket_iterations
         SET status = $3, summary = $4, cost_usd = $5, completed_at = NOW()
       WHERE ticket_id = $1 AND task_id = $2`,
      [args.ticketId, args.taskId, args.status, args.summary ?? null, args.costUsd ?? 0],
    );
  }
}

// ─── Helper: which agent types should be planned (split into tickets) ────────

const SPLITTABLE: ReadonlySet<AgentType> = new Set<AgentType>([
  'architect',
  'backend',
  'frontend',
  'design',
  'seo',
  'infra',
]);

export function isSplittableAgent(agentType: string): boolean {
  return SPLITTABLE.has(agentType as AgentType);
}
