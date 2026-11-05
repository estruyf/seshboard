import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CatchUp, SessionSummary } from '@seshboard/protocol';
import { CatchUpStore } from '../catchUp/catchUpStore.ts';
import { openCacheDatabase } from '../db/database.ts';
import { migrations } from '../db/migrations.ts';
import { git } from '../git/gitChanges.ts';
import type { SessionPr } from '../links/linkStore.ts';
import { parsePromptLine } from '../usage/transcriptUsage.ts';
import { UsageScanner } from '../usage/usageScanner.ts';
import { attributeCommits, localClock, parseCommits, prDay, sessionDays } from './activityDays.ts';
import { ActivityService } from './activityService.ts';
import { daySummaryInput, parseDaySummary, stubDaySummary } from './daySummary.ts';

const MINUTE = 60_000;
const at = (iso: string) => Date.parse(iso);
const inRange = () => true;

describe('sessionDays', () => {
  const clock = localClock('UTC');

  it('adds up the time without the pauses, and splits a session over its days', () => {
    const days = sessionDays(
      {
        messages: [
          { session_id: 's', at: at('2026-11-02T09:00:00Z') },
          { session_id: 's', at: at('2026-11-02T09:04:00Z') },
          // An hour away: not work.
          { session_id: 's', at: at('2026-11-02T10:04:00Z') },
          { session_id: 's', at: at('2026-11-03T08:00:00Z') },
          { session_id: 's', at: at('2026-11-03T08:01:00Z') },
        ],
        prompts: [{ session_id: 's', at: at('2026-11-02T08:58:00Z'), text: 'Fix the bug' }],
        usage: [],
      },
      clock,
      inRange,
    );
    const monday = days.find((d) => d.day === '2026-11-02')!;
    const tuesday = days.find((d) => d.day === '2026-11-03')!;
    expect(monday).toMatchObject({ activeMs: 6 * MINUTE, turns: 1, asks: ['Fix the bug'], firstAt: at('2026-11-02T08:58:00Z'), lastAt: at('2026-11-02T10:04:00Z') });
    expect(monday.hours[9]).toBe(6 * MINUTE);
    expect(tuesday).toMatchObject({ activeMs: MINUTE, turns: 0 });
  });

  it('prices a day with its hours, and shows a single moment on the ribbon', () => {
    const [day] = sessionDays(
      {
        messages: [{ session_id: 's', at: at('2026-11-02T09:30:00Z') }],
        prompts: [],
        usage: [{ session_id: 's', hour: at('2026-11-02T09:00:00Z'), model: 'claude-opus-4-8', input: 1_000_000, output: 0, cache_read: 0, cache_write: 0, cache_write_1h: 0 }],
      },
      clock,
      inRange,
    );
    expect(day!.costUsd).toBeGreaterThan(0);
    expect(day!.hours[9]).toBe(1);
  });

  it('sorts moments into the local day of the time zone', () => {
    const tokyo = localClock('Asia/Tokyo');
    expect(tokyo.dayOf(at('2026-11-02T20:00:00Z'))).toBe('2026-11-03');
    expect(tokyo.hourOf(at('2026-11-02T20:00:00Z'))).toBe(5);
    expect(localClock('Not/AZone').dayOf(at('2026-11-02T20:00:00Z'))).toBe('2026-11-02');
  });
});

