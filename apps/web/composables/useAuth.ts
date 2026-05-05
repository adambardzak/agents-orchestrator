/**
 * useAuth — Nuxt composable for Better Auth integration.
 *
 * Wraps the orchestrator API's `/api/auth/*` endpoints (sign-up/in/out,
 * get-session) and the org endpoints (`/api/orgs`, `/api/orgs/:id/activate`).
 *
 * State is shared across components via `useState` — call `useAuth()` from
 * anywhere and you'll get the same reactive user/session/orgs refs.
 *
 * Cookies: Better Auth sets HttpOnly cookies on auth responses. All fetches
 * use `credentials: 'include'` so the browser sends them on every request.
 *
 * Typical flow:
 *   const { signIn, signUp, signOut, refresh, user, activeOrg } = useAuth()
 *   await signIn(email, password)
 *   await navigateTo('/')
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export interface AuthOrg {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  role: 'owner' | 'admin' | 'member';
}

export interface AuthSession {
  id: string;
  expiresAt: string;
  activeOrganizationId: string | null;
}

interface SessionResponse {
  user: { id: string; email: string; name: string | null; image: string | null } | null;
  session: { id: string; expiresAt: string; active_organization_id: string | null } | null;
}

export function useAuth() {
  const config = useRuntimeConfig();
  const baseUrl = config.public.apiBase as string;

  // Shared, SSR-safe reactive state
  const user        = useState<AuthUser | null>('auth:user', () => null);
  const session     = useState<AuthSession | null>('auth:session', () => null);
  const orgs        = useState<AuthOrg[]>('auth:orgs', () => []);
  const activeOrgId = useState<string | null>('auth:activeOrgId', () => null);
  const loaded      = useState<boolean>('auth:loaded', () => false);

  const activeOrg = computed(() =>
    orgs.value.find((o) => o.id === activeOrgId.value) ?? null,
  );
  const isAuthenticated = computed(() => user.value !== null);

  function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  }

  /** Reads the current session + orgs from the API. Safe to call repeatedly. */
  async function refresh(): Promise<void> {
    try {
      const res = await authedFetch('/api/auth/get-session');
      if (!res.ok) {
        user.value = null;
        session.value = null;
        orgs.value = [];
        activeOrgId.value = null;
        return;
      }
      const data = (await res.json()) as SessionResponse;
      if (!data.user || !data.session) {
        user.value = null;
        session.value = null;
        orgs.value = [];
        activeOrgId.value = null;
        return;
      }
      user.value = data.user;
      session.value = {
        id: data.session.id,
        expiresAt: data.session.expiresAt,
        activeOrganizationId: data.session.active_organization_id,
      };
      activeOrgId.value = data.session.active_organization_id;

      // Load orgs
      const orgRes = await authedFetch('/api/orgs');
      if (orgRes.ok) {
        const { organizations } = (await orgRes.json()) as { organizations: AuthOrg[] };
        orgs.value = organizations;

        // If no active org but user has at least one, default to the first
        if (!activeOrgId.value && organizations.length > 0) {
          await setActiveOrg(organizations[0]!.id);
        }
      }
    } finally {
      loaded.value = true;
    }
  }

  async function signIn(email: string, password: string): Promise<void> {
    const res = await authedFetch('/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(err.message ?? `Sign-in failed (${res.status})`);
    }
    await refresh();
  }

  async function signUp(args: { email: string; password: string; name: string }): Promise<void> {
    const res = await authedFetch('/api/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(err.message ?? `Sign-up failed (${res.status})`);
    }
    await refresh();
    // First-time user: auto-create personal org if none exist yet
    if (orgs.value.length === 0) {
      await createOrg(args.name ? `${args.name}'s workspace` : 'Personal workspace');
    }
  }

  async function signOut(): Promise<void> {
    await authedFetch('/api/auth/sign-out', { method: 'POST' });
    user.value = null;
    session.value = null;
    orgs.value = [];
    activeOrgId.value = null;
  }

  /** Kick off OAuth — Better Auth redirects the browser through the provider. */
  function signInWithOAuth(provider: 'github' | 'google', callbackPath = '/'): void {
    const callback = encodeURIComponent(`${window.location.origin}${callbackPath}`);
    window.location.href = `${baseUrl}/api/auth/sign-in/social?provider=${provider}&callbackURL=${callback}`;
  }

  async function createOrg(name: string): Promise<AuthOrg> {
    const res = await authedFetch('/api/orgs', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `Failed to create org (${res.status})`);
    }
    const { organization } = (await res.json()) as { organization: AuthOrg };
    // Refresh org list so role is included; activate the new one
    await refresh();
    await setActiveOrg(organization.id);
    return organization;
  }

  async function setActiveOrg(orgId: string): Promise<void> {
    const res = await authedFetch(`/api/orgs/${orgId}/activate`, { method: 'POST' });
    if (!res.ok) throw new Error(`Failed to activate org (${res.status})`);
    activeOrgId.value = orgId;
    if (session.value) session.value.activeOrganizationId = orgId;
  }

  return {
    // state
    user:            readonly(user),
    session:         readonly(session),
    orgs:            readonly(orgs),
    activeOrg,
    activeOrgId:     readonly(activeOrgId),
    isAuthenticated,
    loaded:          readonly(loaded),
    // actions
    refresh,
    signIn,
    signUp,
    signOut,
    signInWithOAuth,
    createOrg,
    setActiveOrg,
  };
}
