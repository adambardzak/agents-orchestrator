/**
 * useOrganization — workspace settings API client.
 *
 * Wraps the `/api/orgs/:id/*` endpoints for managing a single organization
 * (rename, delete, members, invitations). All requests use cookie auth via
 * `credentials: 'include'`.
 *
 * Pair with `useAuth()` to get the active org id and to refresh the org list
 * after mutations (rename, delete, leave).
 */

export interface OrgMember {
  userId: string;
  email: string;
  name: string | null;
  image: string | null;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
}

export interface OrgInvitation {
  id: string;
  email: string;
  role: 'admin' | 'member';
  token: string;
  invitedBy: string;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

export interface OrgUpdateInput {
  name?: string;
  slug?: string;
  logoUrl?: string | null;
}

export function useOrganization() {
  const config  = useRuntimeConfig();
  const baseUrl = config.public.apiBase as string;

  function api(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  }

  async function unwrap<T>(res: Response, fallback: string): Promise<T> {
    if (res.ok) {
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }
    const err = (await res.json().catch(() => ({}))) as { error?: string | { formErrors?: string[] } };
    const msg = typeof err.error === 'string'
      ? err.error
      : err.error?.formErrors?.[0] ?? `${fallback} (${res.status})`;
    throw new Error(msg);
  }

  // ── Org-level ────────────────────────────────────────────────────────────
  async function update(orgId: string, patch: OrgUpdateInput): Promise<void> {
    await unwrap(
      await api(`/api/orgs/${orgId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
      'Failed to update workspace',
    );
  }

  async function remove(orgId: string): Promise<void> {
    await unwrap(
      await api(`/api/orgs/${orgId}`, { method: 'DELETE' }),
      'Failed to delete workspace',
    );
  }

  // ── Members ──────────────────────────────────────────────────────────────
  async function listMembers(orgId: string): Promise<OrgMember[]> {
    const data = await unwrap<{ members: OrgMember[] }>(
      await api(`/api/orgs/${orgId}/members`),
      'Failed to load members',
    );
    return data.members;
  }

  async function updateMemberRole(
    orgId: string,
    userId: string,
    role: 'owner' | 'admin' | 'member',
  ): Promise<void> {
    await unwrap(
      await api(`/api/orgs/${orgId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
      'Failed to update member role',
    );
  }

  async function removeMember(orgId: string, userId: string): Promise<void> {
    await unwrap(
      await api(`/api/orgs/${orgId}/members/${userId}`, { method: 'DELETE' }),
      'Failed to remove member',
    );
  }

  // ── Invitations ──────────────────────────────────────────────────────────
  async function listInvitations(orgId: string): Promise<OrgInvitation[]> {
    const data = await unwrap<{ invitations: OrgInvitation[] }>(
      await api(`/api/orgs/${orgId}/invitations`),
      'Failed to load invitations',
    );
    return data.invitations;
  }

  async function invite(
    orgId: string,
    email: string,
    role: 'admin' | 'member',
  ): Promise<OrgInvitation> {
    const data = await unwrap<{ invitation: OrgInvitation }>(
      await api(`/api/orgs/${orgId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      }),
      'Failed to send invitation',
    );
    return data.invitation;
  }

  async function revokeInvitation(orgId: string, invitationId: string): Promise<void> {
    await unwrap(
      await api(`/api/orgs/${orgId}/invitations/${invitationId}`, { method: 'DELETE' }),
      'Failed to revoke invitation',
    );
  }

  return {
    update,
    remove,
    listMembers,
    updateMemberRole,
    removeMember,
    listInvitations,
    invite,
    revokeInvitation,
  };
}
