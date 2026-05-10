#!/usr/bin/env node
/**
 * Marketing video renderer.
 *
 * Spins up Puppeteer against a running Nuxt dev server, navigates to
 * /marketing/genesis with the requested query params, and grabs N
 * frames at a fixed rate. Frames are PNGs, then ffmpeg stitches them
 * into MP4 (H.264 yuv420p) and a GIF.
 *
 * Usage:
 *   # Make sure dev server is running first:
 *   pnpm --filter web dev   # in another terminal
 *
 *   node scripts/marketing-render/render.mjs \
 *     --scene genesis \
 *     --palette dark \
 *     --size 1080 \
 *     --duration 8 \
 *     --fps 60 \
 *     --out renders/genesis-dark.mp4
 *
 * Outputs:
 *   <out>.mp4   H.264 1080×1080 (or whatever --size you pass)
 *   <out>.webm  VP9 (smaller for web embeds)
 *   <out>.gif   Looping GIF (palette-quantized, ~3-6 MB)
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../..');

// ── CLI parsing ────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) {
      const next = all[i + 1];
      acc.push([a.slice(2), next && !next.startsWith('--') ? next : 'true']);
    }
    return acc;
  }, []),
);

const scene = args.scene ?? 'genesis';
const palette = args.palette ?? 'dark';
const size = Number(args.size ?? 1080);
const duration = Number(args.duration ?? 8); // seconds
const fps = Number(args.fps ?? 60);
const baseUrl = args['base-url'] ?? 'http://localhost:3010';
const accent = args.accent ?? '#818cf8';
const out = args.out ?? `renders/${scene}-${palette}.mp4`;

const totalFrames = duration * fps;
const framesDir = join(REPO_ROOT, '.render-frames');

console.log(`▶ Rendering ${scene} (${palette}, ${size}×${size}, ${duration}s @ ${fps}fps = ${totalFrames} frames)`);

// ── Reset frames dir ───────────────────────────────────────────────────────
if (existsSync(framesDir)) await rm(framesDir, { recursive: true });
await mkdir(framesDir, { recursive: true });
await mkdir(join(REPO_ROOT, dirname(out)), { recursive: true });

// ── Puppeteer ──────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--disable-web-security', '--no-sandbox'],
});

const page = await browser.newPage();
await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });

const url = `${baseUrl}/marketing/${scene}?palette=${palette}&loop=1&size=${size}&accent=${encodeURIComponent(accent)}`;
console.log(`  page: ${url}`);

await page.goto(url, { waitUntil: 'networkidle0' });

// Hide the scroll bar / cursor / any leftover dev UI.
await page.addStyleTag({
  content: `*, *::before, *::after { cursor: none !important; }
            html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; background: ${palette === 'dark' ? '#0d0d0d' : '#fafafa'} !important; }`,
});

// Wait for fonts / SVG to settle.
await new Promise((r) => setTimeout(r, 400));

// ── Frame grab loop ────────────────────────────────────────────────────────
// We use evaluate() to poll the page's gsap timeline progress so frames
// stay deterministic. But for simplicity v1 just samples on a setInterval.
const frameInterval = 1000 / fps;
const t0 = Date.now();

for (let i = 0; i < totalFrames; i++) {
  const target = i * frameInterval;
  const now = Date.now() - t0;
  const wait = target - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

  const frame = String(i).padStart(5, '0');
  await page.screenshot({
    path: join(framesDir, `frame-${frame}.png`),
    omitBackground: false,
    type: 'png',
  });

  if (i % 30 === 0) process.stdout.write(`\r  frame ${i + 1}/${totalFrames}`);
}
process.stdout.write('\n');

await browser.close();

// ── ffmpeg encode ──────────────────────────────────────────────────────────
const outAbs = join(REPO_ROOT, out);
const outBase = outAbs.replace(/\.\w+$/, '');

function ff(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-y', ...args], { stdio: 'inherit' });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
  });
}

console.log('▶ Encoding MP4 (H.264)…');
await ff([
  '-framerate', String(fps),
  '-i', join(framesDir, 'frame-%05d.png'),
  '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p',
  '-crf', '17',
  '-preset', 'slow',
  '-movflags', '+faststart',
  `${outBase}.mp4`,
]);

console.log('▶ Encoding WebM (VP9)…');
await ff([
  '-framerate', String(fps),
  '-i', join(framesDir, 'frame-%05d.png'),
  '-c:v', 'libvpx-vp9',
  '-b:v', '0',
  '-crf', '32',
  '-row-mt', '1',
  '-pix_fmt', 'yuv420p',
  `${outBase}.webm`,
]);

console.log('▶ Encoding GIF (palette-quantized)…');
const palettePath = join(framesDir, '.palette.png');
await ff([
  '-framerate', String(fps),
  '-i', join(framesDir, 'frame-%05d.png'),
  '-vf', `fps=${Math.min(30, fps)},scale=${Math.min(720, size)}:-1:flags=lanczos,palettegen=stats_mode=diff`,
  palettePath,
]);
await ff([
  '-framerate', String(fps),
  '-i', join(framesDir, 'frame-%05d.png'),
  '-i', palettePath,
  '-lavfi', `fps=${Math.min(30, fps)},scale=${Math.min(720, size)}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`,
  `${outBase}.gif`,
]);

// Optional: clean frames dir to save disk.
if (args.keep !== 'true') {
  await rm(framesDir, { recursive: true });
}

console.log(`\n✔ Done. Outputs:`);
console.log(`  ${outBase}.mp4`);
console.log(`  ${outBase}.webm`);
console.log(`  ${outBase}.gif`);
