<template>
  <button
    type="button"
    class="inline-flex items-center justify-center w-6 h-6 rounded-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    :class="variantClass"
    :title="title"
  >
    <UIcon :name="icon" class="w-3.5 h-3.5" />
  </button>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    icon: string;
    title?: string;
    variant?: 'default' | 'danger' | 'success';
  }>(),
  { variant: 'default' },
);

const variantClass = computed(() => {
  switch (props.variant) {
    case 'danger':
      return 'text-text-secondary hover:bg-failed-bg hover:text-failed';
    case 'success':
      return 'text-text-secondary hover:bg-completed-bg hover:text-completed';
    default:
      return 'text-text-secondary hover:bg-surface-hover hover:text-text-primary';
  }
});
</script>
