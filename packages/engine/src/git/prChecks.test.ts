import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChecksFinished, PrCheck, PrChecks } from '@switchboard/protocol';
import {
  actionsJob,
  AFTER_PUSH_POLL_MS,
  AFTER_PUSH_WINDOW_MS,
  BACKGROUND_POLL_MS,
  checksFrom,
  ChecksWatcher,
  cleanLog,
  FOREGROUND_POLL_MS,
  LOG_LINES,
  parseChecks,
  readCheckLogs,
  readChecks,
  summarize,
  tail,
} from './prChecks.ts';
import type { GhCommand, RunResult } from './pullRequest.ts';

const ESC = '\x1b';
const base = { path: '/repo', branch: 'feat/login', pr: { number: 123, url: 'https://github.com/o/r/pull/123' } };
const check = (name: string, bucket: PrCheck['bucket'], extra: Partial<PrCheck> = {}): PrCheck => ({ name, bucket, workflow: 'CI', description: '', link: '', startedAt: null, completedAt: null, ...extra });
const result = (stdout: string, code: number | null = 0, stderr = ''): RunResult => ({ code, stdout, stderr, missing: false });

describe('reading checks', () => {
  const json = JSON.stringify([
    { name: 'lint', state: 'SUCCESS', bucket: 'pass', link: 'https://github.com/o/r/actions/runs/1/job/11', workflow: 'CI', description: '', startedAt: '2026-10-16T18:14:29Z', completedAt: '2026-10-16T18:15:42Z' },
    { name: 'test (ubuntu-latest)', state: 'FAILURE', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/1/job/12', workflow: 'CI', description: '', startedAt: '2026-10-16T18:14:29Z', completedAt: '2026-10-16T18:19:50Z' },
    { name: 'deploy', state: 'IN_PROGRESS', bucket: 'pending', link: '', workflow: 'Website', description: '', startedAt: '2026-10-16T18:15:43Z', completedAt: '0001-01-01T00:00:00Z' },
    { name: 'vercel', state: 'FAILURE', link: 'https://vercel.com/o/r/abc', workflow: '', description: 'Deployment has failed' },
  ]);

  it('parses gh pr checks, failed ones first, and leaves out times that have not come yet', () => {
    const checks = parseChecks(json)!;
    expect(checks.map((c) => [c.name, c.bucket])).toEqual([
      ['test (ubuntu-latest)', 'fail'],
      ['vercel', 'fail'],
      ['deploy', 'pending'],
      ['lint', 'pass'],
    ]);
    expect(checks.find((c) => c.name === 'deploy')?.completedAt).toBeNull();
    expect(parseChecks('no checks reported')).toBeNull();
    expect(parseChecks('{}')).toBeNull();
  });

  it('sums them up: a failure first, then running, then passed', () => {
    expect(summarize([])).toBe('none');
    expect(summarize([check('a', 'pass'), check('b', 'pending'), check('c', 'fail')])).toBe('fail');
    expect(summarize([check('a', 'pass'), check('b', 'pending')])).toBe('pending');
    expect(summarize([check('a', 'pass'), check('b', 'skipping'), check('c', 'cancel')])).toBe('pass');
  });

  it("reads the list whatever gh's exit code (8 while pending, 1 when one failed)", () => {
    expect(checksFrom(result(json, 8), base, 5)).toMatchObject({ summary: 'fail', error: null, at: 5 });
    expect(checksFrom(result(json, 1), base, 5).checks).toHaveLength(4);
    expect(checksFrom(result('', 1, "no checks reported on the 'feat/login' branch\n"), base, 5)).toMatchObject({ checks: [], summary: 'none', error: null });
  });

  it('says why when gh is missing or signed out', () => {
    expect(checksFrom({ code: null, stdout: '', stderr: 'spawn gh ENOENT', missing: true }, base, 5).error).toEqual({ code: 'GH_MISSING', message: "GitHub CLI isn't installed." });
    expect(checksFrom(result('', 4, 'To get started with GitHub CLI, please run:  gh auth login\n'), base, 5).error).toEqual({ code: 'GH_AUTH', message: 'Not signed in to GitHub.' });
    expect(checksFrom(result('', 1, 'HTTP 502: Bad gateway\n'), base, 5).error?.code).toBe('UNKNOWN');
  });

  it('finds the run and job of a GitHub Actions check, and nothing in other links', () => {
    expect(actionsJob('https://github.com/o/r/actions/runs/38945799790/job/117124472963')).toEqual({ run: '38945799790', job: '117124472963' });
    expect(actionsJob('https://ghe.example.com/o/r/actions/runs/1/job/2?pr=3')).toEqual({ run: '1', job: '2' });
    expect(actionsJob('https://vercel.com/o/r/abc')).toBeNull();
    expect(actionsJob('')).toBeNull();
  });
});

describe('logs', () => {
  it('drops the job name, timestamps, colours and group markers, and marks where a step starts', () => {
    const raw = [
      `test\tSet up job\t﻿2026-10-16T18:16:20.2013900Z ##[group]Run npm test`,
      `test\tSet up job\t2026-10-16T18:16:20.2014440Z ${ESC}[36;1mnpm test${ESC}[0m`,
      `test\tSet up job\t2026-10-16T18:16:20.2069960Z ##[endgroup]`,
      `test\tRun tests\t2026-10-16T18:16:21.0000000Z FAIL src/a.test.ts\ttab kept`,
      `test\tRun tests\t2026-10-16T18:16:21.1000000Z ##[error]Process completed with exit code 1.`,
      '',
    ].join('\r\n');
    expect(cleanLog(raw)).toBe(['Step: Set up job', 'Run npm test', 'npm test', 'Step: Run tests', 'FAIL src/a.test.ts\ttab kept', 'Error: Process completed with exit code 1.'].join('\n'));
  });

  it('keeps the end: the last lines, within a number of characters, starting on a whole line', () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n');
    const kept = tail(text, LOG_LINES).split('\n');
    expect(kept).toHaveLength(LOG_LINES);
    expect(kept[0]).toBe('line 51');
    expect(tail(text, LOG_LINES, 20)).toBe('line 199\nline 200');
  });
});

