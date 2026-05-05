<template>
  <div class="border border-border rounded-lg overflow-hidden bg-surface-elevated text-sm w-full">
    <!-- Header -->
    <div class="flex items-center gap-2 px-4 py-2.5 border-b border-border">
      <div class="w-5 h-5 rounded bg-accent/15 flex items-center justify-center">
        <UIcon name="i-ph-git-branch-light" class="w-3.5 h-3.5 text-accent" />
      </div>
      <span class="font-semibold text-sm">Orchestration plan</span>
      <span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface text-text-secondary font-mono">
        {{ plan.tasks.length }} task{{ plan.tasks.length !== 1 ? 's' : '' }}
      </span>
    </div>

    <!-- Analysis -->
    <p
      v-if="plan.analysis"
      class="px-4 py-3 text-text-secondary border-b border-border bg-surface/50"
    >
      {{ plan.analysis }}
    </p>

    <!-- Task list -->
    <ul class="divide-y divide-border">
      <li
        v-for="(task, i) in plan.tasks"
        :key="task.id"
        class="flex items-start gap-3 px-4 py-2.5 hover:bg-surface-hover transition"
      >
        <span class="shrink-0 w-5 h-5 rounded-full border border-border flex items-center justify-center text-[10px] tabular-nums text-text-secondary font-mono mt-0.5">
          {{ i + 1 }}
        </span>

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-0.5 text-xs">
            <UIcon :name="agentIcon(task.agentType)" class="w-3.5 h-3.5 text-text-secondary" />
            <span class="font-medium text-text-primary capitalize">{{ task.agentType }}</span>
            <span
              class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-mono"
              :class="complexityClass(task.complexity)"
            >
              {{ task.complexity }}
            </span>
            <span
              v-if="task.dependsOn?.length"
              class="text-text-faint text-[11px]"
            >
              ↳ after {{ task.dependsOn.join(', ') }}
            </span>
          </div>
          <p class="text-sm text-text-secondary">{{ task.prompt }}</p>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
interface PlanTask {
  id: string;
  agentType: string;
  prompt: string;
  complexity: string;
  dependsOn: string[];
}

interface OrchestratorPlan {
  analysis?: string;
  tasks: PlanTask[];
}

defineProps<{ plan: OrchestratorPlan }>();

function agentIcon(type: string): string {
  const icons: Record<string, string> = {
    orchestrator: 'i-ph-network-light',
    architect:    'i-ph-stack-light',
    backend:      'i-ph-hard-drives-light',
    frontend:     'i-ph-monitor-light',
    design:       'i-ph-palette-light',
    devops:       'i-ph-cube-light',
    document:     'i-ph-file-text-light',
    planner:      'i-ph-list-checks-light',
  };
  return icons[type] ?? 'i-ph-robot-light';
}

function complexityClass(c: string): string {
  const map: Record<string, string> = {
    trivial:  'bg-surface text-text-faint',
    simple:   'bg-completed-bg text-completed',
    standard: 'bg-running-bg text-running',
    complex:  'bg-pending-bg text-pending',
    expert:   'bg-failed-bg text-failed',
  };
  return map[c] ?? 'bg-surface text-text-secondary';
}
</script>
