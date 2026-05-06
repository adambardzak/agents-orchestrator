/**
 * useKbScope — global, persistent KB scope selector (user XOR org).
 *
 * Drives the topbar 'My KB' / 'Workspace KB' switcher. Persists to
 * localStorage so reloads remember the user's choice. Used by:
 *   - /settings/knowledge   — list + create defaults to active scope
 *   - useKnowledge.list()   — passes active scope to /api/knowledge
 *
 * Nuxt's useState gives us SSR-safe singleton state across components.
 */
const STORAGE_KEY = 'orchestrator.kb.scope';
type KbScopeKind = 'user' | 'org';

export function useKbScope() {
  const scope = useState<KbScopeKind>('kb-scope', () => 'org');

  // Hydrate from localStorage on client mount.
  if (import.meta.client) {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'user' || stored === 'org') {
      scope.value = stored;
    }
  }

  function setScope(next: KbScopeKind) {
    scope.value = next;
    if (import.meta.client) {
      localStorage.setItem(STORAGE_KEY, next);
    }
  }

  function toggle() {
    setScope(scope.value === 'user' ? 'org' : 'user');
  }

  return {
    scope:    readonly(scope),
    setScope,
    toggle,
  };
}
