/**
 * Easing & interpolation helpers used by every scene.
 *
 * Remotion ships `interpolate()` which is frame-driven and pure (no GSAP
 * runtime needed). These wrappers express the GSAP timeline language we
 * already have in apps/web (`back.out`, `elastic.out`, `power2.inOut`) in
 * a way the deterministic frame renderer can consume.
 */

import { Easing } from 'remotion';

/** Standard ease-out for soft entrances. */
export const easeOut = Easing.out(Easing.cubic);

/** Standard ease-in for collapses / exits. */
export const easeIn = Easing.in(Easing.cubic);

/** Symmetric ease-in-out for cross-scene transitions. */
export const easeInOut = Easing.inOut(Easing.cubic);

/**
 * `back.out(overshoot)` — overshoots the target then settles. Matches the
 * "pop in" feel of GSAP's `back.out(2.4)` used on the center disc.
 *
 * Remotion's Easing.back(s) takes overshoot in radians-ish (s≈1.7 ≈ subtle,
 * s≈3 ≈ aggressive). 2.4 ≈ the bouncy feel we want.
 */
export const backOut = Easing.out(Easing.back(2.4));

/**
 * Elastic spring approximation. Remotion's `Easing.elastic(bounciness)`
 * peaks higher than GSAP's `elastic.out(1, 0.55)`, so we tune bounciness
 * to ~1.2 to roughly match the satellite-landing motion in the Vue
 * reference scene. Visually compared frame-by-frame at 30fps.
 */
export const elasticOut = Easing.out(Easing.elastic(1.2));

/**
 * Convenience: clamp-and-interpolate one value over a [startFrame, endFrame]
 * window with a given easing. Saves boilerplate `extrapolateLeft/Right:
 * 'clamp'` in every scene.
 */
export function tween(
  frame: number,
  startFrame: number,
  endFrame: number,
  from: number,
  to: number,
  easing: (t: number) => number = easeOut,
): number {
  const total = endFrame - startFrame;
  if (total <= 0) return frame >= endFrame ? to : from;
  const raw = (frame - startFrame) / total;
  const t = Math.min(1, Math.max(0, raw));
  return from + (to - from) * easing(t);
}
