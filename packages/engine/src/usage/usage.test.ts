import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canSymlink } from '../util/canSymlink.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openCacheDatabase, type CacheDatabase } from '../db/database.ts';
import { PlanHistoryStore } from './planHistory.ts';
import { measuredDeltas, SHARE_WEIGHTS, sharesOf, weightOf } from './shares.ts';
import { hourOf, parseUsageLine } from './transcriptUsage.ts';
import { breakdown, periodRange, type SessionLookup } from './usageQuery.ts';
import { scopeOf, UsageScanner } from './usageScanner.ts';
import { RoutingStore } from '../autoModel/router.ts';

let dir: string;
let cache: CacheDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sb-usage-'));
  cache = openCacheDatabase(join(dir, 'cache.sqlite'));
});
afterEach(() => {
  cache.close();
  rmSync(dir, { recursive: true, force: true });
});

/** An assistant line as Claude Code writes it: one per content block, each with the message's full usage. */
function line(o: { id: string; req?: string; session: string; at: string; model?: string; input?: number; output?: number; read?: number; write?: number; speed?: string; cwd?: string }): string {
  return (
    JSON.stringify({
      type: 'assistant',
      timestamp: o.at,
      sessionId: o.session,
      requestId: o.req ?? `req_${o.id}`,
      cwd: o.cwd ?? '/work/app',
      message: {
        id: o.id,
        model: o.model ?? 'claude-sonnet-5-5',
        usage: { input_tokens: o.input ?? 10, output_tokens: o.output ?? 100, cache_read_input_tokens: o.read ?? 1000, cache_creation_input_tokens: o.write ?? 200, speed: o.speed ?? 'standard' },
      },
    }) + '\n'
  );
}

function configDir(name = 'claude'): string {
  const config = join(dir, name);
  mkdirSync(join(config, 'projects', '-work-app'), { recursive: true });
  return config;
}

const lookup: SessionLookup = {
  session: (id) => (id === 'known' ? { title: 'Known session', projectRoot: '/work/app' } : null),
  projectOf: (cwd) => cwd,
  projectName: (root) => root.split('/').pop() ?? root,
};

const totals = (scope: string) =>
  cache.db.prepare('SELECT session_id AS session, SUM(output) AS output, SUM(turns) AS turns FROM session_usage WHERE scope = ? GROUP BY session_id ORDER BY session_id').all(scope);

describe('parseUsageLine', () => {
  it('reads tokens, the session, the model and fast mode, and skips synthetic and other lines', () => {
    const parsed = parseUsageLine(line({ id: 'm1', session: 's1', at: '2026-10-12T10:15:00Z', speed: 'fast' }).trim())!;
    expect(parsed).toMatchObject({ key: 'm1|req_m1', sessionId: 's1', model: 'claude-sonnet-5-5', input: 10, output: 100, cacheRead: 1000, cacheWrite: 200, fast: true });
    expect(parseUsageLine(line({ id: 'm2', session: 's1', at: '2026-10-12T10:15:00Z', model: '<synthetic>' }).trim())).toBeNull();
    expect(parseUsageLine(JSON.stringify({ type: 'user', message: { content: 'usage' } }))).toBeNull();
    expect(parseUsageLine('{"usage": broken')).toBeNull();
  });
});

