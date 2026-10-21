import { describe, expect, it } from 'vitest';
import { parseRemoteDrafts, remoteNewDraftKey, remoteSessionDraftKey, withRemoteDraft } from './remoteDrafts.ts';

const fill = { prompt: { id: 'p1', name: 'Review', scope: { kind: 'global' as const } }, text: 'Review {{pr}}', values: {}, displays: {} };

describe('remote drafts', () => {
  it('keys a session and New session per computer', () => {
    expect(remoteSessionDraftKey('mystic', 's1')).toBe('mystic:session:s1');
    expect(remoteNewDraftKey('mystic')).toBe('mystic:new');
    expect(remoteSessionDraftKey('a', 's1')).not.toBe(remoteSessionDraftKey('b', 's1'));
  });

  it('keeps text and a saved prompt, and forgets an empty draft', () => {
    let drafts = withRemoteDraft({}, 'a', { text: 'hello' });
    drafts = withRemoteDraft(drafts, 'b', { text: '', fill });
    expect(drafts).toEqual({ a: { text: 'hello' }, b: { text: '', fill } });
    expect(withRemoteDraft(drafts, 'a', { text: '   ' })).toEqual({ b: { text: '', fill } });
  });

  it('reads back what it saved and skips anything else', () => {
    expect(parseRemoteDrafts(JSON.stringify({ a: { text: 'hi' }, b: { text: '', fill } }))).toEqual({ a: { text: 'hi' }, b: { text: '', fill } });
    expect(parseRemoteDrafts(JSON.stringify({ a: 'hi', b: { text: 3 }, c: null }))).toEqual({});
    expect(parseRemoteDrafts('not json')).toEqual({});
    expect(parseRemoteDrafts('[1]')).toEqual({});
    expect(parseRemoteDrafts(null)).toEqual({});
  });
});
