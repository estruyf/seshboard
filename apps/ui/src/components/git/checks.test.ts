import { describe, expect, it } from 'vitest';
import type { PrCheck, PrChecks } from '@seshboard/protocol/client';
import { checksLine, checkTime, duration, fixChecksDraft } from './checks.ts';

const check = (name: string, bucket: PrCheck['bucket'], extra: Partial<PrCheck> = {}): PrCheck => ({ name, bucket, workflow: 'CI', description: '', link: '', startedAt: null, completedAt: null, ...extra });
const of = (checks: PrCheck[], error: PrChecks['error'] = null): PrChecks => ({ path: '/repo', branch: 'feat/login', pr: { number: 123, url: 'https://github.com/o/r/pull/123' }, checks, summary: 'none', error, at: 0 });

describe('checksLine', () => {
  it('says how many passed, failed or still run', () => {
    expect(checksLine(of([check('a', 'pass'), check('b', 'pass'), check('c', 'pass')]))).toBe('3 checks passed');
    expect(checksLine(of([check('a', 'fail'), check('b', 'pass'), check('c', 'pass'), check('d', 'pass'), check('e', 'pass')]))).toBe('1 of 5 checks failed');
    expect(checksLine(of([check('a', 'pending'), check('b', 'pending'), check('c', 'pass')]))).toBe('2 checks running');
    expect(checksLine(of([check('a', 'fail'), check('b', 'pending'), check('c', 'skipping')]))).toBe('1 of 2 checks failed, 1 running');
    expect(checksLine(of([check('a', 'pass'), check('b', 'cancel')]))).toBe('1 check passed, 1 cancelled');
    expect(checksLine(of([check('a', 'skipping')]))).toBe('All checks were skipped');
    expect(checksLine(of([]))).toBe('No checks');
    expect(checksLine(of([], { code: 'GH_AUTH', message: 'Not signed in to GitHub.' }))).toBe('Not signed in to GitHub.');
  });
});

describe('checkTime', () => {
  const now = Date.parse('2026-10-16T18:20:00Z');
  it('shows how long a check ran, or has been running', () => {
    expect(checkTime(check('a', 'fail', { startedAt: '2026-10-16T18:14:34Z', completedAt: '2026-10-16T18:19:50Z' }), now)).toBe('5m 16s');
    expect(checkTime(check('a', 'pending', { startedAt: '2026-10-16T18:19:18Z' }), now)).toBe('42s');
    expect(checkTime(check('a', 'pending'), now)).toBe('Queued');
    expect(checkTime(check('a', 'skipping', { startedAt: '2026-10-16T18:15:43Z', completedAt: '2026-10-16T18:15:42Z' }), now)).toBe('Skipped');
    expect(checkTime(check('a', 'cancel'), now)).toBe('Cancelled');
    expect(checkTime(check('a', 'pass'), now)).toBe('');
    expect(duration(3_900_000)).toBe('1h 5m');
  });
});

describe('fixChecksDraft', () => {
  it('names the failed checks and puts each log in a chip', () => {
    const failed = [
      check('test (ubuntu-latest)', 'fail', { link: 'https://github.com/o/r/actions/runs/1/job/2' }),
      check('vercel', 'fail', { workflow: '', description: 'Deployment has failed', link: 'https://vercel.com/o/r/abc' }),
      check('build', 'fail', { link: 'https://github.com/o/r/actions/runs/1/job/3' }),
    ];
    const logs = [
      { name: 'test (ubuntu-latest)', workflow: 'CI', link: failed[0]!.link, log: 'FAIL src/a.test.ts\nexpected 1 to be 2', note: null },
      { name: 'vercel', workflow: '', link: failed[1]!.link, log: null, note: null },
      { name: 'build', workflow: 'CI', link: failed[2]!.link, log: null, note: "Couldn't read its log: run 1 is still in progress." },
    ];
    const draft = fixChecksDraft(of(failed), failed, logs);
    expect(draft.text).toBe(
      [
        'These checks failed on PR #123 (feat/login):',
        '',
        '- test (ubuntu-latest), workflow CI',
        '- vercel: Deployment has failed. https://vercel.com/o/r/abc',
        "- build, workflow CI: Couldn't read its log: run 1 is still in progress. https://github.com/o/r/actions/runs/1/job/3",
        '',
        'Find the cause, fix it, and run the failing test locally if you can.',
      ].join('\n'),
    );
    expect(draft.items).toEqual([{ kind: 'text', source: 'checks', label: 'test (ubuntu-latest), workflow CI', text: 'FAIL src/a.test.ts\nexpected 1 to be 2' }]);
  });

  it('says "This check" for one', () => {
    const failed = [check('lint', 'fail')];
    expect(fixChecksDraft(of(failed), failed, [{ name: 'lint', workflow: 'CI', link: '', log: 'x', note: null }]).text).toMatch(/^This check failed on PR #123 \(feat\/login\):/);
  });
});
