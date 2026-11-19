import { describe, expect, it } from 'vitest';
import { failureLine, pickOutcome, shouldDraw } from './mermaidBlockState.ts';

const drawn = (svg: string) => ({ ok: true as const, svg });

describe('pickOutcome', () => {
  it('shows the drawing for this source and theme first', () => {
    expect(pickOutcome('a', drawn('new'), { code: 'a', outcome: drawn('old') }, { code: 'a', outcome: drawn('older') })).toEqual(drawn('new'));
  });

  it('keeps the old drawing while a new theme is drawn, also for a block that came out of the cache', () => {
    // Mounted from the cache: no drawing of its own, but it showed one.
    expect(pickOutcome('a', undefined, null, { code: 'a', outcome: drawn('light') })).toEqual(drawn('light'));
    expect(pickOutcome('a', undefined, { code: 'a', outcome: drawn('light') }, null)).toEqual(drawn('light'));
  });

  it('starts over when the source changes, and shows the source before anything is drawn', () => {
    expect(pickOutcome('b', undefined, { code: 'a', outcome: drawn('x') }, { code: 'a', outcome: drawn('x') })).toBeNull();
    expect(pickOutcome('a', undefined, null, null)).toBeNull();
  });

  it('shows a failure as the outcome, so the source gets its line', () => {
    const failed = { ok: false as const, error: 'Parse error' };
    expect(pickOutcome('a', failed, null, null)).toBe(failed);
  });
});

describe('shouldDraw', () => {
  it('waits while the reply is being written, and does not draw what is drawn', () => {
    expect(shouldDraw(true, undefined)).toBe(false);
    expect(shouldDraw(false, drawn('x'))).toBe(false);
    expect(shouldDraw(false, undefined)).toBe(true);
  });
});

describe('failureLine', () => {
  it('blames the diagram for a parse error and the viewer for a load failure', () => {
    expect(failureLine({ ok: false, error: 'Parse error' })).toBe("Couldn't draw this diagram.");
    expect(failureLine({ ok: false, error: 'chunk failed', load: true })).toBe("Couldn't load the diagram viewer.");
  });
});
