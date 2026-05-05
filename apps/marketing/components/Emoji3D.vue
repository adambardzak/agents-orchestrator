<template>
  <div
    :class="[
      'relative inline-flex items-center justify-center shrink-0',
      sizeClass,
      glow ? 'after:absolute after:inset-0 after:-z-10 after:rounded-full after:blur-2xl after:opacity-60 after:bg-gradient-to-br after:from-indigo-500/40 after:to-violet-500/30' : '',
    ]"
  >
    <img
      :src="resolvedSrc"
      :alt="alt ?? name"
      :width="pixelSize"
      :height="pixelSize"
      loading="lazy"
      draggable="false"
      class="select-none drop-shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * Emoji3D — renders Microsoft Fluent Emoji in 3D style.
 * Source: https://github.com/microsoft/fluentui-emoji  (MIT)
 * Served via jsDelivr CDN.
 *
 * The "3D" Fluent Emoji set is the closest open equivalent to
 * Apple's macOS Big Sur–style 3D folder/object renders.
 */

const props = withDefaults(
  defineProps<{
    /** Folder slug under fluentui-emoji assets, e.g. "Card index dividers" */
    name: string;
    /** Specific filename suffix, default "color" => `*_color.svg` (3D style) */
    style?: '3d' | 'color' | 'flat' | 'high_contrast';
    size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
    glow?: boolean;
    alt?: string;
  }>(),
  { style: '3d', size: 'lg', glow: false },
);

const sizeMap = {
  sm:  { cls: 'w-10 h-10',  px: 40 },
  md:  { cls: 'w-14 h-14',  px: 56 },
  lg:  { cls: 'w-20 h-20',  px: 80 },
  xl:  { cls: 'w-28 h-28',  px: 112 },
  '2xl': { cls: 'w-40 h-40', px: 160 },
} as const;

const sizeClass = computed(() => sizeMap[props.size].cls);
const pixelSize = computed(() => sizeMap[props.size].px);

/**
 * Build the canonical Fluent UI Emoji URL.
 * The folder names in the repo use spaces; we URL-encode them.
 * Filenames are lowercased, with spaces → underscores, plus a style suffix.
 *
 * Example:
 *   name = "File folder"
 *   →  /assets/File%20folder/3D/file_folder_3d.png
 */
const resolvedSrc = computed(() => {
  const folder = encodeURIComponent(props.name);
  const styleFolder =
    props.style === '3d' ? '3D' :
    props.style === 'flat' ? 'Flat' :
    props.style === 'high_contrast' ? 'High Contrast' : 'Color';
  const ext = props.style === '3d' || props.style === 'flat' ? 'png' : 'svg';
  const file =
    props.name.toLowerCase().replace(/ /g, '_') + '_' + props.style + '.' + ext;
  return `https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/${folder}/${styleFolder}/${file}`;
});
</script>
