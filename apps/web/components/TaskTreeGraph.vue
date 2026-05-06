<script setup lang="ts">
/**
 * Real tree/DAG visualisation of an orchestrator pipeline with SVG connectors,
 * zoom/pan, and a sticky orchestrator card.
 *
 * Layout:
 *   • Sticky top band: orchestrator card (always visible while scrolling).
 *   • Pannable/zoomable canvas below: planners + their layered ticket sub-trees.
 *   • SVG overlay draws Bezier connectors between parent → child cards by
 *     measuring DOM positions after layout.
 *
 * Interaction:
 *   • Wheel = scroll. Ctrl/Cmd + wheel = zoom (0.4 – 1.6).
 *   • Drag empty canvas = pan. Drag on a card = no pan (click works).
 *   • Toolbar: zoom in/out/reset.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { AgentTask } from '@agent-orchestrator/shared';
import type { TimestampedEvent } from '~/stores/session';

const props = defineProps<{
  tasks: AgentTask[];
  /** Map taskId → events array (for showing "last activity") */
  eventsByTask: Map<string, TimestampedEvent[]>;
}>();

const emit = defineEmits<{
  (e: 'inspect', task: AgentTask): void;
  (e: 'inject',  task: AgentTask): void;
}>();

// ── Style helpers ─────────────────────────────────────────────────────────
const AGENT_COLORS: Record<string, string> = {
  orchestrator: 'text-accent',
  planner:      'text-completed',
  architect:    'text-secondary',
  backend:      'text-running',
  frontend:     'text-running',
  design:       'text-pending',
  qa:           'text-pending',
  'visual-qa':  'text-pending',
  document:     'text-text-secondary',
  infra:        'text-completed',
  seo:          'text-secondary',
};
function agentColor(type: string): string {
  return AGENT_COLORS[type] ?? 'text-text-primary';
}

function statusBg(status: string): string {
  switch (status) {
    case 'running':           return 'bg-running-bg ring-1 ring-running/40 hover:ring-running/60';
    case 'completed':         return 'bg-surface-elevated ring-1 ring-completed/30 hover:ring-completed/50';
    case 'failed':            return 'bg-failed-bg ring-1 ring-failed/40 hover:ring-failed/60';
    case 'awaiting_approval': return 'bg-pending-bg ring-1 ring-pending/40';
    case 'pending':           return 'bg-surface-elevated ring-1 ring-border opacity-70';
    default:                  return 'bg-surface-elevated ring-1 ring-border';
  }
}

function statusDot(status: string): string {
  switch (status) {
    case 'running':           return 'bg-running animate-pulse';
    case 'completed':         return 'bg-completed';
    case 'failed':            return 'bg-failed';
    case 'pending':
    case 'awaiting_approval': return 'bg-pending';
    default:                  return 'bg-text-faint';
  }
}

