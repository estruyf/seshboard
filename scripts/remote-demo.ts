/**
 * The remote app against a made-up computer, to see it in a browser without a real Seshboard: the real Remote hub
 * (handshakes, contract, what a phone may do) on top of demo sessions, prompts, transcripts and changes. Pairing is
 * allowed by itself.
 *
 *   npm run dev:remote          # the remote app at http://localhost:5199/remote/
 *   node --experimental-transform-types scripts/remote-demo.ts   # prints a pairing link; open it in a browser
 *
 * Nothing here touches ~/.claude or a real project: the database and the key live in a folder in the temp folder (so a
 * paired browser stays paired across runs), and every answer only changes the demo world.
 *
 * The smoke test runs it as a second computer for the app (Other computers): `SESHBOARD_DEMO_DIR` puts the database
 * and key in a throwaway folder, `SESHBOARD_DEMO_NAME` names the computer, `PORT` picks the port, and the line
 * `pairing-link: …` is the link to paste. A pairing link is good for two minutes, so with `SESHBOARD_DEMO_LINK_FILE`
 * a fresh one is written there every minute. New session there adds a session with the prompt as its title.
 * `SESHBOARD_DEMO_THEME` names the built-in theme it shows (`catppuccin`, `nord`…; Demo Time without it).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountTag, BUILT_IN_PIPELINES, costOf, sharesOf, weightOf, type AskThread, type Pipeline, type PipelineRun, type PipelineRunState, type PipelineRunStep, type CatchUp, type GitChanges, type PermissionRequest, type QueuedMessage, type SessionHostInfo, type SessionSummary, type TokenCounts, type TranscriptMessage, type TranscriptUpdate, type UsageBreakdown, type UsageGroup, type UsagePeriod, type UsageRow } from '@seshboard/protocol';
import type { ThemeFile, ThemeModeFile } from '@seshboard/protocol/theme-format';
import { createAppStateStore } from '../packages/engine/src/db/appState.ts';
import { NO_GLOBAL_MODEL } from '../packages/engine/src/remote/remoteView.ts';
import { openCacheDatabase } from '../packages/engine/src/db/database.ts';
import { RemoteHub, type RemotePipelines } from '../packages/engine/src/remote/remoteHub.ts';

const APP_URL = process.env.SESHBOARD_REMOTE_APP_URL ?? 'http://localhost:5199/remote/';
const PORT = Number(process.env.PORT ?? 47699);
const MINUTE = 60_000;
const now = Date.now();

const PROJECTS = [
  { root: '/demo/tideline', name: 'tideline', profileId: null },
  { root: '/demo/harbor-api', name: 'harbor-api', profileId: 'work' },
  { root: '/demo/lighthouse', name: 'lighthouse', profileId: null },
];
const NO_DEFAULTS = { model: null, effort: null, permissionMode: null, workspace: null, baseRef: null };
/** The same accounts on every demo computer, so two of them show each profile once. */
const PROFILES = [
  { id: 'default', name: 'Personal', color: 'yellow' as const, defaults: NO_DEFAULTS, account: accountTag({ email: 'demo@example.com', organization: null }) },
  { id: 'work', name: 'Work', color: 'blue' as const, defaults: { ...NO_DEFAULTS, workspace: 'worktree' as const }, account: accountTag({ email: 'demo@example.com', organization: 'Acme' }) },
];
/** The profile a demo session runs with: its project's. */
const profileOf = (root: string) => PROJECTS.find((p) => p.root === root)?.profileId ?? 'default';

interface DemoSession {
  id: string;
  title: string;
  root: string;
  branch: string;
  minutesAgo: number;
  state: 'needs-you' | 'running' | 'idle' | null;
  unread?: boolean;
  /** A pipeline step's sub-session: the session (or run row) it sits under. */
  parentId?: string;
}

/** The demo's pipeline runs (#179): a session whose run waits at Push, and a run started from New session that works. */
const TOGGLE = 'a0000000-0000-4000-8000-000000000009';
const ROW_RUN = 'run-demo-webhook-retries';

const SESSIONS: DemoSession[] = [
  { id: 'a0000000-0000-4000-8000-000000000001', title: 'Publish the beta', root: '/demo/tideline', branch: 'release/0.9', minutesAgo: 2, state: 'needs-you' },
  { id: 'a0000000-0000-4000-8000-000000000002', title: 'Fix the flaky upload test', root: '/demo/harbor-api', branch: 'fix/upload-retry', minutesAgo: 6, state: 'needs-you' },
  { id: 'a0000000-0000-4000-8000-000000000003', title: 'Pick a cache for the tiles', root: '/demo/lighthouse', branch: 'main', minutesAgo: 9, state: 'needs-you' },
  { id: 'a0000000-0000-4000-8000-000000000004', title: 'Move the login form to the new API', root: '/demo/tideline', branch: 'feat/login-api', minutesAgo: 1, state: 'running' },
  { id: 'a0000000-0000-4000-8000-000000000005', title: 'Add rate limits to the webhooks', root: '/demo/harbor-api', branch: 'feat/rate-limits', minutesAgo: 34, state: 'idle', unread: true },
  { id: 'a0000000-0000-4000-8000-000000000006', title: 'Tidy up the release notes', root: '/demo/tideline', branch: 'main', minutesAgo: 95, state: null },
  { id: 'a0000000-0000-4000-8000-000000000007', title: 'Explain the tile renderer', root: '/demo/lighthouse', branch: 'main', minutesAgo: 60 * 26, state: null },
  { id: 'a0000000-0000-4000-8000-000000000008', title: 'Upgrade to Node 24', root: '/demo/harbor-api', branch: 'chore/node-24', minutesAgo: 60 * 24 * 4, state: null },
  { id: TOGGLE, title: 'Add a usage cost toggle', root: '/demo/tideline', branch: 'main', minutesAgo: 52, state: null },
  { id: 'a0000000-0000-4000-8000-00000000000a', title: 'Plan', root: '/demo/tideline', branch: 'feat/usage-cost', minutesAgo: 40, state: null, parentId: TOGGLE },
  { id: 'a0000000-0000-4000-8000-00000000000b', title: 'Execute', root: '/demo/tideline', branch: 'feat/usage-cost', minutesAgo: 18, state: null, parentId: TOGGLE },
  { id: 'a0000000-0000-4000-8000-00000000000c', title: 'Validate', root: '/demo/tideline', branch: 'feat/usage-cost', minutesAgo: 4, state: null, parentId: TOGGLE },
  { id: 'a0000000-0000-4000-8000-00000000000d', title: 'Plan', root: '/demo/harbor-api', branch: 'feat/webhook-retries', minutesAgo: 14, state: null, parentId: ROW_RUN },
  { id: 'a0000000-0000-4000-8000-00000000000e', title: 'Execute', root: '/demo/harbor-api', branch: 'feat/webhook-retries', minutesAgo: 0, state: 'running', parentId: ROW_RUN },
];

