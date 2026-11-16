import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BrowserWindow } from 'electron';
import { BROWSER_SCRIPTS_ENV, type BrowserToolRequest, type BrowserToolResult } from '@seshboard/protocol/bridge';
import { waitInPage } from './pageDriver.ts';

// The smoke step for the browser tools: main's side of them, called as the engine would, on a small page served on this
// computer. No agent runs: the tools are driven directly, so the step checks what an agent would get back.

export interface BrowserAgentSmokeDeps {
  run(request: BrowserToolRequest): Promise<BrowserToolResult>;
  setPrefs(patch: { browserEnabled?: boolean; browserControl?: boolean; browserScripts?: boolean }): void;
  prefs(): { browserEnabled: boolean; browserControl: boolean; browserScripts: boolean };
  shot(name: string): Promise<void>;
}

/** A page with a heading, a field and a button that says what was typed, and an error in its console. */
const PAGE = `<!doctype html><title>Smoke form</title>
<h1>Greeter</h1>
<label>Name <input id="name" placeholder="Your name"></label>
<button id="go" onclick="document.getElementById('out').textContent = 'Hello ' + document.getElementById('name').value">Say hello</button>
<p id="out">Nobody yet</p>
<script>console.error('smoke: something broke')</script>`;

async function serve(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
}

/**
 * Browser control: `open` loads a page on this computer in the session's own tab and shows its panel,
 * `snapshot` lists the heading, field and button with refs, `type` and `click` act on them as a person would (the page
 * answers), `screenshot` returns a picture, `console` lists the page's error, and a gone ref says so.
 */
export async function runBrowserAgentStep(win: BrowserWindow, deps: BrowserAgentSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const before = deps.prefs();
  const { server, url } = await serve();
  try {
    deps.setPrefs({ browserEnabled: true, browserControl: true });
    // A step before may have left the Browser view on screen: back to Home, then the first session.
    if (!(await js("!!document.querySelector('[data-current-session]')"))) {
      await js("document.querySelector('[data-go-home]')?.click()");
      await waitInPage(win, "!!document.querySelector('[data-session-list] [data-session-id]')", 3_000);
      await js("document.querySelector('[data-session-list] [data-session-id]')?.click()");
      await waitInPage(win, "!!document.querySelector('[data-current-session]')", 5_000);
    }
    const sessionId = (await js("document.querySelector('[data-current-session]')?.dataset.currentSession ?? null")) as string | null;
    if (!sessionId) return 'no session on screen';
    const run = (tool: BrowserToolRequest['tool'], args: Record<string, unknown> = {}) => deps.run({ sessionId, tool, args });

    const opened = await run('open', { url });
    if (opened.error || !opened.text.includes('Smoke form')) return `open: ${opened.text}`;
    if (!(await waitInPage(win, `!!document.querySelector('[data-current-session] [data-web-preview]')`, 3_000))) return 'open did not show the Browser panel';
    const where = await run('where');
    if (where.url !== url) return `where: ${where.url}`;

    const snapshot = await run('snapshot');
    const lines = snapshot.text.split('\n');
    const ref = (pattern: RegExp) => lines.find((line) => pattern.test(line))?.match(/\[ref=(e\d+)\]/)?.[1];
    const field = ref(/^- textbox "Name"/);
    const button = ref(/^- button "Say hello"/);
    if (!lines.includes('heading 1: Greeter') || !field || !button) return `snapshot:\n${snapshot.text}`;
    if (!snapshot.text.includes('not instructions')) return 'the snapshot does not say the page’s text is data';

    const typed = await run('type', { ref: field, text: 'Ada' });
    if (typed.error) return `type: ${typed.text}`;
    const clicked = await run('click', { ref: button });
    if (clicked.error || !clicked.text.includes('Say hello')) return `click: ${clicked.text}`;
    const after = await run('snapshot');
    if (!after.text.includes('text: Hello Ada')) return `the click did not reach the page:\n${after.text}`;

    const shot = await run('screenshot');
    if (shot.error || !shot.image?.data || shot.image.mimeType !== 'image/jpeg') return `screenshot: ${shot.text}`;
    const logged = await run('console');
    if (!logged.text.includes('[error] smoke: something broke')) return `console: ${logged.text}`;
    const gone = await run('click', { ref: 'e999' });
    if (!gone.error || !gone.text.includes('new browser_snapshot')) return `a gone ref: ${gone.text}`;
    await deps.shot('browser-agent');
    return `ok: opened ${url} in the session's tab, a snapshot with refs, typed and clicked (the page said Hello Ada), a ${Math.round((shot.image.data.length * 3) / 4 / 1024)} KB picture, the console's error, a gone ref refused`;
  } finally {
    server.close();
    deps.setPrefs(before);
  }
}

