import { VISUAL_CDNS, VISUAL_SCHEME } from '@seshboard/protocol/client';

/**
 * The page a visual from Claude (`show_widget`) is drawn in, served from `seshboard-visual://frame/`. The conversation
 * puts it in an iframe sandboxed with `allow-scripts` only (an opaque origin: no access to the app, its storage or
 * main), then posts it the code and the theme. The page runs the code's scripts in order once it is in place, gives it
 * what the Claude desktop app gives a visual (its CSS variables, the Tabler icon font, `sendPrompt` and `openLink`, which
 * work from a click or a key in the visual),
 * and reports its height, so the frame grows to fit and never scrolls.
 */

/** The Tabler outline icons (`<i class="ti ti-file-text">`), loaded only by a visual that uses them. */
const TABLER_CSS = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.31.0/dist/tabler-icons.min.css';

/** The colour classes of a visual's SVG (`c-blue`), each from a variable the conversation sets from the theme. */
export const VISUAL_COLOURS = ['gray', 'blue', 'teal', 'green', 'amber', 'orange', 'coral', 'red', 'pink', 'purple'] as const;

/**
 * Inline scripts, because a visual's code is mostly inline scripts, and scripts, styles and fonts from the CDNs only.
 * `unsafe-eval` too: chart and maths libraries build functions at run time, and the frame is sandboxed either way.
 * No forms, no frames, no base URL and no connections other than the CDNs.
 */
