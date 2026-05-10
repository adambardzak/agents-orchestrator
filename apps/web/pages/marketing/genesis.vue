<!--
  Standalone preview page for marketing motion graphics. Open in the
  browser at /marketing/genesis to iterate on the animation, or render
  to MP4/GIF/WebM via the Puppeteer + ffmpeg pipeline in
  scripts/marketing-render/.

  Query params:
    ?palette=light|dark   — bg/fg inversion (default: dark)
    ?loop=0|1             — loop the sequence (default: 1)
    ?size=1080            — viewBox edge (default: 1080)
    ?accent=%23818cf8     — line/pulse color (URL-encoded)
-->
<template>
  <div class="w-screen h-screen overflow-hidden" :style="{ background: palette === 'dark' ? '#0d0d0d' : '#fafafa' }">
    <GenesisScene
      :size="size"
      :palette="palette"
      :loop="loop"
      :accent-color="accent"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import GenesisScene from '~/components/marketing/GenesisScene.vue';

definePageMeta({ layout: false });

const route = useRoute();

const palette = computed<'dark' | 'light'>(() =>
  route.query['palette'] === 'light' ? 'light' : 'dark',
);
const loop = computed(() => route.query['loop'] !== '0');
const size = computed(() => Number(route.query['size'] ?? 1080));
const accent = computed(() => String(route.query['accent'] ?? '#818cf8'));

useHead({
  title: 'Genesis · Marketing preview',
  bodyAttrs: { class: 'overflow-hidden' },
});
</script>