describe('UsageScanner', () => {
  it('counts a message once, however many lines and files repeat it', async () => {
    const config = configDir();
    const scope = scopeOf(config);
    const repeated = line({ id: 'm1', session: 's1', at: '2026-10-12T10:00:00Z' });
    writeFileSync(join(config, 'projects', '-work-app', 's1.jsonl'), repeated + repeated + repeated + line({ id: 'm2', session: 's1', at: '2026-10-12T10:01:00Z' }));
    // A fork copies the history into a new file: still counted once.
    writeFileSync(join(config, 'projects', '-work-app', 's2.jsonl'), repeated);
    await new UsageScanner(cache.db).scan([{ scope, configDir: config }]);
    expect(totals(scope)).toEqual([{ session: 's1', output: 200, turns: 2 }]);
  });

  it('counts subagents under the session they ran in', async () => {
    const config = configDir();
    const scope = scopeOf(config);
    writeFileSync(join(config, 'projects', '-work-app', 's1.jsonl'), line({ id: 'm1', session: 's1', at: '2026-10-12T10:00:00Z' }));
    mkdirSync(join(config, 'projects', '-work-app', 's1', 'subagents'), { recursive: true });
    writeFileSync(join(config, 'projects', '-work-app', 's1', 'subagents', 'agent-a1.jsonl'), line({ id: 'm9', session: 's1', at: '2026-10-12T10:02:00Z', output: 50 }));
    await new UsageScanner(cache.db).scan([{ scope, configDir: config }]);
    expect(totals(scope)).toEqual([{ session: 's1', output: 150, turns: 2 }]);
  });

  it('reads only the appended lines, leaves a line without its newline for later, and rereads a rewritten file', async () => {
    const config = configDir();
    const scope = scopeOf(config);
    const file = join(config, 'projects', '-work-app', 's1.jsonl');
    writeFileSync(file, line({ id: 'm1', session: 's1', at: '2026-10-12T10:00:00Z' }));
    const scanner = new UsageScanner(cache.db);
    await scanner.scan([{ scope, configDir: config }]);
    const offset = () => (cache.db.prepare('SELECT offset FROM usage_files WHERE path = ?').get(file) as { offset: number }).offset;
    const first = offset();

    // Half a line: not counted yet, and the offset stays at the last newline.
    const next = line({ id: 'm2', session: 's1', at: '2026-10-12T10:05:00Z' });
    appendFileSync(file, next.slice(0, 40));
    await scanner.scan([{ scope, configDir: config }]);
    expect(offset()).toBe(first);
    expect(totals(scope)).toEqual([{ session: 's1', output: 100, turns: 1 }]);

    appendFileSync(file, next.slice(40));
    await scanner.scan([{ scope, configDir: config }]);
    expect(offset()).toBeGreaterThan(first);
    expect(totals(scope)).toEqual([{ session: 's1', output: 200, turns: 2 }]);

    // Rewritten with other content: read from the start; responses counted before stay counted once.
    writeFileSync(file, line({ id: 'm1', session: 's1', at: '2026-10-12T10:00:00Z' }).replace('"cwd"', '"cwX"') + line({ id: 'm3', session: 's1', at: '2026-10-12T10:09:00Z' }));
    // Same size as before: only the time and the bytes tell it apart.
    utimesSync(file, new Date(), new Date(Date.now() + 5_000));
    await scanner.scan([{ scope, configDir: config }]);
    expect(totals(scope)).toEqual([{ session: 's1', output: 300, turns: 3 }]);
  });

  it.skipIf(!canSymlink())('reads a config folder shared by two profiles once', async () => {
    const config = configDir();
    symlinkSync(config, join(dir, 'linked'));
    writeFileSync(join(config, 'projects', '-work-app', 's1.jsonl'), line({ id: 'm1', session: 's1', at: '2026-10-12T10:00:00Z' }));
    expect(scopeOf(join(dir, 'linked'))).toBe(scopeOf(config));
    await new UsageScanner(cache.db).scan([
      { scope: scopeOf(config), configDir: config },
      { scope: scopeOf(join(dir, 'linked')), configDir: join(dir, 'linked') },
    ]);
    expect(totals(scopeOf(config))).toEqual([{ session: 's1', output: 100, turns: 1 }]);
    expect((cache.db.prepare('SELECT COUNT(*) AS n FROM usage_files').get() as { n: number }).n).toBe(1);
  });

  it('keeps totals in UTC hours, per model', async () => {
    const config = configDir();
    const scope = scopeOf(config);
    writeFileSync(
      join(config, 'projects', '-work-app', 's1.jsonl'),
      line({ id: 'm1', session: 's1', at: '2026-10-12T10:59:59+02:00' }) +
        line({ id: 'm2', session: 's1', at: '2026-10-12T09:00:00Z' }) +
        line({ id: 'm3', session: 's1', at: '2026-10-12T09:30:00Z', model: 'claude-opus-5-5' }),
    );
    await new UsageScanner(cache.db).scan([{ scope, configDir: config }]);
    const rows = cache.db.prepare('SELECT hour, model, turns FROM session_usage ORDER BY hour, model').all();
    expect(rows).toEqual([
      { hour: Date.UTC(2026, 9, 12, 8), model: 'claude-sonnet-5-5', turns: 1 },
      { hour: Date.UTC(2026, 9, 12, 9), model: 'claude-opus-5-5', turns: 1 },
      { hour: Date.UTC(2026, 9, 12, 9), model: 'claude-sonnet-5-5', turns: 1 },
    ]);
    expect(hourOf(Date.UTC(2026, 9, 12, 9, 59, 59))).toBe(Date.UTC(2026, 9, 12, 9));
  });
});

