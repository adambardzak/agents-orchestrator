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
    <g transform="translate(0,680) scale(0.033333,-0.033333)">
      <path
        ref="pathEl"
        :fill="mode === 'static' ? 'currentColor' : 'transparent'"
        stroke="currentColor"
        :stroke-width="mode === 'static' ? 0 : 120"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M13593 18520 c-995 -97 -1816 -801 -2052 -1760 -102 -415 -93 -801
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
-613 316 -954 366 -130 19 -414 27 -537 15z"
      />
    </g>
  </svg>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import gsap from 'gsap';

interface Props {
  mode?: 'draw' | 'pulse' | 'active' | 'static';
  /** Draw duration (sec). Only for mode="draw". */
  drawDuration?: number;
  /** Delay before draw starts (sec). */
  drawDelay?: number;
  /** Emitted when draw completes. Useful for splash → fade-out chains. */
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'static',
  drawDuration: 1.6,
  drawDelay: 0,
});

const emit = defineEmits<{ (e: 'draw-complete'): void }>();

const svgEl = ref<SVGSVGElement | null>(null);
const pathEl = ref<SVGPathElement | null>(null);

let activeTl: gsap.core.Timeline | null = null;

function killTimeline() {
  if (activeTl) {
    activeTl.kill();
    activeTl = null;
  }
}

function runDraw() {
  if (!pathEl.value) return;
  const path = pathEl.value;
  const len = path.getTotalLength();

  // Prep: hide stroke by offsetting it fully, transparent fill.
  gsap.set(path, {
    strokeDasharray: len,
    strokeDashoffset: len,
    fill: 'transparent',
    strokeOpacity: 1,
  });

  killTimeline();
  activeTl = gsap.timeline({
    delay: props.drawDelay,
    onComplete: () => emit('draw-complete'),
  });

  // 1. Stroke draws in
  activeTl.to(path, {
    strokeDashoffset: 0,
    duration: props.drawDuration,
    ease: 'power2.inOut',
  });

  // 2. Fill fades in while stroke fades out (≈ stroke "thickens" into shape)
  activeTl.to(
    path,
    {
      fill: 'currentColor',
      strokeOpacity: 0,
      duration: 0.45,
      ease: 'power1.out',
    },
    '-=0.15',
  );
}

function runPulse(active: boolean) {
  if (!pathEl.value || !svgEl.value) return;
  const path = pathEl.value;

  // Make sure logo is fully drawn — pulse rides on top of the static look.
  gsap.set(path, {
    strokeDasharray: 'none',
    strokeDashoffset: 0,
    fill: 'currentColor',
    strokeOpacity: 0,
  });

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
  if (!pathEl.value || !svgEl.value) return;
  killTimeline();
  gsap.set(pathEl.value, {
    strokeDasharray: 'none',
    strokeDashoffset: 0,
    fill: 'currentColor',
    strokeOpacity: 0,
  });
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
  // Respect users who asked for no motion at the OS level.
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
  /* Allow scale transforms to render outside the bounding box without being
     clipped (drop-shadow filter especially). */
  overflow: visible;
}
</style>