describe('commits', () => {
  it('reads git log, counting a rebased copy once', () => {
    const commits = parseCommits('\0aaa\t100\tFirst\n\nsrc/a.ts\nsrc/b.ts\n\0bbb\t100\tFirst\n\nsrc/a.ts\n\0ccc\t200\tSecond\twith a tab\n');
    expect(commits.map((c) => c.hash)).toEqual(['aaa', 'ccc']);
    expect(commits[0]!.files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(commits[1]!.subject).toBe('Second\twith a tab');
  });

  it('goes to the session with the nearest moment, and nowhere when none is near', () => {
    const base = at('2026-11-02T09:00:00Z');
    const day = (sessionId: string, moments: number[]) => ({ day: '2026-11-02', sessionId, moments, firstAt: 0, lastAt: 0, activeMs: 0, hours: [], turns: 0, asks: [], costUsd: null });
    const a = day('a', [base, base + 2 * MINUTE]);
    const b = day('b', [base + 3 * MINUTE]);
    const commit = (hash: string, when: number) => ({ hash, at: when, subject: '', files: [] });
    const out = attributeCommits([commit('near-a', base + MINUTE), commit('near-b', base + 3 * MINUTE + 1000), commit('far', base + 60 * MINUTE)], [a, b]);
    expect(out.get(a)?.map((c) => c.hash)).toEqual(['near-a']);
    expect(out.get(b)?.map((c) => c.hash)).toEqual(['near-b']);
  });

  it('puts a pull request on the day it was seen, or the last day before it', () => {
    const { dayOf } = localClock('UTC');
    const days = ['2026-11-02', '2026-11-04'];
    expect(prDay(at('2026-11-04T10:00:00Z'), days, dayOf)).toBe('2026-11-04');
    expect(prDay(at('2026-11-03T10:00:00Z'), days, dayOf)).toBe('2026-11-02');
    expect(prDay(at('2026-11-01T10:00:00Z'), days, dayOf)).toBeNull();
  });
});

describe('parsePromptLine', () => {
  const line = (over: object) => JSON.stringify({ type: 'user', sessionId: 's', timestamp: '2026-11-02T09:00:00.000Z', cwd: '/w', message: { role: 'user', content: 'Fix the bug' }, ...over });

  it('reads a prompt of yours', () => {
    expect(parsePromptLine(line({}))).toMatchObject({ sessionId: 's', cwd: '/w', text: 'Fix the bug', at: at('2026-11-02T09:00:00Z') });
  });

  it('leaves out subagents, what Claude Code wrote itself and commands that do nothing', () => {
    expect(parsePromptLine(line({ isSidechain: true }))).toBeNull();
    expect(parsePromptLine(line({ isMeta: true }))).toBeNull();
    expect(parsePromptLine(line({ isCompactSummary: true }))).toBeNull();
    expect(parsePromptLine(line({ message: { content: '<command-name>/clear</command-name>' } }))).toBeNull();
    expect(parsePromptLine(line({ message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } }))).toBeNull();
    expect(parsePromptLine('not json')).toBeNull();
  });

  it('keeps a command that asks for work', () => {
    expect(parsePromptLine(line({ message: { content: '<command-name>/review</command-name><command-args>the PR</command-args>' } }))?.text).toBe('/review the PR');
  });
});

describe('the day in short', () => {
  const entry = (over: Partial<Parameters<typeof daySummaryInput>[0][number]>) => ({ day: '2026-11-02', sessionId: 's', title: 'A title', projectRoot: '/p', projectName: 'p', firstAt: 0, lastAt: 0, activeMs: 0, turns: 0, costUsd: null, hours: [], commits: 0, files: 0, prs: [], did: [], asks: [], available: true, ...over });

  it('tells Haiku the busiest first, with what was done or else what was asked', () => {
    const input = JSON.parse(daySummaryInput([entry({ title: 'Small', projectName: 'small', activeMs: 1, asks: ['Fix it'] }), entry({ title: 'Big', projectName: 'big', activeMs: 9, did: ['Fixed it'], asks: ['Ignored'] })], []));
    expect(input.projects.map((p: { name: string }) => p.name)).toEqual(['big', 'small']);
    expect(input.projects[0].sessions[0]).toEqual({ title: 'Big', did: ['Fixed it'] });
    expect(input.projects[1].sessions[0]).toEqual({ title: 'Small', asked: ['Fix it'] });
  });

  it('counts sessions from other computers', () => {
    const input = JSON.parse(daySummaryInput([], [{ title: 'Over there', projectName: 'far', activeMs: 1, did: [], asks: [] }]));
    expect(input.projects[0].name).toBe('far');
  });

  it('keeps only the text of the answer', () => {
    expect(parseDaySummary('```\nMostly **x**: done.\n```')).toBe('Mostly **x**: done.');
    expect(parseDaySummary('  ')).toBeNull();
    expect(parseDaySummary(null)).toBeNull();
  });

  it('has a stub for the smoke run', () => {
    expect(stubDaySummary(daySummaryInput([entry({ title: 'Big', projectName: 'big', activeMs: 9 }), entry({ title: 'Small', projectName: 'small' })], []))).toBe('Mostly **big**: Big. In **small**: Small.');
  });
});

