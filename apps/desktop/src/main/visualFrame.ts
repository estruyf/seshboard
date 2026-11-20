import { randomUUID } from 'node:crypto';
import { MCP_APP_PROTOCOL_VERSION, VISUAL_CDNS, VISUAL_FONT_HOSTS, VISUAL_SCHEME, type McpAppCsp } from '@seshboard/protocol/client';

/**
 * The page a visual from Claude (`show_widget`) is drawn in, served from `seshboard-visual://frame/`. The conversation
 * puts it in an iframe sandboxed with `allow-scripts` only (an opaque origin: no access to the app, its storage or
 * main), then posts it the code and the theme. The page runs the code's scripts in order once it is in place, gives it
 * what the Claude desktop app gives a visual (its CSS variables and classes, `data-mode`, the Tabler icon font, `sendPrompt` and `openLink`, which
 * work from a click or a key in the visual),
 * and reports its height, so the frame grows to fit and never scrolls.
 */

/** The Tabler outline icons (`<i class="ti ti-file-text">`), loaded only by a visual that uses them. */
const TABLER_CSS = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.31.0/dist/tabler-icons.min.css';

/**
 * The colour ramps of a visual's SVG (`c-blue`), as Claude's guide for visuals gives them: stops 50, 100, 200, 400,
 * 600, 800 and 900. They are Claude's palette, not the theme's, so a visual looks as Claude drew it.
 */
export const VISUAL_RAMPS = {
  purple: ['#EEEDFE', '#CECBF6', '#AFA9EC', '#7F77DD', '#534AB7', '#3C3489', '#26215C'],
  teal: ['#E1F5EE', '#9FE1CB', '#5DCAA5', '#1D9E75', '#0F6E56', '#085041', '#04342C'],
  coral: ['#FAECE7', '#F5C4B3', '#F0997B', '#D85A30', '#993C1D', '#712B13', '#4A1B0C'],
  pink: ['#FBEAF0', '#F4C0D1', '#ED93B1', '#D4537E', '#993556', '#72243E', '#4B1528'],
  gray: ['#F1EFE8', '#D3D1C7', '#B4B2A9', '#888780', '#5F5E5A', '#444441', '#2C2C2A'],
  blue: ['#E6F1FB', '#B5D4F4', '#85B7EB', '#378ADD', '#185FA5', '#0C447C', '#042C53'],
  green: ['#EAF3DE', '#C0DD97', '#97C459', '#639922', '#3B6D11', '#27500A', '#173404'],
  amber: ['#FAEEDA', '#FAC775', '#EF9F27', '#BA7517', '#854F0B', '#633806', '#412402'],
  red: ['#FCEBEB', '#F7C1C1', '#F09595', '#E24B4A', '#A32D2D', '#791F1F', '#501313'],
} as const;

/**
 * Inline scripts, because a visual's code is mostly inline scripts, and scripts, styles and fonts from the CDNs only
 * (and Google Fonts for styles and fonts). `unsafe-eval` too: chart and maths libraries build functions at run time,
 * and the frame is sandboxed either way. No forms, no frames, no base URL and no connections other than the CDNs.
 */
