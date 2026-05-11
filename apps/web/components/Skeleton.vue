<script setup lang="ts">
/**
 * Animated placeholder block. Single primitive — compose multiple to mirror
 * the eventual layout (better perceived performance than a centered spinner).
 *
 * Usage:
 *   <Skeleton class="h-4 w-32" />
 *   <Skeleton class="h-44 rounded-md" />   // card placeholder
 *   <Skeleton variant="circle" class="w-9 h-9" />
 *
 * Variant controls border-radius; size is intentionally caller-driven so the
 * placeholder matches the final element's footprint exactly.
 */
interface Props {
  /** Shape preset. `text` = small radius, `block` = md radius, `circle` = full. */
  variant?: 'text' | 'block' | 'circle';
}

withDefaults(defineProps<Props>(), {
  variant: 'block',
});
</script>

<template>
  <div
    class="bg-surface-elevated border border-border animate-pulse"
    :class="{
      'rounded':       variant === 'text',
      'rounded-md':    variant === 'block',
      'rounded-full':  variant === 'circle',
    }"
  />
</template>
