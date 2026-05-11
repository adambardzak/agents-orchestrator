<script setup lang="ts">
/**
 * Reusable empty-state component.
 *
 * Slots:
 *  - icon    (optional) custom icon node; falls back to `icon` prop
 *  - default (optional) custom description body; falls back to `description` prop
 *  - actions (optional) extra CTAs rendered next to the primary action
 *
 * Props give the common case a one-liner API; slots cover edge cases.
 */
interface Props {
  /** Phosphor icon name, e.g. "i-ph-folder-light". Ignored if #icon slot is used. */
  icon?: string;
  /** Bold headline. */
  title: string;
  /** Subtle one/two-liner under the title. Ignored if default slot is used. */
  description?: string;
  /** Primary CTA label; omit to hide the button. */
  actionLabel?: string;
  /** Primary CTA leading icon. */
  actionIcon?: string;
  /** Visual size; controls vertical padding + icon scale. */
  size?: 'sm' | 'md' | 'lg';
}

const props = withDefaults(defineProps<Props>(), {
  icon: 'i-ph-folder-open-light',
  size: 'md',
});

defineEmits<{
  (e: 'action'): void;
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
      class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-elevated border border-border text-text-muted"
    >
      <slot name="icon">
        <UIcon :name="icon" class="w-8 h-8" />
      </slot>
    </div>

    <p class="font-semibold text-lg mb-1 text-text-primary">{{ title }}</p>

    <div class="text-sm text-text-secondary mb-6 max-w-md">
      <slot>{{ description }}</slot>
    </div>

    <div v-if="actionLabel || $slots.actions" class="flex items-center gap-2 flex-wrap justify-center">
      <UButton
        v-if="actionLabel"
        :icon="actionIcon"
        @click="$emit('action')"
      >
        {{ actionLabel }}
      </UButton>
      <slot name="actions" />
    </div>
  </div>
</template>
