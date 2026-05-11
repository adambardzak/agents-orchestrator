<template>
  <div class="p-6 max-w-4xl">
    <SettingsTabs />
    <div class="mb-8">
      <h1 class="text-display-md font-heading font-bold mb-2">Workspace</h1>
      <p class="text-text-secondary">
        Manage the active workspace, its members and pending invitations.
        Switch between workspaces from the sidebar selector at the top.
      </p>
    </div>

    <!-- No active workspace -->
    <EmptyState
      v-if="!org"
      icon="i-ph-buildings-light"
      title="No workspace is currently active"
      description="Switch between workspaces from the sidebar selector at the top."
      size="sm"
    />

    <template v-else>
      <!-- Active workspace banner -->
      <div class="mb-6 flex items-center gap-3 px-4 py-3 rounded-md bg-surface-elevated border border-border">
        <div class="w-9 h-9 rounded-md bg-accent/10 text-accent flex items-center justify-center font-semibold">
          {{ org.name.slice(0, 1).toUpperCase() }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold truncate">{{ org.name }}</div>
          <div class="text-xs text-text-muted font-mono truncate">{{ org.slug }}</div>
        </div>
        <UBadge :color="roleColor(org.role)" variant="subtle" size="xs" class="capitalize">{{ org.role }}</UBadge>
      </div>

      <!-- General -->
      <section class="border border-border rounded-md p-5 bg-surface-elevated mb-6">
        <div class="flex items-center gap-2 mb-1">
          <UIcon name="i-ph-pencil-simple-light" class="w-4 h-4" />
          <h2 class="font-semibold">General</h2>
        </div>
        <p class="text-sm text-text-secondary mb-4">Display name and URL slug.</p>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="text-xs text-text-muted mb-1 block">Name</label>
            <UInput v-model="generalForm.name" :disabled="!canEdit" placeholder="Acme Inc." />
          </div>
          <div>
            <label class="text-xs text-text-muted mb-1 block">Slug</label>
            <UInput
              v-model="generalForm.slug"
              :disabled="!canEdit"
              placeholder="acme-inc"
              class="font-mono"
            />
            <p class="text-xs text-text-muted mt-1">Lowercase letters, numbers and dashes.</p>
          </div>
        </div>

        <div v-if="generalError" class="mt-3 text-sm text-failed">{{ generalError }}</div>

        <div class="mt-4 flex items-center gap-2">
          <UButton :loading="savingGeneral" :disabled="!canEdit || !generalDirty" @click="saveGeneral">
            Save changes
          </UButton>
          <UButton v-if="generalDirty" variant="ghost" @click="resetGeneralForm">Cancel</UButton>
          <span v-if="!canEdit" class="text-xs text-text-muted">Only admins and owners can edit.</span>
        </div>
      </section>

      <!-- Members -->
      <section class="border border-border rounded-md p-5 bg-surface-elevated mb-6">
        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-2">
            <UIcon name="i-ph-users-three-light" class="w-4 h-4" />
            <h2 class="font-semibold">Members</h2>
            <UBadge variant="subtle" size="xs">{{ members.length }}</UBadge>
          </div>
        </div>
        <p class="text-sm text-text-secondary mb-4">People who can access this workspace.</p>

        <div v-if="loadingMembers" class="space-y-2">
          <Skeleton v-for="n in 3" :key="n" class="h-12" />
        </div>

        <div v-else class="divide-y divide-border border border-border rounded-md overflow-hidden">
          <div
            v-for="m in members"
            :key="m.userId"
            class="flex items-center gap-3 px-3 py-2.5 hover:bg-surface"
          >
            <div class="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center text-xs font-semibold">
              {{ initials(m) }}
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium truncate">
                {{ m.name ?? m.email }}
                <span v-if="m.userId === currentUserId" class="ml-1 text-xs text-text-muted">(you)</span>
              </div>
              <div class="text-xs text-text-muted truncate">{{ m.email }}</div>
            </div>

            <!-- Role: owner can change anyone (except demoting last owner). Others read-only. -->
            <USelect
              v-if="isOwner && m.userId !== currentUserId"
              :model-value="m.role"
              :options="roleOptions"
              size="xs"
              class="w-28"
              @update:model-value="(role: string) => changeRole(m, role as MemberRole)"
            />
            <UBadge v-else :color="roleColor(m.role)" variant="subtle" size="xs" class="capitalize">{{ m.role }}</UBadge>

            <!-- Remove / leave -->
            <UButton
              v-if="canRemove(m)"
              icon="i-ph-x-light"
              size="xs"
              color="red"
              variant="ghost"
              :title="m.userId === currentUserId ? 'Leave workspace' : 'Remove member'"
              @click="removeMember(m)"
            />
          </div>
        </div>
      </section>

      <!-- Invitations -->
      <section v-if="canInvite" class="border border-border rounded-md p-5 bg-surface-elevated mb-6">
        <div class="flex items-center gap-2 mb-1">
          <UIcon name="i-ph-envelope-light" class="w-4 h-4" />
          <h2 class="font-semibold">Invitations</h2>
          <UBadge variant="subtle" size="xs">{{ pendingInvitations.length }}</UBadge>
        </div>
        <p class="text-sm text-text-secondary mb-4">Invite teammates by email.</p>

        <!-- Invite form -->
        <div class="flex flex-col md:flex-row gap-2 mb-4">
          <UInput
            v-model="inviteForm.email"
            type="email"
            placeholder="teammate@example.com"
            class="flex-1"
            @keydown.enter="sendInvite"
          />
          <USelect v-model="inviteForm.role" :options="inviteRoleOptions" class="md:w-32" />
          <UButton :loading="sendingInvite" :disabled="!inviteForm.email.trim()" @click="sendInvite">
            Send invite
          </UButton>
        </div>
        <div v-if="inviteError" class="mb-3 text-sm text-failed">{{ inviteError }}</div>
        <div v-if="lastInviteToken" class="mb-3 text-xs text-text-muted">
          Invite link (email delivery not configured yet — copy manually):
          <code class="ml-1 bg-surface px-1.5 py-0.5 rounded font-mono break-all">
            /invite/{{ lastInviteToken }}
          </code>
        </div>

        <!-- Pending list -->
        <div v-if="loadingInvitations" class="space-y-2">
          <Skeleton v-for="n in 2" :key="n" class="h-12" />
        </div>
        <EmptyState
          v-else-if="pendingInvitations.length === 0"
          icon="i-ph-envelope-light"
          title="No pending invitations"
          size="sm"
        />
        <div v-else class="divide-y divide-border border border-border rounded-md overflow-hidden">
          <div
            v-for="inv in pendingInvitations"
            :key="inv.id"
            class="flex items-center gap-3 px-3 py-2.5 hover:bg-surface"
          >
            <UIcon name="i-ph-envelope-simple-light" class="w-4 h-4 text-text-muted" />
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium truncate">{{ inv.email }}</div>
              <div class="text-xs text-text-muted">
                Invited by {{ inv.invitedByName ?? 'someone' }} ·
                expires {{ formatDate(inv.expiresAt) }}
              </div>
            </div>
            <UBadge :color="roleColor(inv.role)" variant="subtle" size="xs" class="capitalize">{{ inv.role }}</UBadge>
            <UButton
              icon="i-ph-x-light"
              size="xs"
              color="red"
              variant="ghost"
              title="Revoke invitation"
              @click="revokeInvite(inv)"
            />
          </div>
        </div>
      </section>

      <!-- Danger zone -->
      <section v-if="isOwner" class="border border-failed/50 rounded-md p-5 bg-surface-elevated">
        <div class="flex items-center gap-2 mb-1">
          <UIcon name="i-ph-warning-circle-light" class="w-4 h-4 text-failed" />
          <h2 class="font-semibold text-failed">Danger zone</h2>
        </div>
        <p class="text-sm text-text-secondary mb-4">
          Deleting the workspace permanently removes all projects, sessions, agents,
          knowledge documents and member assignments. This cannot be undone.
        </p>
        <UButton color="red" icon="i-ph-trash-light" @click="confirmDelete">Delete workspace</UButton>
      </section>
    </template>

    <!-- Confirm delete modal -->
    <Teleport to="body">
      <div
        v-if="deleteModalOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        @click.self="deleteModalOpen = false"
      >
        <div class="bg-surface-elevated border border-border rounded-md p-5 w-full max-w-md mx-4">
          <h3 class="text-lg font-semibold mb-2">Delete workspace?</h3>
          <p class="text-sm text-text-secondary mb-4">
            Type <code class="font-mono bg-surface px-1.5 py-0.5 rounded">{{ org?.slug }}</code>
            to confirm.
          </p>
          <UInput v-model="deleteConfirmText" :placeholder="org?.slug ?? ''" class="font-mono mb-4" />
          <div v-if="deleteError" class="mb-3 text-sm text-failed">{{ deleteError }}</div>
          <div class="flex justify-end gap-2">
            <UButton variant="ghost" @click="deleteModalOpen = false">Cancel</UButton>
            <UButton
              color="red"
              :disabled="deleteConfirmText !== org?.slug"
              :loading="deletingOrg"
              @click="performDelete"
            >
              Delete forever
            </UButton>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import type { OrgInvitation, OrgMember } from '~/composables/useOrganization';

type MemberRole = 'owner' | 'admin' | 'member';

const auth = useAuth();
const orgApi = useOrganization();

const org = computed(() => auth.activeOrg.value);
const currentUserId = computed(() => auth.user.value?.id ?? null);
const isOwner = computed(() => org.value?.role === 'owner');
const canEdit = computed(() => org.value?.role === 'owner' || org.value?.role === 'admin');
const canInvite = computed(() => canEdit.value);

// ── General form ──────────────────────────────────────────────────────────
const generalForm = reactive({ name: '', slug: '' });
const savingGeneral = ref(false);
const generalError = ref<string | null>(null);

const generalDirty = computed(() =>
  org.value !== null &&
  (generalForm.name !== org.value.name || generalForm.slug !== org.value.slug),
);

function resetGeneralForm() {
  if (!org.value) return;
  generalForm.name = org.value.name;
  generalForm.slug = org.value.slug;
  generalError.value = null;
}

watch(org, resetGeneralForm, { immediate: true });

async function saveGeneral() {
  if (!org.value) return;
  generalError.value = null;
  savingGeneral.value = true;
  try {
    const patch: { name?: string; slug?: string } = {};
    if (generalForm.name !== org.value.name) patch.name = generalForm.name.trim();
    if (generalForm.slug !== org.value.slug) patch.slug = generalForm.slug.trim();
    await orgApi.update(org.value.id, patch);
    await auth.refresh();
  } catch (err) {
    generalError.value = err instanceof Error ? err.message : 'Failed to save';
  } finally {
    savingGeneral.value = false;
  }
}

// ── Members ───────────────────────────────────────────────────────────────
const members = ref<OrgMember[]>([]);
const loadingMembers = ref(false);

const roleOptions = [
  { label: 'Owner',  value: 'owner' },
  { label: 'Admin',  value: 'admin' },
  { label: 'Member', value: 'member' },
];

async function loadMembers() {
  if (!org.value) return;
  loadingMembers.value = true;
  try {
    members.value = await orgApi.listMembers(org.value.id);
  } catch (err) {
    console.error('[workspace] listMembers failed:', err);
  } finally {
    loadingMembers.value = false;
  }
}

async function changeRole(m: OrgMember, role: MemberRole) {
  if (!org.value) return;
  const previous = m.role;
  m.role = role;
  try {
    await orgApi.updateMemberRole(org.value.id, m.userId, role);
  } catch (err) {
    m.role = previous;
    alert(err instanceof Error ? err.message : 'Failed to change role');
  }
}

function canRemove(m: OrgMember): boolean {
  if (!org.value) return false;
  if (m.userId === currentUserId.value) return true; // self-leave
  return canEdit.value;
}

async function removeMember(m: OrgMember) {
  if (!org.value) return;
  const isSelf = m.userId === currentUserId.value;
  const label = isSelf ? 'leave this workspace' : `remove ${m.name ?? m.email}`;
  if (!confirm(`Are you sure you want to ${label}?`)) return;
  try {
    await orgApi.removeMember(org.value.id, m.userId);
    if (isSelf) {
      await auth.refresh();
      await navigateTo('/');
    } else {
      members.value = members.value.filter((x) => x.userId !== m.userId);
    }
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to remove member');
  }
}

// ── Invitations ───────────────────────────────────────────────────────────
const invitations = ref<OrgInvitation[]>([]);
const loadingInvitations = ref(false);
const inviteForm = reactive<{ email: string; role: 'admin' | 'member' }>({
  email: '',
  role: 'member',
});
const inviteRoleOptions = [
  { label: 'Member', value: 'member' },
  { label: 'Admin',  value: 'admin' },
];
const sendingInvite = ref(false);
const inviteError = ref<string | null>(null);
const lastInviteToken = ref<string | null>(null);

const pendingInvitations = computed(() =>
  invitations.value.filter((i) => i.acceptedAt === null),
);

async function loadInvitations() {
  if (!org.value || !canInvite.value) return;
  loadingInvitations.value = true;
  try {
    invitations.value = await orgApi.listInvitations(org.value.id);
  } catch (err) {
    console.error('[workspace] listInvitations failed:', err);
  } finally {
    loadingInvitations.value = false;
  }
}

async function sendInvite() {
  if (!org.value) return;
  inviteError.value = null;
  sendingInvite.value = true;
  try {
    const inv = await orgApi.invite(org.value.id, inviteForm.email.trim(), inviteForm.role);
    invitations.value = [inv, ...invitations.value];
    lastInviteToken.value = inv.token;
    inviteForm.email = '';
  } catch (err) {
    inviteError.value = err instanceof Error ? err.message : 'Failed to send invite';
  } finally {
    sendingInvite.value = false;
  }
}

async function revokeInvite(inv: OrgInvitation) {
  if (!org.value) return;
  if (!confirm(`Revoke invitation for ${inv.email}?`)) return;
  try {
    await orgApi.revokeInvitation(org.value.id, inv.id);
    invitations.value = invitations.value.filter((x) => x.id !== inv.id);
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to revoke');
  }
}

// ── Delete workspace ──────────────────────────────────────────────────────
const deleteModalOpen = ref(false);
const deleteConfirmText = ref('');
const deletingOrg = ref(false);
const deleteError = ref<string | null>(null);

function confirmDelete() {
  deleteConfirmText.value = '';
  deleteError.value = null;
  deleteModalOpen.value = true;
}

async function performDelete() {
  if (!org.value) return;
  deletingOrg.value = true;
  deleteError.value = null;
  try {
    await orgApi.remove(org.value.id);
    deleteModalOpen.value = false;
    await auth.refresh();
    await navigateTo('/');
  } catch (err) {
    deleteError.value = err instanceof Error ? err.message : 'Failed to delete';
  } finally {
    deletingOrg.value = false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function initials(m: OrgMember): string {
  const src = (m.name ?? m.email).trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function roleColor(role: MemberRole | 'admin' | 'member'): 'amber' | 'blue' | 'gray' {
  if (role === 'owner') return 'amber';
  if (role === 'admin') return 'blue';
  return 'gray';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

// ── Lifecycle ─────────────────────────────────────────────────────────────
async function loadAll() {
  resetGeneralForm();
  await Promise.all([loadMembers(), loadInvitations()]);
}

onMounted(loadAll);
watch(() => org.value?.id, loadAll);
</script>