describe('with gh', () => {
  let scratch: string;
  let gh: GhCommand;
  const env = () => ({ HOME: process.env.HOME ?? '', PATH: process.env.PATH ?? '' });

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-checks-')));
    // A fake gh: `pr checks` prints a list and exits with 8 (some pending); `run view` prints a log, or fails for job 13.
    const script = join(scratch, 'gh.mjs');
    writeFileSync(
      script,
      `const argv = process.argv.slice(2);
if (argv[0] === 'pr' && argv[1] === 'checks') {
  process.stdout.write(JSON.stringify([{ name: 'test', state: 'IN_PROGRESS', bucket: 'pending', link: '', workflow: 'CI', description: '' }]));
  process.exit(8);
}
if (argv[0] === 'run' && argv[1] === 'view') {
  if (argv.includes('--job=13')) { process.stderr.write('X run 1 is still in progress; logs will be available when it is complete\\n'); process.exit(1); }
  if (argv.includes('--job=14')) process.exit(0);
  const lines = Array.from({ length: 300 }, (_, i) => 'test\\tRun tests\\t2026-10-16T18:16:21.0000000Z line ' + (i + 1));
  process.stdout.write(lines.join('\\n') + '\\n');
  process.exit(0);
}
process.exit(2);
`,
    );
    gh = { file: process.execPath, args: [script] };
  });

  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  it('asks gh pr checks for JSON and takes the list from a pending exit', async () => {
    const checks = await readChecks(gh, { ...base, path: scratch }, env(), () => 7);
    expect(checks).toMatchObject({ summary: 'pending', at: 7, error: null, checks: [{ name: 'test', bucket: 'pending' }] });
  });

  it("reads each failed job's log, its last lines, and says why when it can't", async () => {
    const logs = await readCheckLogs(gh, scratch, env(), [
      { name: 'test', workflow: 'CI', link: 'https://github.com/o/r/actions/runs/1/job/12' },
      { name: 'vercel', workflow: '', link: 'https://vercel.com/o/r/abc' },
      { name: 'build', workflow: 'CI', link: 'https://github.com/o/r/actions/runs/1/job/13' },
      { name: 'docs', workflow: 'CI', link: 'https://github.com/o/r/actions/runs/1/job/14' },
    ]);
    expect(logs.map((l) => l.name)).toEqual(['test', 'vercel', 'build', 'docs']);
    const lines = logs[0]!.log!.split('\n');
    expect(lines).toHaveLength(LOG_LINES);
    expect(lines.at(-1)).toBe('line 300');
    expect(logs[1]).toEqual({ name: 'vercel', workflow: '', link: 'https://vercel.com/o/r/abc', log: null, note: null });
    expect(logs[2]).toMatchObject({ log: null, note: "Couldn't read its log: run 1 is still in progress; logs will be available when it is complete" });
    expect(logs[3]).toMatchObject({ log: null, note: 'GitHub has no log of a failed step for it.' });
  });
});

