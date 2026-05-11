/**
 * Remotion config. Defaults tuned for social-first delivery:
 *   • H.264 in MP4 (universally accepted by TikTok / IG Reels / YT Shorts).
 *   • CRF 18 ≈ visually lossless at typical reels bitrates.
 *   • Concurrency 1 keeps the laptop responsive during render; bump it on
 *     a build box.
 *
 * Per-composition `fps`, `width`, `height`, `durationInFrames` live in
 * src/Root.tsx so the same scene can output multiple aspect ratios.
 */
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.setCodec('h264');
Config.setCrf(18);
Config.setConcurrency(1);
Config.setEntryPoint('./src/index.ts');