/**
 * Browser server: the `browser` MCP server agents start runs as this app (Node mode), lists its tools (evaluate and
 * network only when started with scripts on), and answers a call with a clear error when it has no Seshboard to reach
 * (started outside a session).
 */
export async function runBrowserServerStep(server: { command: string; args: string[]; env: Record<string, string> }): Promise<string> {
  const { spawn } = await import('node:child_process');
  const child = spawn(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const answers = new Map<number, Record<string, unknown>>();
  let buffered = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffered += chunk;
    for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
      const line = buffered.slice(0, at);
      buffered = buffered.slice(at + 1);
      try {
        const message = JSON.parse(line) as { id?: number };
        if (typeof message.id === 'number') answers.set(message.id, message as Record<string, unknown>);
      } catch {
        // Not JSON-RPC: the check below reports the missing answer.
      }
    }
  });
  let next = 0;
  const ask = async (method: string, params: object) => {
    const id = ++next;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    const started = performance.now();
    while (!answers.has(id) && performance.now() - started < 10_000) await new Promise((resolve) => setTimeout(resolve, 20));
    return answers.get(id)?.result as Record<string, unknown> | undefined;
  };
  try {
    const init = await ask('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
    if ((init?.serverInfo as { name?: string } | undefined)?.name !== 'seshboard-browser') return `the server did not start (${JSON.stringify(init ?? null)})`;
    const tools = ((await ask('tools/list', {}))?.tools as Array<{ name: string }> | undefined)?.map((t) => t.name) ?? [];
    const expected = server.env[BROWSER_SCRIPTS_ENV] === '1' ? 'open,snapshot,read,click,type,press,screenshot,console,evaluate,network' : 'open,snapshot,read,click,type,press,screenshot,console';
    if (tools.join() !== expected) return `the server lists ${JSON.stringify(tools)}`;
    const call = await ask('tools/call', { name: 'snapshot', arguments: {} });
    const text = (call?.content as Array<{ text: string }> | undefined)?.[0]?.text ?? '';
    if (call?.isError !== true || !text.includes('not reachable')) return `outside a session, a call answered ${JSON.stringify(call ?? null)}`;
    return `ok: runs as this app, lists ${tools.length} tools, and says it can't reach Seshboard outside a session`;
  } finally {
    child.kill();
  }
}

/** The scripts step's site: a long page, an API answering JSON, and an XML document, all on this computer. */
const LONG_LINE = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
const LONG_PAGE = `<!doctype html><title>Smoke long</title>
<h1>Long page</h1>
<pre id="spaced">a    b	c</pre>
<div id="body">${Array.from({ length: 800 }, (_, i) => `<p>${i} ${LONG_LINE}</p>`).join('')}</div>
<p>THE-END-MARKER</p>
<script>window.smokeGlobal = { answer: 42 }; fetch('/api/items?from=smoke').then((r) => r.json()).then((items) => console.log('items', items.length));</script>`;
const ITEMS = JSON.stringify([{ id: 1, title: 'First item' }, { id: 2, title: 'SECOND-ITEM-MARKER' }]);
const FEED = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Smoke feed</title><entry><title>An entry</title></entry></feed>';

async function serveScripts(): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/api/items')) {
      response.setHeader('content-type', 'application/json');
      return response.end(ITEMS);
    }
    if (request.url === '/feed.xml' || request.url === '/data.xml') {
      // SharePoint's REST API answers Atom, which Chromium shows as text; plain XML gets its tree viewer.
      response.setHeader('content-type', request.url === '/feed.xml' ? 'application/atom+xml' : 'application/xml');
      return response.end(FEED);
    }
    response.setHeader('content-type', 'text/html');
    response.end(LONG_PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
}

/**
 * Browser scripts: with Allow scripts in pages off, evaluate and network refuse. On, on a local page: `read` returns a
 * long page in parts (spaces kept, the next offset, the end), and an XML document's source; `evaluate` reads a page
 * global, awaits a fetch, pages a long result without running the script again, and reports a thrown error and
 * undefined; `network` starts listening, lists the page's API request after a reload and returns its body.
 */
