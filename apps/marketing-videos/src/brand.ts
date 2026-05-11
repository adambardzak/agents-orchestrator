/**
 * Brand motion tokens. Single source of truth shared by every scene so
 * the videos stay visually consistent with the dashboard (apps/web).
 *
 * Keep these in sync with the dashboard's tailwind tokens — when the
 * marketing site or app changes its palette, update here too.
 */

export const COLORS = {
  /** Near-black canvas background, matches apps/web bg-surface. */
  bg:     '#0d0d0d',
  /** Off-white logo fill, matches apps/web text-primary. */
  fg:     '#ffffff',
  /** Indigo-400 accent used for connection lines and dispatch pulses. */
  accent: '#818cf8',
  /** Soft glow color around discs; same hue as fg with reduced alpha. */
  glow:   'rgba(255, 255, 255, 0.65)',
} as const;

export const TIMINGS = {
  /** Composition framerate. 30fps is the social platform sweet spot —
   *  60fps doubles the render time without visible benefit at the
   *  motion speeds we're using. */
  fps:                 30,
  /** Total reel duration in frames (= 6s at 30fps). Enough room for
   *  the full center → satellites → lines → pulses → hold sequence
   *  with breathing space at the end. */
  totalFrames:         180,
  /** Frame indices (at 30fps) for each phase of the Genesis scene. */
  centerInStart:       0,
  centerInEnd:         24,    // 0.8s — soft scale-up with back overshoot.
  satellitesStart:     14,    // overlap slightly with center landing.
  satelliteStagger:    3,     // frames between consecutive satellite launches.
  satelliteDuration:   33,    // 1.1s elastic spring per satellite.
  linesStart:          75,
  linesDuration:       17,
  pulsesStart:         95,
  pulsesDuration:      21,
  ackStart:            120,
  ackDuration:         16,
  holdStart:           140,
} as const;

/**
 * Logo SVG path (verbatim copy of apps/web/components/AnimatedBrandLogo.vue).
 * Drawn inside a 680×680 viewBox, transform: translate(0,680) scale(.033..,-.033..).
 *
 * Keeping this duplicated (rather than importing from the Vue file) avoids
 * coupling the video pipeline to the dashboard's framework — marketing
 * videos must be renderable on a fresh machine with just this workspace
 * checked out.
 */
export const LOGO_PATH = `M13593 18520 c-995 -97 -1816 -801 -2052 -1760 -102 -415 -93 -801
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
