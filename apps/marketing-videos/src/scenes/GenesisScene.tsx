/**
 * Genesis scene — animated brand mark in motion.
 *
 *   1. Center disc materialises with a back-out scale-up (frames 0–24).
 *   2. Eight satellites spring outward one-by-one (frames 14–80) with
 *      elastic overshoot, mirroring the static logo's 1-center + 8-petal
 *      composition.
 *   3. Connection lines stroke-draw from center to each satellite
 *      (frames 75–92).
 *   4. Pulses race from center along each line (frames 95–116),
 *      visualising the orchestrator dispatching work.
 *   5. Satellites "ack" — quick scale-bump and settle (frames 120–136).
 *   6. Hold the brand-shape composition until end of timeline.
 *
 * Drawn as plain inline SVG inside an AbsoluteFill; nothing imperative,
 * no DOM mutation, no GSAP. Every visual property is a pure function of
 * `frame`, which is what makes Remotion's render fully deterministic.
 *
 * Stage is sized to fit inside the composition canvas with `padding` of
 * 8% per side, so the same scene reads correctly at 9:16 (reels) and
 * 1:1 (square) without ever cropping satellites.
 */
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { COLORS, TIMINGS } from '../brand';
import { tween, backOut, elasticOut, easeOut, easeIn } from '../easings';

interface Satellite {
  x: number;
  y: number;
  angle: number;
}

function computeSatellites(stage: number): Satellite[] {
  const cx = stage / 2;
  const cy = stage / 2;
  const r = stage * 0.32;
  const out: Satellite[] = [];
  for (let i = 0; i < 8; i++) {
    // First satellite at -90° (top) so it reads like a clock face's 12.
    const angle = -Math.PI / 2 + (i * Math.PI) / 4;
    out.push({
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      angle,
    });
  }
  return out;
}