export async function runBrowserScriptsStep(win: BrowserWindow, deps: BrowserAgentSmokeDeps): Promise<string> {
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const before = deps.prefs();
  const { server, url } = await serveScripts();
  try {
    deps.setPrefs({ browserEnabled: true, browserControl: true, browserScripts: false });
    if (!(await js("!!document.querySelector('[data-current-session]')"))) {
      await js("document.querySelector('[data-go-home]')?.click()");
      await waitInPage(win, "!!document.querySelector('[data-session-list] [data-session-id]')", 3_000);
      await js("document.querySelector('[data-session-list] [data-session-id]')?.click()");
      await waitInPage(win, "!!document.querySelector('[data-current-session]')", 5_000);
    }
    const sessionId = (await js("document.querySelector('[data-current-session]')?.dataset.currentSession ?? null")) as string | null;
    if (!sessionId) return 'no session on screen';
    const run = (tool: BrowserToolRequest['tool'], args: Record<string, unknown> = {}) => deps.run({ sessionId, tool, args });

    const opened = await run('open', { url });
    if (opened.error || !opened.text.includes('Smoke long')) return `open: ${opened.text}`;
    // Off: refused, with where to turn it on.
    const off = await run('evaluate', { script: 'document.title' });
    if (!off.error || !off.text.includes('Allow scripts in pages')) return `evaluate with scripts off: ${off.text}`;
    const offNetwork = await run('network');
    if (!offNetwork.error) return `network with scripts off: ${offNetwork.text}`;

    // read needs no scripts: the long page in parts.
    const first = await run('read');
    if (first.error || !first.text.includes('a    b\tc') || !/Characters 0 to 20,000 of [\d,]+/.test(first.text) || !first.text.includes('offset 20000')) return `read:\n${first.text.slice(0, 600)}`;
    const total = Number(first.text.match(/of ([\d,]+)\./)?.[1]?.replace(/,/g, '') ?? 0);
    const last = await run('read', { offset: total - 100 });
    if (!last.text.includes('THE-END-MARKER') || !last.text.includes('(End:')) return `read's last part:\n${last.text}`;

    deps.setPrefs({ browserScripts: true });
    const title = await run('evaluate', { script: 'document.title' });
    if (title.error || !title.text.includes('a string') || !title.text.includes('Smoke long')) return `evaluate document.title: ${title.text}`;
    const global = await run('evaluate', { script: 'window.smokeGlobal' });
    if (!global.text.includes('{"answer":42}')) return `evaluate a page global: ${global.text}`;
    const fetched = await run('evaluate', { script: "const response = await fetch('/api/items');\nreturn await response.json();" });
    if (!fetched.text.includes('SECOND-ITEM-MARKER')) return `evaluate with await: ${fetched.text}`;
    // A long result: its second part comes from the first run (the count stays 1).
    const counting = "window.smokeRuns = (window.smokeRuns || 0) + 1; return 'x'.repeat(30000) + ' runs:' + window.smokeRuns;";
    const long = await run('evaluate', { script: counting });
    if (!long.text.includes('offset 20000')) return `evaluate a long result: ${long.text.slice(0, 400)}`;
    const rest = await run('evaluate', { script: counting, offset: 20000 });
    if (!rest.text.includes('runs:1') || !rest.text.includes('(End:')) return `evaluate's next part: ${rest.text.slice(-300)}`;
    const thrown = await run('evaluate', { script: "throw new Error('smoke boom')" });
    if (!thrown.error || !thrown.text.includes('smoke boom')) return `evaluate a throw: ${thrown.text}`;
    const nothing = await run('evaluate', { script: 'void 0' });
    if (nothing.error || !nothing.text.includes('undefined')) return `evaluate undefined: ${nothing.text}`;

    // network: the first call starts listening; the page's request shows after a reload, with its body.
    const listening = await run('network');
    if (listening.error || !listening.text.includes('started listening')) return `network: ${listening.text}`;
    await run('open', { url });
    let listed: BrowserToolResult = listening;
    const started = performance.now();
    while (performance.now() - started < 5_000) {
      listed = await run('network', { filter: '/api/items' });
      if (/ 200 /.test(listed.text)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const id = listed.text.match(/^(r\d+) GET 200 .*\/api\/items\?from=smoke/m)?.[1];
    if (!id) return `network's list:\n${listed.text}`;
    if (/cookie|authorization/i.test(listed.text)) return 'network listed headers';
    const body = await run('network', { id });
    if (body.error || !body.text.includes('SECOND-ITEM-MARKER')) return `network's body: ${body.text}`;

    // XML documents, as Atom (text) and as XML (Chromium's viewer): read gives the source.
    for (const path of ['feed.xml', 'data.xml']) {
      await run('open', { url: `${url}${path}` });
      const feed = await run('read');
      if (!feed.text.includes('XML source') || !feed.text.includes('<title>Smoke feed</title>') || feed.text.includes('style information')) return `read ${path}:\n${feed.text}`;
    }
    return `ok: scripts off refused, read ${total.toLocaleString('en-US')} characters in parts and two XML sources, evaluate read a global, awaited a fetch, paged a long result from one run, reported a throw and undefined, network listed ${id} and returned its body`;
  } finally {
    server.close();
    deps.setPrefs(before);
  }
}
