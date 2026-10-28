import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

const here = import.meta.dirname;
// Workspace packages ship TypeScript source, so they must be bundled rather than required at runtime.
const workspacePackages = ['@seshboard/engine', '@seshboard/protocol'];

/** The commit being built, for Settings → About and the About panel. Empty when git isn't there. */
function shortCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return process.env.GITHUB_SHA?.slice(0, 7) ?? '';
  }
}

/** Strict CSP for production builds (dev needs inline scripts for React Fast Refresh). */
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const cspPlugin: Plugin = {
  name: 'seshboard-csp',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' },
  ],
};

export default defineConfig({
  main: {
    define: { __SESHBOARD_COMMIT__: JSON.stringify(shortCommit()) },
    build: {
      externalizeDeps: { exclude: workspacePackages },
      rollupOptions: {
        input: {
          index: resolve(here, 'src/main/index.ts'),
          // Runs in an Electron utilityProcess, off the main thread.
          engine: resolve(here, 'src/engine/index.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: { exclude: workspacePackages },
      rollupOptions: {
        input: { index: resolve(here, 'src/preload/index.ts') },
        // Sandboxed preloads must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(here, '../ui'),
    plugins: [react(), tailwindcss(), cspPlugin],
    build: {
      outDir: resolve(here, 'out/renderer'),
      // Smaller bundle parses faster at startup; main and engine stay readable for stack traces.
      minify: true,
      rollupOptions: { input: resolve(here, '../ui/index.html') },
    },
  },
});