describe('shares', () => {
  it('weighs cache writes 1.25×, cache reads 0.1× and output 5× against input', () => {
    expect(SHARE_WEIGHTS).toEqual({ input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 });
    expect(weightOf({ input: 100, cacheWrite: 100, cacheRead: 1000, output: 10 })).toBe(100 + 125 + 100 + 50);
    const shares = sharesOf([
      { key: 'a', weight: 300 },
      { key: 'b', weight: 100 },
    ]);
    expect(shares.get('a')).toEqual({ share: 0.75, measured: false });
  });

  it('uses a measured share and splits the rest by weight', () => {
    const shares = sharesOf(
      [
        { key: 'a', weight: 100 },
        { key: 'b', weight: 300 },
        { key: 'c', weight: 100 },
      ],
      new Map([['a', 0.6]]),
    );
    expect(shares.get('a')).toEqual({ share: 0.6, measured: true });
    expect(shares.get('b')!.share).toBeCloseTo(0.3);
    expect(shares.get('c')!.share).toBeCloseTo(0.1);
  });

  it('measures a session only while no other session ran', () => {
    const samples = [
      { at: 1000, percent: 10, resetsAt: 50_000, sessionId: null },
      { at: 2000, percent: 14, resetsAt: 50_000, sessionId: 'a' },
      { at: 3000, percent: 20, resetsAt: 50_000, sessionId: 'a' },
      { at: 4000, percent: 23, resetsAt: 50_000, sessionId: 'b' },
    ];
    const messages = [
      { at: 1500, sessionId: 'a' },
      { at: 2500, sessionId: 'a' },
      // b ran while a's second turn did: neither that step nor b's is measured.
      { at: 2800, sessionId: 'b' },
      { at: 3500, sessionId: 'b' },
    ];
    expect(measuredDeltas(samples, messages)).toEqual(new Map([['a', 4], ['b', 3]]));
    // Across a reset nothing is measured.
    expect(measuredDeltas([samples[0]!, { ...samples[1]!, resetsAt: 999_999 }], messages)).toEqual(new Map());
  });
});