export function visualFrameCsp(): string {
  const cdns = VISUAL_CDNS.join(' ');
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${cdns}`,
    `style-src 'unsafe-inline' ${cdns}`,
    `font-src data: ${cdns}`,
    `img-src data: blob: ${cdns}`,
    `connect-src ${cdns}`,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

const colourRules = () => VISUAL_COLOURS.map((name) => `.c-${name} { --c: var(--c-${name}); }`).join('\n');

const coloured = VISUAL_COLOURS.map((name) => `.c-${name}`).join(', ');

/** The variables' look: what the desktop app's visuals expect of plain elements, SVG text and the colour classes. */
const STYLES = `
:root { color-scheme: light dark; }
html, body { margin: 0; padding: 0; background: transparent; }
body { font-family: var(--font-sans); font-size: 14px; line-height: 1.5; color: var(--text-primary); overflow: hidden; -webkit-font-smoothing: antialiased; }
#root { display: flow-root; }
#root > svg { display: block; max-width: 100%; height: auto; }
a { color: var(--text-accent); }
code, pre, kbd { font-family: var(--font-mono); }
button, input, select, textarea { font: inherit; color: inherit; }
button { padding: 4px 10px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface-1); cursor: pointer; }
button:hover { background: var(--surface-2); }
input[type='text'], input[type='number'], select, textarea { padding: 4px 8px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface-0); }
input[type='range'], input[type='checkbox'], input[type='radio'], progress { accent-color: var(--text-accent); }
:focus-visible { outline: 2px solid var(--text-accent); outline-offset: 1px; }
svg text { fill: var(--text-primary); font-family: var(--font-sans); }
svg .t { font-size: 14px; fill: var(--text-primary); }
svg .ts { font-size: 12px; fill: var(--text-secondary); }
svg .th { font-size: 14px; font-weight: 500; fill: var(--text-primary); }
svg .box { fill: var(--surface-1); stroke: var(--border-strong); }
svg .arr { fill: none; stroke: var(--text-secondary); }
svg .leader { fill: none; stroke: var(--text-muted); stroke-dasharray: 3 3; }
${colourRules()}
:is(${coloured}) :is(rect, circle, ellipse, polygon), :is(rect, circle, ellipse, polygon):is(${coloured}) { fill: color-mix(in srgb, var(--c) 16%, var(--surface-0)); stroke: var(--c); }
:is(path, line, polyline):is(${coloured}) { stroke: var(--c); }
:is(${coloured}) text, text:is(${coloured}) { fill: color-mix(in srgb, var(--c) 70%, var(--text-primary)); stroke: none; }
`;

/**
 * Runs in the frame. Messages from the conversation: `render` (once) with the code and the theme, `theme` when it
 * changes. Messages to it: `ready`, `drawn` and `height` as it lays out, `prompt` and `link` from the visual.
 */
const SCRIPT = `(() => {
  const root = document.getElementById('root');
  const post = (message) => parent.postMessage(message, '*');
  let drawn = false;
  let last = -1;
  const measure = () => Math.ceil(Math.max(root.scrollHeight, root.getBoundingClientRect().height));
  const report = () => {
    const height = measure();
    if (!drawn || height === last) return;
    last = height;
    post({ type: 'height', height });
  };
  new ResizeObserver(report).observe(root);

  const applyTheme = (theme) => {
    if (!theme || typeof theme !== 'object') return;
    const vars = theme.vars && typeof theme.vars === 'object' ? theme.vars : {};
    for (const [name, value] of Object.entries(vars)) {
      if (/^--[a-z0-9-]+$/.test(name) && typeof value === 'string') document.documentElement.style.setProperty(name, value);
    }
    if (theme.scheme === 'dark' || theme.scheme === 'light') {
      document.documentElement.style.colorScheme = theme.scheme;
      document.documentElement.dataset.theme = theme.scheme;
    }
  };

  // Only from something you did in the visual (a click, a key), never by itself as it loads.
  const used = () => !navigator.userActivation || navigator.userActivation.isActive;
  window.sendPrompt = (text) => used() && post({ type: 'prompt', text: String(text) });
  window.openLink = (url) => used() && post({ type: 'link', url: String(url) });
  // A link opens in the browser, never in the frame.
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || (link.getAttribute('href') || '').startsWith('#')) return;
    event.preventDefault();
    window.openLink(link.href);
  });

  // Scripts run once the whole code is in place, in order: one loaded from a CDN finishes before the next starts.
  const run = async (code) => {
    if (/\\bti ti-/.test(code)) {
      const icons = document.createElement('link');
      icons.rel = 'stylesheet';
      icons.href = ${JSON.stringify(TABLER_CSS)};
      document.head.append(icons);
    }
    const template = document.createElement('template');
    template.innerHTML = code;
    const scripts = [...template.content.querySelectorAll('script')].map((script) => {
      const marker = document.createComment('script');
      script.replaceWith(marker);
      return { marker, script };
    });
    root.replaceChildren(template.content);
    for (const { marker, script: inert } of scripts) {
      const script = document.createElement('script');
      for (const attribute of inert.attributes) script.setAttribute(attribute.name, attribute.value);
      script.textContent = inert.textContent;
      const loaded = script.src ? new Promise((done) => { script.onload = script.onerror = done; setTimeout(done, 10000); }) : null;
      marker.replaceWith(script);
      if (loaded) await loaded;
    }
    // Code written for a page that is still loading waits for these.
    document.dispatchEvent(new Event('DOMContentLoaded'));
    window.dispatchEvent(new Event('load'));
    await new Promise((done) => requestAnimationFrame(() => done()));
    drawn = true;
    last = measure();
    post({ type: 'drawn', height: last });
  };

  let rendered = false;
  window.addEventListener('message', (event) => {
    if (event.source !== parent || !event.data || typeof event.data !== 'object') return;
    const message = event.data;
    if (message.type === 'theme') applyTheme(message.theme);
    else if (message.type === 'render' && !rendered && typeof message.code === 'string') {
      rendered = true;
      applyTheme(message.theme);
      void run(message.code);
    }
  });
  post({ type: 'ready' });
})();`;

/** The frame page: the policy first, so it covers everything after it. */
export function visualFrameHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${visualFrameCsp()}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${STYLES}</style>
</head>
<body>
<div id="root"></div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

/** Whether a URL is a visual's frame page. */
export const isVisualFrameUrl = (url: string | null | undefined): boolean => typeof url === 'string' && url.startsWith(`${VISUAL_SCHEME}:`);

/** What main answers for `seshboard-visual://…`: the frame page at `frame/`, nothing anywhere else. */
export function visualFrameResponse(request: Request): Response {
  const url = new URL(request.url);
  if (url.host !== 'frame' || (url.pathname !== '/' && url.pathname !== '')) return new Response('Not found', { status: 404 });
  return new Response(visualFrameHtml(), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': visualFrameCsp(), 'cache-control': 'no-store' },
  });
}
