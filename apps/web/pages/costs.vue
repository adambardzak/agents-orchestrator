<template>
  <div class="p-6 max-w-6xl mx-auto">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-display-md font-heading font-bold">Cost Dashboard</h1>
        <p class="text-text-secondary mt-1">Token usage and cost analytics across all sessions.</p>
      </div>
      <div class="flex items-center gap-2">
        <UButton
          size="sm"
          variant="ghost"
          icon="i-ph-arrows-clockwise-light"
          :loading="loading"
          @click="load"
        >
          Refresh
        </UButton>
      </div>
    </div>

    <div v-if="loading && !data" class="space-y-6">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Skeleton v-for="n in 4" :key="n" class="h-20" />
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Skeleton class="h-72" />
        <Skeleton class="h-72" />
      </div>
      <Skeleton class="h-48" />
      <Skeleton class="h-96" />
    </div>

    <template v-else-if="data">
      <!-- ── Period totals ── -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div
          v-for="(period, key) in periodCards"
          :key="key"
          class="border border-border rounded-md p-4 bg-surface-elevated"
        >
          <div class="text-xs text-text-muted font-medium uppercase tracking-wide mb-1">{{ period.label }}</div>
          <div class="text-2xl font-mono font-bold">${{ period.value.toFixed(4) }}</div>
        </div>
      </div>

      <!-- ── Savings banner ── -->
      <div
        v-if="data.savings.savedUsd > 0"
        class="border border-completed/30 bg-completed-bg rounded-md p-4 mb-6 flex items-center justify-between"
      >
        <div>
          <div class="text-sm font-semibold text-completed">
            Model routing saved you ${{ data.savings.savedUsd.toFixed(4) }}
            <span class="text-completed/70">({{ data.savings.savedPct }}% vs all-Sonnet)</span>
          </div>
          <div class="text-xs text-text-muted mt-0.5">
            Actual: ${{ data.savings.actualUsd.toFixed(4) }}
            · Hypothetical (all claude-sonnet-4-6): ${{ data.savings.hypotheticalSonnetUsd.toFixed(4) }}
          </div>
        </div>
        <UIcon name="i-ph-trend-down-light" class="w-6 h-6 text-completed flex-shrink-0" />
      </div>

      <!-- ── Breakdown columns ── -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <!-- By Model -->
        <div class="border border-border rounded-md p-5 bg-surface-elevated">
          <h2 class="font-semibold font-heading mb-4">By Model</h2>
          <div v-if="data.byModel.length === 0" class="text-sm text-text-muted">No data yet.</div>
          <div v-else class="space-y-3">
            <div v-for="row in data.byModel" :key="row.model">
              <div class="flex justify-between text-sm mb-1">
                <span class="font-mono text-text-primary">{{ row.model }}</span>
                <span class="text-text-secondary tabular-nums">${{ row.costUsd.toFixed(4) }}</span>
              </div>
              <div class="w-full bg-surface rounded-full h-1.5">
                <div
                  class="bg-accent h-1.5 rounded-full"
                  :style="{ width: `${modelBarWidth(row.costUsd)}%` }"
                />
              </div>
              <div class="text-xs text-text-muted mt-0.5 flex gap-2">
                <span>{{ row.taskCount }} tasks</span>
                <span>·</span>
                <span>{{ row.inputTokens.toLocaleString() }} in</span>
                <span>/</span>
                <span>{{ row.outputTokens.toLocaleString() }} out</span>
              </div>
            </div>
          </div>
        </div>

        <!-- By Agent -->
        <div class="border border-border rounded-md p-5 bg-surface-elevated">
          <h2 class="font-semibold font-heading mb-4">By Agent</h2>
          <div v-if="data.byAgent.length === 0" class="text-sm text-text-muted">No data yet.</div>
          <div v-else class="space-y-3">
            <div v-for="row in data.byAgent" :key="row.agentType">
              <div class="flex justify-between text-sm mb-1">
                <span class="capitalize font-medium">{{ row.agentType }}</span>
                <span class="text-text-secondary tabular-nums">${{ row.costUsd.toFixed(4) }}</span>
              </div>
              <div class="w-full bg-surface rounded-full h-1.5">
                <div
                  class="bg-violet-500 h-1.5 rounded-full"
                  :style="{ width: `${agentBarWidth(row.costUsd)}%` }"
                />
              </div>
              <div class="text-xs text-text-muted mt-0.5 flex gap-2">
                <span>{{ row.taskCount }} tasks</span>
                <span>·</span>
                <span>{{ row.inputTokens.toLocaleString() }} in / {{ row.outputTokens.toLocaleString() }} out</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Daily trend ── -->
      <div v-if="data.dailyTrend.length > 0" class="border border-border rounded-md p-5 bg-surface-elevated mb-6">
        <h2 class="font-semibold font-heading mb-4">Daily Trend (last 14 days)</h2>
        <div class="flex items-end gap-1.5 h-24">
          <div
            v-for="day in paddedTrend"
            :key="day.date"
            class="flex-1 flex flex-col items-center gap-1"
          >
            <div
              class="w-full rounded-t-sm bg-accent/70 transition-all"
              :style="{ height: `${trendBarHeight(day.costUsd)}px` }"
              :title="`${day.date}: $${day.costUsd.toFixed(4)}`"
            />
            <div class="text-[9px] text-text-muted">{{ formatShortDate(day.date) }}</div>
          </div>
        </div>
      </div>

      <!-- ── Recent sessions ── -->
      <div class="border border-border rounded-md overflow-hidden">
        <div class="px-5 py-3 border-b border-border bg-surface-elevated flex items-center justify-between">
          <h2 class="font-semibold font-heading">Recent Sessions</h2>
          <span class="text-xs text-text-muted">{{ data.recentSessions.length }} shown</span>
        </div>
        <table class="w-full text-sm">
          <thead class="bg-surface-elevated border-b border-border">
            <tr>
              <th class="text-left p-3 font-semibold">Prompt</th>
              <th class="text-right p-3 font-semibold">Cost</th>
              <th class="text-right p-3 font-semibold">Tokens in/out</th>
              <th class="text-right p-3 font-semibold">Status</th>
              <th class="text-right p-3 font-semibold">Date</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="s in data.recentSessions"
              :key="s.id"
              class="border-b border-border last:border-0 hover:bg-surface-elevated/50 cursor-pointer"
              @click="$router.push('/')"
            >
              <td class="p-3 max-w-xs">
                <div class="truncate">{{ s.userPrompt }}</div>
                <div class="text-xs text-text-muted font-mono">{{ s.id.slice(0, 8) }}</div>
              </td>
              <td class="p-3 text-right font-mono tabular-nums">
                ${{ s.costUsd.toFixed(4) }}
              </td>
              <td class="p-3 text-right font-mono text-text-muted tabular-nums text-xs">
                {{ s.inputTokens.toLocaleString() }} / {{ s.outputTokens.toLocaleString() }}
              </td>
              <td class="p-3 text-right">
                <span
                  class="text-xs font-medium px-1.5 py-0.5 rounded-full"
                  :class="{
                    'bg-completed-bg text-completed': s.status === 'completed',
                    'bg-pending-bg text-pending': s.status === 'active',
                    'bg-failed-bg text-failed': s.status === 'failed',
                  }"
                >{{ s.status }}</span>
              </td>
              <td class="p-3 text-right text-text-muted text-xs">
                {{ formatDate(s.createdAt) }}
              </td>
            </tr>
          </tbody>
        </table>
        <EmptyState
          v-if="data.recentSessions.length === 0"
          icon="i-ph-chart-line-light"
          title="No sessions yet"
          description="Start your first session from Chat. Token usage and costs will appear here."
          action-label="Go to Chat"
          action-icon="i-ph-chat-circle-light"
          size="sm"
          @action="$router.push('/')"
        />
      </div>
    </template>

    <div v-if="error" class="text-center py-16 text-failed">
      <UIcon name="i-ph-warning-light" class="w-6 h-6 mx-auto mb-2" />
      {{ error }}
    </div>
  </div>
