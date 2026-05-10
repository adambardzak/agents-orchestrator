<!--
  Marketing animation: "Genesis" scene.

  A single central disc (the orchestrator) spawns 8 satellite discs
  (sub-agents) one by one with elastic spring physics. After all
  satellites have landed, a second pass draws thin connection lines
  from the center to each satellite — visualising the orchestrator →
  agent fan-out. The whole animation loops with a long pause + reverse
  collapse so it can be embedded as a hero element OR rendered to
  video.

  Node positions intentionally mirror the BrandLogo glyph (1 center
  + 8 satellites at 45° intervals on radius ≈ 200), so the closing
  frame visually matches the static brand mark.

  Props let marketing pick palette (light/dark) and embed mode
  (live loop vs single play, useful for ffmpeg renders).
-->
<template>
  <div
    class="genesis-stage"
    :class="[`palette-${palette}`]"
    :style="{ '--bg': bg, '--fg': fg, '--accent': accent }"
  >
    <svg
      ref="svgEl"
      :viewBox="`0 0 ${vb} ${vb}`"
      xmlns="http://www.w3.org/2000/svg"
      class="genesis-svg"
    >
      <defs>
        <radialGradient :id="gradId" cx="50%" cy="50%" r="50%">
          <stop offset="0%" :stop-color="fg" stop-opacity="1" />
          <stop offset="70%" :stop-color="fg" stop-opacity="0.95" />
          <stop offset="100%" :stop-color="fg" stop-opacity="0.65" />
        </radialGradient>

        <filter :id="glowId" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <!-- Connection lines (drawn after satellites land) -->
      <g ref="linesGroupEl" :stroke="accent" stroke-width="2.5" fill="none" opacity="0">
        <line
          v-for="(p, i) in satellites"
          :key="`line-${i}`"
          :x1="cx"
          :y1="cy"
          :x2="p.x"
          :y2="p.y"
          stroke-linecap="round"
          :ref="(el) => setLineRef(i, el as SVGLineElement | null)"
        />
      </g>

      <!-- Pulses traveling along each connection line (decorative bursts) -->
      <g ref="pulsesGroupEl" :fill="accent" opacity="0">
        <circle
          v-for="(_, i) in satellites"
          :key="`pulse-${i}`"
          :ref="(el) => setPulseRef(i, el as SVGCircleElement | null)"
          :cx="cx"
          :cy="cy"
          r="6"
        />
      </g>

      <!-- Satellite discs -->
      <g>
        <circle
          v-for="(p, i) in satellites"
          :key="`sat-${i}`"
          :ref="(el) => setSatRef(i, el as SVGCircleElement | null)"
          :cx="p.x"
          :cy="p.y"
          :r="rSat"
          :fill="`url(#${gradId})`"
          :filter="`url(#${glowId})`"
          opacity="0"
        />
      </g>

      <!-- Center disc, drawn last so it sits on top of any line endpoints -->
      <circle
        ref="centerEl"
        :cx="cx"
        :cy="cy"
        :r="rCenter"
        :fill="`url(#${gradId})`"
        :filter="`url(#${glowId})`"
        opacity="0"
      />
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import gsap from 'gsap';

interface Props {
  /** SVG viewBox edge size. Render-side: 1080 for 1080p, 1920 for 1080p HiDPI. */
  size?: number;
  /** 'dark' = white marks on near-black bg (matches app). 'light' = inverse. */
  palette?: 'dark' | 'light';
  /** If true, scene loops forever. If false, plays once and stops on the brand frame. */
  loop?: boolean;
  /** Accent color for connection lines / pulses. Defaults to indigo-500. */
  accentColor?: string;
}

const props = withDefaults(defineProps<Props>(), {
  size: 1080,
  palette: 'dark',
  loop: true,
  accentColor: '#818cf8',
});

const emit = defineEmits<{ (e: 'sequence-complete'): void }>();

const vb = computed(() => props.size);
const cx = computed(() => props.size / 2);
const cy = computed(() => props.size / 2);
const rCenter = computed(() => Math.round(props.size * 0.07)); // ≈ 76 @ 1080
const rSat = computed(() => Math.round(props.size * 0.055));   // ≈ 60 @ 1080

const bg = computed(() => (props.palette === 'dark' ? '#0d0d0d' : '#fafafa'));
const fg = computed(() => (props.palette === 'dark' ? '#ffffff' : '#0d0d0d'));
const accent = computed(() => props.accentColor);

const gradId = `genesis-grad-${Math.random().toString(36).slice(2, 8)}`;
const glowId = `genesis-glow-${Math.random().toString(36).slice(2, 8)}`;

// 8 satellites, evenly distributed on a circle of radius ~ 0.32 * size.
// First satellite at -90° (top) to read like a clock-face "12".
const satellites = computed(() => {
  const r = props.size * 0.32;
  const out: { x: number; y: number; angle: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 4;
    out.push({
      x: cx.value + Math.cos(angle) * r,
      y: cy.value + Math.sin(angle) * r,
      angle,
    });
  }
  return out;
});

