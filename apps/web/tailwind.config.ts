import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',

  content: [
    './components/**/*.{js,vue,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './plugins/**/*.{js,ts}',
    './app.vue',
    './error.vue',
  ],

  theme: {
    extend: {
      colors: {
        // CSS-var driven design tokens
        bg:                  'var(--color-bg)',
        surface:             'var(--color-surface)',
        'surface-elevated':  'var(--color-surface-elevated)',
        'surface-hover':     'var(--color-surface-hover)',
        'surface-active':    'var(--color-surface-active)',

        border:              'var(--color-border)',
        'border-strong':     'var(--color-border-strong)',

        secondary:           'var(--color-secondary)',
        accent:              'var(--color-accent)',

        'text-primary':      'var(--color-text-primary)',
        'text-secondary':    'var(--color-text-secondary)',
        'text-muted':        'var(--color-text-muted)',
        'text-faint':        'var(--color-text-faint)',

        // Status
        running:             'var(--color-running)',
        completed:           'var(--color-completed)',
        failed:              'var(--color-failed)',
        pending:             'var(--color-pending)',
        paused:              'var(--color-paused)',

        'running-bg':        'var(--color-running-bg)',
        'completed-bg':      'var(--color-completed-bg)',
        'failed-bg':         'var(--color-failed-bg)',
        'pending-bg':        'var(--color-pending-bg)',
      },

      fontFamily: {
        heading: 'var(--font-heading)',
        body:    'var(--font-body)',
        mono:    'var(--font-mono)',
      },

      fontSize: {
        'display-xl': 'var(--text-display-xl)',
        'display-lg': 'var(--text-display-lg)',
        'display-md': 'var(--text-display-md)',
        xl:           'var(--text-xl)',
        lg:           'var(--text-lg)',
        md:           'var(--text-md)',
        sm:           'var(--text-sm)',
        xs:           'var(--text-xs)',
      },

      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },

      boxShadow: {
        sm:  'var(--shadow-sm)',
        md:  'var(--shadow-md)',
        lg:  'var(--shadow-lg)',
        pop: 'var(--shadow-pop)',
      },

      transitionDuration: {
        DEFAULT: '120ms',  // Linear's snappy feel
      },
    },
  },

  plugins: [],
} satisfies Config;