const HOUR = 60 * MINUTE;
/** Made-up tokens for each demo session (the last ones it worked on used the most), and the model it ran on; not for pipeline steps. */
const TOKENS: Record<string, { tokens: TokenCounts; turns: number; model: string }> = Object.fromEntries(
  SESSIONS.filter((s) => !s.parentId).map((s, i) => [
    s.id,
    {
      tokens: { input: 14_000 + i * 3_000, output: 60_000 - i * 5_000, cacheRead: 3_200_000 - i * 300_000, cacheWrite: 210_000 - i * 18_000 },
      turns: 24 - i * 2,
      model: i % 3 === 2 ? 'claude-sonnet-5-5' : 'claude-opus-5-5',
    },
  ]),
);

/** Where the demo sessions' tokens went, as `usage.breakdown` on a real computer: one hour's bucket per session. */
function demoTokens(params: { period: UsagePeriod; groupBy: UsageGroup; model: string | null; timeZone: string }): UsageBreakdown {
  const hours = { window: 5, day: 24, week: 24 * 7, month: 24 * 30 }[params.period];
  const from = now - hours * HOUR;
  const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: params.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const used = SESSIONS.filter((s) => TOKENS[s.id] && now - s.minutesAgo * MINUTE >= from && (!params.model || TOKENS[s.id]!.model === params.model));
  const add = (into: TokenCounts, t: TokenCounts) => {
    into.input += t.input;
    into.output += t.output;
    into.cacheRead += t.cacheRead;
    into.cacheWrite += t.cacheWrite;
  };
  const empty = (): TokenCounts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  const keyOf = (s: DemoSession) =>
    params.groupBy === 'session' ? s.id : params.groupBy === 'project' ? s.root : params.groupBy === 'model' ? TOKENS[s.id]!.model : dayOf.format(now - s.minutesAgo * MINUTE);
  const groups = new Map<string, { sessions: DemoSession[]; tokens: TokenCounts; turns: number }>();
  const totals = empty();
  for (const s of used) {
    const key = keyOf(s);
    const group = groups.get(key) ?? { sessions: [], tokens: empty(), turns: 0 };
    group.sessions.push(s);
    add(group.tokens, TOKENS[s.id]!.tokens);
    group.turns += TOKENS[s.id]!.turns;
    groups.set(key, group);
    add(totals, TOKENS[s.id]!.tokens);
  }
  const shares = sharesOf([...groups].map(([key, g]) => ({ key, weight: weightOf(g.tokens) })));
  const rows: UsageRow[] = [...groups].map(([key, g]) => {
    const first = g.sessions[0]!;
    const project = PROJECTS.find((p) => p.root === first.root)!;
    const label = params.groupBy === 'session' ? first.title : params.groupBy === 'project' ? project.name : key;
    const largest = Math.max(...g.sessions.map((s) => TOKENS[s.id]!.tokens.cacheRead / TOKENS[s.id]!.turns));
    return {
      key,
      label,
      sessionId: params.groupBy === 'session' ? first.id : null,
      projectRoot: params.groupBy === 'session' || params.groupBy === 'project' ? first.root : null,
      model: TOKENS[first.id]!.model,
      sessions: g.sessions.length,
      turns: g.turns,
      fastTurns: 0,
      tokens: g.tokens,
      cost: g.sessions.reduce((sum, s) => sum + (costOf(TOKENS[s.id]!.tokens, TOKENS[s.id]!.model) ?? 0), 0),
      largestContext: Math.round(largest),
      share: shares.get(key)!.share,
      measured: false,
    };
  });
  rows.sort((a, b) => (params.groupBy === 'day' ? b.label.localeCompare(a.label) : b.share - a.share));
  return {
    period: params.period,
    from,
    to: now,
    bucket: hours > 24 ? 'day' : 'hour',
    totals: { tokens: totals, cost: used.reduce((sum, s) => sum + (costOf(TOKENS[s.id]!.tokens, TOKENS[s.id]!.model) ?? 0), 0), sessions: used.length, turns: used.reduce((n, s) => n + TOKENS[s.id]!.turns, 0), fastTurns: 0, largestContext: Math.max(0, ...rows.map((r) => r.largestContext)) },
    rows,
    // The app adds each of these to its own hour or day.
    buckets: used.map((s) => ({ start: Math.floor((now - s.minutesAgo * MINUTE) / HOUR) * HOUR, tokens: TOKENS[s.id]!.tokens, turns: TOKENS[s.id]!.turns, cost: costOf(TOKENS[s.id]!.tokens, TOKENS[s.id]!.model) ?? 0 })),
    scan: null,
  };
}

