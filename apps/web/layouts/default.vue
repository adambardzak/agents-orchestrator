<template>
  <div class="flex h-screen w-screen overflow-hidden bg-bg text-text-primary">
    <!-- ════════════════════════════════════════════════════════════════════
         SIDEBAR
         ══════════════════════════════════════════════════════════════════ -->
    <aside
      class="flex flex-col w-[220px] shrink-0 border-r border-border bg-surface-elevated"
    >
      <!-- Brand -->
      <div class="flex items-center gap-2 px-4 h-12 border-b border-border">
        <AnimatedBrandLogo
          :mode="hasActiveTasks ? 'active' : 'static'"
          class="w-6 h-6 shrink-0 text-text-primary"
        />
        <span class="font-heading font-semibold text-sm tracking-tight">Orchestrator</span>
      </div>

      <!-- Workspace selector -->
      <div class="px-3 pt-3 pb-2 relative">
        <button
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-hover transition group"
          @click.stop="orgMenuOpen = !orgMenuOpen"
        >
          <div class="w-5 h-5 rounded bg-gradient-to-br from-indigo-500/80 to-violet-600/80 flex items-center justify-center text-[10px] font-semibold text-white shrink-0">
            {{ orgInitial }}
          </div>
          <span class="flex-1 text-left text-sm font-medium truncate">
            {{ auth.activeOrg.value?.name ?? 'No workspace' }}
          </span>
          <UIcon
            name="i-ph-caret-up-down-light"
            class="w-3.5 h-3.5 text-text-faint"
          />
        </button>

        <!-- Org dropdown -->
        <div
          v-if="orgMenuOpen"
          class="absolute left-3 right-3 top-[calc(100%-4px)] z-30 mt-1 bg-surface-elevated border border-border-strong rounded-md shadow-pop overflow-hidden"
          @click.stop
        >
          <div class="py-1 max-h-64 overflow-y-auto">
            <button
              v-for="org in auth.orgs.value"
              :key="org.id"
              class="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-surface-hover transition text-left"
              :class="org.id === auth.activeOrgId.value ? 'bg-surface-active text-text-primary' : 'text-text-secondary'"
              @click="switchOrg(org.id)"
            >
              <div class="w-5 h-5 rounded bg-gradient-to-br from-indigo-500/80 to-violet-600/80 flex items-center justify-center text-[10px] font-semibold text-white shrink-0">
                {{ org.name.charAt(0).toUpperCase() }}
              </div>
              <span class="flex-1 truncate">{{ org.name }}</span>
              <span class="text-[10px] uppercase tracking-wider text-text-faint">{{ org.role }}</span>
              <UIcon
                v-if="org.id === auth.activeOrgId.value"
                name="i-ph-check-light"
                class="w-3.5 h-3.5 text-completed"
              />
            </button>
            <div v-if="auth.orgs.value.length === 0" class="px-2.5 py-2 text-xs text-text-faint">
              No workspaces yet.
            </div>
          </div>
          <div class="border-t border-border py-1">
            <button
              class="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary transition"
              @click="createWorkspace"
            >
              <UIcon name="i-ph-plus-light" class="w-3.5 h-3.5" />
              Create workspace
            </button>
          </div>
        </div>
      </div>

      <!-- Nav -->
      <nav class="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        <div class="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-text-faint font-semibold">
          Workspace
        </div>
        <NuxtLink
          v-for="item in primaryNav"
          :key="item.to"
          :to="item.to"
          class="relative flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary transition group"
          active-class="!bg-surface-active !text-text-primary nav-link-active"
        >
          <UIcon :name="item.icon" class="w-4 h-4 shrink-0" />
          <span class="flex-1 truncate">{{ item.label }}</span>
          <span
            v-if="item.badge"
            class="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-surface-hover text-text-secondary group-hover:bg-surface-elevated"
          >
            {{ item.badge }}
          </span>
        </NuxtLink>

        <div class="px-2 pt-4 pb-1 text-[10px] uppercase tracking-wider text-text-faint font-semibold">
          Build
        </div>
        <NuxtLink
          v-for="item in buildNav"
          :key="item.to"
          :to="item.to"
          class="relative flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary transition"
          active-class="!bg-surface-active !text-text-primary nav-link-active"
        >
          <UIcon :name="item.icon" class="w-4 h-4 shrink-0" />
          <span class="flex-1 truncate">{{ item.label }}</span>
        </NuxtLink>

        <div class="px-2 pt-4 pb-1 text-[10px] uppercase tracking-wider text-text-faint font-semibold">
          System
        </div>
        <NuxtLink
          v-for="item in systemNav"
          :key="item.to"
          :to="item.to"
          class="relative flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary transition"
          active-class="!bg-surface-active !text-text-primary nav-link-active"
        >
          <UIcon :name="item.icon" class="w-4 h-4 shrink-0" />
          <span class="flex-1 truncate">{{ item.label }}</span>
        </NuxtLink>
      </nav>

      <!-- Sidebar footer: session/cost mini-strip -->
      <div
        v-if="sessionStore.currentSession"
        class="px-3 py-2.5 border-t border-border space-y-1.5"
      >
        <div class="flex items-center gap-2">
          <span class="relative flex h-2 w-2">
            <span
              v-if="hasActiveTasks"
              class="animate-ping absolute inline-flex h-full w-full rounded-full bg-completed opacity-60"
            />
            <span
              :class="[
                'relative inline-flex rounded-full h-2 w-2',
                hasActiveTasks ? 'bg-completed' : 'bg-paused',
              ]"
            />
          </span>
          <span class="text-xs text-text-secondary truncate">
            {{ hasActiveTasks ? `${activeTaskCount} running` : 'Session idle' }}
          </span>
        </div>
        <div class="flex items-center justify-between text-xs tabular-nums">
          <span class="text-text-faint">Cost</span>
          <span class="text-text-secondary">
            ${{ sessionStore.totalCost.toFixed(3) }}
            <span class="text-text-faint">/ ${{ sessionStore.currentSession.budgetCapUsd }}</span>
          </span>
        </div>
      </div>

      <!-- Theme + user menu -->
      <div class="px-3 py-2 border-t border-border flex items-center gap-2 relative">
        <button
          class="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-md text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary transition"
          @click="toggleColorMode"
        >
          <UIcon
            :name="isDark ? 'i-ph-sun-light' : 'i-ph-moon-light'"
            class="w-3.5 h-3.5"
          />
          {{ isDark ? 'Light' : 'Dark' }}
        </button>
        <button
          class="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded-md text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary transition"
          @click.stop="userMenuOpen = !userMenuOpen"
        >
          <div class="w-4 h-4 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-[9px] font-semibold text-white shrink-0">
            {{ userInitial }}
          </div>
          <span class="truncate max-w-[80px]">{{ auth.user.value?.name ?? auth.user.value?.email ?? 'You' }}</span>
        </button>

        <!-- User dropdown -->
        <div
          v-if="userMenuOpen"
          class="absolute left-3 right-3 bottom-[calc(100%-4px)] z-30 mb-1 bg-surface-elevated border border-border-strong rounded-md shadow-pop overflow-hidden"
          @click.stop
        >
          <div class="px-3 py-2 border-b border-border">
            <p class="text-sm font-medium truncate">{{ auth.user.value?.name ?? 'Anonymous' }}</p>
            <p class="text-xs text-text-faint truncate">{{ auth.user.value?.email }}</p>
          </div>
          <div class="py-1">
            <button
              class="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary transition text-left"
              @click="navigateTo('/settings'); userMenuOpen = false"
            >
              <UIcon name="i-ph-gear-six-light" class="w-3.5 h-3.5" />
              Settings
            </button>
            <button
              class="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm text-failed hover:bg-failed/10 transition text-left"
              @click="signOutAndRedirect"
            >
              <UIcon name="i-ph-sign-out-light" class="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </div>
    </aside>

    <!-- ════════════════════════════════════════════════════════════════════
         MAIN AREA
         ══════════════════════════════════════════════════════════════════ -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Topbar — minimal, contextual actions -->
      <header
        class="flex items-center justify-between gap-2 h-12 px-4 border-b border-border bg-surface shrink-0"
      >
        <!-- Breadcrumb / page title -->
        <div class="flex items-center gap-2 text-sm min-w-0 flex-1">
          <NuxtLink
            :to="currentNavItem?.to ?? '/'"
            class="inline-flex items-center gap-2 shrink-0 rounded px-1 -mx-1 hover:bg-surface-hover transition-colors"
          >
            <UIcon
              :name="currentNavIcon"
              class="w-4 h-4 text-text-secondary"
            />
            <span class="font-medium">{{ currentNavLabel }}</span>
          </NuxtLink>
          <template v-if="projectStore.activeProject">
            <span class="text-text-faint shrink-0">/</span>
            <NuxtLink
              to="/projects"
              class="text-text-secondary truncate min-w-0 hover:text-text-primary hover:underline transition-colors"
              :title="`Switch project (currently: ${projectStore.activeProject.name})`"
            >
              {{ projectStore.activeProject.name }}
            </NuxtLink>
          </template>
        </div>

        <!-- Right cluster -->
        <div class="flex items-center gap-2 shrink-0">
          <!-- KB scope switcher: My KB ↔ Workspace KB -->
          <div
            class="hidden md:inline-flex items-center rounded-md border border-border overflow-hidden"
            title="Active knowledge base scope"
          >
            <button
              type="button"
              class="flex items-center gap-1 px-2 py-1 text-xs transition"
              :class="kbScope === 'user'
                ? 'bg-accent/10 text-accent'
                : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'"
              @click="setKbScope('user')"
            >
              <UIcon name="i-ph-user-light" class="w-3 h-3" />
              My KB
            </button>
            <button
              type="button"
              class="flex items-center gap-1 px-2 py-1 text-xs border-l border-border transition"
              :class="kbScope === 'org'
                ? 'bg-accent/10 text-accent'
                : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'"
              @click="setKbScope('org')"
            >
              <UIcon name="i-ph-buildings-light" class="w-3 h-3" />
              Workspace KB
            </button>
          </div>

          <!-- code-server quick link -->
          <a
            v-if="resolvedCodeServerUrl && projectStore.activeProject"
            :href="buildCodeServerLink({ workspacePath: projectStore.activeProject.workspacePath })"
            target="_blank"
            rel="noopener"
            class="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary transition"
            title="Open in VS Code"
          >
            <UIcon name="i-ph-code-light" class="w-3.5 h-3.5" />
            VS Code
          </a>

          <!-- Stop all -->
          <button
            v-if="hasActiveTasks"
            :disabled="stopping"
            class="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-failed border border-failed/30 bg-failed-bg hover:bg-failed/20 transition disabled:opacity-50"
            @click="stopAll"
          >
            <UIcon name="i-ph-stop-light" class="w-3.5 h-3.5" />
            Stop all
          </button>
        </div>
      </header>

      <!--
        KB scope mismatch warning — when the user has selected "Workspace KB"
        but no active organization is set, no documents will load (org-scoped
        queries need an org id) and KB writes from /settings/knowledge will
        fail with a 400. We surface this loudly so users don't think the KB
        is broken; the fix is either picking a workspace or switching back
        to "My KB".
      -->
      <div
        v-if="kbScope === 'org' && !auth.activeOrgId.value"
        class="flex items-center justify-between px-4 py-2 text-xs font-medium border-b border-border shrink-0 bg-pending-bg text-pending border-pending/30"
      >
        <div class="flex items-center gap-2">
          <UIcon name="i-ph-warning-light" class="w-4 h-4" />
          <span>
            KB scope is set to <strong>Workspace</strong> but no workspace is
            active. Pick a workspace from the top-left switcher, or switch the
            KB scope back to <strong>My KB</strong>.
          </span>
        </div>
        <button
          type="button"
          class="underline hover:no-underline"
          @click="setKbScope('user')"
        >
          Switch to My KB
        </button>
      </div>

      <!-- Budget alert banners -->
      <div
        v-for="(alert, i) in budgetAlerts"
        :key="`${alert.sessionId}:${alert.thresholdPct}`"
        :class="[
          'flex items-center justify-between px-4 py-2 text-xs font-medium border-b border-border shrink-0',
          alert.thresholdPct >= 100
            ? 'bg-failed-bg text-failed border-failed/30'
            : 'bg-pending-bg text-pending border-pending/30',
        ]"
      >
        <span class="flex items-center gap-2">
          <UIcon
            :name="alert.thresholdPct >= 100 ? 'i-ph-warning-fill' : 'i-ph-warning-circle-light'"
            class="w-4 h-4"
          />
          {{ alert.thresholdPct >= 100 ? 'Budget cap reached' : 'Budget warning' }}
          — ${{ alert.currentCostUsd.toFixed(3) }} of ${{ alert.budgetCapUsd }}
          ({{ alert.thresholdPct }}%)
        </span>
        <button
          class="opacity-70 hover:opacity-100 transition"
          @click="budgetAlerts.splice(i, 1)"
        >
          <UIcon name="i-ph-x-light" class="w-3.5 h-3.5" />
        </button>
      </div>

      <!-- Content -->
      <main class="flex-1 min-h-0 overflow-auto bg-bg">
        <slot />
      </main>
    </div>

    <!-- ════════════════════════════════════════════════════════════════════
         APPROVAL MODAL
         ══════════════════════════════════════════════════════════════════ -->
    <div
      v-if="pendingApprovals.length"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div class="bg-surface-elevated border border-border-strong rounded-xl shadow-pop w-full max-w-lg mx-4 overflow-hidden">
        <div class="px-5 py-3.5 border-b border-border flex items-center gap-3">
          <div class="w-8 h-8 rounded-md bg-pending-bg border border-pending/30 flex items-center justify-center">
            <UIcon name="i-ph-warning-light" class="w-4 h-4 text-pending" />
          </div>
          <div class="flex-1">
            <p class="font-semibold text-sm">Approval required</p>
            <p class="text-xs text-text-secondary">
              {{ pendingApprovals.length }} task{{ pendingApprovals.length !== 1 ? 's' : '' }} need confirmation
            </p>
          </div>
        </div>

        <div class="p-4 space-y-2.5 max-h-80 overflow-y-auto">
          <div
            v-for="approval in pendingApprovals"
            :key="approval.taskId"
            class="border border-border rounded-md p-3 bg-surface"
          >
            <div class="flex items-center gap-2 mb-1.5">
              <span class="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface-hover text-text-secondary">
                {{ approval.agentType }}
              </span>
            </div>
            <p class="text-sm mb-1">{{ approval.prompt }}</p>
            <p class="text-xs text-pending italic">{{ approval.reason }}</p>
          </div>
        </div>

        <div class="px-4 py-3 border-t border-border flex justify-end gap-2 bg-surface">
          <UButton
            color="gray"
            variant="ghost"
            size="sm"
            :loading="approvalLoading"
            @click="rejectAllApprovals"
          >
            Reject all
          </UButton>
          <UButton
            color="primary"
            variant="solid"
            size="sm"
            :loading="approvalLoading"
            @click="approveAllApprovals"
          >
            Approve all
          </UButton>
        </div>
      </div>
    </div>

    <!-- Create workspace modal -->
    <Teleport to="body">
      <div
        v-if="showCreateWorkspace"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
        @click.self="showCreateWorkspace = false"
        @keydown.esc="showCreateWorkspace = false"
      >
        <div
          class="w-[420px] max-w-[90vw] bg-surface-elevated border border-border-strong rounded-lg shadow-pop overflow-hidden"
          @click.stop
        >
          <div class="px-5 pt-5 pb-3">
            <h3 class="font-heading font-semibold text-base text-text-primary">Create workspace</h3>
            <p class="text-xs text-text-faint mt-1">A workspace groups projects, knowledge and team members.</p>
          </div>
          <form class="px-5 pb-4 space-y-3" @submit.prevent="submitCreateWorkspace">
            <div>
              <label class="block text-xs font-medium text-text-secondary mb-1.5">Name</label>
              <input
                ref="newWorkspaceInputRef"
                v-model="newWorkspaceName"
                type="text"
                placeholder="Acme Inc."
                class="w-full px-3 py-2 text-sm bg-surface border border-border-strong rounded-md focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30 transition"
                :disabled="creatingWorkspace"
              >
              <p v-if="newWorkspaceError" class="mt-1.5 text-xs text-red-500">{{ newWorkspaceError }}</p>
            </div>
          </form>
          <div class="flex justify-end gap-2 px-5 py-3 bg-surface border-t border-border">
            <UButton
              variant="ghost"
              size="sm"
              :disabled="creatingWorkspace"
              @click="showCreateWorkspace = false"
            >
              Cancel
            </UButton>
            <UButton
              variant="primary"
              size="sm"
              :loading="creatingWorkspace"
              :disabled="!newWorkspaceName.trim() || creatingWorkspace"
              @click="submitCreateWorkspace"
            >
              Create
            </UButton>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Global completion burst overlay — listens for window 'task-complete-celebrate' -->
    <CompletionBurst />
  </div>
