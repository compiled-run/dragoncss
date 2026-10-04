import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['dragon-internal', 'module', 'node', 'import', 'default'] },
  ssr: { resolve: { conditions: ['dragon-internal', 'module', 'node', 'import', 'default'] } },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    globalSetup: ['scripts/vitest-tmpdir.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