const summaries = (): SessionSummary[] =>
  SESSIONS.map(
    (s) =>
      ({
        id: s.id,
        title: s.title,
        firstPrompt: s.title,
        customTitle: null,
        cwd: s.root,
        projectRoot: s.root,
        gitBranch: s.branch,
        worktree: null,
        origin: 'app',
        createdAt: now - s.minutesAgo * MINUTE - 10 * MINUTE,
        updatedAt: now - s.minutesAgo * MINUTE,
        fileSize: 1000,
        tag: null,
        pinned: false,
        archivedAt: archived.has(s.id) ? now : null,
        restoredAt: null,
        viewedAt: null,
        unread: !read.has(s.id) && (s.unread ?? false),
        inApp: true,
        profileId: profileOf(s.root),
        parentId: s.parentId ?? null,
      }) as SessionSummary,
  );

const hosts = (): SessionHostInfo[] =>
  SESSIONS.filter((s) => s.state).map(
    (s) =>
      ({
        sessionId: s.id,
        cwd: s.root,
        state: s.state === 'needs-you' && !permissions.some((p) => p.sessionId === s.id) ? 'idle' : s.state,
        model: models.has(s.id) ? models.get(s.id) : s.state === 'running' ? 'sonnet' : 'opus',
        permissionMode: modes.get(s.id) ?? 'default',
        effort: efforts.has(s.id) ? efforts.get(s.id) : 'medium',
        // The working session started on Auto, which picked Sonnet, until you pick a model yourself.
        autoPick: s.state === 'running' && !models.has(s.id) ? { model: 'sonnet' as const, reason: 'A focused change to one form', at: now, tokens: 420, allowed: ['haiku' as const, 'sonnet' as const, 'opus' as const] } : null,
        costUsd: 0,
        contextPercent: 20,
        contextTokens: null,
        contextMax: null,
        error: null,
        startedAt: now - 30 * MINUTE,
        promptedAt: null,
        queue: [],
        queueHold: null,
        profileId: profileOf(s.root),
        backgroundTasks: s.state === 'running' ? background : [],
      }) as unknown as SessionHostInfo,
  );

const request = (requestId: string, sessionIndex: number, toolName: string, input: Record<string, unknown>, extra: Partial<PermissionRequest> = {}): PermissionRequest => ({
  requestId,
  sessionId: SESSIONS[sessionIndex]!.id,
  toolName,
  toolUseId: null,
  input: input as PermissionRequest['input'],
  title: null,
  description: null,
  decisionReason: null,
  blockedPath: null,
  alwaysLabel: null,
  agentId: null,
  createdAt: now - SESSIONS[sessionIndex]!.minutesAgo * MINUTE,
  ...extra,
});

let permissions: PermissionRequest[] = [
  request('r-publish', 0, 'Bash', { command: 'npm publish --tag beta', description: 'Publish the beta to npm' }, { alwaysLabel: 'Always in tideline' }),
  request('r-upload', 1, 'Edit', { file_path: 'src/upload/retry.ts', old_string: 'const RETRIES = 3;', new_string: 'const RETRIES = 5;\nconst BACKOFF_MS = 250;' }),
  request('r-cache', 2, 'AskUserQuestion', {
    questions: [
      {
        question: 'Which cache should the tile server use?',
        header: 'Cache',
        multiSelect: false,
        options: [
          { label: 'Redis', description: 'Shared between instances, needs a server' },
          { label: 'In memory (LRU)', description: 'Simple, lost on restart' },
        ],
      },
    ],
  }),
];

const archived = new Set<string>();
const models = new Map<string, string | null>();
const modes = new Map<string, string>();
const efforts = new Map<string, SessionHostInfo['effort']>();
let committed = false;
/** What the working session keeps running in the background; Stop takes a task away. */
let background: SessionHostInfo['backgroundTasks'] = [{ taskId: 'demo-dev-server', type: 'local_bash', description: 'npm run dev', startedAt: now - 12 * MINUTE }];

const CHANGES: GitChanges = {
  root: '/demo/harbor-api',
  branch: 'feat/rate-limits',
  baseBranch: 'main',
  base: 'uncommitted',
  error: null,
  files: [
    { path: 'src/webhooks/limit.ts', status: 'untracked', additions: 48, deletions: 0, staged: false },
    { path: 'src/webhooks/router.ts', status: 'modified', additions: 3, deletions: 1, staged: false },
    { path: 'src/webhooks/limit.test.ts', status: 'untracked', additions: 61, deletions: 0, staged: false },
    { path: 'src/config/defaults.ts', status: 'modified', additions: 6, deletions: 2, staged: false },
    { path: 'docs/webhooks.md', status: 'modified', additions: 2, deletions: 37, staged: false },
    { path: 'src/legacy/throttle.ts', status: 'deleted', additions: 0, deletions: 0, staged: false },
  ],
};

const DIFF = [
  'diff --git a/src/webhooks/router.ts b/src/webhooks/router.ts',
  'index 3f2a1c0..9b8e7d2 100644',
  '--- a/src/webhooks/router.ts',
  '+++ b/src/webhooks/router.ts',
  '@@ -1,6 +1,8 @@',
  " import { Router } from 'express';",
  " import { handle } from './handle.ts';",
  "+import { limit } from './limit.ts';",
  '+',
  ' export const router = Router();',
  ' ',
  "-router.post('/hooks/:id', handle);",
  "+router.post('/hooks/:id', limit({ perMinute: 100, key: (request) => request.params.customerId ?? request.ip }), handle);",
  " router.get('/hooks', list);",
].join('\n');

