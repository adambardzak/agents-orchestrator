/**
 * Organization service — create/list/manage workgroups (tenants).
 *
 * One user belongs to 1+ organizations via memberships. Each org owns its
 * own projects, knowledge base, git connections, and AI provider config.
 *
 * Roles:
 *   • owner   — full control + can delete org
 *   • admin   — manage members, settings, integrations
 *   • member  — create projects/sessions, use shared resources
 *
 * On signup, a "Personal" org is auto-created so the user has a default
 * landing tenant. They can later be invited into team orgs.
 */
import type { Pool } from 'pg';
import { v4 as uuid } from 'uuid';
import { randomBytes } from 'node:crypto';

export interface Organization {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  createdBy: string;
  createdAt: Date;
}

export type OrgRole = 'owner' | 'admin' | 'member';

export interface Membership {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  joinedAt: Date;
}

export class OrganizationService {
  constructor(private readonly pool: Pool) {}

  /** Returns all orgs the user belongs to (with their role on each). */
  async listForUser(userId: string): Promise<Array<Organization & { role: OrgRole }>> {
    const { rows } = await this.pool.query(
      `SELECT o.*, m.role
         FROM organizations o
         JOIN organization_memberships m ON m.organization_id = o.id
        WHERE m.user_id = $1
        ORDER BY o.created_at ASC`,
      [userId],
    );
    return rows.map(this.mapOrgWithRole);
  }

  async getById(id: string): Promise<Organization | null> {
    const { rows: [r] } = await this.pool.query(
      `SELECT * FROM organizations WHERE id = $1`,
      [id],
    );
    return r ? this.mapOrg(r) : null;
  }

  async getMembership(orgId: string, userId: string): Promise<Membership | null> {
    const { rows: [r] } = await this.pool.query(
      `SELECT * FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`,
      [orgId, userId],
    );
    return r ? this.mapMembership(r) : null;
  }

  async create(args: {
    name: string;
    slug?: string;
    createdBy: string;
    logoUrl?: string;
  }): Promise<Organization> {
    const slug = (args.slug ?? this.slugify(args.name)) || `org-${randomBytes(3).toString('hex')}`;
    const id = uuid();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [orgRow] } = await client.query(
        `INSERT INTO organizations (id, slug, name, logo_url, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, slug, args.name, args.logoUrl ?? null, args.createdBy],
      );
      await client.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [id, args.createdBy],
      );
      await client.query('COMMIT');
      return this.mapOrg(orgRow);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Creates the default "Personal" org on first sign-in (idempotent). */
  async ensurePersonalOrg(args: { userId: string; userName?: string | null }): Promise<Organization> {
    const existing = await this.listForUser(args.userId);
    if (existing.length > 0) return existing[0]!;
    return this.create({
      name: args.userName ? `${args.userName}'s workspace` : 'Personal workspace',
      createdBy: args.userId,
    });
  }

  async listMembers(orgId: string): Promise<
    Array<{ userId: string; email: string; name: string | null; role: OrgRole; joinedAt: Date }>
  > {
    const { rows } = await this.pool.query(
      `SELECT m.user_id, u.email, u.name, m.role, m.joined_at
         FROM organization_memberships m
         JOIN auth_user u ON u.id = m.user_id
        WHERE m.organization_id = $1
        ORDER BY m.joined_at ASC`,
      [orgId],
    );
    return rows.map((r) => ({
      userId:   String(r['user_id']),
      email:    String(r['email']),
      name:     (r['name'] as string | null) ?? null,
      role:     r['role'] as OrgRole,
      joinedAt: new Date(r['joined_at']),
    }));
  }

  async invite(args: {
    orgId: string;
    email: string;
    role: OrgRole;
    invitedBy: string;
    expiresInDays?: number;
  }): Promise<{ id: string; token: string; expiresAt: Date }> {
    const id = uuid();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + (args.expiresInDays ?? 7) * 24 * 60 * 60 * 1000);
    await this.pool.query(
      `INSERT INTO organization_invitations
         (id, organization_id, email, role, invited_by, token, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, args.orgId, args.email.toLowerCase(), args.role, args.invitedBy, token, expiresAt],
    );
    return { id, token, expiresAt };
  }

  async acceptInvitation(token: string, userId: string): Promise<Organization> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [inv] } = await client.query(
        `SELECT * FROM organization_invitations
          WHERE token = $1 AND status = 'pending' AND expires_at > NOW()
          FOR UPDATE`,
        [token],
      );
      if (!inv) throw new Error('Invitation invalid or expired');

      await client.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role, invited_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (organization_id, user_id) DO NOTHING`,
        [inv['organization_id'], userId, inv['role'], inv['invited_by']],
      );
      await client.query(
        `UPDATE organization_invitations SET status = 'accepted' WHERE id = $1`,
        [inv['id']],
      );
      const { rows: [orgRow] } = await client.query(
        `SELECT * FROM organizations WHERE id = $1`,
        [inv['organization_id']],
      );
      await client.query('COMMIT');
      return this.mapOrg(orgRow);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async setActiveOrgForSession(sessionId: string, orgId: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_session SET active_organization_id = $1, updated_at = NOW() WHERE id = $2`,
      [orgId, sessionId],
    );
  }

  // ── private mappers ──────────────────────────────────────────────────────
  private mapOrg(r: Record<string, unknown>): Organization {
    return {
      id:        String(r['id']),
      slug:      String(r['slug']),
      name:      String(r['name']),
      logoUrl:   (r['logo_url'] as string | null) ?? null,
      createdBy: String(r['created_by']),
      createdAt: new Date(r['created_at'] as string),
    };
  }
  private mapOrgWithRole(r: Record<string, unknown>): Organization & { role: OrgRole } {
    return {
      id:        String(r['id']),
      slug:      String(r['slug']),
      name:      String(r['name']),
      logoUrl:   (r['logo_url'] as string | null) ?? null,
      createdBy: String(r['created_by']),
      createdAt: new Date(r['created_at'] as string),
      role:      r['role'] as OrgRole,
    };
  }
  private mapMembership(r: Record<string, unknown>): Membership {
    return {
      id:             String(r['id']),
      organizationId: String(r['organization_id']),
      userId:         String(r['user_id']),
      role:           r['role'] as OrgRole,
      joinedAt:       new Date(r['joined_at'] as string),
    };
  }
  private slugify(s: string): string {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }
}
