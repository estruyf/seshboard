import { describe, expect, it } from 'vitest';
import { fastCommand, fastModeFace } from './fastMode.ts';

describe('fastModeFace', () => {
  it('is off when Claude Code has said nothing, and says what it does and costs', () => {
    const face = fastModeFace({ contextTokens: null });
    expect(face).toMatchObject({ look: 'off', next: true, label: 'Fast mode: off' });
    expect(face.tooltip).toContain('2.5x faster');
    expect(face.tooltip).toContain('usage credits');
    expect(face.tooltip).not.toContain('reads this conversation again');
  });

  it('warns about the cost of switching once the conversation has context', () => {
    expect(fastModeFace({ fastMode: 'off', contextTokens: 1200 }).tooltip).toContain('reads this conversation again');
    expect(fastModeFace({ fastMode: 'on', contextTokens: 1200 }).tooltip).not.toContain('reads this conversation again');
  });

  it('turns off when on or cooling down', () => {
    expect(fastModeFace({ fastMode: 'on', contextTokens: 0 })).toMatchObject({ look: 'on', next: false });
    expect(fastModeFace({ fastMode: 'cooldown', contextTokens: 0 })).toMatchObject({ look: 'cooldown', next: false, label: 'Fast mode: paused' });
  });

  it('says why when out of credits, even though Claude Code still reports on, and a click turns it off', () => {
    const face = fastModeFace({ fastMode: 'on', fastModeBlocked: 'credits_exhausted', contextTokens: 10 });
    expect(face).toMatchObject({ look: 'blocked', next: false });
    expect(face.tooltip).toContain('out of usage credits');
    expect(face.tooltip).toContain('turn it off');
  });

  it('offers to try again when it could not turn on, with a plain line for a reason it does not know', () => {
    const face = fastModeFace({ fastMode: 'off', fastModeBlocked: 'extra_usage_disabled', contextTokens: 10 });
    expect(face).toMatchObject({ look: 'blocked', next: true });
    expect(face.tooltip).toContain('needs usage credits');
    expect(face.tooltip).toContain('try again');
    expect(fastModeFace({ fastMode: 'off', fastModeBlocked: 'something_new', contextTokens: 0 }).tooltip).toContain('not available right now');
  });

  it('has no em dashes in anything it says', () => {
    for (const blocked of ['credits_exhausted', 'extra_usage_disabled', 'free', 'preference', 'model_not_allowed', 'not_first_party', 'disabled_by_env', 'network_error', 'new']) {
      expect(fastModeFace({ fastMode: 'off', fastModeBlocked: blocked, contextTokens: 1 }).tooltip).not.toContain('—');
    }
  });
});

describe('fastCommand', () => {
  it('reads /fast and its arguments', () => {
    expect(fastCommand('/fast')).toBe('toggle');
    expect(fastCommand('  /fast  ')).toBe('toggle');
    expect(fastCommand('/fast on')).toBe('on');
    expect(fastCommand('/FAST OFF')).toBe('off');
  });

  it('leaves everything else alone', () => {
    expect(fastCommand('/faster')).toBeNull();
    expect(fastCommand('/fast please')).toBeNull();
    expect(fastCommand('make it /fast')).toBeNull();
  });
});
