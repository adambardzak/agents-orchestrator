<template>
  <div>
    <div class="text-[10px] uppercase tracking-wider text-text-faint font-semibold mb-1">
      {{ label }}
    </div>
    <div class="text-sm text-text-primary">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string }>();
</script>
