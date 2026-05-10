// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },

  modules: [
    '@nuxt/ui',
    '@pinia/nuxt',
    '@vueuse/nuxt',
    '@nuxt/image',
    '@nuxtjs/tailwindcss',
  ],

  css: ['~/assets/css/tokens.css'],

  app: {
    head: {
      title: 'Orchestrator',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
    },
  },

  colorMode: {
    preference: 'dark',     // dark default
    fallback: 'dark',
    classSuffix: '',        // .dark / .light (not .dark-mode)
    storageKey: 'ao-theme',
  },

  runtimeConfig: {
    public: {
      apiBase: process.env['NUXT_PUBLIC_API_BASE'] ?? 'http://localhost:3002',
      wsBase: process.env['NUXT_PUBLIC_WS_BASE'] ?? 'ws://localhost:3002',
      codeServerUrl: process.env['NUXT_PUBLIC_CODE_SERVER_URL'] ?? 'http://localhost:8080',
    },
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },

  // Auto-import composables and components
  imports: {
    dirs: ['composables/**', 'stores/**'],
  },

  ui: {
    global: true,
    icons: ['ph', 'lucide'], // ph = Phosphor (primary), lucide as fallback
  },

  tailwindcss: {
    configPath: '~/tailwind.config.ts',
  },

  compatibilityDate: '2024-07-30',
});
