/**
 * Composition registry. Each <Composition> entry below shows up in
 * Remotion Studio's sidebar and is a render target for the CLI:
 *
 *   pnpm render:reels   → 1080×1920 vertical (TikTok / IG Reels / YT Shorts)
 *   pnpm render:square  → 1080×1080 square    (IG feed / LinkedIn)
 *
 * Both compositions render the same GenesisScene; only the canvas size
 * differs. The scene auto-fits to the shorter dimension so the brand
 * shape stays visually centred in every aspect ratio.
 */
import { Composition } from 'remotion';
import { TIMINGS } from './brand';
import { GenesisScene } from './scenes/GenesisScene';

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="genesis-reels"
        component={GenesisScene}
        durationInFrames={TIMINGS.totalFrames}
        fps={TIMINGS.fps}
        width={1080}
        height={1920}
      />
      <Composition
        id="genesis-square"
        component={GenesisScene}
        durationInFrames={TIMINGS.totalFrames}
        fps={TIMINGS.fps}
        width={1080}
        height={1080}
      />
    </>
  );
};