const CATCH_UP: CatchUp = {
  sessionId: 'a0000000-0000-4000-8000-000000000005',
  turnId: 'a5-17',
  generatedAt: now - 34 * MINUTE,
  source: 'model',
  state: 'finished',
  // The start of the prompt as it was written, in Markdown: the card's title is its heading.
  ask: '# Rate limits for the webhooks\n\nAdd rate limits to the webhook endpoints: 100 requests a minute per customer.',
  did: ['Added a per-customer token bucket in limit.ts', 'Put the limit in front of the webhook handler', 'Wrote 3 tests for the limit and the 429 answer'],
  skipped: [],
  need: { kind: 'commit', title: 'Commit the changes', text: 'The tests pass. Look over the diff, then commit.' },
  signals: { tests: { state: 'passed', passed: 14, command: 'npm test -- webhooks' }, diff: { files: 6, add: 120, del: 40 }, outOfScope: [], scope: null, plan: null },
  reviewMinutes: 2,
};
const read = new Set<string>();

const text = (uuid: string, role: 'user' | 'assistant', body: string, minutesAgo: number): TranscriptMessage => ({ uuid, role, timestamp: now - minutesAgo * MINUTE, parentToolUseId: null, model: null, blocks: [{ type: 'text', text: body }] });
const tool = (uuid: string, id: string, name: string, input: Record<string, unknown>, minutesAgo: number): TranscriptMessage => ({
  uuid,
  role: 'assistant',
  timestamp: now - minutesAgo * MINUTE,
  parentToolUseId: null,
  model: null,
  blocks: [{ type: 'tool_use', id, name, input: input as never, truncated: false }],
});
const result = (uuid: string, id: string, output: string, minutesAgo: number): TranscriptMessage => ({
  uuid,
  role: 'user',
  timestamp: now - minutesAgo * MINUTE,
  parentToolUseId: null,
  model: null,
  blocks: [{ type: 'tool_result', toolUseId: id, isError: false, text: output, truncated: false }],
});

/** The finished session's prompt, written as a Markdown brief (its catch-up shows the heading as the title). */
const BRIEF = '# Rate limits for the webhooks\n\nAdd rate limits to the webhook endpoints: **100 requests a minute** per customer.\n\n- Answer `429` with `Retry-After` past the limit\n- Tell me what you changed';

function transcript(sessionId: string): TranscriptMessage[] {
  const p = sessionId.slice(-2);
  return [
    text(`${p}-1`, 'user', sessionId === CATCH_UP.sessionId ? BRIEF : 'Add rate limits to the webhook endpoints. 100 requests a minute per customer, and tell me what you changed.', 40),
    text(`${p}-2`, 'assistant', "I'll look at how the webhooks are routed first.", 39),
    tool(`${p}-3`, `${p}-t1`, 'Grep', { pattern: 'router.post\\(.*webhook', path: 'src' }, 39),
    result(`${p}-4`, `${p}-t1`, 'src/webhooks/router.ts:14', 39),
    tool(`${p}-5`, `${p}-t2`, 'Read', { file_path: 'src/webhooks/router.ts' }, 38),
    result(`${p}-6`, `${p}-t2`, '...', 38),
    tool(`${p}-7`, `${p}-t3`, 'Edit', { file_path: 'src/webhooks/router.ts', old_string: "router.post('/hooks/:id', handle);", new_string: "router.post('/hooks/:id', limit({ perMinute: 100 }), handle);" }, 37),
    result(`${p}-8`, `${p}-t3`, 'ok', 37),
    tool(`${p}-9`, `${p}-t4`, 'Write', { file_path: 'src/webhooks/limit.ts', content: 'export function limit() {}' }, 36),
    result(`${p}-10`, `${p}-t4`, 'ok', 36),
    tool(`${p}-11`, `${p}-t5`, 'Edit', { file_path: 'src/webhooks/limit.test.ts', old_string: '', new_string: "it('limits', () => {});" }, 36),
    result(`${p}-12`, `${p}-t5`, 'ok', 36),
    tool(`${p}-13`, `${p}-t6`, 'Bash', { command: 'npm test -- webhooks' }, 35),
    result(`${p}-14`, `${p}-t6`, 'Tests  14 passed (14)', 35),
    tool(`${p}-15`, `${p}-t7`, 'Bash', { command: 'npm run typecheck' }, 35),
    result(`${p}-16`, `${p}-t7`, '', 35),
    text(
      `${p}-17`,
      'assistant',
      [
        '## Rate limits are in',
        '',
        'Each customer can now call a webhook **100 times a minute**. Past that they get a `429` with a `Retry-After` header.',
        '',
        '### What changed',
        '',
        '- `src/webhooks/limit.ts`: a small *token bucket* per customer, kept in memory',
        '- `src/webhooks/router.ts`: the limit runs before `handle`',
        '- 3 new tests in `limit.test.ts`',
        '',
        '| Endpoint | Limit |',
        '| --- | --- |',
        '| `POST /hooks/:id` | 100/min |',
        '| `GET /hooks` | none |',
        '',
        'To try it:',
        '',
        '```sh',
        'for i in $(seq 1 120); do curl -s -o /dev/null -w "%{http_code}\\n" -X POST localhost:3000/hooks/demo; done | sort | uniq -c',
        '```',
        '',
        'See [the RFC](https://www.rfc-editor.org/rfc/rfc6585#section-4) for `429`. <script>alert(1)</script> stays text.',
      ].join('\n'),
      34,
    ),
  ];
}

