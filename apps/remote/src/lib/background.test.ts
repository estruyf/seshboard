import { describe, expect, it } from 'vitest';
import { backgroundKind, backgroundLine, backgroundSummary, inBackground } from './background.ts';

const task = (type: string) => ({ type });

describe('backgroundSummary', () => {
  it('names commands and agents, and counts a mix as tasks', () => {
    expect(backgroundSummary([task('local_bash')])).toBe('1 background command');
    expect(backgroundSummary([task('local_agent'), task('remote_agent')])).toBe('2 background agents');
    expect(backgroundSummary([task('local_bash'), task('local_agent')])).toBe('2 background tasks');
    expect(backgroundKind('something_new')).toBe('other');
  });
});

describe('inBackground', () => {
  it('is true while a task runs after the turn, also unread, and never while Claude works or waits', () => {
    const running = [{ taskId: 'b1', type: 'local_bash', description: 'gh run watch', startedAt: 1 }];
    expect(inBackground({ status: 'background', background: running })).toBe(true);
    expect(inBackground({ status: 'unread', background: running })).toBe(true);
    expect(inBackground({ status: 'unread', background: [] })).toBe(false);
    expect(inBackground({ status: 'working', background: running })).toBe(false);
    expect(inBackground({ status: 'needs-you', background: running })).toBe(false);
    // An older Seshboard sends no list, only the status.
    expect(inBackground({ status: 'background' })).toBe(true);
    expect(inBackground(null)).toBe(false);
  });

  it('says what runs when the computer says', () => {
    expect(backgroundLine([task('local_bash')])).toBe('1 background command running');
    expect(backgroundLine(undefined)).toBe('Running in the background');
  });
});
