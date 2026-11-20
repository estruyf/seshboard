import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AppServer, AppServerOptions, CodexBinary } from './appServer.ts';
import { codexSessionsDir, ROLLOUT_FILE } from './codexFiles.ts';
import type { CodexLatestVersion } from './codexUpdate.ts';
import type { Methods, Model, Thread, Turn } from './protocol.ts';

/**
 * A made-up OpenAI Codex CLI for the demo home (the smoke test and the screenshots), in the process: installed,
 * signed in, with three models, rate limits, two MCP servers and a skill, and an app-server that answers from the
 * demo's rollout files and the conversations below, and renames them. Starting, continuing, forking or compacting a
 * session refuses (`CODEX_DEMO_REFUSAL`). Nothing is spawned, nothing ships as a file, and nothing ever reaches a real
 * Codex.
 */

/** One made-up thread: its id (in its rollout file's name), what it is called, and its conversation in a folder. */
interface DemoThread {
  id: string;
  name: string | null;
  preview: string;
  branch: string;
  /** How long it took, so `createdAt` is this much before the file's time. */
  minutes: number;
  turns(cwd: string): Turn[];
}

const at = (seconds: number) => ({ startedAtMs: null, completedAtMs: seconds * 1000 });

const turn = (id: string, items: Turn['items']): Turn => ({ id, items, itemsView: 'full', status: 'completed', error: null, startedAt: null, completedAt: null, durationMs: null });

/** The demo's Codex sessions, on acme-store. */
export const CODEX_DEMO_THREADS: readonly DemoThread[] = [
  {
    id: '019a7c00-0000-7000-8000-00000000c0d1',
    name: 'Add a search box to the product list',
    preview: 'Add a search box to the product list that filters by name',
    branch: 'main',
    minutes: 6,
    turns: (cwd) => [
      turn('019a7c00-0000-7000-8000-0000000a0001', [
        { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'Add a search box to the product list that filters by name' }], ...at(1) },
        { type: 'reasoning', id: 'r1', summary: ['**Reading the product list**'], content: [], ...at(2) },
        {
          type: 'commandExecution',
          id: 'call_read',
          command: "/bin/zsh -lc 'cat src/products/ProductList.tsx'",
          cwd,
          status: 'completed',
          commandActions: [{ type: 'read', command: 'cat src/products/ProductList.tsx', name: 'ProductList.tsx', path: 'src/products/ProductList.tsx' }],
          aggregatedOutput: 'export function ProductList({ products }) {\n  return <ul>{products.map((p) => <li key={p.id}>{p.name}</li>)}</ul>;\n}\n',
          exitCode: 0,
          durationMs: 30,
          ...at(3),
        },
        {
          type: 'fileChange',
          id: 'call_patch',
          status: 'completed',
          changes: [
            {
              path: join(cwd, 'src', 'products', 'ProductList.tsx'),
              kind: { type: 'update', move_path: null },
              diff: '@@ -1,3 +1,7 @@\n export function ProductList({ products }) {\n-  return <ul>{products.map((p) => <li key={p.id}>{p.name}</li>)}</ul>;\n+  const [query, setQuery] = useState(\'\');\n+  const shown = products.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));\n+  return (\n+    <>\n+      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products" />\n+      <ul>{shown.map((p) => <li key={p.id}>{p.name}</li>)}</ul>\n+    </>\n+  );\n }\n',
            },
          ],
          ...at(5),
        },
        { type: 'agentMessage', id: 'a1', text: 'The product list now has a search box. It filters by name as you type, and ignores case.', ...at(6) },
      ]),
    ],
  },
  {
    id: '019a7c00-0000-7000-8000-00000000c0d2',
    name: null,
    preview: 'Why does the orders test fail on CI?',
    branch: 'main',
    minutes: 3,
    turns: (cwd) => [
      turn('019a7c00-0000-7000-8000-0000000a0002', [
        { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'Why does the orders test fail on CI?' }], ...at(1) },
        {
          type: 'commandExecution',
          id: 'call_test',
          command: "/bin/zsh -lc 'npx vitest run src/orders'",
          cwd,
          status: 'completed',
          commandActions: [{ type: 'unknown', command: 'npx vitest run src/orders' }],
          aggregatedOutput: 'FAIL src/orders/orders.test.ts > sorts by date\nExpected "2026-03-01" but got "2026-02-28"\n',
          exitCode: 1,
          durationMs: 2400,
          ...at(4),
        },
        // The CI server's MCP App: a card for the run, drawn in the conversation (the smoke test's "MCP App").
        {
          type: 'mcpToolCall',
          id: 'call_ci',
          server: 'ci',
          tool: 'show_run',
          status: 'completed',
          arguments: { run: 4821 },
          mcpAppUi: { resourceUri: CODEX_DEMO_APP_URI, preferredModelDisplayMode: 'inline' },
          result: { content: [{ type: 'text', text: 'Run 4821: 213 passed, 1 failed' }], structuredContent: { run: 4821, passed: 213, failed: ['orders.test.ts > sorts by date'] } },
          error: null,
          ...at(4),
        },
        { type: 'agentMessage', id: 'a1', text: 'The test builds its dates in local time, and CI runs in UTC. Build them with `Date.UTC` and it passes in both.', ...at(5) },
      ]),
    ],
  },
];

