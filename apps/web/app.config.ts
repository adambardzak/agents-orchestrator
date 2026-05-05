export default defineAppConfig({
  ui: {
    primary: 'indigo',
    gray: 'neutral',

    // Linear-like compact defaults for Nuxt UI components
    button: {
      rounded: 'rounded-md',
      font: 'font-medium',
      default: { size: 'sm' },
    },
    input: {
      rounded: 'rounded-md',
      default: { size: 'sm' },
    },
    select: {
      rounded: 'rounded-md',
      default: { size: 'sm' },
    },
    card: {
      base: '',
      background: 'bg-surface-elevated',
      divide: 'divide-y divide-border',
      ring: 'ring-1 ring-border',
      rounded: 'rounded-lg',
      shadow: 'shadow-sm',
      body: { padding: 'p-4 sm:p-5' },
      header: { padding: 'px-4 py-3 sm:px-5' },
      footer: { padding: 'px-4 py-3 sm:px-5' },
    },
    badge: {
      rounded: 'rounded',
      font: 'font-medium',
      default: { size: 'xs', variant: 'subtle' },
    },
  },
});
