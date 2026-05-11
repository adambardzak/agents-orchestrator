<!--
  Animated brand mark with three motion modes:

  • mode="draw"   — one-shot draw-on stroke reveal that ends with the path
                    filled (used for splash screens and auth pages).
  • mode="pulse"  — subtle infinite "breathing" loop. Used in the sidebar
                    when no agent task is running (passive idle state).
  • mode="active" — faster, glowing pulse used while at least one agent
                    task is in flight. Drop-in replacement for "pulse"
                    that pops more — communicates "agents are thinking".
  • mode="static" — no animation; same look as <BrandLogo />.

  Color is inherited from `currentColor`, so wrap with `text-*` to color
  the mark. Stroke width scales with `viewBox` (680 units) and is tuned
  to feel right at any size from 24px to 240px.
-->
<template>
  <svg
    ref="svgEl"
    viewBox="0 0 680 680"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="Orchestrator"
    role="img"
    :class="['brand-mark', { 'is-active': mode === 'active', 'is-pulse': mode === 'pulse' }]"
  >
    <!--
      Filled copy of the path. Always rendered with `currentColor`.
      In draw mode its opacity is animated from 0 → 1 as the stroke
      finishes drawing; in every other mode it shows immediately.
      No mask is involved — earlier revisions tried a radial-mask reveal
      but the mask coord system fought the path's translate/scale
      transform and could leave the logo invisible if the timeline was
      interrupted by a re-render. Plain opacity cross-fade is robust.
    -->
    <g transform="translate(0,680) scale(0.033333,-0.033333)">
      <path
        ref="fillPathEl"
        fill="currentColor"
        stroke="none"
        :d="logoPath"
      />
    </g>

    <!--
      Stroke copy of the path drawn on top. In draw mode this is what
      the user sees being "painted" before the fill cross-fades in.
      In other modes it's invisible (stroke-width 0).
    -->
    <g transform="translate(0,680) scale(0.033333,-0.033333)">
      <path
        ref="strokePathEl"
        fill="none"
        stroke="currentColor"
        :stroke-width="mode === 'draw' ? 140 : 0"
        stroke-linecap="round"
        stroke-linejoin="round"
        :d="logoPath"
      />
    </g>
  </svg>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import gsap from 'gsap';

interface Props {
  mode?: 'draw' | 'pulse' | 'active' | 'static';
  /** Total draw timeline duration (sec). */
  drawDuration?: number;
  /** Delay before draw starts (sec). */
  drawDelay?: number;
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'static',
  drawDuration: 1.6,
  drawDelay: 0,
});

const emit = defineEmits<{ (e: 'draw-complete'): void }>();

// Verbatim copy of the logo glyph path; kept as a const string so both
// the stroke and fill copies stay perfectly in sync.
const logoPath = `M13593 18520 c-995 -97 -1816 -801 -2052 -1760 -102 -415 -93 -801
29 -1320 159 -676 155 -649 154 -925 0 -188 -3 -235 -22 -321 -67 -309 -206
-569 -416 -780 -166 -166 -331 -266 -565 -344 -160 -53 -300 -83 -667 -140
-173 -28 -419 -68 -547 -90 -354 -60 -493 -73 -692 -67 -247 8 -407 47 -608
147 -363 182 -710 535 -900 915 -121 243 -170 419 -263 940 -68 384 -135 607
-254 845 -106 211 -228 377 -397 541 -506 491 -1241 669 -1915 465 -849 -258
-1420 -1055 -1385 -1936 25 -638 347 -1209 882 -1563 128 -85 345 -189 504
-240 172 -57 309 -87 640 -143 407 -69 566 -107 743 -178 528 -213 997 -680
1153 -1149 62 -188 70 -245 70 -517 -1 -213 -4 -270 -28 -440 -86 -603 -91
-673 -89 -1238 2 -472 -4 -620 -34 -782 -37 -200 -130 -419 -251 -590 -83
-116 -321 -358 -462 -469 -242 -192 -547 -366 -780 -446 -215 -73 -388 -108
-776 -155 -515 -62 -726 -116 -1004 -256 -163 -82 -280 -163 -407 -278 -455
-417 -661 -1053 -534 -1654 113 -537 472 -993 965 -1228 616 -293 1343 -202
1878 233 96 79 241 234 316 339 147 207 235 385 376 764 115 310 165 432 232
564 116 225 252 406 459 606 325 315 691 537 1015 615 299 71 560 50 1042 -86
692 -195 914 -233 1357 -233 280 -1 367 6 794 65 470 64 620 70 853 33 576
-89 1106 -597 1257 -1205 47 -187 56 -290 66 -719 12 -543 28 -707 96 -979 49
-199 104 -347 195 -530 168 -339 400 -628 684 -854 938 -750 2252 -750 3190 0
476 380 812 949 914 1551 139 817 -125 1648 -709 2232 -301 301 -687 529
-1092 646 -306 88 -446 104 -1008 114 -479 9 -594 17 -764 52 -518 106 -973
488 -1167 980 -32 81 -67 234 -80 348 -17 147 -5 364 31 610 70 464 79 530 91
650 17 159 17 581 0 725 -41 357 -125 681 -262 1010 -28 66 -122 266 -209 445
-217 445 -281 618 -311 845 -15 117 -6 334 20 445 65 284 194 514 405 726 226
226 398 320 971 534 392 147 634 270 857 437 229 172 402 355 557 589 192 289
313 606 367 964 25 160 24 481 0 645 -100 669 -464 1244 -1022 1614 -287 191
-613 316 -954 366 -130 19 -414 27 -537 15z`;