export function visualFrameCsp(): string {
  const cdns = VISUAL_CDNS.join(' ');
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${cdns}`,
    `style-src 'unsafe-inline' ${cdns} ${VISUAL_FONT_HOSTS.styles}`,
    `font-src data: ${cdns} ${VISUAL_FONT_HOSTS.files}`,
    `img-src data: blob: ${cdns}`,
    `connect-src ${cdns}`,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

const RAMP_NAMES = Object.keys(VISUAL_RAMPS) as Array<keyof typeof VISUAL_RAMPS>;
const coloured = RAMP_NAMES.map((name) => `.c-${name}`).join(', ');

/**
 * Each ramp's fill, stroke, title and subtitle: in light the 50 fill, 600 stroke, 800 title and 600 subtitle, in dark
 * the 800 fill, 200 stroke, 100 title and 200 subtitle.
 */
const rampRules = () =>
  RAMP_NAMES.map((name) => {
    const [s50, s100, s200, , s600, s800] = VISUAL_RAMPS[name];
    return `.c-${name} { --cf: ${s50}; --cs: ${s600}; --ct: ${s800}; --cu: ${s600}; }\n[data-mode='dark'] .c-${name} { --cf: ${s800}; --cs: ${s200}; --ct: ${s100}; --cu: ${s200}; }`;
  }).join('\n');

/**
 * What the desktop app gives a visual besides the theme's variables (`visualThemeVars` in the conversation): its sizes,
 * short names and serif, its pre-styled headings and controls, and the SVG classes (`t`, `ts`, `th`, `box`, `node`,
 * `arr`, `leader`, `c-*`). The colour classes work on the shapes and text directly under them, as in the desktop app.
 */
const STYLES = `
:root { color-scheme: light dark; --radius: 8px; --h-control: 36px; --pad-sm: 0.5rem; --pad-md: 0.75rem; --pad-lg: 1rem; --pad-xl: 1.5rem; --gap-xs: 4px; --gap-sm: 8px; --gap-md: 12px; --gap-lg: 16px; --gap-xl: 24px; --font-voice: ui-serif, Georgia, Cambria, 'Times New Roman', serif; --p: var(--text-primary); --s: var(--text-secondary); --t: var(--text-muted); --bg2: var(--surface-1); --b: var(--border); }
html, body { margin: 0; padding: 0; background: transparent; }
body { font-family: var(--font-sans); font-size: 16px; line-height: 1.7; color: var(--text-primary); overflow: hidden; -webkit-font-smoothing: antialiased; }
#root { display: flow-root; }
#root > svg { display: block; max-width: 100%; height: auto; }
h1, h2, h3 { color: var(--text-primary); font-weight: 500; line-height: 1.3; }
h1 { font-size: 22px; }
h2 { font-size: 18px; }
h3 { font-size: 16px; }
a { color: var(--text-accent); }
code, pre, kbd { font-family: var(--font-mono); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
button, input, select, textarea { font: inherit; font-size: 14px; color: inherit; }
button { min-height: 32px; padding: 0 12px; border: 0.5px solid var(--border-strong); border-radius: var(--radius); background: transparent; cursor: pointer; }
button:hover { background: var(--surface-1); }
button:active { transform: scale(0.98); }
:is(input:not([type]), input[type='text'], input[type='number'], input[type='email'], input[type='search'], input[type='url'], input[type='date'], select) { height: var(--h-control); box-sizing: border-box; padding: 0 10px; }
:is(input:not([type]), input[type='text'], input[type='number'], input[type='email'], input[type='search'], input[type='url'], input[type='date'], select, textarea) { border: 0.5px solid var(--border-strong); border-radius: var(--radius); background: var(--surface-2); }
:is(input, select, textarea):hover { border-color: var(--border-stronger); }
textarea { padding: 8px 10px; }
input[type='range'] { appearance: none; height: 4px; border-radius: 2px; background: var(--border-strong); }
input[type='range']::-webkit-slider-thumb { appearance: none; width: 18px; height: 18px; border-radius: 50%; background: var(--surface-2); border: 0.5px solid var(--border-stronger); cursor: pointer; }
input[type='checkbox'], input[type='radio'], progress { accent-color: var(--text-accent); }
:focus-visible { outline: 2px solid var(--text-accent); outline-offset: 1px; }
svg text { fill: var(--text-primary); font-family: var(--font-sans); }
svg .t { font-size: 14px; fill: var(--text-primary); }
svg .ts { font-size: 12px; fill: var(--text-secondary); }
svg .th { font-size: 14px; font-weight: 500; fill: var(--text-primary); }
svg .box { fill: var(--surface-1); stroke: var(--border-strong); }
svg .node { cursor: pointer; }
svg .node:hover { opacity: 0.8; }
svg .arr { fill: none; stroke: var(--text-secondary); stroke-width: 1.5px; }
svg .leader { fill: none; stroke: var(--text-muted); stroke-width: 0.5px; stroke-dasharray: 4 3; }
${rampRules()}
:is(rect, circle, ellipse):is(${coloured}), :is(${coloured}) > :is(rect, circle, ellipse) { fill: var(--cf); stroke: var(--cs); }
:is(${coloured}) > :is(.t, .th) { fill: var(--ct); }
:is(${coloured}) > .ts { fill: var(--cu); }
`;

/**
 * What draws a visual, in both of its pages: its scripts run once the whole code is in place, `sendPrompt` and
 * `openLink` work from a click or a key in it, a link goes to the browser, and its size is reported. Each page puts
 * `send` before it: how these reach the host (`size`, `drawn`, `prompt`, `link`).
 */
const RUNNER = `
  const root = document.getElementById('root');
  let drawn = false;
  let last = -1;
  const measure = () => Math.ceil(Math.max(root.scrollHeight, root.getBoundingClientRect().height));
  const report = () => {
    const height = measure();
    if (!drawn || height === last) return;
    last = height;
    send.size(height);
  };
  new ResizeObserver(report).observe(root);

  const setVars = (vars) => {
    for (const [name, value] of Object.entries(vars && typeof vars === 'object' ? vars : {})) {
      if (/^--[a-z0-9-]+$/.test(name) && typeof value === 'string') document.documentElement.style.setProperty(name, value);
    }
  };
  const setScheme = (scheme) => {
    if (scheme !== 'dark' && scheme !== 'light') return;
    document.documentElement.style.colorScheme = scheme;
    document.documentElement.dataset.mode = scheme;
  };

  // Only from something you did in the visual (a click, a key), never by itself as it loads.
  const used = () => !navigator.userActivation || navigator.userActivation.isActive;
  window.sendPrompt = (text) => used() && send.prompt(String(text));
  window.openLink = (url) => used() && send.link(String(url));
  // A link opens in the browser, never in the frame.
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || (link.getAttribute('href') || '').startsWith('#')) return;
    event.preventDefault();
    window.openLink(link.href);
  });

  // Scripts run once the whole code is in place, in order: one loaded from a CDN finishes before the next starts.
  let rendered = false;
  const run = async (code) => {
    if (rendered || typeof code !== 'string' || !code.trim()) return;
    rendered = true;
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
    send.drawn(last);
  };