</template>

<script setup lang="ts">
import { useSessionStore } from '~/stores/session';
import { useProjectStore } from '~/stores/project';
import { useOrchestratorApi } from '~/composables/useOrchestratorApi';
import { useCodeServerLink } from '~/composables/useCodeServerLink';
import type {
  BudgetAlertPayload,
  ApprovalRequiredPayload,
  ClarificationPayload,
} from '@agent-orchestrator/shared';

const sessionStore = useSessionStore();
const projectStore = useProjectStore();
const apiStore     = reactive(useOrchestratorApi());
const auth         = useAuth();
const config       = useRuntimeConfig();
const route        = useRoute();
const colorMode    = useColorMode();
const toast        = useToast();

// KB scope switcher (topbar)
const { scope: kbScope, setScope: setKbScope } = useKbScope();

const stopping     = ref(false);
const orgMenuOpen  = ref(false);
const userMenuOpen = ref(false);

// Create workspace modal state
const showCreateWorkspace  = ref(false);
const newWorkspaceName     = ref('');
const newWorkspaceError    = ref<string | null>(null);
const creatingWorkspace    = ref(false);
const newWorkspaceInputRef = ref<HTMLInputElement | null>(null);

// Close menus on route change or outside click
watch(() => route.fullPath, () => {
  orgMenuOpen.value = false;
  userMenuOpen.value = false;
});
if (import.meta.client) {
  window.addEventListener('click', () => {
    orgMenuOpen.value = false;
    userMenuOpen.value = false;
  });
}

