import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/test/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 10_000,
    // Resolve .js → .ts for ESM TypeScript imports within Vitest
    alias: [
      // Map @agent-orchestrator/shared to source
      {
        find: '@agent-orchestrator/shared',
        replacement: resolve('../../packages/shared/src/index.ts'),
      },
    ],
  },
  resolve: {
    // This tells Vite/Vitest to resolve .js extensions to .ts when running tests
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
    alias: [
      {
        find: '@agent-orchestrator/shared',
        replacement: resolve('../../packages/shared/src/index.ts'),
      },
    ],
  },
});