function connectorStroke(status: string): string {
  switch (status) {
    case 'running':   return 'var(--color-running, #38bdf8)';
    case 'completed': return 'var(--color-completed, #34d399)';
    case 'failed':    return 'var(--color-failed, #f87171)';
    default:          return 'var(--color-border, #2a2a2a)';
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

/**
 * Try to extract a human-readable preview from a raw agent message.
 * Agents often emit fenced JSON (```json … ```) with `analysis` (orchestrator)
 * or `tickets: [{ title }]` (planners). Falls back to the raw text.
 */
function humanizeAgentMessage(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();

  // Strip markdown JSON fences: ```json ... ```
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  let body = fenced ? fenced[1] : trimmed;
  body = (body ?? '').trim();

  // Find the first JSON object substring if present
  const start = body.indexOf('{');
  const end   = body.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const candidate = body.slice(start, end + 1);
    try {
      const obj = JSON.parse(candidate) as Record<string, unknown>;

      // Orchestrator-style: { analysis: "…", tasks: [...] }
      if (typeof obj['analysis'] === 'string' && obj['analysis']) {
        const analysis = obj['analysis'] as string;
        const tasks    = Array.isArray(obj['tasks']) ? (obj['tasks'] as unknown[]).length : 0;
        return tasks > 0 ? `${analysis} · ${tasks} task${tasks === 1 ? '' : 's'}` : analysis;
      }

      // Planner-style: { tickets: [{ title, ... }, …] }
      if (Array.isArray(obj['tickets'])) {
        const tickets = obj['tickets'] as Array<Record<string, unknown>>;
        const first   = tickets[0];
        const firstTitle = first && typeof first['title'] === 'string' ? (first['title'] as string) : '';
        if (firstTitle) {
          return tickets.length > 1
            ? `${firstTitle} (+${tickets.length - 1} more)`
            : firstTitle;
        }
        return `${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`;
      }

      // Generic fallbacks: summary / title / description
      for (const key of ['summary', 'title', 'description', 'message']) {
        const v = obj[key];
        if (typeof v === 'string' && v) return v;
      }
    } catch {
      // not valid JSON — fall through
    }
  }

  return body;
}

/**
 * Build a short, human-readable description of a tool invocation. Falls back
 * to the bare tool name when no useful context is available.
 *
 * Different agents/tools name parameters differently — `bash` uses `command`,
 * `read`/`write`/`edit` use `path`/`file_path`, `glob`/`grep` use `pattern`,
 * `webfetch` uses `url`, etc. We try the most informative field per tool.
 */
function describeToolCall(name: string, input: Record<string, unknown>): string {
  const lower = name.toLowerCase();
  const path  = (input['path'] ?? input['file_path'] ?? input['filename']) as string | undefined;
  const cmd   = input['command'] as string | undefined;
  const ptn   = input['pattern'] as string | undefined;
  const url   = input['url']     as string | undefined;
  const desc  = input['description'] as string | undefined;
  const todos = input['todos'] as Array<unknown> | undefined;

  // Bash — show the actual command (or its description if very long)
  if (lower === 'bash') {
    const text = (cmd && typeof cmd === 'string')
      ? cmd
      : (typeof desc === 'string' ? desc : '');
    return text ? `$ ${truncate(stripNewlines(text), 60)}` : 'bash';
  }

  // Edit / Write / Read / View — show the file path
  if (['edit', 'write', 'read', 'view', 'open', 'multiedit', 'str_replace'].includes(lower)) {
    return path ? `${name}: ${truncate(path, 55)}` : name;
  }

  // Glob / Grep — show the search pattern (and optional path)
  if (['glob', 'grep', 'search', 'find'].includes(lower)) {
    if (ptn) {
      const where = path ? ` in ${truncate(path, 25)}` : '';
      return `${name}: ${truncate(ptn, 40)}${where}`;
    }
    return name;
  }

  // WebFetch / WebSearch — show URL or query
  if (lower === 'webfetch' || lower === 'fetch') {
    return url ? `fetch: ${truncate(url, 55)}` : 'fetch';
  }
  if (lower === 'websearch' || lower === 'search_web') {
    const q = input['query'] as string | undefined;
    return q ? `search: ${truncate(q, 55)}` : 'search';
  }

  // TodoWrite — count
  if (lower === 'todowrite' || lower === 'todo_write') {
    const n = Array.isArray(todos) ? todos.length : 0;
    return n > 0 ? `todo: ${n} item${n === 1 ? '' : 's'}` : 'todo';
  }

  // Task / sub-agent dispatch
  if (lower === 'task' || lower === 'dispatch') {
    const subDesc = (input['description'] ?? input['prompt']) as string | undefined;
    return subDesc ? `task: ${truncate(stripNewlines(subDesc), 55)}` : 'task';
  }

  // Generic fallback: prefer path, then command, then any string-valued field.
  if (path) return `${name}: ${truncate(path, 55)}`;
  if (cmd)  return `${name}: ${truncate(stripNewlines(cmd), 55)}`;
  if (typeof desc === 'string' && desc) return `${name}: ${truncate(desc, 55)}`;

  // Last resort — first stringy value in the input.
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.trim()) {
      return `${name}: ${truncate(stripNewlines(v), 55)}`;
    }
  }
  return name;
}

function stripNewlines(s: string): string {
  return s.replace(/\s*\n+\s*/g, ' ').trim();
}