const orgInitial = computed(() => (auth.activeOrg.value?.name ?? 'W').charAt(0).toUpperCase());
const userInitial = computed(() => {
  const u = auth.user.value;
  return ((u?.name ?? u?.email ?? '?').charAt(0)).toUpperCase();
});

async function switchOrg(orgId: string) {
  orgMenuOpen.value = false;
  if (orgId === auth.activeOrgId.value) return;
  try {
    await auth.setActiveOrg(orgId);
    // Reload projects for the new org context
    const { projects } = await apiStore.listProjects();
    projectStore.setProjects(projects);
  } catch (e) { console.error('Switch org failed:', e); }
}

async function createWorkspace() {
  orgMenuOpen.value = false;
  newWorkspaceName.value = '';
  newWorkspaceError.value = null;
  showCreateWorkspace.value = true;
  // Focus the input after the modal is mounted
  await nextTick();
  newWorkspaceInputRef.value?.focus();
}

async function submitCreateWorkspace() {
  const name = newWorkspaceName.value.trim();
  if (!name) {
    newWorkspaceError.value = 'Name is required';
    return;
  }
  creatingWorkspace.value = true;
  newWorkspaceError.value = null;
  try {
    await auth.createOrg(name);
    const { projects } = await apiStore.listProjects();
    projectStore.setProjects(projects);
    showCreateWorkspace.value = false;
  } catch (e) {
    newWorkspaceError.value = e instanceof Error ? e.message : 'Failed to create workspace';
  } finally {
    creatingWorkspace.value = false;
  }
}

