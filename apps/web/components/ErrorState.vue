<script setup lang="ts">
/**
 * Page-level fatal-error display with retry CTA.
 *
 * Use for failures that wiped out the data layer (network error, 500 from API,
 * etc.) where the user's only option is to try again. NOT for form validation
 * errors or item-level failures — those should stay inline near their input.
 *
 * Mirrors EmptyState's API for visual consistency, but uses a destructive
 * accent color and a default "Try again" action.
 */
interface Props {
  /** Phosphor icon name. Overridden by #icon slot. */
  icon?: string;
  /** Bold headline. */
  title?: string;
  /** Subtle description; ignored if default slot is used. Often the error message itself. */
  description?: string;
  /** Retry CTA label; set to '' to hide the button. */
  actionLabel?: string;
  /** Retry CTA leading icon. */
  actionIcon?: string;
  /** Visual size; controls vertical padding. */
  size?: 'sm' | 'md' | 'lg';
}

const props = withDefaults(defineProps<Props>(), {
  icon:        'i-ph-warning-octagon-light',
  title:       'Something went wrong',
  actionLabel: 'Try again',
  actionIcon:  'i-ph-arrow-clockwise-light',
  size:        'md',
});

defineEmits<{
  (e: 'retry'): void;
}>();

const paddingClass = computed(() => {
  switch (props.size) {
    case 'sm': return 'py-12';
    case 'lg': return 'py-32';
    default:   return 'py-24';
  }
});
</script>

<template>
  <div
    class="flex flex-col items-center justify-center text-center"
    :class="paddingClass"
  >
    <div
      class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-failed-bg border border-failed/30 text-failed"
    >
      <slot name="icon">
        <UIcon :name="icon" class="w-8 h-8" />
      </slot>
    </div>

    <p class="font-semibold text-lg mb-1 text-text-primary">{{ title }}</p>

    <div class="text-sm text-text-secondary mb-6 max-w-md break-words">
      <slot>{{ description }}</slot>
    </div>

    <div v-if="actionLabel || $slots.actions" class="flex items-center gap-2 flex-wrap justify-center">
      <UButton
        v-if="actionLabel"
        :icon="actionIcon"
        color="gray"
        variant="outline"
        @click="$emit('retry')"
      >
        {{ actionLabel }}
      </UButton>
      <slot name="actions" />
    </div>
  </div>
</template>
