/**
 * Global auth middleware
 *
 * On every route change, ensures we know who the user is. If not signed in,
 * redirects to /auth/login (preserving the requested path so we can bounce
 * back after sign-in).
 *
 * Public routes (login, signup, accept-invitation) are exempted via the
 * `auth.public` route meta flag — set `definePageMeta({ auth: { public: true } })`
 * on those pages.
 *
 * In dev when REQUIRE_AUTH=false on the API, the bootstrap user is always
 * "signed in" so this middleware is a no-op except for refreshing state.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  // Skip on server in dev — Better Auth cookies are HttpOnly and need browser
  if (import.meta.server) return;

  const auth = useAuth();
  if (!auth.loaded.value) {
    await auth.refresh();
  }

  const isPublic = (to.meta['auth'] as { public?: boolean } | undefined)?.public === true;
  if (isPublic) return;

  if (!auth.isAuthenticated.value) {
    return navigateTo({
      path: '/auth/login',
      query: to.fullPath !== '/' ? { redirect: to.fullPath } : undefined,
    });
  }
});
