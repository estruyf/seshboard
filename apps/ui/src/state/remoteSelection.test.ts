import { describe, expect, it } from 'vitest';
import { isRemoteRowId, parseRemoteRowId, remoteRowId, sameRemote, selectionOf } from './remoteSelection.ts';

describe('the selection', () => {
  it('keeps a remote session as its computer and id', () => {
    const id = remoteRowId({ computerId: 'c-1', sessionId: 's-1' });
    expect(isRemoteRowId(id)).toBe(true);
    expect(parseRemoteRowId(id)).toEqual({ computerId: 'c-1', sessionId: 's-1' });
    expect(selectionOf(id)).toEqual({ kind: 'remote', computerId: 'c-1', sessionId: 's-1' });
  });

  it('never reads a local id as a remote one', () => {
    const local = '6c1d7f0e-2b9a-4f3e-9d61-0a2b3c4d5e6f';
    expect(isRemoteRowId(local)).toBe(false);
    expect(parseRemoteRowId(local)).toBeNull();
    expect(selectionOf(local)).toEqual({ kind: 'local', sessionId: local });
  });

  it('takes the session after the last colon, and refuses a malformed key', () => {
    expect(parseRemoteRowId('remote:a:b:s')).toEqual({ computerId: 'a:b', sessionId: 's' });
    expect(parseRemoteRowId('remote:only')).toBeNull();
    expect(parseRemoteRowId('remote::s')).toBeNull();
    expect(parseRemoteRowId('remote:c:')).toBeNull();
  });

  it('compares remote sessions by computer and id', () => {
    expect(sameRemote({ computerId: 'c', sessionId: 's' }, { computerId: 'c', sessionId: 's' })).toBe(true);
    expect(sameRemote({ computerId: 'c', sessionId: 's' }, { computerId: 'd', sessionId: 's' })).toBe(false);
    expect(sameRemote(null, { computerId: 'c', sessionId: 's' })).toBe(false);
  });
});