describe('breakdown', () => {
  async function seeded() {
    const config = configDir();
    const scope = scopeOf(config);
    writeFileSync(
      join(config, 'projects', '-work-app', 'known.jsonl'),
      line({ id: 'k1', session: 'known', at: '2026-10-12T08:10:00Z', output: 1000, speed: 'fast' }) + line({ id: 'k2', session: 'known', at: '2026-10-11T08:10:00Z', output: 500, model: 'claude-opus-5-5' }),
    );
    writeFileSync(join(config, 'projects', '-work-app', 'other.jsonl'), line({ id: 'o1', session: 'other', at: '2026-10-12T09:10:00Z', output: 10, cwd: '/work/lib' }));
    await new UsageScanner(cache.db).scan([{ scope, configDir: config }]);
    return scope;
  }
  const now = Date.UTC(2026, 9, 12, 10);

  it('groups by session, project, model and day, with shares that add up to one', async () => {
    const scope = await seeded();
    const range = periodRange('week', now, 'UTC');
    const query = { scope, period: 'week' as const, ...range, model: null, timeZone: 'UTC' };
    const bySession = breakdown(cache.db, { ...query, groupBy: 'session' }, lookup);
    expect(bySession.totals).toMatchObject({ sessions: 2, turns: 3, fastTurns: 1 });
    expect(bySession.rows.map((r) => [r.label, r.projectRoot, r.fastTurns])).toEqual([
      ['Known session', '/work/app', 1],
      ['Session', '/work/lib', 0],
    ]);
    expect(bySession.rows.reduce((sum, r) => sum + r.share, 0)).toBeCloseTo(1);
    expect(breakdown(cache.db, { ...query, groupBy: 'project' }, lookup).rows.map((r) => r.label)).toEqual(['app', 'lib']);
    expect(breakdown(cache.db, { ...query, groupBy: 'model' }, lookup).rows.map((r) => [r.label, r.sessions])).toEqual([
      ['claude-sonnet-5-5', 2],
      ['claude-opus-5-5', 1],
    ]);
    expect(breakdown(cache.db, { ...query, groupBy: 'day' }, lookup).rows.map((r) => r.label)).toEqual(['2026-10-12', '2026-10-11']);
    expect(bySession.buckets).toHaveLength(7);
    expect(bySession.bucket).toBe('day');
  });

  it('keeps local days in the time zone asked for', async () => {
    const scope = await seeded();
    // In Honolulu (UTC-10) 08:10 and 09:10 UTC are the evening before.
    const range = periodRange('week', now, 'Pacific/Honolulu');
    const days = breakdown(cache.db, { scope, period: 'week', ...range, groupBy: 'day', model: null, timeZone: 'Pacific/Honolulu' }, lookup);
    expect(days.rows.map((r) => r.label)).toEqual(['2026-10-11', '2026-10-10']);
  });

  it('shows Auto model routing as its own row, in totals and shares, and counts the sessions Auto picked per model', async () => {
    const scope = await seeded();
    const routing = new RoutingStore(cache.db);
    const tokens = { input: 1_000, output: 40, cacheRead: 0, cacheWrite: 0 };
    routing.record({ id: 'r1', scope, at: Date.UTC(2026, 9, 12, 8), model: 'claude-haiku-5-5', picked: 'sonnet', tokens });
    routing.record({ id: 'r2', scope, at: Date.UTC(2026, 9, 12, 9), model: 'claude-haiku-5-5', picked: 'opus', tokens });
    // Another login's routing call stays out.
    routing.record({ id: 'r3', scope: 'elsewhere', at: Date.UTC(2026, 9, 12, 9), model: 'claude-haiku-5-5', picked: 'haiku', tokens });
    routing.attach('r1', 'known');
    const range = periodRange('week', now, 'UTC');
    const query = { scope, period: 'week' as const, ...range, model: null, timeZone: 'UTC' };
    const byModel = breakdown(cache.db, { ...query, groupBy: 'model' }, lookup);
    expect(byModel.rows.map((r) => [r.label, r.sessions, r.byAuto ?? 0, r.autoRouting?.picks ?? null])).toEqual([
      ['claude-sonnet-5-5', 2, 1, null],
      ['claude-opus-5-5', 1, 0, null],
      ['Auto routing', 0, 0, 2],
    ]);
    expect(byModel.rows.reduce((sum, r) => sum + r.share, 0)).toBeCloseTo(1);
    expect(byModel.totals.turns).toBe(5);
    expect(byModel.totals.sessions).toBe(2);
    // In Day, the calls count inside their day.
    expect(breakdown(cache.db, { ...query, groupBy: 'day' }, lookup).rows.map((r) => [r.label, r.turns])).toEqual([
      ['2026-10-12', 4],
      ['2026-10-11', 1],
    ]);
  });

  it('narrows to one model, and counts hours for the 24-hour period', async () => {
    const scope = await seeded();
    const range = periodRange('day', now, 'UTC');
    const result = breakdown(cache.db, { scope, period: 'day', ...range, groupBy: 'session', model: 'claude-sonnet-5-5', timeZone: 'UTC' }, lookup);
    expect(result.bucket).toBe('hour');
    expect(result.buckets).toHaveLength(25);
    expect(result.totals.turns).toBe(2);
  });
});

describe('PlanHistoryStore', () => {
  it('records /usage results and rate-limit updates, and lists each window with its resets', () => {
    const store = new PlanHistoryStore(cache.db);
    const reset = Date.UTC(2026, 9, 12, 12);
    store.recordSnapshot('scope', {
      fetchedAt: Date.UTC(2026, 9, 12, 9),
      limits: [{ kind: 'session', group: 'session', percent: 20, resetsAt: reset, scope: null, severity: 'normal', isActive: true }],
      extraUsage: null,
    });
    store.recordEvent('scope', 's1', { rateLimitType: 'five_hour', utilization: 0.25, resetsAt: reset / 1000 }, Date.UTC(2026, 9, 12, 10));
    store.recordEvent('scope', 's1', { rateLimitType: 'seven_day_opus', utilization: 0.5 }, Date.UTC(2026, 9, 12, 10));
    const history = store.history('scope', Date.UTC(2026, 9, 12, 0), Date.UTC(2026, 9, 12, 23));
    expect(history.since).toBe(Date.UTC(2026, 9, 12, 9));
    expect(history.series).toEqual([{ kind: 'session', scope: null, points: [{ at: Date.UTC(2026, 9, 12, 9), percent: 20 }, { at: Date.UTC(2026, 9, 12, 10), percent: 25 }], resets: [reset] }]);
    expect(store.samples('scope', 'session', 0, Date.UTC(2026, 9, 13)).map((s) => s.sessionId)).toEqual([null, 's1']);
  });
});
