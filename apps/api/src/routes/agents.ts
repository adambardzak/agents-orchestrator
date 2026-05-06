import type { FastifyInstance } from 'fastify';
import { BUILT_IN_AGENTS } from '../agents/definitions.js';
import { MCP_CATALOG, MCP_CATEGORIES } from '../agents/mcp-catalog.js';

export async function agentRoutes(fastify: FastifyInstance): Promise<void> {
  // NOTE: GET /api/skills moved to routes/skills.ts (now returns built-in
  // catalog merged with org-defined custom skills).

  // GET /api/mcp-servers — return the full MCP server catalog with categories
  fastify.get('/api/mcp-servers', async () => ({
    servers: MCP_CATALOG,
    categories: MCP_CATEGORIES,
  }));

  // GET /api/agents — list all agents (built-in + custom from DB)
  fastify.get('/api/agents', async () => {
    const { rows: customAgents } = await fastify.pg.query(
      'SELECT * FROM agent_definitions WHERE is_active = true ORDER BY created_at',
    );

    return {
      agents: [
        ...BUILT_IN_AGENTS,
        ...customAgents.map(dbRowToAgentDefinition),
      ],
    };
  });

  // GET /api/agents/:id
  fastify.get<{ Params: { id: string } }>('/api/agents/:id', async (request, reply) => {
    const { id } = request.params;

    // Check built-in first
    const builtIn = BUILT_IN_AGENTS.find((a: typeof BUILT_IN_AGENTS[number]) => a.id === id);
    if (builtIn) return builtIn;

    // Check DB
    const { rows: [agent] } = await fastify.pg.query(
      'SELECT * FROM agent_definitions WHERE id = $1',
      [id],
    );

    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    return dbRowToAgentDefinition(agent);
  });

  // POST /api/agents — create custom agent
  fastify.post('/api/agents', async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    const { rows: [agent] } = await fastify.pg.query(
      `INSERT INTO agent_definitions
         (id, name, description, icon, agent_type, default_complexity, can_escalate_to,
          system_prompt, rules, skills, allowed_mcp_servers, allowed_tools,
          max_steps, timeout_minutes, triggers, is_built_in, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, false, true, 'user')
       RETURNING *`,
      [
        `custom:${Date.now()}`,
        body['name'],
        body['description'],
        body['icon'] ?? 'bot',
        body['type'],
        body['defaultComplexity'] ?? 'standard',
        body['canEscalateTo'] ?? 'complex',
        body['systemPrompt'],
        JSON.stringify(body['rules'] ?? []),
        JSON.stringify(body['skills'] ?? []),
        JSON.stringify(body['allowedMcpServers'] ?? []),
        JSON.stringify(body['allowedTools'] ?? []),
        body['maxSteps'] ?? 20,
        body['timeoutMinutes'] ?? 10,
        JSON.stringify(body['triggers'] ?? {}),
      ],
    );

    return reply.status(201).send(dbRowToAgentDefinition(agent));
  });

  // DELETE /api/agents/:id — delete custom agent (built-in protected)
  fastify.delete<{ Params: { id: string } }>('/api/agents/:id', async (request, reply) => {
    const { id } = request.params;

    if (id.startsWith('built-in:')) {
      return reply.status(403).send({ error: 'Cannot delete built-in agents' });
    }

    const { rowCount } = await fastify.pg.query(
      'DELETE FROM agent_definitions WHERE id = $1 AND is_built_in = false',
      [id],
    );

    if (!rowCount) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    return reply.status(204).send();
  });

  // PATCH /api/agents/:id — update custom agent
  fastify.patch<{ Params: { id: string } }>('/api/agents/:id', async (request, reply) => {
    const { id } = request.params;
    const body = request.body as Record<string, unknown>;

    if (id.startsWith('built-in:')) {
      return reply.status(403).send({ error: 'Cannot modify built-in agents' });
    }

    const { rows: [agent] } = await fastify.pg.query(
      `UPDATE agent_definitions
       SET name = COALESCE($2, name),
           description = COALESCE($3, description),
           system_prompt = COALESCE($4, system_prompt),
           rules = COALESCE($5::jsonb, rules),
           skills = COALESCE($6::jsonb, skills),
           allowed_mcp_servers = COALESCE($7::jsonb, allowed_mcp_servers),
           max_steps = COALESCE($8, max_steps),
           is_active = COALESCE($9, is_active),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        body['name'] ?? null,
        body['description'] ?? null,
        body['systemPrompt'] ?? null,
        body['rules'] ? JSON.stringify(body['rules']) : null,
        body['skills'] ? JSON.stringify(body['skills']) : null,
        body['allowedMcpServers'] ? JSON.stringify(body['allowedMcpServers']) : null,
        body['maxSteps'] ?? null,
        body['isActive'] ?? null,
      ],
    );

    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    return dbRowToAgentDefinition(agent);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbRowToAgentDefinition(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    type: row.agent_type,
    defaultComplexity: row.default_complexity,
    canEscalateTo: row.can_escalate_to,
    systemPrompt: row.system_prompt,
    rules: row.rules ?? [],
    skills: row.skills ?? [],
    allowedMcpServers: row.allowed_mcp_servers ?? [],
    allowedTools: row.allowed_tools ?? [],
    maxSteps: row.max_steps,
    timeoutMinutes: row.timeout_minutes,
    triggers: row.triggers ?? {},
    isBuiltIn: row.is_built_in,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
