import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'website/src/**/*.test.ts'],
    environment: 'node',
    // The theme tests read styles.css (`?raw`) to check Demo Time against it.
    css: { include: [/styles\.css/] },
  },
});