const svgEl = ref<SVGSVGElement | null>(null);
const fillPathEl = ref<SVGPathElement | null>(null);
const strokePathEl = ref<SVGPathElement | null>(null);

let activeTl: gsap.core.Timeline | null = null;

function killTimeline() {
  if (activeTl) {
    activeTl.kill();
    activeTl = null;
  }
}

function runDraw() {
  const stroke = strokePathEl.value;
  const fill = fillPathEl.value;
  if (!stroke || !fill) return;

  const len = stroke.getTotalLength();

  // Initial: stroke fully hidden along its length, fill invisible.
  gsap.set(stroke, {
    strokeDasharray: len,
    strokeDashoffset: len,
    strokeOpacity: 1,
  });
  gsap.set(fill, { opacity: 0 });

  killTimeline();
  activeTl = gsap.timeline({
    delay: props.drawDelay,
    onComplete: () => {
      // Hard-force the final visible state so the logo can never end up
      // invisible — even if the timeline is interrupted by HMR or a
      // mode change at the wrong moment.
      gsap.set(fill, { opacity: 1 });
      gsap.set(stroke, { strokeOpacity: 0 });
      emit('draw-complete');
    },
  });

  // 1) Trace the stroke around the path.
  activeTl.to(stroke, {
    strokeDashoffset: 0,
    duration: props.drawDuration,
    ease: 'power2.inOut',
  }, 0);

  // 2) Cross-fade the filled glyph in once the trace is ~60% done — it
  //    feels like the outline is "filling itself in" without the
  //    radial-mask coordinate-system fragility of the previous revision.
  activeTl.to(fill, {
    opacity: 1,
    duration: props.drawDuration * 0.5,
    ease: 'power1.out',
  }, props.drawDuration * 0.55);

  // 3) Fade the stroke out as the fill takes over so the final frame is
  //    just the clean filled logo with no double-stroke artefact.
  activeTl.to(stroke, {
    strokeOpacity: 0,
    duration: 0.35,
    ease: 'power1.out',
  }, props.drawDuration - 0.05);
}

function runPulse(active: boolean) {
  const fill = fillPathEl.value;
  const stroke = strokePathEl.value;
  if (!fill || !stroke || !svgEl.value) return;

  // Force the logo to its fully revealed look before pulsing.
  // No mask in pulse mode — fill is unrestricted.
  gsap.set(stroke, { strokeDasharray: 'none', strokeDashoffset: 0, strokeOpacity: 0 });
  gsap.set(fill, { opacity: 1 });

  killTimeline();
  activeTl = gsap.timeline({ repeat: -1, yoyo: true });
  activeTl.to(svgEl.value, {
    scale: active ? 1.08 : 1.04,
    opacity: active ? 1 : 0.85,
    filter: active
      ? 'drop-shadow(0 0 6px currentColor)'
      : 'drop-shadow(0 0 0 transparent)',
    duration: active ? 0.7 : 1.4,
    ease: 'sine.inOut',
    transformOrigin: '50% 50%',
  });
}

function runStatic() {
  const fill = fillPathEl.value;
  const stroke = strokePathEl.value;
  if (!fill || !stroke || !svgEl.value) return;

  killTimeline();
  // No mask in static mode — fill renders directly.
  gsap.set(stroke, { strokeDasharray: 'none', strokeDashoffset: 0, strokeOpacity: 0 });
  gsap.set(fill, { opacity: 1 });
  gsap.set(svgEl.value, { scale: 1, opacity: 1, filter: 'none' });
}

function applyMode() {
  switch (props.mode) {
    case 'draw':
      runDraw();
      break;
    case 'pulse':
      runPulse(false);
      break;
    case 'active':
      runPulse(true);
      break;
    case 'static':
    default:
      runStatic();
  }
}

onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    runStatic();
    if (props.mode === 'draw') emit('draw-complete');
    return;
  }
  applyMode();
});

watch(() => props.mode, applyMode);

onBeforeUnmount(killTimeline);
</script>

<style scoped>
.brand-mark {
  display: block;
  overflow: visible;
}
</style>