export const GenesisScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // The scene is drawn into a square stage centred in the canvas. The
  // stage size is 84% of the shorter canvas dimension — leaves visual
  // breathing room top/bottom on 9:16, and a comfortable margin on 1:1.
  const stage = Math.round(Math.min(width, height) * 0.84);
  const stageX = (width - stage) / 2;
  const stageY = (height - stage) / 2;

  const cx = stage / 2;
  const cy = stage / 2;
  const rCenter = Math.round(stage * 0.07);
  const rSat    = Math.round(stage * 0.055);
  const sats    = computeSatellites(stage);

  // ── Center disc ─────────────────────────────────────────────────────
  const centerScale   = tween(frame, TIMINGS.centerInStart, TIMINGS.centerInEnd, 0, 1, backOut);
  const centerOpacity = tween(frame, TIMINGS.centerInStart, TIMINGS.centerInStart + 6, 0, 1);

  // ── Connection lines stroke-draw progress (0..1) ────────────────────
  const lineProgress = tween(
    frame,
    TIMINGS.linesStart,
    TIMINGS.linesStart + TIMINGS.linesDuration,
    0,
    1,
    easeOut,
  );
  const lineOpacity = tween(frame, TIMINGS.linesStart - 3, TIMINGS.linesStart, 0, 1);

  // ── Pulse-along-line ────────────────────────────────────────────────
  const pulseProgress = tween(
    frame,
    TIMINGS.pulsesStart,
    TIMINGS.pulsesStart + TIMINGS.pulsesDuration,
    0,
    1,
    easeIn,
  );
  // Pulse fades out as it nears the satellite (so it "delivers" the message).
  const pulseOpacity = 1 - pulseProgress;

  // Unique IDs per render — Remotion renders each frame fresh so randomness
  // is unsafe; use a stable string instead.
  const gradId = 'genesis-grad';
  const glowId = 'genesis-glow';

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <svg
        width={stage}
        height={stage}
        viewBox={`0 0 ${stage} ${stage}`}
        style={{ position: 'absolute', left: stageX, top: stageY }}
      >
        <defs>
          <radialGradient id={gradId} cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor={COLORS.fg} stopOpacity={1} />
            <stop offset="70%"  stopColor={COLORS.fg} stopOpacity={0.95} />
            <stop offset="100%" stopColor={COLORS.fg} stopOpacity={0.65} />
          </radialGradient>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={6} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Connection lines (drawn under the discs so they appear "behind"). */}
        <g stroke={COLORS.accent} strokeWidth={2.5} fill="none" opacity={lineOpacity}>
          {sats.map((s, i) => {
            const len = Math.hypot(s.x - cx, s.y - cy);
            // Stroke-dash trick to reveal the line: dasharray = full length,
            // dashoffset shrinks from `len` to 0 as `lineProgress` ramps 0→1.
            // Stagger lines by frame offset so they don't all draw in sync.
            const localStart = i * 1.2 / TIMINGS.linesDuration; // tiny stagger
            const localProg = Math.min(1, Math.max(0, (lineProgress - localStart) / (1 - localStart)));
            return (
              <line
                key={`line-${i}`}
                x1={cx}
                y1={cy}
                x2={s.x}
                y2={s.y}
                strokeLinecap="round"
                strokeDasharray={len}
                strokeDashoffset={len * (1 - localProg)}
              />
            );
          })}
        </g>

        {/* Pulses racing from center toward each satellite. */}
        <g fill={COLORS.accent} opacity={pulseOpacity}>
          {sats.map((s, i) => {
            // Stagger pulses slightly so they don't all leave the hub
            // simultaneously — feels more like sequential dispatch.
            const localOffset = (i * 1.5) / TIMINGS.pulsesDuration;
            const localProg = Math.min(
              1,
              Math.max(0, (pulseProgress - localOffset) / (1 - localOffset)),
            );
            const px = cx + (s.x - cx) * localProg;
            const py = cy + (s.y - cy) * localProg;
            return <circle key={`pulse-${i}`} cx={px} cy={py} r={6} />;
          })}
        </g>

        {/* Satellite discs — each springs out on its own timeline. */}
        {sats.map((s, i) => {
          const start = TIMINGS.satellitesStart + i * TIMINGS.satelliteStagger;
          const end   = start + TIMINGS.satelliteDuration;
          // Position interpolates from center to target along a straight line.
          const t = tween(frame, start, end, 0, 1, elasticOut);
          const x = cx + (s.x - cx) * t;
          const y = cy + (s.y - cy) * t;
          const scale = tween(frame, start, end, 0, 1, elasticOut);
          const opacity = tween(frame, start, start + 4, 0, 1);

          // "Ack" pulse: brief scale-up around frame 120–136, staggered per satellite.
          const ackStart = TIMINGS.ackStart + i * 2;
          const ackPeak  = ackStart + 5;
          const ackEnd   = ackStart + TIMINGS.ackDuration;
          let ackScale = 1;
          if (frame >= ackStart && frame <= ackEnd) {
            if (frame <= ackPeak) {
              ackScale = tween(frame, ackStart, ackPeak, 1, 1.18, easeOut);
            } else {
              ackScale = tween(frame, ackPeak, ackEnd, 1.18, 1, elasticOut);
            }
          }
          const finalScale = scale * ackScale;

          return (
            <g
              key={`sat-${i}`}
              transform={`translate(${x}, ${y}) scale(${finalScale})`}
              opacity={opacity}
            >
              <circle
                cx={0}
                cy={0}
                r={rSat}
                fill={`url(#${gradId})`}
                filter={`url(#${glowId})`}
              />
            </g>
          );
        })}

        {/* Center disc — drawn last so it sits on top of any line endpoints. */}
        <g
          transform={`translate(${cx}, ${cy}) scale(${centerScale})`}
          opacity={centerOpacity}
        >
          <circle
            cx={0}
            cy={0}
            r={rCenter}
            fill={`url(#${gradId})`}
            filter={`url(#${glowId})`}
          />
        </g>
      </svg>
    </AbsoluteFill>
  );
};
