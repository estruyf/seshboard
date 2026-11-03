import { describe, expect, it } from 'vitest';
import { triggerOriginOf } from './triggerOrigin.ts';

describe('triggerOriginOf', () => {
  const origin = { name: 'CI fails on main', kind: 'ci', ref: 'CI #4512', url: 'https://github.com/acme/web/actions/runs/4512', at: 1 };

  it('reads what another computer sent', () => {
    expect(triggerOriginOf(origin)).toEqual(origin);
    expect(triggerOriginOf({ ...origin, kind: 'issue', ref: '#212', name: ' ' })).toMatchObject({ kind: 'issue', ref: '#212', name: 'a trigger' });
  });

  it('keeps a link only to an https page', () => {
    expect(triggerOriginOf({ ...origin, url: 'javascript:alert(1)' })?.url).toBe('');
    expect(triggerOriginOf({ ...origin, url: 'file:///etc/passwd' })?.url).toBe('');
  });

  it('is null for nothing, or what it can’t read', () => {
    expect(triggerOriginOf(undefined)).toBeNull();
    expect(triggerOriginOf({ ...origin, kind: 'schedule' })).toBeNull();
    expect(triggerOriginOf({ ...origin, at: 'today' })).toBeNull();
  });
});