const dir = process.env.SESHBOARD_DEMO_DIR ?? join(tmpdir(), 'seshboard-remote-demo');
mkdirSync(dir, { recursive: true });
const keyFile = join(dir, 'identity.key');
if (!existsSync(keyFile)) writeFileSync(keyFile, crypto.getRandomValues(new Uint8Array(32)));
const cache = openCacheDatabase(join(dir, 'cache.sqlite'));
const appState = createAppStateStore(cache.db);
const watchers = new Map<string, Set<(update: TranscriptUpdate) => void>>();

/** The answer to a message from the phone, written a few words at a time as Claude would, then put in the transcript. */
const REPLY = [
  '## Done',
  '',
  'I changed **two files** and ran the tests:',
  '',
  '- `src/limit.ts`: the bucket refills every *second*',
  '- `src/limit.test.ts`: a test for the `429` answer',
  '',
  '| File | Lines |',
  '| --- | --- |',
  '| limit.ts | +12 −3 |',
  '| limit.test.ts | +28 |',
  '',
  '```ts',
  'export const REFILL_MS = 1_000;',
  '```',
  '',
  'See [the docs](https://seshboard.app/) for more.',
].join('\n');
function streamReply(sessionId: string) {
  const words = REPLY.split(/(?<=\s)/);
  let at = 0;
  const timer = setInterval(() => {
    if (at < words.length) {
      hub.stream({ sessionId, kind: 'text', text: words.slice(at, at + 2).join('') });
      at += 2;
      return;
    }
    clearInterval(timer);
    for (const listener of watchers.get(sessionId) ?? []) listener({ sessionId, mode: 'append', messages: [text(`reply-${Date.now()}`, 'assistant', REPLY, 0)], error: null } as TranscriptUpdate);
    hub.stream({ sessionId, kind: 'clear', text: '' });
  }, 120);
}

/** Ask about this session: the demo's threads per session, and a made-up answer that streams in. */
const askThreads = new Map<string, AskThread[]>();
const ASK_ANSWER = 'It changed **2 files**:\n\n- `src/webhooks/limit.ts`: a token bucket per endpoint, 60 requests a minute.\n- `src/webhooks/limit.test.ts`: tests for the limit and its reset.\n\nThe tests pass. Nothing else was touched.';

function demoAsk(sessionId: string, question: string, threadId?: string): { threadId: string; id: string; at: number } {
  const threads = askThreads.get(sessionId) ?? [];
  askThreads.set(sessionId, threads);
  const at = Date.now();
  const id = `ask-${at}`;
  let thread = threads.find((t) => t.id === threadId);
  if (!thread) {
    thread = { id: `thread-${at}`, title: question.slice(0, 80), createdAt: at, items: [] };
    threads.unshift(thread);
  }
  const words = ASK_ANSWER.split(/(?<= )/);
  let sent = 0;
  const timer = setInterval(() => {
    if (sent < words.length) {
      hub.askEvent({ sessionId, threadId: thread.id, id, delta: words.slice(sent, sent + 3).join('') });
      sent += 3;
      return;
    }
    clearInterval(timer);
    thread.items.push({ id, question, answer: ASK_ANSWER, at });
    hub.askEvent({ sessionId, threadId: thread.id, id, done: true, answer: ASK_ANSWER });
  }, 80);
  return { threadId: thread.id, id, at };
}

/** Each demo profile's plan: the 5-hour window and the week, as Claude Code's /usage reports them. */
const limit = (kind: string, percent: number, resetsInMinutes: number) => ({ kind, group: kind === 'session' ? 'session' : 'weekly', percent, resetsAt: now + resetsInMinutes * MINUTE, scope: null, severity: percent >= 85 ? 'critical' : percent >= 60 ? 'warning' : 'normal', isActive: true });
const USAGE = {
  default: { fetchedAt: now, limits: [limit('session', 44, 182), limit('weekly_all', 58, 122)], extraUsage: null },
  work: { fetchedAt: now, limits: [limit('session', 91, 212), limit('weekly_all', 5, 60 * 24 * 5 + 4 * 60)], extraUsage: null },
};

// --- Pipelines (#179): two runs, and what their buttons do in the demo world -----------------------------------------