describe('ChecksWatcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (answers: Array<PrChecks | null>) => {
    const reads: string[] = [];
    const emitted: PrChecks[] = [];
    const finished: ChecksFinished[] = [];
    let i = 0;
    const watcher = new ChecksWatcher({
      read: async (cwd) => {
        reads.push(cwd);
        const answer = answers[Math.min(i++, answers.length - 1)]!;
        return answer && { ...answer, at: Date.now() };
      },
      emit: (checks) => emitted.push(checks),
      finished: (event) => finished.push(event),
    });
    return { watcher, reads, emitted, finished };
  };
  const at = (summary: PrChecks['summary'], checks: PrCheck[]): PrChecks => ({ ...base, checks, summary, error: null, at: 0 });
  const running = at('pending', [check('test', 'pending'), check('lint', 'pass')]);
  const failed = at('fail', [check('test', 'fail'), check('lint', 'pass')]);
  const passed = at('pass', [check('test', 'pass'), check('lint', 'pass')]);

  it('reads running checks again every 30 seconds until they finish, then says how they ended', async () => {
    const { watcher, reads, finished, emitted } = setup([running, running, failed]);
    await watcher.get('/repo', { sessionId: 's1' });
    expect(reads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    expect(reads).toHaveLength(2);
    expect(finished).toEqual([]);
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    expect(finished).toEqual([{ sessionId: 's1', path: '/repo', branch: 'feat/login', pr: base.pr, outcome: 'fail', failed: 1, total: 2 }]);
    expect(emitted).toHaveLength(3);
    // Done: nothing more by itself.
    await vi.advanceTimersByTimeAsync(10 * FOREGROUND_POLL_MS);
    expect(reads).toHaveLength(3);
    watcher.close();
  });

  it('says nothing for checks that were done when first read', async () => {
    const { watcher, finished } = setup([passed]);
    await watcher.get('/repo', { sessionId: 's1' });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(finished).toEqual([]);
    watcher.close();
  });

  it('reuses a recent read unless asked for a fresh one', async () => {
    const { watcher, reads } = setup([passed]);
    await watcher.get('/repo');
    await watcher.get('/repo');
    expect(reads).toHaveLength(1);
    await watcher.get('/repo', { fresh: true });
    expect(reads).toHaveLength(2);
    watcher.close();
  });

  it('slows down to every 5 minutes without a focused window, and picks up again with one', async () => {
    const { watcher, reads } = setup([running]);
    watcher.setForeground(false);
    await watcher.get('/repo', { sessionId: 's1' });
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS * 2);
    expect(reads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(BACKGROUND_POLL_MS);
    expect(reads).toHaveLength(2);
    watcher.setForeground(true);
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    expect(reads).toHaveLength(3);
    watcher.close();
  });

  it('looks for checks that have not started yet after a push, for a while', async () => {
    const none = at('none', []);
    const { watcher, reads, finished } = setup([passed, none, running, passed]);
    await watcher.get('/repo', { sessionId: 's1' });
    await watcher.get('/repo', { sessionId: 's1', afterPush: true });
    expect(reads).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(AFTER_PUSH_POLL_MS);
    expect(reads).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    expect(finished.map((f) => f.outcome)).toEqual(['pass']);
    await vi.advanceTimersByTimeAsync(AFTER_PUSH_WINDOW_MS * 2);
    expect(reads.length).toBeLessThanOrEqual(4 + Math.ceil(AFTER_PUSH_WINDOW_MS / AFTER_PUSH_POLL_MS));
    watcher.close();
  });

  it('stops following a branch that has no pull request any more', async () => {
    const { watcher, reads, emitted } = setup([running, null]);
    await watcher.get('/repo');
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    await vi.advanceTimersByTimeAsync(10 * FOREGROUND_POLL_MS);
    expect(reads).toHaveLength(2);
    expect(emitted).toHaveLength(1);
    watcher.close();
  });

  it('stops following the checks of an archived session: no more reads, and no notice when they finish', async () => {
    const { watcher, reads, finished } = setup([running, running, failed]);
    await watcher.get('/repo', { sessionId: 's1' });
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    expect(reads).toHaveLength(2);
    watcher.release('s1');
    await vi.advanceTimersByTimeAsync(10 * FOREGROUND_POLL_MS);
    expect(reads).toHaveLength(2);
    expect(finished).toEqual([]);
    // A read asked for without a live session (the archived window) doesn't start following again.
    await watcher.get('/repo', { fresh: true });
    await vi.advanceTimersByTimeAsync(10 * FOREGROUND_POLL_MS);
    expect(reads).toHaveLength(3);
    expect(finished).toEqual([]);
    watcher.close();
  });
});