describe('the migration', () => {
  it('starts the history from the cards there are, and reads every transcript once more', () => {
    const db = new DatabaseSync(':memory:');
    const before = migrations.findIndex((sql) => sql.includes('CREATE TABLE usage_prompts'));
    for (const sql of migrations.slice(0, before)) db.exec(sql);
    const card = (state: string) => JSON.stringify({ generatedAt: 5, state, did: ['Did it'] });
    db.prepare('INSERT INTO catchup (session_id, turn_id, json) VALUES (?, ?, ?)').run('finished', 't', card('finished'));
    db.prepare('INSERT INTO catchup (session_id, turn_id, json) VALUES (?, ?, ?)').run('waiting', 't', card('waiting'));
    db.prepare('INSERT INTO catchup (session_id, turn_id, json) VALUES (?, ?, ?)').run('broken', 't', 'not json');
    db.prepare('INSERT INTO usage_files (path, scope, size, mtime, offset, tail_hash) VALUES (?, ?, ?, ?, ?, ?)').run('/a', 's', 10, 1, 10, 'h');
    db.exec(migrations[before]!);
    expect(db.prepare('SELECT session_id, at, did_json FROM catchup_turns').all()).toEqual([{ session_id: 'finished', at: 5, did_json: '["Did it"]' }]);
    expect(db.prepare('SELECT size, offset, tail_hash FROM usage_files').all()).toEqual([{ size: -1, offset: 0, tail_hash: null }]);
    db.close();
  });
});