const BUILT_IN: Pipeline = { ...BUILT_IN_PIPELINES[0]!, builtIn: true, createdAt: now, updatedAt: now };
const EXECUTE_VALIDATE: Pipeline = { ...BUILT_IN, id: 'demo-execute-validate', name: 'Execute and validate', builtIn: false, steps: BUILT_IN.steps.filter((s) => s.name !== 'Plan').map((s) => (s.kind === 'claude' && s.name === 'Execute' ? { ...s, start: 'fresh' as const } : s)) };
const PIPELINES = [BUILT_IN, EXECUTE_VALIDATE];
const ago = (minutes: number) => now - minutes * MINUTE;
const stepRow = (runId: string, index: number, sessionId: string | null, status: PipelineRunStep['status'], from: number, to: number | null, extra: Partial<PipelineRunStep> = {}): PipelineRunStep => ({
  runId,
  step: BUILT_IN.steps[index]!.name,
  index,
  round: 1,
  sessionId,
  status,
  outcome: status === 'done' ? 'clean' : null,
  verdict: null,
  reason: null,
  plan: null,
  actions: [],
  startedAt: ago(from),
  endedAt: to === null ? null : ago(to),
  ...extra,
});
const demoRun = (id: string, parent: string | null, root: string, over: Partial<PipelineRun>): PipelineRun => ({
  id,
  pipelineId: BUILT_IN.id,
  pipeline: BUILT_IN,
  parentSessionId: parent,
  task: null,
  title: '',
  projectRoot: root,
  cwd: `${root}-worktree`,
  profileId: null,
  status: 'running',
  reason: null,
  waitingFor: null,
  hold: null,
  step: 0,
  round: 1,
  sentBackTo: null,
  pr: null,
  createdAt: ago(52),
  updatedAt: now,
  endedAt: null,
  archivedAt: null,
  restoredAt: null,
  ...over,
});
const runs: PipelineRunState[] = [
  {
    run: demoRun('run-demo-usage-cost', TOGGLE, '/demo/tideline', { title: 'Add a usage cost toggle', status: 'waiting', waitingFor: 'push', reason: 'Push waits for you.', step: 3, updatedAt: ago(3) }),
    steps: [
      stepRow('run-demo-usage-cost', 0, 'a0000000-0000-4000-8000-00000000000a', 'done', 50, 40, { reason: 'plan approved' }),
      stepRow('run-demo-usage-cost', 1, 'a0000000-0000-4000-8000-00000000000b', 'done', 40, 18),
      stepRow('run-demo-usage-cost', 2, 'a0000000-0000-4000-8000-00000000000c', 'done', 18, 4, { verdict: { kind: 'pass', items: [] } }),
    ],
  },
  {
    run: demoRun(ROW_RUN, null, '/demo/harbor-api', { title: 'Retry failed webhook deliveries', task: 'Retry failed webhook deliveries with a backoff, and stop after five tries.', step: 1, createdAt: ago(16) }),
    steps: [stepRow(ROW_RUN, 0, 'a0000000-0000-4000-8000-00000000000d', 'done', 16, 14, { reason: 'plan approved' }), stepRow(ROW_RUN, 1, 'a0000000-0000-4000-8000-00000000000e', 'working', 14, null)],
  },
];
/** Changes a run, and tells phones. */
const runChanged = (state: PipelineRunState) => {
  state.run.updatedAt = Date.now();
  setTimeout(() => hub.sessionsChanged(), 0);
  return state;
};
const runById = (runId: string) => {
  const state = runs.find((r) => r.run.id === runId);
  if (!state) throw new Error('That run is gone.');
  return state;
};
/** The step after `index`: a waiting Push, or the next step working in a sub-session of its own. */
const moveOn = (state: PipelineRunState, index: number) => {
  const next = state.run.pipeline.steps[index];
  state.run.step = index;
  state.run.reason = null;
  state.run.waitingFor = null;
  if (!next) {
    Object.assign(state.run, { status: 'done', endedAt: Date.now() });
    return;
  }
  if (next.kind === 'push') {
    Object.assign(state.run, { status: 'waiting', waitingFor: 'push', reason: `${next.name} waits for you.` });
    return;
  }
  state.run.status = 'running';
  const sessionId = crypto.randomUUID();
  SESSIONS.unshift({ id: sessionId, title: next.name, root: state.run.projectRoot, branch: 'main', minutesAgo: 0, state: 'running', parentId: state.run.parentSessionId ?? state.run.id });
  state.steps.push(stepRow(state.run.id, index, sessionId, 'working', 0, null, { step: next.name }));
};
const demoPipelines: RemotePipelines = {
  runs: () => runs,
  list: () => PIPELINES,
  run: async (input) => {
    const pipeline = PIPELINES.find((p) => p.id === input.pipelineId)!;
    const parent = input.parentSessionId ? SESSIONS.find((s) => s.id === input.parentSessionId) : null;
    const id = `run-demo-${Date.now()}`;
    const title = parent?.title ?? input.task!.split('\n')[0]!.slice(0, 80);
    const state: PipelineRunState = { run: demoRun(id, input.parentSessionId, parent?.root ?? input.projectRoot!, { pipeline, pipelineId: pipeline.id, title, task: input.task, createdAt: Date.now() }), steps: [] };
    runs.unshift(state);
    moveOn(state, 0);
    return runChanged(state);
  },
  act: async (action, runId) => {
    const state = runById(runId);
    const { run } = state;
    if (run.status === 'done' || run.status === 'stopped') throw new Error('This run has ended.');
    const current = state.steps.findLast((s) => s.index === run.step);
    if (action === 'stop') {
      if (current?.status === 'working') current.status = 'stopped';
      Object.assign(run, { status: 'stopped', endedAt: Date.now(), waitingFor: null });
    } else if (action === 'continue' && run.waitingFor === 'push') {
      // Push: committed with the message, pushed, and the pull request opened.
      state.steps.push(stepRow(runId, run.step, null, 'done', 0, 0, { step: 'Push', reason: 'Pull request #152 opened' }));
      run.pr = { number: 152, url: 'https://github.com/acme/tideline/pull/152' };
      moveOn(state, run.step + 1);
    } else if (action === 'skipStep') {
      if (current) current.status = 'skipped';
      moveOn(state, run.step + 1);
    } else if (action === 'continue') {
      moveOn(state, run.step + 1);
    } else {
      // Run this step again, or Another round: a new round in a new sub-session.
      if (current?.status === 'working') current.status = 'stopped';
      const round = (current?.round ?? 0) + 1;
      run.round = round;
      moveOn(state, run.step);
      state.steps.at(-1)!.round = round;
    }
    return runChanged(state);
  },
  archive: async (runId, on) => {
    const state = runById(runId);
    if (on && (state.run.status === 'running' || state.run.status === 'waiting')) throw new Error('The run is still going. Stop it first.');
    const tree = [state.run.parentSessionId, ...state.steps.map((s) => s.sessionId)].filter((id): id is string => Boolean(id));
    for (const id of tree) if (on) archived.add(id);
    else archived.delete(id);
    if (on) state.run.archivedAt = Date.now();
    else state.run.restoredAt = Date.now();
    runChanged(state);
  },
  pushPreview: async () => ({ message: 'Add a usage cost toggle\n\nShow the estimated API cost under the message box, behind a switch in Settings › Usage.', files: 6, branch: 'feat/usage-cost', base: 'main', problem: null }),
  write: async (runId) => {
    const state = runById(runId);
    const id = crypto.randomUUID();
    SESSIONS.unshift({ id, title: state.run.title, root: state.run.projectRoot, branch: 'main', minutesAgo: 0, state: 'running' });
    for (const s of SESSIONS) if (s.parentId === runId) s.parentId = id;
    state.run.parentSessionId = id;
    runChanged(state);
    return { sessionId: id };
  },
};

