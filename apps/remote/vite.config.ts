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
 * sockets to any `wss://` address (the tunnel), or to this computer while developing.
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
  'connect-src wss: ws://127.0.0.1:* ws://localhost:*',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const cspPlugin: Plugin = {
  name: 'remote-csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' }],
};

export default defineConfig({
  base: '/remote/',
  plugins: [react(), tailwindcss(), cspPlugin],
  server: { port: 5199, strictPort: true },
  build: {
    outDir: resolve(here, '../../website/public/remote'),
    emptyOutDir: true,
    minify: true,
  },
});