`;

/**
 * Seshboard's own frame. Messages from the conversation: `render` (once) with the code and the theme, `theme` when it
 * changes. Messages to it: `ready`, `drawn` and `height` as it lays out, `prompt` and `link` from the visual.
 */
const SCRIPT = `(() => {
  const post = (message) => parent.postMessage(message, '*');
  const send = {
    size: (height) => post({ type: 'height', height }),
    drawn: (height) => post({ type: 'drawn', height }),
    prompt: (text) => post({ type: 'prompt', text }),
    link: (url) => post({ type: 'link', url }),
  };
${RUNNER}
  const applyTheme = (theme) => {
    if (!theme || typeof theme !== 'object') return;
    setVars(theme.vars);
    setScheme(theme.scheme);
  };
  window.addEventListener('message', (event) => {
    if (event.source !== parent || !event.data || typeof event.data !== 'object') return;
    const message = event.data;
    if (message.type === 'theme') applyTheme(message.theme);
    else if (message.type === 'render' && typeof message.code === 'string') {
      applyTheme(message.theme);
      void run(message.code);
    }
  });
  post({ type: 'ready' });
})();`;

/**
 * The MCP Apps spec's style variables a host may send, as the names a visual uses (its guide's): the page takes either.
 * Pairs of [the visual's name, the spec's name].
 */
const SPEC_VARIABLES: ReadonlyArray<readonly [string, string]> = [
  ['--text-primary', '--color-text-primary'],
  ['--text-secondary', '--color-text-secondary'],
  ['--text-muted', '--color-text-tertiary'],
  ['--text-disabled', '--color-text-disabled'],
  ['--surface-0', '--color-background-primary'],
  ['--surface-1', '--color-background-secondary'],
  ['--surface-2', '--color-background-primary'],
  ['--surface-3', '--color-background-primary'],
  ['--border', '--color-border-secondary'],
  ['--border-strong', '--color-border-primary'],
  ['--border-stronger', '--color-border-primary'],
  ['--bg-accent', '--color-background-info'],
  ['--text-accent', '--color-text-info'],
  ['--border-accent', '--color-border-info'],
  ...(['danger', 'success', 'warning'] as const).flatMap((role) => [
    [`--bg-${role}`, `--color-background-${role}`] as const,
    [`--text-${role}`, `--color-text-${role}`] as const,
    [`--border-${role}`, `--color-border-${role}`] as const,
  ]),
  ['--radius', '--border-radius-md'],
];

/**
 * What a visual looks like in a host that sends no theme (or only part of one): neutral greys and a blue accent, in
 * light and dark by the host's theme (`data-mode`) or else the system's.
 */
const APP_DEFAULTS = `
:root { --text-primary: light-dark(#1f1e1d, #f2f1ed); --text-secondary: light-dark(#5e5d59, #b4b2a9); --text-muted: light-dark(#87867f, #888780); --text-disabled: light-dark(#b4b2a9, #5f5e5a); --surface-0: light-dark(#f5f4ef, #1f1e1d); --surface-1: light-dark(#faf9f5, #262624); --surface-2: light-dark(#ffffff, #30302e); --surface-3: light-dark(#ffffff, #3a3a37); --border: light-dark(rgb(31 30 29 / 0.12), rgb(242 241 237 / 0.12)); --border-strong: light-dark(rgb(31 30 29 / 0.22), rgb(242 241 237 / 0.22)); --border-stronger: light-dark(rgb(31 30 29 / 0.4), rgb(242 241 237 / 0.4)); --bg-accent: light-dark(#e6f1fb, #0c447c); --text-accent: light-dark(#185fa5, #85b7eb); --border-accent: light-dark(#85b7eb, #185fa5); --bg-danger: light-dark(#fcebeb, #791f1f); --text-danger: light-dark(#a32d2d, #f09595); --border-danger: light-dark(#f09595, #a32d2d); --bg-success: light-dark(#eaf3de, #27500a); --text-success: light-dark(#3b6d11, #97c459); --border-success: light-dark(#97c459, #3b6d11); --bg-warning: light-dark(#faeeda, #633806); --text-warning: light-dark(#854f0b, #ef9f27); --border-warning: light-dark(#ef9f27, #854f0b); --font-sans: system-ui, -apple-system, 'Segoe UI', sans-serif; --font-mono: ui-monospace, Menlo, Consolas, monospace; }
`;

/**
 * The visual as an MCP App (`ui://visualize/widget`), for any host that speaks the spec (Seshboard, and others): it
 * asks to initialize, takes the host's theme (the spec's variables, as the visual's names), draws the call's
 * `widget_code` from `ui/notifications/tool-input`, and sends `sendPrompt` as `ui/message` and `openLink` as
 * `ui/open-link`.
 */
const APP_SCRIPT = `(() => {
  let next = 0;
  const waiting = new Map();
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++next;
    waiting.set(id, { resolve, reject });
    parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
  });
  const notify = (method, params) => parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
  const size = (height) => notify('ui/notifications/size-changed', { width: Math.ceil(document.documentElement.getBoundingClientRect().width), height });
  const send = {
    size,
    drawn: size,
    prompt: (text) => void request('ui/message', { role: 'user', content: { type: 'text', text } }).catch(() => {}),
    link: (url) => void request('ui/open-link', { url }).catch(() => {}),
  };
${RUNNER}
  const SPEC = ${JSON.stringify(SPEC_VARIABLES)};
  const applyHost = (context) => {
    if (!context || typeof context !== 'object') return;
    const vars = context.styles && context.styles.variables && typeof context.styles.variables === 'object' ? context.styles.variables : {};
    const ours = {};
    for (const [name, spec] of SPEC) if (typeof vars[spec] === 'string' && vars[spec]) ours[name] = vars[spec];
    for (const name of ['--font-sans', '--font-mono']) if (typeof vars[name] === 'string' && vars[name]) ours[name] = vars[name];
    setVars({ ...vars, ...ours });
    setScheme(context.theme);
  };
  window.addEventListener('message', (event) => {
    if (event.source !== parent || !event.data || event.data.jsonrpc !== '2.0') return;
    const message = event.data;
    if (message.id !== undefined && waiting.has(message.id)) {
      const pending = waiting.get(message.id);
      waiting.delete(message.id);
      return message.error ? pending.reject(message.error) : pending.resolve(message.result);
    }
    if (message.method === 'ui/notifications/tool-input') void run(message.params && message.params.arguments && message.params.arguments.widget_code);
    else if (message.method === 'ui/notifications/host-context-changed') applyHost(message.params);
    else if (message.method === 'ui/resource-teardown' && message.id !== undefined) parent.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, '*');
  });
  request('ui/initialize', { protocolVersion: ${JSON.stringify(MCP_APP_PROTOCOL_VERSION)}, appInfo: { name: 'Visual', version: '1' }, appCapabilities: { availableDisplayModes: ['inline'] } }).then(
    (result) => {
      applyHost(result && result.hostContext);
      notify('ui/notifications/initialized', {});
    },
    () => {},
  );
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

/**
 * The visual as an MCP App's page (what the `visualize` server serves at `ui://visualize/widget`): the same styles and
 * drawing as the frame page, defaults for a host that sends no theme, and the MCP Apps protocol instead of
 * Seshboard's. Its policy is the host's, from the origins the server declares (`VISUAL_APP_CSP`).
 */
export function visualAppHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${APP_DEFAULTS}${STYLES}</style>
</head>
<body>
<div id="root"></div>
<script>${APP_SCRIPT}</script>
</body>
</html>
`;
}

/** The origins the visual's MCP App declares (`_meta.ui.csp`): the CDNs for scripts, styles and fonts, and Google Fonts. */
export const VISUAL_APP_CSP = {
  resourceDomains: [...VISUAL_CDNS, VISUAL_FONT_HOSTS.styles, VISUAL_FONT_HOSTS.files],
  connectDomains: [...VISUAL_CDNS],
};

/** Whether a URL is a visual's frame page. */
export const isVisualFrameUrl = (url: string | null | undefined): boolean => typeof url === 'string' && url.startsWith(`${VISUAL_SCHEME}:`);

/** An origin an MCP App may declare: http(s) or ws(s), a host with an optional `*.` and port. Nothing wider. */
const DECLARED_ORIGIN = /^(?:https?|wss?):\/\/(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d{1,5})?$/i;
const MAX_ORIGINS = 32;

/** The origins of one list that are origins: a page can't widen its policy with `*`, `'unsafe-eval'` or a `;`. */
const origins = (list: unknown): string[] => (Array.isArray(list) ? list.filter((o): o is string => typeof o === 'string' && o.length <= 256 && DECLARED_ORIGIN.test(o)).slice(0, MAX_ORIGINS) : []);

/**
 * An MCP App page's policy, from what its server declared (`_meta.ui.csp`) and the spec's restrictive default for
 * the rest: inline scripts and styles, and only the origins it named for loading, connecting, frames and its base URL.
 */
export function mcpAppCsp(declared: McpAppCsp | null): string {
  const load = origins(declared?.resourceDomains).join(' ');
  const or = (list: unknown, none: string) => origins(list).join(' ') || none;
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${load}`.trim(),
    `style-src 'unsafe-inline' ${load}`.trim(),
    `img-src data: blob: ${load}`.trim(),
    `font-src data: ${load}`.trim(),
    `media-src data: blob: ${load}`.trim(),
    `connect-src ${or(declared?.connectDomains, "'none'")}`,
    `frame-src ${or(declared?.frameDomains, "'none'")}`,
    `base-uri ${or(declared?.baseUriDomains, "'none'")}`,
    "object-src 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** How many app pages are kept to serve: a frame loads its page once, so older ones are only for a reload. */
const MAX_APP_DOCUMENTS = 64;

/** The MCP App pages main serves at `seshboard-visual://app/<id>`, each with its own policy, the newest kept. */
export class McpAppDocuments {
  private readonly pages = new Map<string, { html: string; csp: string }>();

  /** Keeps a page and returns its address. */
  add(html: string, declared: McpAppCsp | null): string {
    const id = randomUUID();
    this.pages.set(id, { html, csp: mcpAppCsp(declared) });
    for (const old of this.pages.keys()) {
      if (this.pages.size <= MAX_APP_DOCUMENTS) break;
      this.pages.delete(old);
    }
    return `${VISUAL_SCHEME}://app/${id}`;
  }

  get(id: string): { html: string; csp: string } | undefined {
    return this.pages.get(id);
  }
}

/**
 * What main answers for `seshboard-visual://…`: the visual frame page at `frame/`, an MCP App's page at `app/<id>`
 * with its own policy, nothing anywhere else.
 */
export function visualFrameResponse(request: Request, apps?: McpAppDocuments): Response {
  const url = new URL(request.url);
  const html = (body: string, csp: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp, 'cache-control': 'no-store' } });
  if (url.host === 'frame' && (url.pathname === '/' || url.pathname === '')) return html(visualFrameHtml(), visualFrameCsp());
  const page = url.host === 'app' ? apps?.get(url.pathname.slice(1)) : undefined;
  return page ? html(page.html, page.csp) : new Response('Not found', { status: 404 });
}