/** Each session's Up next: a message queued while Claude works waits here until Send now or Remove. */
const upNextOf = new Map<string, QueuedMessage[]>();
const setUpNext = (sessionId: string, queue: QueuedMessage[]) => {
  upNextOf.set(sessionId, queue);
  hub.upNextChanged(sessionId, queue);
};
/** A message reaches the conversation, and Claude answers it. */
const deliver = (sessionId: string, message: string): string => {
  const uuid = `sent-${Date.now()}`;
  for (const listener of watchers.get(sessionId) ?? []) listener({ sessionId, mode: 'append', messages: [text(uuid, 'user', message, 0)], error: null } as TranscriptUpdate);
  streamReply(sessionId);
  return uuid;
};

const hub: RemoteHub = new RemoteHub({
  db: cache.db,
  appState,
  appVersion: 'demo',
  appUrl: APP_URL,
  filesDir: join(dir, 'remote-files'),
  computerName: () => process.env.SESHBOARD_DEMO_NAME ?? "Elio's iMac",
  identity: async () => new Uint8Array(readFileSync(keyFile)),
  sources: () => ({ summaries: summaries().filter((s) => !archived.has(s.id)), live: [], hosts: hosts(), permissions }),
  archiveAfterDays: () => 30,
  scope: () => 'switchboard',
  projects: () => PROJECTS.map((p, order) => ({ ...p, exists: true, added: true, order, defaults: { ...NO_DEFAULTS, branch: null } })),
  profiles: () => ({ profiles: PROFILES, defaultId: 'default' }),
  readTranscript: async (sessionId) => transcript(sessionId),
  watchTranscript: (sessionId, listener) => {
    const set = watchers.get(sessionId) ?? new Set();
    watchers.set(sessionId, set.add(listener));
    return () => set.delete(listener);
  },
  send: async (sessionId, message, mode) => {
    if (mode === 'queue' && SESSIONS.find((s) => s.id === sessionId)?.state === 'running') {
      const id = `queued-${Date.now()}`;
      setUpNext(sessionId, [...(upNextOf.get(sessionId) ?? []), { id, text: message, attachments: [], createdAt: Date.now() }]);
      return { messageUuid: id, queued: true };
    }
    return { messageUuid: deliver(sessionId, message), queued: false };
  },
  dequeue: (sessionId, id) => setUpNext(sessionId, (upNextOf.get(sessionId) ?? []).filter((m) => m.id !== id)),
  upNext: (sessionId) => upNextOf.get(sessionId) ?? [],
  sendQueuedNow: async (sessionId, id) => {
    const message = upNextOf.get(sessionId)?.find((m) => m.id === id);
    if (!message) return;
    setUpNext(sessionId, upNextOf.get(sessionId)!.filter((m) => m.id !== id));
    deliver(sessionId, message.text);
  },
  interrupt: async () => {},
  stopTask: async (_sessionId, taskId) => {
    background = background.filter((task) => task.taskId !== taskId);
    hub.sessionsChanged();
  },
  respond: (requestId) => {
    permissions = permissions.filter((p) => p.requestId !== requestId);
    hub.sessionsChanged();
  },
  // A new session in the demo world, working, titled with its prompt.
  create: async (root, prompt, choice) => {
    const id = crypto.randomUUID();
    SESSIONS.unshift({ id, title: prompt.split('\n')[0]!.slice(0, 80), root, branch: choice.checkoutBranch ?? 'main', minutesAgo: 0, state: 'running' });
    setTimeout(() => hub.sessionsChanged(), 0);
    return { sessionId: id };
  },
  // GitHub Copilot, allowed on this made-up computer: its modes, two models, and its sessions start like the others.
  providers: () => [
    {
      id: 'copilot',
      name: 'GitHub Copilot',
      modes: [
        { value: 'default', label: 'Ask before edits', description: 'Approve every edit and command' },
        { value: 'acceptEdits', label: 'Accept edits', description: 'File edits apply, commands still ask' },
        { value: 'plan', label: 'Plan mode', description: 'Copilot plans before it changes anything' },
        { value: 'auto', label: 'Autopilot', description: 'Copilot keeps going until the task is done; edits apply, commands still ask' },
      ],
    },
  ],
  providerReady: async () => ({
    problem: null,
    models: [
      { value: 'gpt-5-mini', displayName: 'GPT-5 mini', description: '', supportsEffort: false },
      { value: 'claude-sonnet-5', displayName: 'Claude Sonnet 5', description: '', supportsEffort: true },
    ],
  }),
  createWithProvider: async (root, prompt) => {
    const id = crypto.randomUUID();
    SESSIONS.unshift({ id, title: prompt.split('\n')[0]!.slice(0, 80), root, branch: 'main', minutesAgo: 0, state: 'running' });
    setTimeout(() => hub.sessionsChanged(), 0);
    return { sessionId: id };
  },
  branches: async () => ({ current: 'main', branches: ['main', 'feat/onboarding', 'fix/login-redirect'], checkedOutElsewhere: [] }),
  queue: () => ({ id: `later-${Date.now()}` }),
  markRead: (sessionId) => void read.add(sessionId),
  markUnread: (sessionId) => void read.delete(sessionId),
  setFlags: (sessionId, flags) => {
    if (flags.archived) archived.add(sessionId);
    else if (flags.archived === false) archived.delete(sessionId);
  },
  setModel: async (sessionId, model) => void models.set(sessionId, model),
  setEffort: async (sessionId, effort) => void efforts.set(sessionId, effort),
  setPermissionMode: async (sessionId, mode) => void modes.set(sessionId, mode),
  autoModel: () => ({ enabled: true, allowed: ['haiku', 'sonnet', 'opus'] }),
  globalPermissionMode: () => 'default',
  // No global model or effort set on this made-up computer: sessions start on Claude Code's defaults.
  globalModel: () => NO_GLOBAL_MODEL,
  // No demo session is at a usage limit.
  limit: () => null,
  models: () => [
    { value: 'default', displayName: 'Default', description: 'Opus for planning, Sonnet for the rest', supportsEffort: true },
    { value: 'opus', displayName: 'Opus', description: 'Most capable for complex work', supportsEffort: true },
    { value: 'sonnet', displayName: 'Sonnet', description: 'Best for everyday tasks', supportsEffort: true },
    { value: 'haiku', displayName: 'Haiku', description: 'Fastest for quick answers', supportsEffort: false },
  ],
  ask: (sessionId, question, threadId) => demoAsk(sessionId, question, threadId),
  askThreads: (sessionId) => ({ threads: askThreads.get(sessionId) ?? [] }),
  usage: async (profileId) => ({ usage: USAGE[profileId as keyof typeof USAGE] ?? null, error: null }),
  // A demo answers for whichever account asks, so the app's Usage view has another computer to count.
  tokens: (_account, params) => demoTokens(params),
  // Each demo session's tokens at list prices; a window counts the sessions that last worked in it.
  sessionCost: (sessionId) => (TOKENS[sessionId] ? { usd: costOf(TOKENS[sessionId]!.tokens, TOKENS[sessionId]!.model) ?? 0, partial: false } : null),
  windowCosts: (_account, windows) =>
    windows.map((w) => {
      const family = w.scope?.split(/ /)[0]?.toLowerCase() ?? null;
      const usd = SESSIONS.filter((s) => TOKENS[s.id] && now - s.minutesAgo * MINUTE >= w.from && (!family || TOKENS[s.id]!.model.includes(family))).reduce(
        (sum, s) => sum + (costOf(TOKENS[s.id]!.tokens, TOKENS[s.id]!.model) ?? 0),
        0,
      );
      return { ...w, usd, partial: false };
    }),
  catchUp: (sessionId) => (sessionId === CATCH_UP.sessionId && !committed ? CATCH_UP : null),
  changes: async () => (committed ? { ...CHANGES, files: [] } : CHANGES),
  diff: async () => ({ diff: DIFF, truncated: false }),
  commit: async (_sessionId, message) => {
    if (/fail/i.test(message)) return { ok: false, output: 'husky - pre-commit hook\n> eslint src\n\nsrc/webhooks/limit.ts\n  12:5  error  Unexpected console statement  no-console\n\n1 problem (1 error, 0 warnings)\nhusky - pre-commit script failed (code 1)' };
    committed = true;
    return { ok: true, sha: '9b8e7d2c4f1a6b3e5d7c9a0b1c2d3e4f5a6b7c8d' };
  },
  pipelines: demoPipelines,
  onStatus: () => {},
  log: (level, message) => console.log(`[${level}] ${message}`),
});