// Element refs — arrays for satellites/lines/pulses.
const svgEl = ref<SVGSVGElement | null>(null);
const centerEl = ref<SVGCircleElement | null>(null);
const linesGroupEl = ref<SVGGElement | null>(null);
const pulsesGroupEl = ref<SVGGElement | null>(null);
const satRefs: (SVGCircleElement | null)[] = new Array(8).fill(null);
const lineRefs: (SVGLineElement | null)[] = new Array(8).fill(null);
const pulseRefs: (SVGCircleElement | null)[] = new Array(8).fill(null);

function setSatRef(i: number, el: SVGCircleElement | null) { satRefs[i] = el; }
function setLineRef(i: number, el: SVGLineElement | null) { lineRefs[i] = el; }
function setPulseRef(i: number, el: SVGCircleElement | null) { pulseRefs[i] = el; }

let tl: gsap.core.Timeline | null = null;

function buildTimeline(): gsap.core.Timeline {
  const sats = satellites.value;
  const t = gsap.timeline({
    repeat: props.loop ? -1 : 0,
    repeatDelay: 1.0,
    onComplete: () => emit('sequence-complete'),
  });

  // 1) Center disc materialises with a soft scale-up + glow ramp.
  t.fromTo(
    centerEl.value!,
    { opacity: 0, scale: 0, transformOrigin: '50% 50%' },
    {
      opacity: 1,
      scale: 1,
      duration: 0.8,
      ease: 'back.out(2.4)',
    },
    0,
  );

  // 2) Satellites spawn outward one by one with elastic overshoot.
  //    Each starts at the center and arcs to its target with spring.
  sats.forEach((s, i) => {
    const el = satRefs[i];
    if (!el) return;
    const startX = cx.value - s.x;
    const startY = cy.value - s.y;
    t.fromTo(
      el,
      {
        x: startX,
        y: startY,
        scale: 0,
        opacity: 0,
        transformOrigin: '50% 50%',
      },
      {
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
        duration: 1.1,
        ease: 'elastic.out(1, 0.55)',
      },
      0.45 + i * 0.09,
    );
  });

  // 3) Connection lines fade in & stretch from center to satellite.
  t.set(linesGroupEl.value!, { opacity: 1 }, '+=0.1');
  sats.forEach((s, i) => {
    const line = lineRefs[i];
    if (!line) return;
    const len = Math.hypot(s.x - cx.value, s.y - cy.value);
    gsap.set(line, { strokeDasharray: len, strokeDashoffset: len });
    t.to(
      line,
      { strokeDashoffset: 0, duration: 0.55, ease: 'power2.out' },
      `<${i * 0.04}`,
    );
  });

  // 4) Pulses race outward along each line (parallel) — feels like
  //    the orchestrator "dispatching" work to its agents.
  t.set(pulsesGroupEl.value!, { opacity: 1 }, '+=0.2');
  sats.forEach((s, i) => {
    const p = pulseRefs[i];
    if (!p) return;
    t.fromTo(
      p,
      { attr: { cx: cx.value, cy: cy.value }, opacity: 1, scale: 1 },
      {
        attr: { cx: s.x, cy: s.y },
        opacity: 0,
        scale: 1.6,
        duration: 0.7,
        ease: 'power2.in',
        transformOrigin: '50% 50%',
      },
      `<${i * 0.05}`,
    );
  });

  // 5) Brief satellite "ack" pulse — each satellite scales up then back.
  t.to(
    satRefs.filter(Boolean),
    {
      scale: 1.18,
      duration: 0.18,
      ease: 'power2.out',
      stagger: 0.04,
      transformOrigin: '50% 50%',
    },
    '<0.3',
  ).to(
    satRefs.filter(Boolean),
    {
      scale: 1,
      duration: 0.35,
      ease: 'elastic.out(1.1, 0.6)',
      stagger: 0.04,
      transformOrigin: '50% 50%',
    },
    '>',
  );

  // 6) Hold the final composition (logo-like) so it reads as the brand.
  t.to({}, { duration: 1.2 });

  // 7) If looping, collapse everything back to center for a clean restart.
  if (props.loop) {
    t.to(
      [linesGroupEl.value!, pulsesGroupEl.value!],
      { opacity: 0, duration: 0.4, ease: 'power1.in' },
      '+=0',
    );
    sats.forEach((s, i) => {
      const el = satRefs[i];
      if (!el) return;
      t.to(
        el,
        {
          x: cx.value - s.x,
          y: cy.value - s.y,
          scale: 0,
          opacity: 0,
          duration: 0.55,
          ease: 'power2.in',
        },
        `<${i * 0.03}`,
      );
    });
    t.to(
      centerEl.value!,
      { scale: 0, opacity: 0, duration: 0.4, ease: 'power2.in' },
      '<0.2',
    );
  }

  return t;
}

onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return; // do nothing — show static initial frame (everything opacity:0).
  }
  tl = buildTimeline();
});

onBeforeUnmount(() => {
  if (tl) tl.kill();
});
</script>

<style scoped>
.genesis-stage {
  width: 100%;
  height: 100%;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
}
.genesis-svg {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
}
</style>