/** The demo CI server's MCP App page. */
export const CODEX_DEMO_APP_URI = 'ui://ci/run';

/**
 * The demo's MCP App: a CI run as a card. It speaks the MCP Apps protocol by hand (no SDK): it asks to initialize,
 * takes the host's theme, shows the run from the call's result, reports its size, and has a button that sends a
 * message and one that calls a tool (refused while the session isn't running here, as in the demo).
 */
const CODEX_DEMO_APP = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
body { margin: 0; font: var(--font-text-md-size, 13px) var(--font-sans, system-ui); color: var(--color-text-primary, #111); }
.card { padding: 12px 14px; }
.failed { color: var(--color-text-danger, #c00); margin: 6px 0; padding-left: 18px; }
.row { display: flex; gap: 8px; }
button { font: inherit; padding: 4px 10px; border: 1px solid var(--color-border-primary, #ccc); border-radius: var(--border-radius-md, 6px); background: var(--color-background-secondary, #f5f5f5); color: inherit; }
#status { margin-top: 6px; color: var(--color-text-secondary, #666); }
</style></head>
<body><div class="card" id="card">
<div id="title">Loading the run</div>
<ul class="failed" id="failed"></ul>
<div class="row"><button id="ask" type="button">Ask about the failure</button><button id="rerun" type="button">Run again</button></div>
<div id="status"></div>
</div>
<script>
let next = 0;
const waiting = new Map();
const send = (method, params) => new Promise((resolve, reject) => { const id = ++next; waiting.set(id, { resolve, reject }); parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*'); });
const notify = (method, params) => parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
const theme = (context) => { for (const [name, value] of Object.entries(context?.styles?.variables ?? {})) document.documentElement.style.setProperty(name, value); if (context?.theme) document.documentElement.dataset.theme = context.theme; };
const card = document.getElementById('card');
new ResizeObserver(() => notify('ui/notifications/size-changed', { width: card.offsetWidth, height: Math.ceil(card.getBoundingClientRect().height) })).observe(card);
window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.id !== undefined && waiting.has(message.id)) { const pending = waiting.get(message.id); waiting.delete(message.id); return message.error ? pending.reject(message.error) : pending.resolve(message.result); }
  if (message.method === 'ui/notifications/tool-input') document.body.dataset.run = String(message.params.arguments.run);
  if (message.method === 'ui/notifications/host-context-changed') theme(message.params);
  if (message.method === 'ui/notifications/tool-result') {
    const run = message.params.structuredContent;
    document.getElementById('title').textContent = 'Run ' + run.run + ': ' + run.passed + ' passed, ' + run.failed.length + ' failed';
    for (const name of run.failed) { const item = document.createElement('li'); item.textContent = name; document.getElementById('failed').append(item); }
    document.body.dataset.result = 'shown';
  }
});
document.getElementById('ask').addEventListener('click', () => send('ui/message', { role: 'user', content: { type: 'text', text: 'Why does orders.test.ts fail on CI?' } }));
document.getElementById('rerun').addEventListener('click', () => send('tools/call', { name: 'rerun', arguments: { run: 4821 } }).then(
  () => { document.body.dataset.rerun = 'ran'; },
  (error) => { document.body.dataset.rerun = 'refused'; document.getElementById('status').textContent = error.message; },
));
send('ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: 'CI run', version: '1' }, appCapabilities: {} }).then((result) => {
  theme(result.hostContext);
  document.body.dataset.host = result.hostInfo.name;
  notify('ui/notifications/initialized', {});
});
</script></body></html>`;

/** A rollout file's first line, as Codex CLI writes it (`session_meta`). The demo app-server reads the folder from it. */
export function codexDemoRollout(thread: Pick<DemoThread, 'id'>, cwd: string, time: Date): string {
  return `${JSON.stringify({ timestamp: time.toISOString(), type: 'session_meta', payload: { id: thread.id, timestamp: time.toISOString(), cwd, originator: 'codex_cli_rs', cli_version: '0.167.0', source: 'cli' } })}\n`;
}

/** The demo's rollout files under `sessions/YYYY/MM/DD/`, by thread id: what the app-server lists. */
function rollouts(codexHomeDir: string): Map<string, string> {
  const found = new Map<string, string>();
  const dir = codexSessionsDir(codexHomeDir);
  const list = (path: string) => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  };
  for (const year of list(dir)) for (const month of list(join(dir, year))) for (const day of list(join(dir, year, month))) {
    for (const name of list(join(dir, year, month, day))) {
      const id = ROLLOUT_FILE.exec(name)?.[1]?.toLowerCase();
      if (id) found.set(id, join(dir, year, month, day, name));
    }
  }
  return found;
}

/** A demo thread as `thread/list` gives it, from its rollout file (moved to the Trash: gone). */
function threadOf(demo: DemoThread, file: string): Thread | undefined {
  try {
    const meta = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]!) as { payload?: { cwd?: string } };
    const updatedAt = Math.floor(statSync(file).mtimeMs / 1000);
    return {
      id: demo.id,
      forkedFromId: null,
      parentThreadId: null,
      preview: demo.preview,
      ephemeral: false,
      historyMode: 'paginated',
      modelProvider: 'openai',
      model: 'gpt-5.3-codex',
      createdAt: updatedAt - demo.minutes * 60,
      updatedAt,
      status: { type: 'notLoaded' },
      path: file,
      cwd: meta.payload?.cwd ?? '',
      cliVersion: '0.167.0',
      originator: 'codex_cli_rs',
      source: 'cli',
      gitInfo: { sha: null, branch: demo.branch, originUrl: null },
      name: demo.name,
      turns: [],
    };
  } catch {
    return undefined;
  }
}

/** What the demo's Codex says when asked to start or continue a session. */
export const CODEX_DEMO_REFUSAL = 'The demo has no Codex CLI to run sessions';

const efforts = (...levels: string[]) => levels.map((reasoningEffort) => ({ reasoningEffort, description: `${reasoningEffort} reasoning` }));

/** The demo's models (`model/list`): the default one with every effort, a smaller one with fewer, and one without. */
export const CODEX_DEMO_MODELS: Model[] = [
  { id: 'gpt-5.3-codex', model: 'gpt-5.3-codex', displayName: 'GPT-5.3 Codex', description: 'Codex for coding', hidden: false, supportedReasoningEfforts: efforts('low', 'medium', 'high', 'xhigh'), defaultReasoningEffort: 'medium', inputModalities: ['text', 'image'], isDefault: true },
  { id: 'gpt-5.3-codex-mini', model: 'gpt-5.3-codex-mini', displayName: 'GPT-5.3 Codex Mini', description: 'Faster and cheaper', hidden: false, supportedReasoningEfforts: efforts('medium', 'high'), defaultReasoningEffort: 'medium', inputModalities: ['text'], isDefault: false },
  { id: 'gpt-5.2', model: 'gpt-5.2', displayName: 'GPT-5.2', description: 'General model', hidden: false, supportedReasoningEfforts: [], defaultReasoningEffort: 'none', inputModalities: ['text'], isDefault: false },
];

/**
 * The demo account's rate limits (`account/rateLimits/read`): a 5-hour window and a weekly one, as Codex reports them
 * (percent used, the window's length in minutes, when it resets in seconds since the epoch).
 */
export function codexDemoRateLimits(now = Date.now()) {
  const at = (hours: number) => Math.floor(now / 1000 + hours * 3600);
  return {
    rateLimits: {
      limitId: 'codex',
      limitName: null,
      primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: at(3) },
      secondary: { usedPercent: 41, windowDurationMins: 10_080, resetsAt: at(4 * 24) },
      credits: null,
      planType: 'plus',
    },
  };
}

/** The demo's MCP servers (`mcpServerStatus/list`), for Tools. */
export const CODEX_DEMO_MCP_SERVERS = [
  { name: 'github', pluginId: null, tools: { create_issue: { name: 'create_issue', description: 'Open an issue' }, list_pull_requests: { name: 'list_pull_requests', description: 'List pull requests' } }, resources: [], resourceTemplates: [], authStatus: 'oAuth' },
  { name: 'linear', pluginId: null, tools: { create_issue: { name: 'create_issue', description: 'Create a Linear issue' } }, resources: [], resourceTemplates: [], authStatus: 'bearerToken' },
];

/**
 * The demo's MCP servers as Codex's config has them (`config/read`), for Tools of a session not running here: names
 * and whether they're on, with made-up commands.
 */
export const CODEX_DEMO_MCP_CONFIG = {
  github: { url: 'https://example.invalid/github/mcp', enabled: true },
  linear: { command: 'demo-linear-mcp', args: [], enabled: true },
};

/** The demo's hook (`hooks/list`), for Tools. */
export const CODEX_DEMO_HOOK = {
  key: 'demo-lint',
  eventName: 'postToolUse',
  matcher: 'apply_patch',
  statusMessage: null,
  source: 'user',
  pluginId: null,
  enabled: true,
  handlerType: 'command',
  command: 'npm run lint',
  async: false,
};

/** The demo's skill (`skills/list`), for Tools, in the user's `CODEX_HOME`. */
export const codexDemoSkills = (codexHomeDir: string, cwds: readonly string[]) => ({
  data: (cwds.length ? cwds : ['']).map((cwd) => ({
    cwd,
    skills: [{ name: 'release-notes', description: 'Write release notes from the merged pull requests', shortDescription: 'Release notes', path: join(codexHomeDir, 'skills', 'release-notes', 'SKILL.md'), scope: 'user', enabled: true }],
    errors: [],
  })),
});

/** Names given in the demo (`thread/name/set`), by thread id: kept for the run, so a rename shows in the list. */
const DEMO_NAMES = new Map<string, string>();

/** The in-process app-server: answers the read methods for the demo threads that have a rollout file in `CODEX_HOME`. */
function demoAppServer(options: AppServerOptions): AppServer {
  const threads = async (): Promise<Thread[]> => {
    const home = (await options.env()).CODEX_HOME;
    if (!home) return [];
    const files = rollouts(home);
    return CODEX_DEMO_THREADS.flatMap((demo) => {
      const file = files.get(demo.id);
      const thread = file ? threadOf(demo, file) : undefined;
      return thread ? [{ ...thread, name: DEMO_NAMES.get(thread.id) ?? thread.name }] : [];
    }).sort((a, b) => b.updatedAt - a.updatedAt);
  };
  const find = async (threadId: string) => {
    const thread = (await threads()).find((t) => t.id === threadId);
    if (!thread) throw new Error(`no rollout found for thread id ${threadId}`);
    return thread;
  };
  const answer = async (method: keyof Methods, params: Record<string, unknown>): Promise<unknown> => {
    // As a string: the methods Phase 3 adds (rate limits, skills, rename) may not be in `Methods` on every branch yet.
    switch (method as string) {
      case 'thread/list':
        return { data: params.archived ? [] : await threads(), nextCursor: null };
      case 'thread/read':
        return { thread: await find(String(params.threadId)) };
      case 'thread/turns/list': {
        const thread = await find(String(params.threadId));
        const turns = CODEX_DEMO_THREADS.find((d) => d.id === thread.id)!.turns(thread.cwd);
        return { data: params.sortDirection === 'desc' ? [...turns].reverse() : turns, nextCursor: null };
      }
      case 'account/read':
        return { account: { type: 'chatgpt', email: 'demo-user@example.com', planType: 'plus', workspaceName: null }, requiresOpenaiAuth: true };
      case 'model/list':
        return { data: CODEX_DEMO_MODELS, nextCursor: null };
      case 'account/rateLimits/read':
        return codexDemoRateLimits();
      case 'mcpServerStatus/list':
        return { data: CODEX_DEMO_MCP_SERVERS, nextCursor: null };
      case 'skills/list':
        return codexDemoSkills((await options.env()).CODEX_HOME ?? '', Array.isArray(params.cwds) ? params.cwds.map(String) : []);
      case 'config/read':
        return { config: { mcp_servers: CODEX_DEMO_MCP_CONFIG } };
      case 'hooks/list': {
        const cwds = Array.isArray(params.cwds) && params.cwds.length ? params.cwds.map(String) : [''];
        return { data: cwds.map((cwd) => ({ cwd, hooks: [CODEX_DEMO_HOOK], warnings: [], errors: [] })) };
      }
      case 'config/mcpServer/reload':
        return {};
      case 'mcpServer/resource/read':
        if (params.server !== 'ci' || params.uri !== CODEX_DEMO_APP_URI) throw new Error(`no resource ${String(params.uri)}`);
        return { contents: [{ uri: CODEX_DEMO_APP_URI, mimeType: 'text/html;profile=mcp-app', text: CODEX_DEMO_APP, _meta: { ui: { prefersBorder: false } } }], originCallId: params.originCallId ?? null };
      case 'thread/name/set': {
        const thread = await find(String(params.threadId));
        DEMO_NAMES.set(thread.id, String(params.name ?? '').trim() || thread.name || '');
        return {};
      }
      default:
        // Starting, continuing, forking or compacting a session refuses: a smoke run never reaches a real Codex, nor
        // looks like it did.
        throw new Error(CODEX_DEMO_REFUSAL);
    }
  };
  return {
    request: (method, params) => answer(method, params as Record<string, unknown>) as never,
    pid: () => null,
    onNotification: () => () => {},
    handleRequests: () => {},
    hold: () => () => {},
    onExit: () => () => {},
    dispose: async () => {},
  };
}

/** The demo's Codex CLI version, which its update check also says is the latest. */
const DEMO_VERSION = '0.167.0';

/** The made-up Codex CLI, as `ProviderOptions['codex']`. Its update check says it is up to date, without the network. */
export function demoCodex(): { binary: () => Promise<CodexBinary>; createAppServer: (options: AppServerOptions) => AppServer; latestVersion: CodexLatestVersion } {
  return { binary: async () => ({ path: '/demo/bin/codex', version: DEMO_VERSION }), createAppServer: demoAppServer, latestVersion: async () => DEMO_VERSION };
}