function activityLine(task: AgentTask): string {
  const events = props.eventsByTask.get(task.id) ?? [];

  if (task.status === 'pending') {
    if (task.dependsOn.length > 0) {
      const labels = task.dependsOn
        .map((id) => {
          const dep = props.tasks.find((t) => t.id === id);
          return dep ? dep.agentType : id.slice(0, 6);
        })
        .join(', ');
      return `Waiting: ${labels}`;
    }
    return 'Queued…';
  }
  if (task.status === 'awaiting_approval') return 'Approval needed';
  if (events.length === 0) return task.status === 'running' ? 'Starting…' : '';

  if (task.status === 'completed') {
    const done = [...events].reverse().find((e) => e.type === 'complete');
    if (done && 'summary' in done && done.summary) {
      return truncate(humanizeAgentMessage(String(done.summary)), 70);
    }
  }

  const lastTool = [...events].reverse().find((e) => e.type === 'tool_use');
  if (lastTool && 'input' in lastTool) {
    const name  = ((lastTool as { name?: string }).name ?? '?');
    const input = (lastTool.input ?? {}) as Record<string, unknown>;
    return describeToolCall(name, input);
  }

  const lastMsg = [...events].reverse().find((e) => e.type === 'message');
  if (lastMsg && 'content' in lastMsg && lastMsg.content) {
    return truncate(humanizeAgentMessage(String(lastMsg.content)), 70);
  }

  return '';
}

// ── Tree construction ─────────────────────────────────────────────────────────

interface TaskGroup {
  /** parent task (planner) */
  root: AgentTask;
  /** Layered grid of ticket-bound children. layers[L] = parallel siblings at depth L. */
  layers: AgentTask[][];
}

interface TopGroup {
  orchestrator: AgentTask;
  /** planner / direct-worker cards in row 1, parallel */
  directChildren: AgentTask[];
  /** for each planner: its own ticket-task sub-tree */
  plannerGroups: TaskGroup[];
}

const tree = computed<TopGroup | null>(() => {
  const tasks = props.tasks;
  const orchestrator = tasks.find((t) => t.agentType === 'orchestrator');
  if (!orchestrator) return null;

  const planners = tasks.filter((t) => t.agentType === 'planner');
  const plannerIds = new Set(planners.map((p) => p.id));

  const directChildren = tasks.filter((t) => {
    if (t.id === orchestrator.id) return false;
    if (t.agentType === 'planner') return true;
    return !t.ticketId && !plannerIds.has(t.id);
  });

  const plannerGroups: TaskGroup[] = planners.map((planner) => {
    const childTasks = tasks.filter((t) =>
      t.ticketId
      && planner.targetAgentType
      && t.agentType === planner.targetAgentType,
    );

    const childIds = new Set(childTasks.map((c) => c.id));
    const rank = new Map<string, number>();
    function rankOf(t: AgentTask): number {
      if (rank.has(t.id)) return rank.get(t.id)!;
      const inBatchDeps = t.dependsOn.filter((d) => childIds.has(d));
      if (inBatchDeps.length === 0) {
        rank.set(t.id, 0);
        return 0;
      }
      let maxParent = -1;
      for (const d of inBatchDeps) {
        const dep = childTasks.find((c) => c.id === d);
        if (dep) maxParent = Math.max(maxParent, rankOf(dep));
      }
      const r = maxParent + 1;
      rank.set(t.id, r);
      return r;
    }
    childTasks.forEach(rankOf);

    const layerMap = new Map<number, AgentTask[]>();
    for (const t of childTasks) {
      const r = rank.get(t.id) ?? 0;
      if (!layerMap.has(r)) layerMap.set(r, []);
      layerMap.get(r)!.push(t);
    }
    const layers: AgentTask[][] = [];
    const sortedRanks = [...layerMap.keys()].sort((a, b) => a - b);
    for (const r of sortedRanks) {
      const arr = layerMap.get(r)!.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      layers.push(arr);
    }
    return { root: planner, layers };
  });

  const directNonPlanners = directChildren.filter((c) => c.agentType !== 'planner');

  return {
    orchestrator,
    directChildren: [...planners, ...directNonPlanners],
    plannerGroups,
  };
});

function plannerGroupFor(plannerId: string) {
  return tree.value?.plannerGroups.find((g) => g.root.id === plannerId) ?? null;
}

function ticketLabel(taskId: string): string | null {
  const t = props.tasks.find((x) => x.id === taskId);
  if (!t?.ticketId) return null;
  return `#${t.ticketId.slice(0, 6)}`;
}

