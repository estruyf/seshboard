import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LaterItem, QueueSession, SessionHostInfo, UsageLimitHit } from '@switchboard/protocol';
import { openCacheDatabase } from '../db/database.ts';
import { QueueAutoStarter, type AutoSkipped, type AutoStarted } from './autoStart.ts';
import { LaterStore } from './laterStore.ts';

// Folders in this platform's form, as the queue only takes absolute local paths.
const WEB = resolve('/work/web');

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A host's state as the engine reports it. */
const host = (sessionId: string, state: SessionHostInfo['state']) => ({ sessionId, state }) as SessionHostInfo;

/** A queue on a real SQLite file, sessions the test drives, and the starter between them. */
function world(options: { focusLimit?: number | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-autostart-'));
  dirs.push(dir);
  const store = new LaterStore(openCacheDatabase(join(dir, 'cache.sqlite')).db);
  const sessions = new Map<string, QueueSession>();
  const started: AutoStarted[] = [];
  const skipped: AutoSkipped[] = [];
  const focus = { limit: options.focusLimit ?? null, count: 0 };
  let limit: UsageLimitHit | null = null;
  let next = 0;
  let starter: QueueAutoStarter | null = null;
  const make = () =>
    (starter = new QueueAutoStarter({
      store,
      sessions: () => [...sessions.values()],
      projectName: () => 'web',
      limitOf: () => limit,
      focus: () => focus,
      start: async (item: LaterItem) => {
        // As `later.start`: the session starts working, and the item leaves the queue.
        await new Promise((r) => setTimeout(r, 5));
        const id = `started-${++next}`;
        sessions.set(id, { id, title: item.prompt, projectRoot: WEB, busy: true });
        store.started(item.id, id);
        starter!.onHost(host(id, 'running'));
        return id;
      },
      changed: () => {},
      started: (event) => started.push(event),
      skipped: (event) => skipped.push(event),
      log: () => {},
    }));
  const w = {
    store,
    started,
    skipped,
    focus,
    get starter() {
      return starter ?? make();
    },
    /** A restart: a new engine over the same queue. */
    relaunch: () => make(),
    setLimit: (hit: UsageLimitHit | null) => void (limit = hit),
    /** A session this app runs starts a turn. */
    run(id: string, title = id) {
      sessions.set(id, { id, title, projectRoot: WEB, busy: true });
      w.starter.onHost(host(id, 'running'));
    },
    /** It isn't running anymore, without a word (the app quit). */
    quiet(id: string) {
      sessions.set(id, { ...sessions.get(id)!, busy: false });
    },
    /** Its turn ends: `result`, then idle. */
    finish(id: string, outcome: { ok: boolean; stopped?: boolean } = { ok: true }) {
      w.starter.turnEnded(id, outcome);
      sessions.set(id, { ...sessions.get(id)!, busy: false });
      w.starter.onHost(host(id, 'idle'));
      return w.starter.check();
    },
    queue: (prompt: string, waitFor: LaterItem['waitFor'], autoStart = true) => store.add({ cwd: WEB, prompt, autoStart }, { waitFor }),
  };
  return w;
}

describe('starting queued items by themselves', () => {
  it('starts an item once when the session it waits for finishes cleanly, however often it is asked', async () => {
    const w = world();
    w.run('fix-login', 'Fix login');
    const item = w.queue('Run the tests', { kind: 'session', sessionId: 'fix-login' });
    await w.starter.check();
    expect(w.started).toEqual([]);
    // Two windows connected: each change reaches the engine more than once, and checks overlap.
    await Promise.all([w.finish('fix-login'), w.starter.check(), w.starter.check()]);
    await w.starter.check();
    expect(w.started.map((s) => s.itemId)).toEqual([item.id]);
    expect(w.store.list()).toEqual([]);
  });

  it("doesn't start after an error or a stop: the item stays, ready, and says why", async () => {
    const w = world();
    w.run('fix-login', 'Fix login');
    w.run('deploy', 'Deploy');
    const afterError = w.queue('Run the tests', { kind: 'session', sessionId: 'fix-login' });
    const afterStop = w.queue('Write the changelog', { kind: 'session', sessionId: 'deploy' });
    await w.starter.check();
    await w.finish('fix-login', { ok: false });
    await w.finish('deploy', { ok: true, stopped: true });
    expect(w.started).toEqual([]);
    expect(w.skipped).toEqual([
      { itemId: afterError.id, prompt: 'Run the tests', sessionId: 'fix-login', title: 'Fix login', outcome: 'error' },
      { itemId: afterStop.id, prompt: 'Write the changelog', sessionId: 'deploy', title: 'Deploy', outcome: 'stopped' },
    ]);
    expect(w.store.list().map((i) => i.id)).toEqual([afterError.id, afterStop.id]);
    // Said once, not on every change after.
    await w.starter.check();
    expect(w.skipped).toHaveLength(2);
    expect(w.starter.auto().outcomes).toEqual(expect.arrayContaining([{ sessionId: 'fix-login', outcome: 'error' }, { sessionId: 'deploy', outcome: 'stopped' }]));
  });

  it('counts a session closed or failing mid-turn as not finished cleanly', async () => {
    const w = world();
    w.run('fix-login');
    w.queue('Run the tests', { kind: 'session', sessionId: 'fix-login' });
    await w.starter.check();
    // The process fails: the engine lists it as not running any more.
    w.quiet('fix-login');
    w.starter.onHost(host('fix-login', 'error'));
    expect(w.starter.outcomeOf('fix-login')).toBe('error');
    await w.starter.check();
    expect(w.started).toEqual([]);
    expect(w.skipped.map((s) => s.outcome)).toEqual(['error']);
  });

  it('waits for a free slot at the focus limit, then starts', async () => {
    const w = world({ focusLimit: 2 });
    w.run('fix-login');
    const item = w.queue('Run the tests', { kind: 'session', sessionId: 'fix-login' });
    await w.starter.check();
    // Two sessions still count (one unread, one working).
    w.focus.count = 2;
    await w.finish('fix-login');
    expect(w.started).toEqual([]);
    expect(w.starter.auto().focusHeld).toEqual([item.id]);
    // A session is read or archived: a slot frees.
    w.focus.count = 1;
    await w.starter.check();
    expect(w.started.map((s) => s.itemId)).toEqual([item.id]);
    expect(w.starter.auto().focusHeld).toEqual([]);
  });

  it('waits for a usage limit to reset, then starts', async () => {
    const w = world();
    w.run('fix-login');
    const item = w.queue('Run the tests', { kind: 'session', sessionId: 'fix-login' });
    await w.starter.check();
    w.setLimit({ profileId: 'default', kind: 'five_hour', resetsAt: Date.now() + 60 * 60_000, since: Date.now(), message: null, sessionIds: [] });
    await w.finish('fix-login');
    expect(w.started).toEqual([]);
    expect(w.store.list()).toHaveLength(1);
    w.setLimit(null);
    await w.starter.check();
    expect(w.started.map((s) => s.itemId)).toEqual([item.id]);
    w.starter.close();
  });

  it('runs a chain of three in order, each after the one before finishes', async () => {
    const w = world();
    w.run('fix-login');
    const first = w.queue('First', { kind: 'session', sessionId: 'fix-login' });
    const second = w.queue('Second', { kind: 'item', itemId: first.id });
    const third = w.queue('Third', { kind: 'item', itemId: second.id });
    await w.starter.check();
    await w.finish('fix-login');
    expect(w.started.map((s) => s.itemId)).toEqual([first.id]);
    await w.finish(w.started[0]!.sessionId);
    expect(w.started.map((s) => s.itemId)).toEqual([first.id, second.id]);
    await w.finish(w.started[1]!.sessionId);
    expect(w.started.map((s) => s.itemId)).toEqual([first.id, second.id, third.id]);
    expect(w.store.list()).toEqual([]);
  });

  it('starts nothing at launch after a quit while the session it waits for worked', async () => {
    const w = world();
    w.run('fix-login');
    const item = w.queue('Run the tests', { kind: 'session', sessionId: 'fix-login' });
    await w.starter.check();
    // The app quits mid-turn; at the next launch the session isn't running anymore.
    w.starter.close();
    // No turn end is ever seen, and after the launch the session isn't running.
    w.quiet('fix-login');
    const relaunched = w.relaunch();
    expect(relaunched.outcomeOf('fix-login')).toBe('quit');
    await relaunched.check();
    expect(w.started).toEqual([]);
    expect(w.skipped).toEqual([]);
    expect(w.store.list().map((i) => i.id)).toEqual([item.id]);
  });

  it('leaves items alone that start themselves off, wait for nothing, or were queued after the session was done', async () => {
    const w = world();
    w.run('fix-login');
    w.queue('Off', { kind: 'session', sessionId: 'fix-login' }, false);
    const nothing = w.queue('Nothing', { kind: 'none' });
    expect(nothing.autoStart).toBe(false);
    await w.starter.check();
    await w.finish('fix-login');
    // Queued once it had finished: it is ready, and you start it.
    w.queue('Late', { kind: 'session', sessionId: 'fix-login' });
    await w.starter.check();
    expect(w.started).toEqual([]);
  });

  it('waits through a turn whose end is not known (Send now), and starts after the next clean one', async () => {
    const w = world();
    w.run('fix-login');
    const item = w.queue('Run the tests', { kind: 'session', sessionId: 'fix-login' });
    await w.starter.check();
    w.starter.turnEnded('fix-login', { ok: false, superseded: true });
    await w.starter.check();
    expect(w.started).toEqual([]);
    expect(w.skipped).toEqual([]);
    w.run('fix-login');
    await w.finish('fix-login');
    expect(w.started.map((s) => s.itemId)).toEqual([item.id]);
  });

  it('starts an item held only by a limit (a scheduled run) when the slot frees, and not before', async () => {
    const w = world({ focusLimit: 2 });
    w.focus.count = 2;
    const item = w.queue('Review open pull requests', { kind: 'project' });
    w.starter.armForLimit(item.id);
    await w.starter.check();
    expect(w.started).toEqual([]);
    expect(w.starter.auto().focusHeld).toEqual([item.id]);
    w.focus.count = 1;
    await w.starter.check();
    expect(w.started.map((s) => s.itemId)).toEqual([item.id]);
  });

  it('starts an item held only by a usage limit once it resets', async () => {
    const w = world();
    w.setLimit({ profileId: 'default', resetsAt: Date.now() + 60_000 } as UsageLimitHit);
    const item = w.queue('Review open pull requests', { kind: 'project' });
    w.starter.armForLimit(item.id);
    await w.starter.check();
    expect(w.started).toEqual([]);
    w.setLimit(null);
    await w.starter.check();
    expect(w.started.map((s) => s.itemId)).toEqual([item.id]);
  });
});
