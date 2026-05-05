<template>
  <div class="flex items-center justify-between gap-2">
    <span class="text-text-faint">{{ label }}</span>
    <span
      class="font-mono tabular-nums"
      :class="highlight ? 'text-text-primary font-medium' : 'text-text-secondary'"
    >
      {{ value }}
    </span>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{ label: string; value: string; highlight?: boolean }>(),
  { highlight: false },
);
</script>
