import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/*
 * The remote app (docs/remote-access.md): built into the website, which serves it at /remote/ from Switchboard's own
 * site. One fixed HTTPS address, so a phone pairs once whatever tunnel the computer uses.
 */
const here = import.meta.dirname;

/**
 * GitHub Pages can't send headers, so the CSP is a meta tag: the app's own files only (and its service worker), and
 * sockets to any `wss://` address (the tunnel), or to this computer while developing. `'self'` in `connect-src` is
 * for `version.json` only, on the app's own site.
 */
const csp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "manifest-src 'self'",
  // The service worker that shows push notifications (public/sw.js).
  "worker-src 'self'",
  "connect-src 'self' wss: ws://127.0.0.1:* ws://localhost:*",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const cspPlugin: Plugin = {
  name: 'remote-csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' }],
};

/**
 * This build's version: the commit it was built from (a build of the same commit is the same app), else the time.
 * The app has it in `import.meta.env.VITE_APP_BUILD`, and `version.json` next to it says what the site serves now, so
 * a Home Screen app that iOS kept suspended knows when to offer Reload (`src/lib/update.ts`).
 */
const build = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: here, encoding: 'utf8' }).trim();
  } catch {
    return Date.now().toString(36);
  }
})();

const versionPlugin: Plugin = {
  name: 'remote-version',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build }) });
  },
};

export default defineConfig(({ command }) => ({
  base: '/remote/',
  plugins: [react(), tailwindcss(), cspPlugin, versionPlugin],
  // Empty while developing: there is no version.json to compare with, so nothing offers Reload.
  define: { 'import.meta.env.VITE_APP_BUILD': JSON.stringify(command === 'build' ? build : '') },
  server: { port: 5199, strictPort: true },
  build: {
    outDir: resolve(here, '../../website/public/remote'),
    emptyOutDir: true,
    minify: true,
  },
}));
