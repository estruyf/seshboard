import { beforeEach, describe, expect, it } from 'vitest';
import { useWhy } from './whyStore.ts';

describe('the Why Claude asks panel', () => {
  beforeEach(() => useWhy.setState({ open: null, results: new Map() }));

  it('opens for a request, closes on a second press, and moves to another request', () => {
    useWhy.getState().toggle('s1', 'r1');
    expect(useWhy.getState().open).toEqual({ sessionId: 's1', requestId: 'r1' });
    useWhy.getState().toggle('s1', 'r2');
    expect(useWhy.getState().open).toEqual({ sessionId: 's1', requestId: 'r2' });
    useWhy.getState().toggle('s1', 'r2');
    expect(useWhy.getState().open).toBeNull();
  });

  it('keeps what came back, so opening it again shows it at once', () => {
    useWhy.getState().setResult('r1', { status: 'loading' });
    useWhy.getState().toggle('s1', 'r1');
    useWhy.getState().close();
    expect(useWhy.getState().results.get('r1')).toEqual({ status: 'loading' });
  });

  it('asks again for one that failed', () => {
    useWhy.getState().setResult('r1', { status: 'error', error: 'Not connected' });
    useWhy.getState().toggle('s1', 'r1');
    expect(useWhy.getState().results.has('r1')).toBe(false);
  });
});
