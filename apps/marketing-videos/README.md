# Marketing Videos

Remotion-powered brand motion graphics for social distribution.

## Compositions

| id               | canvas       | use case                             |
|------------------|--------------|--------------------------------------|
| `genesis-reels`  | 1080 × 1920  | TikTok, Instagram Reels, YT Shorts   |
| `genesis-square` | 1080 × 1080  | Instagram feed, LinkedIn             |

Both compositions render the same **Genesis** scene: a central disc
materialises, eight satellites spring outward, connection lines draw, and
pulses race along them — visualising the orchestrator dispatching work to
its agents. The closing frame mirrors the static brand logo.

## Workflow

```bash
# Interactive preview & scrubbing
pnpm dev

# One-shot renders to ./out/
pnpm render:reels    # 1080×1920 mp4
pnpm render:square   # 1080×1080 mp4
pnpm render:all
```

## Editing the scene

- **Timing** — adjust frame ranges in `src/brand.ts` (`TIMINGS`). The scene
  is fully frame-driven, so any change is reflected instantly in
  Remotion Studio's scrubber.
- **Palette** — `COLORS` in `src/brand.ts`. Keep in sync with the
  dashboard's tailwind tokens (`apps/web/tailwind.config.ts`).
- **Logo glyph** — `LOGO_PATH` in `src/brand.ts` is a verbatim copy of
  the one in `apps/web/components/AnimatedBrandLogo.vue`. The Genesis
  scene currently uses 1 center + 8 satellites as a stylised stand-in;
  the path is kept here for future logo-trace compositions.

## Adding a new aspect ratio

1. Open `src/Root.tsx`.
2. Add a new `<Composition>` with the desired `width` / `height`.
3. Add a `render:<name>` script to `package.json`.
The scene auto-fits to the shorter canvas dimension, so no further code
changes are needed.

## Why Remotion (not GSAP + Puppeteer)?

- **Deterministic** — every frame is a pure function of `frame`. No flaky
  headless-browser timing, no dropped frames.
- **Scrub-able** — `pnpm dev` opens a studio where you can drag the
  playhead and tweak code with HMR.
- **Multi-format from one source** — same React tree → reels + square +
  any future ratio.
- **TypeScript-native** — no JS-in-DOM-string templating.