// ── Edge model: parent→child relations to draw ───────────────────────────
interface Edge { from: string; to: string; status: string; }

const edges = computed<Edge[]>(() => {
  const t = tree.value;
  if (!t) return [];
  const list: Edge[] = [];
  // orchestrator → each direct child (use anchor as visual source)
  const orchSrc = t.orchestrator.id + '__anchor';
  for (const child of t.directChildren) {
    list.push({ from: orchSrc, to: child.id, status: child.status });
  }
  // planner → first layer; layer N → layer N+1 by dep
  for (const group of t.plannerGroups) {
    if (group.layers.length === 0) continue;
    // planner → all in layer 0
    for (const top of group.layers[0]!) {
      list.push({ from: group.root.id, to: top.id, status: top.status });
    }
    // For each task in layer ≥ 1, draw edge from each in-batch dep
    const allChildIds = new Set(group.layers.flat().map((c) => c.id));
    for (let li = 1; li < group.layers.length; li++) {
      for (const t2 of group.layers[li]!) {
        const inBatchDeps = t2.dependsOn.filter((d) => allChildIds.has(d));
        if (inBatchDeps.length === 0) {
          // attach to planner if no in-batch deps remain
          list.push({ from: group.root.id, to: t2.id, status: t2.status });
        } else {
          for (const d of inBatchDeps) {
            list.push({ from: d, to: t2.id, status: t2.status });
          }
        }
      }
    }
  }
  return list;
});

// ── Position measurement ─────────────────────────────────────────────────
const cardRefs = ref(new Map<string, HTMLElement>());
function setCardRef(id: string, el: Element | null) {
  if (el instanceof HTMLElement) cardRefs.value.set(id, el);
  else cardRefs.value.delete(id);
}

const canvasRef = ref<HTMLDivElement | null>(null);
const positions = reactive<Map<string, { x: number; y: number; w: number; h: number }>>(new Map());
const canvasSize = reactive({ w: 0, h: 0 });

function measure() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const cRect = canvas.getBoundingClientRect();
  positions.clear();
  let maxRight = 0;
  let maxBottom = 0;
  for (const [id, el] of cardRefs.value) {
    if (!el.isConnected) continue;
    const r = el.getBoundingClientRect();
    // Account for current zoom: positions in canvas's untransformed coords
    const x = (r.left - cRect.left) / scale.value;
    const y = (r.top  - cRect.top)  / scale.value;
    const w = r.width  / scale.value;
    const h = r.height / scale.value;
    positions.set(id, { x, y, w, h });
    if (x + w > maxRight)  maxRight  = x + w;
    if (y + h > maxBottom) maxBottom = y + h;
  }
  canvasSize.w = maxRight  + 40;
  canvasSize.h = maxBottom + 40;
}

let ro: ResizeObserver | null = null;
let measureRaf = 0;
function scheduleMeasure() {
  cancelAnimationFrame(measureRaf);
  measureRaf = requestAnimationFrame(() => measure());
}

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => scheduleMeasure());
    if (canvasRef.value) ro.observe(canvasRef.value);
  }
  scheduleMeasure();
});

onBeforeUnmount(() => {
  ro?.disconnect();
  cancelAnimationFrame(measureRaf);
});

// Re-measure after props change & DOM updates
watch(
  () => [props.tasks.length, props.tasks.map((t) => t.status).join(','), tree.value?.directChildren.length].join('|'),
  async () => { await nextTick(); scheduleMeasure(); },
);

// ── Connector path generator (vertical Bezier) ───────────────────────────
function pathFor(edge: Edge): string {
  const a = positions.get(edge.from);
  const b = positions.get(edge.to);
  if (!a || !b) return '';
  // Bottom-center of source → top-center of target
  const x1 = a.x + a.w / 2;
  const y1 = a.y + a.h;
  const x2 = b.x + b.w / 2;
  const y2 = b.y;
  const dy = Math.max(20, (y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
}

// ── Zoom & Pan ───────────────────────────────────────────────────────────
const scale = ref(1);
const pan = reactive({ x: 0, y: 0 });
const MIN_SCALE = 0.4;
const MAX_SCALE = 1.6;

function setScale(next: number) {
  const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
  if (clamped === scale.value) return;
  scale.value = clamped;
  scheduleMeasure();
}

function onWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setScale(scale.value * factor);
  }
}

