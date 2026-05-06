# State Management

**TL;DR:** Separate **server state** (data from API, cached, eventually consistent)
from **client state** (local UI: modals open, form drafts, theme). Use
React Query / TanStack Query for server state, Zustand or Context for client
state. Avoid global state for everything. URL is state too — keep filters,
pagination, selected tab in the URL so links share the user's view. Avoid
Redux/MobX for new projects unless you have a specific reason; their
boilerplate is no longer worth it.

## Three categories of state

| Type            | Examples                                  | Tools                              |
|-----------------|-------------------------------------------|------------------------------------|
| Server state    | User profile, list of projects, prices    | React Query, SWR, Apollo (GraphQL) |
| Client state    | Modal open, theme, form draft, sidebar collapsed | Zustand, Jotai, Context, useState |
| URL state       | Active tab, filters, pagination, search query | Router / search params           |

Mixing these (e.g. storing server data in Redux for "consistency") creates
problems: cache invalidation is hard, optimistic updates are fragile, you
re-implement what dedicated libraries do better.

## Server state with React Query

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// Fetch
const { data, isLoading, error } = useQuery({
  queryKey: ['projects', { ownerId }],
  queryFn: () => api.getProjects({ ownerId }),
  staleTime: 60_000,           // consider fresh for 1 min
})

// Mutate with optimistic update
const queryClient = useQueryClient()
const createProject = useMutation({
  mutationFn: api.createProject,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
})
```

Benefits:
- Automatic caching, deduplication, background refetch, retry
- Loading and error states out of the box
- Mutations + invalidation — no manual cache management
- Suspense / streaming compatible

## Client state with Zustand

```typescript
import { create } from 'zustand'

interface UIStore {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  theme: 'light' | 'dark' | 'system'
  setTheme: (t: 'light' | 'dark' | 'system') => void
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  theme: 'system',
  setTheme: (theme) => set({ theme }),
}))

// In component
const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
const toggle = useUIStore((s) => s.toggleSidebar)
```

Why Zustand over Redux:
- No reducers, no actions, no providers — direct mutations via setter
- ~1 KB; tree-shakeable selectors mean components only re-render on relevant changes
- Works outside React (use in vanilla JS, web workers)
- Easy persistence middleware (localStorage)

Why Zustand over Context:
- Context re-renders ALL consumers on any change (perf cliff at scale)
- Zustand selectors subscribe only to slices that matter

## URL state with the router

```typescript
// Next.js App Router example
'use client'
import { useSearchParams, useRouter } from 'next/navigation'

const params = useSearchParams()
const status = params.get('status') ?? 'all'
const page = Number(params.get('page') ?? 1)

const router = useRouter()
const setStatus = (next: string) => {
  const next_params = new URLSearchParams(params)
  next_params.set('status', next)
  next_params.delete('page')  // reset pagination
  router.push(`?${next_params.toString()}`)
}
```

Put in URL:
- ✅ Filters (`?status=running`)
- ✅ Pagination (`?page=3`)
- ✅ Active tab (`?tab=settings`)
- ✅ Search query (`?q=foo`)
- ✅ Modal/drawer state for shareable workflows (`?edit=usr_123`)

Why: links, refreshes, and back-button work as users expect. "Send me a link
to that filtered view" is free.

Don't put in URL:
- ❌ Sensitive data (tokens, PII) — leaks to logs and history
- ❌ Huge state (long arrays) — URL length limits + ugly
- ❌ Transient UI (hover state, animation progress)

## When state belongs at component level (useState)

For state that ONE component cares about:
```typescript
const [isOpen, setIsOpen] = useState(false)
```

Don't promote to global until a second component needs it. Premature global
state creates coupling.

## Form state

Use a form library (React Hook Form recommended) instead of `useState` per field:
- Less re-rendering (uncontrolled inputs)
- Built-in validation integration (Zod resolver)
- Touched / dirty / submitting states tracked
- Easy to handle field arrays and nested objects

See `forms-validation.md`.

## Derived state

Don't store what you can compute:
```typescript
// ❌ Bad — two sources of truth, can drift
const [items, setItems] = useState([])
const [total, setTotal] = useState(0)

// ✅ Compute on render
const [items, setItems] = useState([])
const total = items.reduce((sum, i) => sum + i.price, 0)
```

If computation is expensive, memoize:
```typescript
const total = useMemo(() => expensiveCalculation(items), [items])
```

But profile first — most computations are cheap; `useMemo` adds complexity.

## Persistence

When state should survive reloads:

```typescript
import { persist } from 'zustand/middleware'

export const useUIStore = create(persist(
  (set) => ({ /* ... */ }),
  { name: 'ui-store', storage: createJSONStorage(() => localStorage) },
))
```

What to persist:
- Theme preference, sidebar collapsed state, language
- Form drafts (long forms — auto-save)
- Recently viewed items (offline access)

What NOT to persist:
- Server data (use React Query's cache; invalidates correctly)
- Sensitive data (tokens — use HttpOnly cookies)
- Large blobs (use IndexedDB if needed)

## Real-time / live updates

Server-pushed updates:
- **WebSocket** for bi-directional, low-latency (chat, collaborative editing)
- **Server-Sent Events (SSE)** for one-way push (notifications, live prices)
- **Polling** for simple "refresh every N seconds" (React Query handles this:
  `refetchInterval: 5000`)
- **Webhook + database trigger + WebSocket fanout** for "external event → all clients"

Integration with React Query:
```typescript
// SSE updates the query cache directly, components re-render
const eventSource = new EventSource('/api/v1/events')
eventSource.addEventListener('project.updated', (e) => {
  const updated = JSON.parse(e.data)
  queryClient.setQueryData(['project', updated.id], updated)
})
```

## Common anti-patterns

```typescript
// ❌ "Loading" boolean in state — race conditions, forgotten resets
const [loading, setLoading] = useState(false)
const fetchData = async () => {
  setLoading(true)
  try { ... } finally { setLoading(false) }
}
// Use React Query's `isLoading` instead.

// ❌ "Refresh key" hack to force re-mount
const [key, setKey] = useState(0)
return <Component key={key} />
// Use proper invalidation via React Query.

// ❌ Fetching in useEffect with empty deps
useEffect(() => { fetch(...).then(setData) }, [])
// Use React Query — handles errors, retries, cleanup, race conditions.

// ❌ Storing function refs in state
const [callback, setCallback] = useState(() => doSomething)
// Use ref or just call the function directly.

// ❌ One mega Zustand store for everything
// Multiple small stores by domain (UI, settings, current-user, etc.)
```

## DO NOT
- ❌ Mix server state into Redux/Zustand — use a query library
- ❌ Use Context as a state manager (it's a transport mechanism, not a store)
- ❌ Persist tokens or PII in localStorage — XSS risk
- ❌ Store derived values you can compute — drift bugs
- ❌ Use Redux for new projects without specific need (DevTools, time travel,
  middleware ecosystem) — Zustand covers 90% with less boilerplate
- ❌ Promote state to global before a second consumer needs it
- ❌ Block UI on background data refetch — show stale data + indicator
- ❌ Implement your own cache when React Query / SWR exists
- ❌ Use `useEffect` for data fetching — use a library