// The theme the demo computer shows (Theme on the phone): `SESHBOARD_DEMO_THEME=catppuccin` takes a built-in theme's
// own colours (without the app's generator, which needs the renderer), else Demo Time's.
const themeName = process.env.SESHBOARD_DEMO_THEME ?? 'demo-time';
const themeFile = JSON.parse(readFileSync(new URL(`../apps/ui/src/themes/${themeName}.json`, import.meta.url), 'utf8')) as ThemeFile;
const modeOf = (mode: ThemeModeFile | undefined) => (mode ? { ...(mode.canvas ? { bg: mode.canvas } : {}), ...(mode.accent ? { accent: mode.accent } : {}), ...mode.colors } : {});
hub.setTheme({ name: themeFile.name, light: modeOf(themeFile.light), dark: modeOf(themeFile.dark) });

await hub.configure({ enabled: true, port: PORT });
const { url } = hub.startPairing();
console.log(`\nA browser paired before connects by itself at ${APP_URL}. To pair one, open this link (good for two minutes):\n\n  ${url}\n`);
// For scripts (the smoke test pairs the app with it).
console.log(`pairing-link: ${url}`);
const linkFile = process.env.SESHBOARD_DEMO_LINK_FILE;
if (linkFile) writeFileSync(linkFile, url);
const renew = linkFile
  ? setInterval(() => {
      // Not while a pairing waits for Allow.
      if (!hub.status().pairing.request) writeFileSync(linkFile, hub.startPairing().url);
    }, 60_000)
  : null;

// Allow every phone that asks, as you would click Allow on the computer.
const allow = setInterval(() => {
  const asked = hub.status().pairing.request;
  if (asked) {
    hub.decidePairing(asked.id, true);
    console.log(`Paired ${asked.name}. Press Ctrl+C to stop.`);
  }
}, 200);

const stop = () => {
  clearInterval(allow);
  if (renew) clearInterval(renew);
  hub.stop();
  cache.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
