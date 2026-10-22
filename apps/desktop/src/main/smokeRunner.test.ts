import { describe, expect, it } from 'vitest';
import { SKIPPED, SmokeRun } from './smokeRunner.ts';

describe('SmokeRun', () => {
  it('records results, booleans and throws', async () => {
    const run = new SmokeRun();
    await run.step('passes', async () => 'ok: fine');
    await run.step('says no', async () => 'the menu did not open');
    await run.step('true', async () => true);
    await run.step('false', async () => false);
    await run.step('throws', async () => {
      throw new Error('boom');
    });
    expect(run.steps.map(({ label, result, ok }) => [label, result, ok])).toEqual([
      ['passes', 'ok: fine', true],
      ['says no', 'the menu did not open', false],
      ['true', 'ok', true],
      ['false', 'failed', false],
      ['throws', 'failed: boom', false],
    ]);
  });

  it('stops the run when a step times out and skips the rest', async () => {
    const run = new SmokeRun();
    await run.step('hangs', () => new Promise<string>(() => {}), { timeoutMs: 20 });
    let ran = false;
    await run.step('after', async () => {
      ran = true;
      return 'ok';
    });
    expect(ran).toBe(false);
    expect(run.stoppedBy).toBe('hangs');
    expect(run.steps.map((s) => s.result)).toEqual(['failed: timed out after 0s', 'not run']);
  });

  it('cleans up after each step unless the step opts out', async () => {
    const cleaned: string[] = [];
    const run = new SmokeRun({
      cleanup: async () => {
        cleaned.push('x');
        return null;
      },
    });
    await run.step('one', async () => 'ok');
    await run.step('nested', async () => 'ok', { cleanup: false });
    await run.step('fails', async () => 'no');
    expect(cleaned).toHaveLength(2);
  });

  it('lists the slowest steps first', async () => {
    const run = new SmokeRun();
    await run.step('quick', async () => 'ok');
    await run.step('slow', () => new Promise<string>((resolve) => setTimeout(() => resolve('ok'), 30)));
    expect(run.slowest(1).map((s) => s.label)).toEqual(['slow']);
  });

  it('runs only the steps --only picks, the always ones, and the steps inside a picked one', async () => {
    const run = new SmokeRun({ only: /pop-out|projects/i });
    const ran: string[] = [];
    const step = (label: string, options = {}) => run.step(label, async () => (ran.push(label), 'ok'), options);
    await step('open a session', { always: true });
    expect(await step('find in session')).toBe(SKIPPED);
    await step('a session in its own window (Pop-out)');
    await run.step('projects', async () => {
      ran.push('projects');
      await step('project branches');
      return 'ok';
    });
    expect(ran).toEqual(['open a session', 'a session in its own window (Pop-out)', 'projects', 'project branches']);
    expect(run.steps.map((s) => s.label)).toEqual(['open a session', 'a session in its own window (Pop-out)', 'project branches', 'projects']);
    expect(run.matched).toBe(2);
  });
});
