# Marketing Motion Graphics Renderer

Render Vue/SVG/GSAP animations to MP4 / WebM / GIF for marketing assets
(landing pages, X posts, LinkedIn, demo loops, etc).

## How it works

1. The animation lives as a normal Vue component in `apps/web/components/marketing/`.
2. A preview page (`apps/web/pages/marketing/<scene>.vue`) renders it
   full-screen so a headless browser can see it.
3. `render.mjs` spins up Puppeteer, navigates to that page, captures N
   PNG frames at a fixed FPS, then ffmpeg encodes them into MP4 / WebM
   / GIF.

## One-time setup

```sh
# ffmpeg (already on most macs via Homebrew)
brew install ffmpeg

# puppeteer download (Chromium)
pnpm --filter web add -D puppeteer
```

## Render a scene

```sh
# Terminal 1 — keep dev server up
pnpm --filter web dev

# Terminal 2 — render
node scripts/marketing-render/render.mjs \
  --scene genesis \
  --palette dark \
  --size 1080 \
  --duration 8 \
  --fps 60 \
  --out renders/genesis-dark.mp4
```

### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--scene` | `genesis` | Page name under `apps/web/pages/marketing/` |
| `--palette` | `dark` | `dark` (white-on-black) or `light` (inverse) |
| `--size` | `1080` | Square viewport edge in px |
| `--duration` | `8` | Seconds of footage to capture |
| `--fps` | `60` | Frame rate (60 looks butter, 30 is plenty for socials) |
| `--accent` | `#818cf8` | Connection-line / pulse color |
| `--base-url` | `http://localhost:3010` | Where the dev server is |
| `--out` | `renders/<scene>-<palette>.mp4` | Output base path; `.webm` and `.gif` are created next to it |
| `--keep` | `false` | Keep the intermediate PNG frames after encode |

## Outputs

For each render you get three files at the same base path:

- `*.mp4` — H.264 yuv420p, CRF 17 (small file, plays everywhere, **use this for socials**)
- `*.webm` — VP9 CRF 32 (~half the size of MP4, **use this for `<video>` on the site**)
- `*.gif` — Palette-quantized, capped at 720p / 30fps (~3-6 MB, **use this for X / Slack inline previews**)

## Add a new scene

1. Build the animation as `apps/web/components/marketing/MyScene.vue`.
2. Add a preview page `apps/web/pages/marketing/my-scene.vue` that
   imports the component full-screen and accepts the same query params
   (`palette`, `size`, `loop`, `accent`).
3. `node scripts/marketing-render/render.mjs --scene my-scene ...`

## Tips

- Loop the animation in the component (`loop: true`) so the renderer
  always has fresh frames to grab regardless of when capture starts.
- Match `--duration` to one full loop cycle for the cleanest GIF; an
  8-second loop captured for 8 seconds gives a seamless GIF.
- For 1:1 social cards (X, IG) use `--size 1080`. For 16:9 hero videos,
  open `render.mjs` and switch the `setViewport` call to `{ width:
  1920, height: 1080 }`.
- Headless renders are slower than real-time (puppeteer screenshots
  block the page). Expect ~2-3× duration to capture.
