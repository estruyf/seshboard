import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CatchUp, PermissionRequest } from '@seshboard/protocol';
import type { RawSessionMessage } from '../claude/transcript.ts';
import { openCacheDatabase, type CacheDatabase } from '../db/database.ts';
import { git, listChanges } from '../git/gitChanges.ts';
import { CatchUpService } from './catchUpService.ts';
import { CatchUpStore } from './catchUpStore.ts';
import { stubAnswer, SUMMARY_SYSTEM_PROMPT, WHY_SYSTEM_PROMPT } from './summary.ts';

const SESSION = 'session-1';
const user = (uuid: string, content: unknown): RawSessionMessage => ({ type: 'user', uuid, parent_tool_use_id: null, message: { role: 'user', content } });
const assistant = (uuid: string, content: unknown[]): RawSessionMessage => ({ type: 'assistant', uuid, parent_tool_use_id: null, message: { role: 'assistant', content } });
const result = (id: string, content: string, isError = false) => user(`r-${id}`, [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }]);

let dir: string;
let repo: string;
let cache: CacheDatabase;
let file: RawSessionMessage[];
let emitted: Array<{ sessionId: string; catchUp: CatchUp | null }>;
let asked: string[];
/** The "why" inputs Haiku was given. */
let askedWhy: string[];
let useModel: boolean;

beforeEach(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-catchup-')));
  repo = join(dir, 'repo');
  await git(dir, ['init', '-q', '-b', 'main', repo]);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test']);
  await git(repo, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(repo, 'a.ts'), 'one\ntwo\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-qm', 'initial']);
  cache = openCacheDatabase(join(dir, 'cache.sqlite'));
  file = [];
  emitted = [];
  asked = [];
  askedWhy = [];
  useModel = true;
});

afterEach(() => {
  cache.close();
  rmSync(dir, { recursive: true, force: true });
});

function service(db = cache) {
  return new CatchUpService({
    store: new CatchUpStore(db.db),
    transcript: async () => file,
    cwd: () => repo,
    profileOf: () => 'default',
    changes: (cwd) => listChanges(cwd, 'uncommitted').catch(() => null),
    summarize: async (_profile, _session, input, system = SUMMARY_SYSTEM_PROMPT) => {
      (system === WHY_SYSTEM_PROMPT ? askedWhy : asked).push(input);
      return stubAnswer(input, system);
    },
    useModel: () => useModel,
    emit: (sessionId, catchUp) => emitted.push({ sessionId, catchUp }),
    log: () => {},
  });
}

/** A turn as it comes live from a session this app runs: Claude edits a.ts and runs the tests. */
function playTurn(catchUp: CatchUpService) {
  writeFileSync(join(repo, 'a.ts'), 'one\nTWO\nthree\n');
  catchUp.messages(SESSION, [
    user('p1', 'Make a.ts shout'),
    assistant('a1', [
      { type: 'tool_use', id: 'e1', name: 'Write', input: { file_path: join(repo, 'a.ts'), content: 'CONTENTS_OF_THE_FILE' } },
      { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'npx vitest run' } },
    ]),
    result('e1', 'File written'),
    result('b1', ' Test Files  1 passed (1)\n      Tests  3 passed (3)\n'),
    assistant('a2', [{ type: 'text', text: 'Done. a.ts shouts now.' }]),
  ]);
}

const request = (patch: Partial<PermissionRequest> = {}): PermissionRequest => ({
  requestId: 'req-1',
  sessionId: SESSION,
  toolName: 'Bash',
  toolUseId: 'b9',
  input: { command: 'npm publish' },
  title: 'Claude wants to run npm publish',
  description: null,
  decisionReason: null,
  blockedPath: null,
  alwaysLabel: null,
  agentId: null,
  createdAt: Date.now(),
  ...patch,
});