async function signOutAndRedirect() {
  userMenuOpen.value = false;
  try {
    await auth.signOut();
  } finally {
    await navigateTo('/auth/login');
  }
}

const isDark = computed(() => colorMode.value === 'dark');
function toggleColorMode() {
  colorMode.preference = isDark.value ? 'light' : 'dark';
}

const resolvedCodeServerUrl = computed(
  () => (config.public.codeServerUrl as string | undefined) ?? '',
);

// Code-server runs in a Docker container that mounts the host workspaces
// volume at `/home/coder/workspaces`. The DB stores the host-side path
// (e.g. `/tmp/orchestrator-workspaces/<id>`). buildLink rebases for us.
const { buildLink: buildCodeServerLink } = useCodeServerLink();

const budgetAlerts        = reactive<BudgetAlertPayload[]>([]);
const pendingApprovals    = reactive<ApprovalRequiredPayload[]>([]);
const approvalLoading     = ref(false);
const pendingClarifications = reactive<ClarificationPayload[]>([]);

// Navigation — grouped Linear-style
const primaryNav = computed(() => [
  { to: '/',        label: 'Chat',    icon: 'i-ph-chat-circle-text-light',
    badge: hasActiveTasks.value ? activeTaskCount.value : null },
  { to: '/monitor', label: 'Monitor', icon: 'i-ph-pulse-light',
    badge: sessionStore.tasks.length || null },
]);

