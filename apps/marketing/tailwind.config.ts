import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: [
    './components/**/*.{js,vue,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './app.vue',
    './error.vue',
  ],
  theme: {
    extend: {
      colors: {
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
      },
      fontFamily: {
        heading: 'var(--font-heading)',
        body:    'var(--font-body)',
        mono:    'var(--font-mono)',
      },
      fontSize: {
        'display-2xl': ['4.5rem', { lineHeight: '1.05', letterSpacing: '-0.04em' }],
        'display-xl':  ['3.5rem', { lineHeight: '1.05', letterSpacing: '-0.035em' }],
        'display-lg':  ['2.5rem', { lineHeight: '1.1',  letterSpacing: '-0.03em' }],
        'display-md':  ['1.75rem',{ lineHeight: '1.2',  letterSpacing: '-0.02em' }],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': '20px',
      },
      boxShadow: {
        sm:  'var(--shadow-sm)',
        md:  'var(--shadow-md)',
        lg:  'var(--shadow-lg)',
        pop: 'var(--shadow-pop)',
        glow: '0 0 0 1px rgba(99,102,241,.25), 0 8px 30px rgba(99,102,241,.18)',
      },
      transitionDuration: { DEFAULT: '160ms' },
      backgroundImage: {
        'grid-fade':
          'radial-gradient(circle at 50% 0%, rgba(99,102,241,0.08), transparent 60%)',
      },
    },
  },
  plugins: [],
} satisfies Config;