describe('catch-up cards', () => {
  it('makes a card when a turn ends, with the signals from the tool calls and git', async () => {
    const catchUp = service();
    playTurn(catchUp);
    const card = await catchUp.turnEnded(SESSION, { ok: true, error: null });
    expect(card).toMatchObject({
      sessionId: SESSION,
      turnId: 'a2',
      source: 'model',
      state: 'finished',
      ask: 'Make a.ts shout',
      need: { kind: 'commit', title: 'Commit the changes' },
      signals: { tests: { state: 'passed', passed: 3, failed: 0 }, diff: { files: 1, add: 2, del: 1 }, outOfScope: [], plan: null },
      reviewMinutes: 1,
    });
    expect(emitted.at(-1)).toEqual({ sessionId: SESSION, catchUp: card });
    expect(catchUp.get(SESSION)).toEqual(card);
  });

  it('writes the card from the tool calls when Haiku is off', async () => {
    useModel = false;
    const catchUp = service();
    playTurn(catchUp);
    const card = await catchUp.turnEnded(SESSION, { ok: true, error: null });
    expect(asked).toEqual([]);
    expect(card).toMatchObject({ source: 'fallback', did: ['Edited a.ts', 'Ran the tests'] });
  });

  it('never sends what was in a file to the summary', async () => {
    const catchUp = service();
    playTurn(catchUp);
    await catchUp.turnEnded(SESSION, { ok: true, error: null });
    expect(asked).toHaveLength(1);
    expect(asked[0]).not.toContain('CONTENTS_OF_THE_FILE');
    expect(asked[0]).toContain('a.ts');
  });

  it('makes a card while the session waits for a permission, from the request, and drops it once answered', async () => {
    const catchUp = service();
    playTurn(catchUp);
    const card = await catchUp.permission(request());
    expect(card).toMatchObject({ state: 'waiting', source: 'fallback', turnId: 'a2:req-1', need: { kind: 'permission', title: 'Allow a command', text: 'Claude wants to run npm publish' }, reviewMinutes: 1 });
    // Waiting cards come from the request, never from a model.
    expect(asked).toEqual([]);
    await catchUp.permissionResolved('req-1', SESSION);
    expect(catchUp.get(SESSION)).toBeNull();
    expect(emitted.at(-1)).toEqual({ sessionId: SESSION, catchUp: null });
  });

  it('moves to the next request when one of two is answered', async () => {
    const catchUp = service();
    playTurn(catchUp);
    await catchUp.permission(request());
    await catchUp.permission(request({ requestId: 'req-2', toolName: 'AskUserQuestion', input: { questions: [{ question: 'Which easing?' }] } }));
    expect(catchUp.get(SESSION)?.need.title).toBe('Allow a command');
    await catchUp.permissionResolved('req-1', SESSION);
    expect(catchUp.get(SESSION)?.need).toEqual({ kind: 'question', title: 'Answer a question', text: 'Which easing?' });
  });

  it('says why a session asks: the turn so far, Claude\'s words and Haiku\'s explanation, made once', async () => {
    const catchUp = service();
    playTurn(catchUp);
    catchUp.messages(SESSION, [assistant('a3', [{ type: 'text', text: 'Now I publish it.' }, { type: 'tool_use', id: 'b9', name: 'Bash', input: { command: 'npm publish' } }])]);
    await catchUp.permission(request());
    const why = await catchUp.why(SESSION, 'req-1');
    expect(why).toEqual({
      requestId: 'req-1',
      source: 'model',
      ask: 'Make a.ts shout',
      did: ['Edited a.ts', 'Ran the tests'],
      claudeSaid: 'Now I publish it.',
      what: 'Runs npm publish. It only reads files and changes nothing.',
      why: 'Claude needs it to check its work for your ask.',
    });
    expect(await catchUp.why(SESSION, 'req-1')).toEqual(why);
    expect(askedWhy).toHaveLength(1);
    expect(askedWhy[0]).not.toContain('CONTENTS_OF_THE_FILE');
    // The request itself is the request, not one of the tool calls so far.
    expect(JSON.parse(askedWhy[0]!).toolCalls.map((t: { tool: string }) => t.tool)).toEqual(['Write', 'Bash']);
  });

  it('says why without Haiku when summaries are off, and nothing once the request is answered', async () => {
    useModel = false;
    const catchUp = service();
    playTurn(catchUp);
    await catchUp.permission(request());
    expect(await catchUp.why(SESSION, 'req-1')).toMatchObject({ source: 'fallback', what: null, why: null, claudeSaid: 'Done. a.ts shouts now.' });
    expect(askedWhy).toEqual([]);
    await catchUp.permissionResolved('req-1', SESSION);
    expect(await catchUp.why(SESSION, 'req-1')).toBeNull();
    expect(await catchUp.why(SESSION, 'unknown')).toBeNull();
  });

  it('clears the card when you send a new message', async () => {
    const catchUp = service();
    playTurn(catchUp);
    await catchUp.turnEnded(SESSION, { ok: true, error: null });
    catchUp.messages(SESSION, [user('p2', 'Now make b.ts shout too')]);
    expect(catchUp.get(SESSION)).toBeNull();
    expect(emitted.at(-1)).toEqual({ sessionId: SESSION, catchUp: null });
  });

  it('drops a card that was still being made when a new message came', async () => {
    const catchUp = service();
    playTurn(catchUp);
    const pending = catchUp.turnEnded(SESSION, { ok: true, error: null });
    catchUp.messages(SESSION, [user('p2', 'Wait, one more thing')]);
    expect(await pending).toBeNull();
    expect(catchUp.get(SESSION)).toBeNull();
  });

  it('makes no card for a turn you stopped', async () => {
    const catchUp = service();
    playTurn(catchUp);
    catchUp.interrupt(SESSION);
    expect(await catchUp.turnEnded(SESSION, { ok: false, error: 'Interrupted' })).toBeNull();
    expect(catchUp.get(SESSION)).toBeNull();
  });

  it('says a turn stopped with an error, and needs a reply', async () => {
    const catchUp = service();
    playTurn(catchUp);
    const card = await catchUp.turnEnded(SESSION, { ok: false, error: 'API Error: overloaded' });
    expect(card).toMatchObject({ state: 'error', need: { kind: 'reply', title: 'Claude stopped with an error', text: 'API Error: overloaded. Tell Claude how to go on.' } });
    useModel = false;
    playTurn(catchUp);
    const fallback = await catchUp.turnEnded(SESSION, { ok: false, error: 'API Error: overloaded' });
    expect(fallback?.skipped[0]).toBe('Stopped with an error: API Error: overloaded');
  });

  it('keeps the card across a restart', async () => {
    const catchUp = service();
    playTurn(catchUp);
    const card = await catchUp.turnEnded(SESSION, { ok: true, error: null });
    cache.close();
    cache = openCacheDatabase(join(dir, 'cache.sqlite'));
    const again = service();
    expect(again.get(SESSION)).toEqual(card);
    expect(again.list()).toEqual([card]);
  });

  it('builds a card from the transcript alone, for a session that ran elsewhere', async () => {
    file = [user('p1', 'What does a.ts do?'), assistant('a1', [{ type: 'text', text: 'It prints two lines.' }])];
    const card = await service().build(SESSION);
    expect(card).toMatchObject({ turnId: 'a1', need: { kind: 'none' }, signals: { diff: { files: 0, add: 0, del: 0 } } });
    file = [user('p1', 'Hello')];
    expect(await service().build(SESSION)).toBeNull();
  });
});