const buildNav = [
  { to: '/projects', label: 'Projects', icon: 'i-ph-folders-light' },
  { to: '/files',    label: 'Files',    icon: 'i-ph-file-code-light' },
  { to: '/agents',   label: 'Agents',   icon: 'i-ph-cube-light' },
  { to: '/costs',    label: 'Costs',    icon: 'i-ph-currency-dollar-light' },
];

const systemNav = [
  { to: '/settings/connections', label: 'Connections',  icon: 'i-ph-plug-light' },
  { to: '/settings/ai',          label: 'AI Providers', icon: 'i-ph-brain-light' },
  { to: '/settings/skills',      label: 'Skills',       icon: 'i-ph-lightbulb-light' },
  { to: '/settings/knowledge',   label: 'Knowledge',    icon: 'i-ph-book-open-light' },
  { to: '/settings/workspace',   label: 'Workspace',    icon: 'i-ph-buildings-light' },
  { to: '/settings',             label: 'Account',      icon: 'i-ph-user-circle-light' },
];

const allNav = computed(() => [...primaryNav.value, ...buildNav, ...systemNav]);
const currentNavItem = computed(
  () => allNav.value.find((n) => n.to === route.path) ?? primaryNav.value[0],
);
const currentNavLabel = computed(() => currentNavItem.value?.label ?? 'Chat');
const currentNavIcon  = computed(() => currentNavItem.value?.icon ?? 'i-ph-chat-circle-text-light');