</template>

<script setup lang="ts">
const config = useRuntimeConfig();

interface CostSummary {
  periods: { today: number; thisWeek: number; thisMonth: number; allTime: number };
  savings: { hypotheticalSonnetUsd: number; actualUsd: number; savedUsd: number; savedPct: number };
  byModel: Array<{ model: string; taskCount: number; inputTokens: number; outputTokens: number; costUsd: number }>;
  byAgent: Array<{ agentType: string; taskCount: number; inputTokens: number; outputTokens: number; costUsd: number }>;
  dailyTrend: Array<{ date: string; costUsd: number; sessions: number }>;
  recentSessions: Array<{ id: string; userPrompt: string; status: string; createdAt: string; costUsd: number; inputTokens: number; outputTokens: number }>;
}

const data = ref<CostSummary | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch(`${config.public.apiBase}/api/costs/summary`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data.value = await res.json() as CostSummary;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

// ── Computed helpers ────────────────────────────────────────────────────────

const periodCards = computed(() => {
  if (!data.value) return [];
  return [
    { label: 'Today',      value: data.value.periods.today },
    { label: 'This week',  value: data.value.periods.thisWeek },
    { label: 'This month', value: data.value.periods.thisMonth },
    { label: 'All time',   value: data.value.periods.allTime },
  ];
});

const maxModelCost = computed(() =>
  Math.max(...(data.value?.byModel.map((r) => r.costUsd) ?? [1])),
);
const maxAgentCost = computed(() =>
  Math.max(...(data.value?.byAgent.map((r) => r.costUsd) ?? [1])),
);
const maxTrendCost = computed(() =>
  Math.max(...(data.value?.dailyTrend.map((r) => r.costUsd) ?? [1])),
);

function modelBarWidth(cost: number) {
  return maxModelCost.value > 0 ? (cost / maxModelCost.value) * 100 : 0;
}
function agentBarWidth(cost: number) {
  return maxAgentCost.value > 0 ? (cost / maxAgentCost.value) * 100 : 0;
}
function trendBarHeight(cost: number) {
  const maxH = 80;
  return maxTrendCost.value > 0 ? Math.max(2, (cost / maxTrendCost.value) * maxH) : 2;
}

// Pad trend to always show 14 days
const paddedTrend = computed(() => {
  if (!data.value) return [];
  const trend = data.value.dailyTrend;
  const days: Array<{ date: string; costUsd: number; sessions: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const found = trend.find((r) => r.date.startsWith(iso));
    days.push({ date: iso, costUsd: found?.costUsd ?? 0, sessions: found?.sessions ?? 0 });
  }
  return days;
});

function formatShortDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}
</script>
