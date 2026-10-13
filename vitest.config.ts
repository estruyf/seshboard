import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'website/src/**/*.test.ts'],
    environment: 'node',
    // On Windows, the temp folder by its long name (see the file).
    setupFiles: ['./vitest.setup.ts'],
    // Windows starts git and PowerShell far slower, and parallel test files slow each other down more: on a CI runner
    // a test that takes 1-2s there has taken 5-8s, past the 5s default. A hang still fails, only later.
    ...(process.platform === 'win32' ? { testTimeout: 30_000, hookTimeout: 30_000 } : {}),
    // The theme tests read styles.css (`?raw`) to check Demo Time against it.
    css: { include: [/styles\.css/] },
  },
});