let isPanning = false;
let panStart = { x: 0, y: 0, panX: 0, panY: 0 };

function onPanStart(e: PointerEvent) {
  // Only pan when starting on the canvas background (not on a card)
  const target = e.target as HTMLElement;
  if (target.closest('[data-card]')) return;
  isPanning = true;
  panStart = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onPanMove(e: PointerEvent) {
  if (!isPanning) return;
  pan.x = panStart.panX + (e.clientX - panStart.x);
  pan.y = panStart.panY + (e.clientY - panStart.y);
}

function onPanEnd(e: PointerEvent) {
  if (!isPanning) return;
  isPanning = false;
  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
}

function resetView() {
  scale.value = 1;
  pan.x = 0;
  pan.y = 0;
  scheduleMeasure();
}
</script>

<template>
  <div v-if="tree" class="relative">

    <!-- ── Sticky orchestrator band (always visible) ─────────────────── -->
    <div class="sticky top-0 z-20 bg-surface/90 backdrop-blur-sm py-2 mb-3 border-b border-border">
      <div class="flex items-center justify-between gap-3">
        <div
          :ref="(el) => setCardRef(tree.orchestrator.id, el as Element | null)"
          data-card
          class="rounded-md px-3.5 py-2.5 min-w-[260px] max-w-[420px] cursor-pointer transition"
          :class="[statusBg(tree.orchestrator.status)]"
          @click="emit('inspect', tree.orchestrator)"
        >
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full" :class="statusDot(tree.orchestrator.status)" />
            <span class="font-semibold text-[10px] uppercase tracking-wider" :class="agentColor(tree.orchestrator.agentType)">
              {{ tree.orchestrator.agentType }}
            </span>
            <span class="text-[10px] text-text-faint ml-auto font-mono tabular-nums">
              ${{ tree.orchestrator.costUsd.toFixed(4) }}
            </span>
          </div>
          <p class="text-xs text-text-secondary mt-1 leading-snug min-h-[1.5em]">
            {{ activityLine(tree.orchestrator) || '—' }}
          </p>
        </div>

        <!-- Zoom toolbar -->
        <div class="flex items-center gap-1 text-text-faint">
          <button
            class="p-1.5 rounded hover:bg-surface-elevated transition"
            title="Zoom out"
            @click="setScale(scale * 0.9)"
          >
            <UIcon name="i-ph-minus-light" class="w-3.5 h-3.5" />
          </button>
          <button
            class="px-2 py-1 rounded hover:bg-surface-elevated transition text-[10px] font-mono tabular-nums min-w-[48px]"
            title="Reset view"
            @click="resetView"
          >
            {{ Math.round(scale * 100) }}%
          </button>
          <button
            class="p-1.5 rounded hover:bg-surface-elevated transition"
            title="Zoom in"
            @click="setScale(scale * 1.1)"
          >
            <UIcon name="i-ph-plus-light" class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>

    <!-- ── Pan/zoom viewport ─────────────────────────────────────────── -->
    <div
      class="relative overflow-hidden touch-none select-none"
      :style="{ minHeight: '320px', cursor: isPanning ? 'grabbing' : 'grab' }"
      @wheel="onWheel"
      @pointerdown="onPanStart"
      @pointermove="onPanMove"
      @pointerup="onPanEnd"
      @pointercancel="onPanEnd"
    >
      <!-- Transformed canvas -->
      <div
        ref="canvasRef"
        class="origin-top-left"
        :style="{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          width:  canvasSize.w ? `${canvasSize.w}px` : 'max-content',
          height: canvasSize.h ? `${canvasSize.h}px` : 'auto',
        }"
      >
        <!-- SVG connectors overlay -->
        <svg
          class="absolute inset-0 pointer-events-none"
          :width="canvasSize.w || '100%'"
          :height="canvasSize.h || '100%'"
        >
          <path
            v-for="(e, i) in edges"
            :key="i"
            :d="pathFor(e)"
            fill="none"
            :stroke="connectorStroke(e.status)"
            :stroke-width="e.status === 'running' ? 1.6 : 1"
            :stroke-dasharray="e.status === 'pending' ? '3 3' : ''"
            :opacity="e.status === 'pending' ? 0.5 : 0.85"
          />
        </svg>

        <!-- Phantom orchestrator anchor for connector geometry only -->
        <!-- We need something at the top of the canvas at the same X as the sticky orchestrator
             for edges to land on. Use a 1px point anchor positioned at left=200, top=0. -->
        <div
          :ref="(el) => setCardRef(tree.orchestrator.id + '__anchor', el as Element | null)"
          class="absolute"
          style="left: 200px; top: 0; width: 1px; height: 1px;"
        />

        <!-- Tier 2: planners + non-ticket workers (parallel row) -->
        <div class="flex items-start gap-8 flex-wrap justify-start pt-6 pl-2 pr-8 pb-8 min-w-fit">
          <div
            v-for="child in tree.directChildren"
            :key="child.id"
            class="flex flex-col items-center gap-3"
          >
            <div
              :ref="(el) => setCardRef(child.id, el as Element | null)"
              data-card
              class="rounded-md px-3 py-2 min-w-[240px] max-w-[300px] cursor-pointer transition relative group"
              :class="[statusBg(child.status)]"
              @click="emit('inspect', child)"
            >
              <div class="flex items-center gap-2">
                <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="statusDot(child.status)" />
                <span class="font-semibold text-[10px] uppercase tracking-wider" :class="agentColor(child.agentType)">
                  {{ child.agentType }}
                </span>
                <span v-if="child.targetAgentType" class="text-[10px] text-text-faint">→ {{ child.targetAgentType }}</span>
                <span v-if="child.costUsd > 0" class="text-[10px] text-text-faint ml-auto font-mono tabular-nums">
                  ${{ child.costUsd.toFixed(4) }}
                </span>
              </div>
              <p class="text-[11px] text-text-secondary mt-1 leading-snug min-h-[1.4em]">
                {{ activityLine(child) || '—' }}
              </p>
              <button
                v-if="child.status === 'running'"
                class="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 bg-accent/30 hover:bg-accent/50 rounded-full p-1 transition"
                title="Inject context"
                @click.stop="emit('inject', child)"
              >
                <UIcon name="i-ph-syringe-light" class="w-3 h-3 text-accent" />
              </button>
            </div>

            <!-- Sub-tree if planner with ticket children -->
            <template v-if="child.agentType === 'planner' && plannerGroupFor(child.id)">
              <div
                v-for="(layer, li) in plannerGroupFor(child.id)!.layers"
                :key="li"
                class="flex items-start gap-3 flex-wrap justify-center"
              >
                <div
                  v-for="t in layer"
                  :key="t.id"
                  :ref="(el) => setCardRef(t.id, el as Element | null)"
                  data-card
                  class="rounded-md px-2.5 py-1.5 min-w-[180px] max-w-[240px] cursor-pointer transition relative group"
                  :class="[statusBg(t.status)]"
                  @click="emit('inspect', t)"
                >
                  <div class="flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="statusDot(t.status)" />
                    <span class="font-semibold text-[10px] uppercase tracking-wider" :class="agentColor(t.agentType)">
                      {{ t.agentType }}
                    </span>
                    <span v-if="ticketLabel(t.id)" class="text-[9px] font-mono text-text-faint">
                      {{ ticketLabel(t.id) }}
                    </span>
                    <span
                      v-if="t.status === 'running' && t.maxSteps"
                      class="text-[9px] text-text-faint font-mono ml-auto tabular-nums"
                    >
                      {{ t.currentStep }}/{{ t.maxSteps }}
                    </span>
                    <span v-else-if="t.costUsd > 0" class="text-[9px] text-text-faint ml-auto font-mono tabular-nums">
                      ${{ t.costUsd.toFixed(4) }}
                    </span>
                  </div>
                  <p class="text-[10.5px] text-text-secondary mt-0.5 leading-snug min-h-[1.3em]">
                    {{ activityLine(t) || '—' }}
                  </p>
                  <button
                    v-if="t.status === 'running'"
                    class="absolute -top-1.5 -right-1.5 opacity-0 group-hover:opacity-100 bg-accent/30 hover:bg-accent/50 rounded-full p-0.5 transition"
                    title="Inject context"
                    @click.stop="emit('inject', t)"
                  >
                    <UIcon name="i-ph-syringe-light" class="w-2.5 h-2.5 text-accent" />
                  </button>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>
