import { defineNuxtConfig } from 'nuxt/config';

export default defineNuxtConfig({
  modules: ['@nuxtjs/tailwindcss', '@nuxt/image', '@nuxt/icon', '@vueuse/nuxt'],
  css: ['~/assets/css/tokens.css', '~/assets/css/main.css'],
  app: {
    head: {
      title: 'Orchestrator — Multi-agent coding, organized.',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content:
            'Coding Agent Orchestrator — plan, run and monitor multiple AI coding agents in parallel. Linear-grade workflow, OpenCode runtime, GitHub Copilot models.',
        },
        { name: 'theme-color', content: '#08090a' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'preconnect', href: 'https://rsms.me' },
      ],
    },
  },
  tailwindcss: {
    cssPath: '~/assets/css/main.css',
    configPath: 'tailwind.config.ts',
  },
  typescript: { strict: true, shim: false },
  experimental: { payloadExtraction: false },
  ssr: true,
  nitro: { preset: 'node-server' },
});