describe('ActivityService', () => {
  let dir: string;
  let db: DatabaseSync;
  let close: () => void;
  let asks: string[];
  let answer: string | null;
  let useModel: boolean;
  let now: number;
  let summaries: Map<string, SessionSummary>;
  let prs: Map<string, SessionPr[]>;

  const summary = (id: string, over: Partial<SessionSummary> = {}) => ({ id, title: `Title of ${id}`, projectRoot: join(dir, 'repo'), profileId: 'default', updatedAt: at('2026-11-02T10:00:00Z'), ...over }) as SessionSummary;

  const service = () =>
    new ActivityService({
      db,
      session: (id) => summaries.get(id) ?? null,
      providerSessions: () => [...summaries.values()].filter((s) => s.provider),
      projectOf: () => join(dir, 'repo'),
      projectName: () => 'repo',
      prsOf: (id) => prs.get(id) ?? [],
      git: (cwd, args) => git(cwd, args),
      refresh: () => {},
      ask: async (_ids, input) => {
        asks.push(input);
        return answer;
      },
      useModel: () => useModel,
      now: () => now,
    });

  const addMoment = (session: string, when: number) => db.prepare('INSERT INTO usage_messages (key, scope, session_id, at, split) VALUES (?, ?, ?, ?, 1)').run(`${session}${when}`, 'scope', session, when);
  const range = (from = '2026-11-02', to = from) => service().range({ from, to, timeZone: 'UTC' });
  const ask = (day = '2026-11-02', fresh = false) => service().summary({ day, timeZone: 'UTC', fresh, others: [] });

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-activity-')));
    const cache = openCacheDatabase(join(dir, 'cache.db'));
    db = cache.db;
    close = () => cache.close();
    asks = [];
    answer = 'Mostly **repo**: fixed it.';
    useModel = true;
    now = at('2026-11-05T09:00:00Z');
    summaries = new Map();
    prs = new Map();
  });
  afterEach(() => {
    close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads prompts from a transcript once, also when a fork repeats them', async () => {
    const config = join(dir, 'config');
    mkdirSync(join(config, 'projects', 'p'), { recursive: true });
    const prompt = JSON.stringify({ type: 'user', sessionId: 's', uuid: 'u1', timestamp: '2026-11-02T09:00:00.000Z', cwd: '/w', message: { content: 'Fix the bug' } });
    const fork = JSON.stringify({ type: 'user', sessionId: 'fork', uuid: 'u2', timestamp: '2026-11-02T09:00:00.000Z', cwd: '/w', message: { content: 'Fix the bug' } });
    const result = JSON.stringify({ type: 'user', sessionId: 's', uuid: 'u3', timestamp: '2026-11-02T09:01:00.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } });
    writeFileSync(join(config, 'projects', 'p', 'a.jsonl'), `${prompt}\n${result}\n`);
    writeFileSync(join(config, 'projects', 'p', 'b.jsonl'), `${fork}\n`);
    await new UsageScanner(db).scan([{ scope: 'scope', configDir: config }]);
    expect(db.prepare('SELECT text FROM usage_prompts').all()).toEqual([{ text: 'Fix the bug' }]);
  });

  it('builds a session\'s day, with a gone transcript still counted under the folder it named', async () => {
    summaries.set('known', summary('known'));
    addMoment('known', at('2026-11-02T09:00:00Z'));
    addMoment('known', at('2026-11-02T09:03:00Z'));
    addMoment('gone', at('2026-11-02T09:00:00Z'));
    db.prepare('INSERT INTO usage_sessions (scope, session_id, cwd) VALUES (?, ?, ?)').run('scope', 'gone', '/somewhere');
    db.prepare('INSERT INTO usage_prompts (key, scope, session_id, at, text) VALUES (?, ?, ?, ?, ?)').run('k', 'scope', 'gone', at('2026-11-02T08:59:00Z'), 'What I asked');
    const entries = await range();
    const known = entries.find((e) => e.sessionId === 'known')!;
    const gone = entries.find((e) => e.sessionId === 'gone')!;
    expect(known).toMatchObject({ title: 'Title of known', activeMs: 3 * MINUTE, available: true, projectName: 'repo', commits: 0 });
    expect(gone).toMatchObject({ title: 'What I asked', available: false, projectRoot: join(dir, 'repo') });
  });

  it('leaves out hidden sessions and days outside the range', async () => {
    addMoment('hidden', at('2026-11-02T09:00:00Z'));
    db.prepare('INSERT INTO session_flags (id, hidden_at) VALUES (?, ?)').run('hidden', 1);
    addMoment('other-day', at('2026-11-03T09:00:00Z'));
    expect(await range()).toEqual([]);
  });

  it('refuses a range that is backwards or too long', async () => {
    await expect(range('2026-11-02', '2026-11-01')).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    await expect(range('2026-01-01', '2026-12-31')).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('keeps what every turn\'s catch-up said, as the card itself is replaced', async () => {
    summaries.set('s', summary('s'));
    addMoment('s', at('2026-11-02T09:00:00Z'));
    const store = new CatchUpStore(db);
    const card = (turnId: string, generatedAt: number, did: string[], state: CatchUp['state'] = 'finished') => ({ sessionId: 's', turnId, generatedAt, source: 'model', state, ask: 'x', did, skipped: [], need: { kind: 'none', title: '', text: '' }, signals: { tests: { state: 'notRun' }, diff: null, outOfScope: [], scope: null, plan: null }, reviewMinutes: 1 }) as CatchUp;
    store.save(card('t1', at('2026-11-02T09:01:00Z'), ['First thing']));
    store.save(card('t2', at('2026-11-02T09:02:00Z'), ['Second thing']));
    store.save(card('t3', at('2026-11-02T09:03:00Z'), ['Waits for you'], 'waiting'));
    store.save(card('t4', at('2026-11-03T09:03:00Z'), ['Next day']));
    store.clear('s');
    expect((await range())[0]!.did).toEqual(['First thing', 'Second thing']);
  });

  it('counts your commits near a session, on any branch, and their files', async () => {
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const run = (args: string[], date?: string) => execFileSync('git', args, { cwd: repo, env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) } });
    run(['init', '-q', '-b', 'main']);
    run(['config', 'user.email', 'me@example.com']);
    run(['config', 'user.name', 'Me']);
    const commit = (file: string, date: string, author?: string) => {
      writeFileSync(join(repo, file), file);
      run(['add', file]);
      run(['commit', '-q', '-m', `Add ${file}`, ...(author ? ['--author', author] : [])], date);
    };
    commit('a.txt', '2026-11-02T09:01:00Z');
    run(['checkout', '-q', '-b', 'feature']);
    commit('b.txt', '2026-11-02T09:02:00Z');
    run(['checkout', '-q', 'main']);
    commit('colleague.txt', '2026-11-02T09:02:30Z', 'Other <other@example.com>');
    commit('later.txt', '2026-11-02T15:00:00Z');
    summaries.set('s', summary('s'));
    addMoment('s', at('2026-11-02T09:00:00Z'));
    addMoment('s', at('2026-11-02T09:03:00Z'));
    expect(await range()).toMatchObject([{ commits: 2, files: 2 }]);
    // Asked not to, it runs no git.
    expect(await service().range({ from: '2026-11-02', to: '2026-11-02', timeZone: 'UTC', git: false })).toMatchObject([{ commits: 0 }]);
  });

  it('has no commits outside a repository', async () => {
    summaries.set('s', summary('s', { projectRoot: join(dir, 'nowhere') }));
    addMoment('s', at('2026-11-02T09:00:00Z'));
    expect(await range()).toMatchObject([{ commits: 0 }]);
  });

  it('puts a pull request on its day', async () => {
    summaries.set('s', summary('s'));
    addMoment('s', at('2026-11-02T09:00:00Z'));
    prs.set('s', [{ repo: 'o/r', number: 253, url: 'https://github.com/o/r/pull/253', state: 'open', base: null, head: null, source: 'opened', seenAt: at('2026-11-02T09:30:00Z'), checkedAt: 0 }]);
    expect((await range())[0]!.prs).toEqual([{ number: 253, url: 'https://github.com/o/r/pull/253' }]);
  });

  it('shows another provider\'s session on the day of its last activity', async () => {
    summaries.set('copilot', summary('copilot', { provider: 'copilot', updatedAt: at('2026-11-02T10:00:00Z') } as Partial<SessionSummary>));
    expect(await range()).toMatchObject([{ sessionId: 'copilot', activeMs: 0, available: true }]);
    expect(await range('2026-11-03')).toEqual([]);
  });

  describe('summary', () => {
    beforeEach(() => {
      summaries.set('s', summary('s'));
      addMoment('s', at('2026-11-02T09:00:00Z'));
    });

    it('writes a past day once and keeps it', async () => {
      expect(await ask()).toMatchObject({ state: 'ok', summary: { text: 'Mostly **repo**: fixed it.', sessions: 1 } });
      addMoment('s', at('2026-11-02T09:01:00Z'));
      summaries.set('s', summary('s', { title: 'Another title' }));
      await ask();
      expect(asks).toHaveLength(1);
    });

    it('writes it again when asked', async () => {
      await ask();
      answer = 'Another line.';
      expect(await ask('2026-11-02', true)).toMatchObject({ summary: { text: 'Another line.' } });
      expect(asks).toHaveLength(2);
    });

    it('writes today again only when its sessions changed, and not right away', async () => {
      now = at('2026-11-02T12:00:00Z');
      await ask();
      await ask();
      expect(asks).toHaveLength(1);
      summaries.set('s', summary('s', { title: 'Another title' }));
      now += MINUTE;
      await ask();
      expect(asks).toHaveLength(1);
      now += 11 * MINUTE;
      await ask();
      expect(asks).toHaveLength(2);
    });

    it('writes a day again once it is over, then keeps it', async () => {
      now = at('2026-11-02T12:00:00Z');
      await ask();
      now = at('2026-11-03T08:00:00Z');
      await ask();
      await ask();
      expect(asks).toHaveLength(2);
    });

    it('is off with the setting, and calls no model', async () => {
      useModel = false;
      expect(await ask()).toEqual({ summary: null, state: 'off' });
      expect(asks).toEqual([]);
    });

    it('has nothing to write for a day without sessions', async () => {
      expect(await ask('2026-11-01')).toEqual({ summary: null, state: 'empty' });
      expect(asks).toEqual([]);
    });

    it('says when Haiku gave no answer, and keeps what there was', async () => {
      answer = null;
      expect(await ask()).toEqual({ summary: null, state: 'failed' });
      answer = 'Written.';
      await ask();
      answer = null;
      expect(await ask('2026-11-02', true)).toMatchObject({ state: 'failed', summary: { text: 'Written.' } });
    });

    it('shares one call between two asks for a day', async () => {
      const a = service();
      await Promise.all([a.summary({ day: '2026-11-02', timeZone: 'UTC', fresh: false, others: [] }), a.summary({ day: '2026-11-02', timeZone: 'UTC', fresh: false, others: [] })]);
      expect(asks).toHaveLength(1);
    });
  });
});
