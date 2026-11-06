// A stand-in for `codex app-server` in appServer.test.ts: JSON-RPC over stdio, one JSON object per line, the way Codex
// speaks it (no `jsonrpc` field). Run as `node fakeAppServer.mjs app-server`.
//
// `thread/read`'s `threadId` picks what it does: `crash` exits with code 3 (after a line on stderr), `hang` never
// answers, `ask` sends a request of its own first and answers with the client's reply to it, `last` answers and exits
// at once, `big` answers with a preview of 8 MB, `ask-later` answers at once, then sends a request of its own (id 7)
// and reports the client's reply in a `fake/reply` notification, `ask-resolved` answers at once, sends a request
// (id 8) and resolves it itself 100 ms later (`serverRequest/resolved`), `notify` sends `thread/started` before answering. `thread/list` answers after `limit` milliseconds, so answers can come
// back out of order. Every answer is written in two pieces, with a notification and a line that isn't JSON before it.
// FAKE_CODEX_INIT=hang never answers `initialize`. FAKE_CODEX_STUBBORN=1 ignores SIGTERM and the end of its stdin, and
// says so with a `fake/sigterm` notification.
import { createInterface } from 'node:readline';

if (process.argv[2] !== 'app-server') {
  process.stderr.write(`unexpected arguments: ${process.argv.slice(2).join(' ')}\n`);
  process.exit(2);
}

const state = { initialize: null, initialized: false, beforeInitialized: [] };
const waiting = new Map();

const send = (message) => {
  const line = `${JSON.stringify(message)}\n`;
  const half = Math.floor(line.length / 2);
  process.stdout.write('this is not json\n');
  process.stdout.write(`${JSON.stringify({ method: 'remoteControl/status/changed', params: { status: 'disabled' } })}\n`);
  process.stdout.write(line.slice(0, half));
  setTimeout(() => process.stdout.write(line.slice(half)), 5);
};

const thread = (id) => ({ id, preview: 'Hello', cwd: '/tmp/project', createdAt: 1, updatedAt: 2, status: { type: 'notLoaded' }, turns: [] });

const handle = async (message) => {
  const { id, method, params } = message;
  if (method === 'initialize') {
    if (process.env.FAKE_CODEX_INIT === 'hang') return;
    state.initialize = params;
    send({ id, result: { userAgent: 'fake/0.0.0', codexHome: '/tmp/codex', platformFamily: 'unix', platformOs: 'macos' } });
    return;
  }
  if (!state.initialized) state.beforeInitialized.push(method);
  if (method === 'thread/list') {
    await new Promise((resolve) => setTimeout(resolve, params?.limit ?? 0));
    send({ id, result: { data: [thread(`t-${params?.limit ?? 0}`)], nextCursor: null, readStates: {} } });
    return;
  }
  if (method === 'thread/read') {
    if (params.threadId === 'crash') {
      process.stderr.write('\x1b[31mERROR\x1b[0m boom: the fake crashed\n');
      process.exit(3);
    }
    if (params.threadId === 'hang') return;
    if (params.threadId === 'last') {
      process.stdout.write(`${JSON.stringify({ id, result: { thread: { ...thread('last'), preview: 'x'.repeat(2 * 1024 * 1024) } } })}\n`, () => process.exit(0));
      return;
    }
    if (params.threadId === 'ask-later') {
      send({ id, result: { thread: thread('ask-later') } });
      const reply = new Promise((resolve) => waiting.set(7, resolve));
      setTimeout(() => process.stdout.write(`${JSON.stringify({ id: 7, method: 'item/fileChange/requestApproval', params: { threadId: 'ask-later' } })}\n`), 20);
      process.stdout.write(`${JSON.stringify({ method: 'fake/reply', params: await reply })}\n`);
      return;
    }
    if (params.threadId === 'ask-resolved') {
      send({ id, result: { thread: thread('ask-resolved') } });
      const reply = new Promise((resolve) => waiting.set(8, resolve));
      setTimeout(() => process.stdout.write(`${JSON.stringify({ id: 8, method: 'item/commandExecution/requestApproval', params: { threadId: 'ask-resolved' } })}\n`), 20);
      setTimeout(() => process.stdout.write(`${JSON.stringify({ method: 'serverRequest/resolved', params: { threadId: 'ask-resolved', requestId: 8 } })}\n`), 120);
      process.stdout.write(`${JSON.stringify({ method: 'fake/reply', params: await reply })}\n`);
      return;
    }
    if (params.threadId === 'notify') {
      process.stdout.write(`${JSON.stringify({ method: 'thread/started', params: { thread: thread('notify') } })}\n`);
      send({ id, result: { thread: thread('notify') } });
      return;
    }
    if (params.threadId === 'big') {
      send({ id, result: { thread: { ...thread('big'), preview: 'x'.repeat(8 * 1024 * 1024) } } });
      return;
    }
    if (params.threadId === 'ask') {
      const reply = new Promise((resolve) => waiting.set('srv-1', resolve));
      process.stdout.write(`${JSON.stringify({ id: 'srv-1', method: 'item/commandExecution/requestApproval', params: { threadId: 'ask' } })}\n`);
      send({ id, result: { thread: thread('ask'), reply: await reply } });
      return;
    }
    send({ id, result: { thread: thread(params.threadId) } });
    return;
  }
  if (method === 'account/read') {
    send({ id, result: { account: null, requiresOpenaiAuth: true, seen: state } });
    return;
  }
  send({ id, error: { code: -32600, message: `Invalid request: unknown variant \`${method}\`` } });
};

createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method === 'initialized' && message.id === undefined) {
    state.initialized = true;
    return;
  }
  if (message.method === undefined && waiting.has(message.id)) {
    waiting.get(message.id)(message);
    waiting.delete(message.id);
    return;
  }
  void handle(message);
});
// Codex ends when its stdin closes.
if (process.env.FAKE_CODEX_STUBBORN === '1') {
  process.on('SIGTERM', () => process.stdout.write(`${JSON.stringify({ method: 'fake/sigterm', params: {} })}\n`));
  // Without this, the end of its stdin would leave Node nothing to wait for, and it would end by itself.
  setInterval(() => {}, 60_000);
}
else process.stdin.on('end', () => process.exit(0));
