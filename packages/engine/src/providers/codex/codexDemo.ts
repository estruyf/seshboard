import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AppServer, AppServerOptions, CodexBinary } from './appServer.ts';
import { codexSessionsDir, ROLLOUT_FILE } from './codexFiles.ts';
import type { Methods, Thread, Turn } from './protocol.ts';

/**
 * A made-up OpenAI Codex CLI for the demo home (the smoke test), in the process: installed,
 * signed in, and an app-server that answers from the demo's rollout files and the conversations below. Nothing is
 * spawned, nothing ships as a file, and nothing ever reaches a real Codex.
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
        { type: 'agentMessage', id: 'a1', text: 'The test builds its dates in local time, and CI runs in UTC. Build them with `Date.UTC` and it passes in both.', ...at(5) },
      ]),
    ],
  },
];

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

/** The in-process app-server: answers the read methods for the demo threads that have a rollout file in `CODEX_HOME`. */
function demoAppServer(options: AppServerOptions): AppServer {
  const threads = async (): Promise<Thread[]> => {
    const home = (await options.env()).CODEX_HOME;
    if (!home) return [];
    const files = rollouts(home);
    return CODEX_DEMO_THREADS.flatMap((demo) => {
      const file = files.get(demo.id);
      const thread = file ? threadOf(demo, file) : undefined;
      return thread ? [thread] : [];
    }).sort((a, b) => b.updatedAt - a.updatedAt);
  };
  const find = async (threadId: string) => {
    const thread = (await threads()).find((t) => t.id === threadId);
    if (!thread) throw new Error(`no rollout found for thread id ${threadId}`);
    return thread;
  };
  const answer = async (method: keyof Methods, params: Record<string, unknown>): Promise<unknown> => {
    switch (method) {
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
      default:
        // The demo never runs a Codex session: a smoke run must not look like it reached one.
        throw new Error("The demo's Codex doesn't run sessions");
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

/** The made-up Codex CLI, as `ProviderOptions['codex']`. */
export function demoCodex(): { binary: () => Promise<CodexBinary>; createAppServer: (options: AppServerOptions) => AppServer } {
  return { binary: async () => ({ path: '/demo/bin/codex', version: '0.167.0' }), createAppServer: demoAppServer };
}