const hasActiveTasks = computed(() =>
  sessionStore.tasks.some((t) => t.status === 'running' || t.status === 'pending'),
);
const activeTaskCount = computed(() =>
  sessionStore.tasks.filter((t) => t.status === 'running').length,
);

// ── Mount: restore session + projects ─────────────────────────────────────
onMounted(async () => {
  try {
    const { sessions } = await apiStore.listSessions({ limit: 30 });
    sessionStore.setSessionHistory(sessions);

    if (!sessionStore.currentSession) {
      const activeSession = sessions.find((s) => s.status === 'active');
      if (activeSession) {
        const { session, tasks } = await apiStore.getSession(activeSession.id);
        sessionStore.restoreSession(session, tasks);
      }
    }
  } catch { /* ignore */ }

  if (projectStore.projects.length === 0) {
    try {
      const { projects } = await apiStore.listProjects();
      projectStore.setProjects(projects);
    } catch { /* ignore */ }
  }
});

// ── WebSocket — global ────────────────────────────────────────────────────
const activeSessionId = computed(() => sessionStore.currentSession?.id ?? null);

useAgentSocket({
  sessionId: activeSessionId,

  onTaskCreated(task) { sessionStore.addTask(task); },

  onAgentEvent(taskId, event) {
    sessionStore.appendTaskEvent(taskId, event);
    const task = sessionStore.tasks.find((t) => t.id === taskId);
    const agentLabel = task ? capitalize(task.agentType) : 'Agent';

    if (event.type === 'tool_use') {
      if (event.name === 'question') return;
      const file = (event.input?.['path'] ?? event.input?.['file_path'] ?? event.input?.['filename'] ?? '') as string;
      const detail = file ? ` ${file}` : '';
      sessionStore.addMessage({
        id: `tool-${taskId}-${Date.now()}`,
        role: 'assistant',
        content: `${agentLabel}: ${event.name}${detail}`,
        timestamp: new Date().toISOString(),
      });
    } else if (event.type === 'message' && event.content?.trim()) {
      const plan = tryParsePlan(event.content);
      sessionStore.addMessage({
        id: `msg-${taskId}-${Date.now()}`,
        role: 'assistant',
        content: plan ? '' : event.content,
        plan: plan ?? undefined,
        timestamp: new Date().toISOString(),
      });
    }
  },

  onStatusChange(payload) {
    sessionStore.updateTaskStatus(payload.taskId, payload.status, {
      currentStep: payload.currentStep,
      maxSteps: payload.maxSteps,
    });
    const task = sessionStore.tasks.find((t) => t.id === payload.taskId);
    if (payload.status === 'completed') {
      if (task?.agentType === 'document') {
        projectStore.notifyVaultUpdated();
      }
      // Celebrate when the orchestrator (the root task) finishes — that
      // signals the whole session is done from the user's POV.
      if (task?.agentType === 'orchestrator') {
        toast.add({
          title:       'Task complete',
          description: 'All agents finished. Check the results in the chat or Monitor.',
          icon:        'i-ph-check-circle-fill',
          color:       'green',
          timeout:     6000,
        });
        // Fire a subtle visual burst centered on the viewport. CompletionBurst
        // (mounted globally below) listens for this event.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('task-complete-celebrate'));
        }
      }
    } else if (payload.status === 'failed' && task?.agentType === 'orchestrator') {
      toast.add({
        title:       'Task failed',
        description: 'The orchestrator hit an unrecoverable error. See Monitor for details.',
        icon:        'i-ph-warning-octagon-fill',
        color:       'red',
        timeout:     8000,
      });
    }
  },

  onCostUpdate(payload) {
    sessionStore.updateTaskCost(
      payload.taskId,
      payload.inputTokens,
      payload.outputTokens,
      payload.costUsd,
    );
  },

  onSessionUpdate(payload) {
    sessionStore.applySessionUpdate(payload);
    if (payload.status !== 'active' && sessionStore.currentSession?.id === payload.sessionId) {
      sessionStore.sessionHistory.unshift({ ...sessionStore.currentSession, ...payload });
    }
  },

  onBudgetAlert(payload) {
    const exists = budgetAlerts.some(
      (a) => a.sessionId === payload.sessionId && a.thresholdPct === payload.thresholdPct,
    );
    if (!exists) budgetAlerts.push(payload);
  },

  onApprovalRequired(payload) {
    const exists = pendingApprovals.some((a) => a.taskId === payload.taskId);
    if (!exists) pendingApprovals.push(payload);
  },

  onClarificationNeeded(payload) {
    const exists = pendingClarifications.some((c) => c.taskId === payload.taskId);
    if (!exists) {
      pendingClarifications.push(payload);
      sessionStore.setClarification(payload);
    }
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────
function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function tryParsePlan(content: string) {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (Array.isArray(parsed['tasks']) && (parsed['tasks'] as unknown[]).length > 0) {
      return parsed as {
        analysis?: string;
        tasks: Array<{ id: string; agentType: string; prompt: string; complexity: string; dependsOn: string[] }>;
      };
    }
  } catch { /* not JSON */ }
  return null;
}

// ── Fallback poller ───────────────────────────────────────────────────────
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollSessionId: string | null = null;

function startFallbackPolling(sessionId: string) {
  stopFallbackPolling();
  pollSessionId = sessionId;
  const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

  async function poll() {
    if (pollSessionId !== sessionId) return;
    try {
      const { session, tasks } = await apiStore.getSession(sessionId);
      for (const t of tasks) sessionStore.addTask(t);
      if (session.status !== 'active') {
        sessionStore.applySessionUpdate({
          sessionId: session.id,
          status: session.status,
          totalCostUsd: session.totalCostUsd,
        });
      }

      const allDone = tasks.every((t) => TERMINAL.has(t.status));
      if (allDone) {
        stopFallbackPolling();
        try {
          const eventsRes = await fetch(
            `${config.public.apiBase}/api/sessions/${sessionId}/events?limit=500`,
          );
          if (eventsRes.ok) {
            const { events } = await eventsRes.json() as {
              events: Array<{
                task_id: string;
                event_type: string;
                payload: { type: string; role?: string; content?: string; questions?: string[]; originalPrompt?: string };
                created_at: string;
              }>;
            };
            for (const row of events) {
              if (row.event_type === 'message' && row.payload?.content?.trim()) {
                const alreadyShown = sessionStore.messages.some(
                  (m) => m.role === 'assistant' && m.content === row.payload.content,
                );
                if (!alreadyShown) {
                  sessionStore.addMessage({
                    id: `fb-msg-${row.task_id}-${row.created_at}`,
                    role: 'assistant',
                    content: row.payload.content!,
                    timestamp: row.created_at,
                  });
                }
              }
              if (row.event_type === 'clarification_needed' && row.payload?.questions) {
                if (!sessionStore.pendingClarification) {
                  sessionStore.setClarification({
                    sessionId,
                    taskId: row.task_id,
                    questions: row.payload.questions,
                    originalPrompt: row.payload.originalPrompt ?? '',
                  });
                }
              }
            }
          }
        } catch { /* ignore */ }

        const hasDoneMsg = sessionStore.messages.some((m) => m.id.startsWith(`done-${sessionId}`));
        if (!hasDoneMsg && tasks.length > 0) {
          const total = tasks.reduce((s, t) => s + t.costUsd, 0);
          sessionStore.addMessage({
            id: `done-${sessionId}`,
            role: 'assistant',
            content: `All ${tasks.length} task(s) completed. Total cost: $${total.toFixed(4)}.`,
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch { /* ignore */ }
  }

  pollTimer = setInterval(poll, 2000);
  setTimeout(poll, 2000);
}

function stopFallbackPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  pollSessionId = null;
}

watch(activeSessionId, (newId, oldId) => {
  if (newId && newId !== oldId) startFallbackPolling(newId);
  else if (!newId) stopFallbackPolling();
});

onUnmounted(stopFallbackPolling);

// ── Approval handlers ─────────────────────────────────────────────────────
async function approveAllApprovals() {
  approvalLoading.value = true;
  try {
    await Promise.all(pendingApprovals.map((a) => apiStore.approveTask(a.taskId)));
    pendingApprovals.splice(0);
  } catch (e) { console.error('Approve failed:', e); }
  finally { approvalLoading.value = false; }
}

async function rejectAllApprovals() {
  approvalLoading.value = true;
  try {
    await Promise.all(pendingApprovals.map((a) => apiStore.rejectTask(a.taskId)));
    pendingApprovals.splice(0);
  } catch (e) { console.error('Reject failed:', e); }
  finally { approvalLoading.value = false; }
}

// ── Stop all ──────────────────────────────────────────────────────────────
async function stopAll() {
  const sid = sessionStore.currentSession?.id;
  if (!sid) return;
  stopping.value = true;
  try {
    await apiStore.cancelSession(sid);
    for (const task of sessionStore.tasks) {
      if (task.status === 'running' || task.status === 'pending') {
        sessionStore.updateTaskStatus(task.id, 'cancelled');
      }
    }
  } catch (e) { console.error('Stop all failed:', e); }
  finally { stopping.value = false; }
}

// Keyboard shortcut Cmd+. = stop
defineShortcuts({
  'meta_.': () => { if (hasActiveTasks.value) stopAll(); },
});
</script>
