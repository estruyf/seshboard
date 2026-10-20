import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from './drafts.ts';

describe('drafts', () => {
  beforeEach(() => {
    const items = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps New session and each session apart', () => {
    saveDraft({ kind: 'new' }, 'Fix the login');
    saveDraft({ kind: 'session', sessionId: 'a' }, 'And the tests');
    expect(loadDraft({ kind: 'new' })).toBe('Fix the login');
    expect(loadDraft({ kind: 'session', sessionId: 'a' })).toBe('And the tests');
    expect(loadDraft({ kind: 'session', sessionId: 'b' })).toBe('');
  });

  it('keeps the text as typed, and forgets one that is only spaces or cleared', () => {
    saveDraft({ kind: 'new' }, '  two\nlines ');
    expect(loadDraft({ kind: 'new' })).toBe('  two\nlines ');
    saveDraft({ kind: 'new' }, ' \n ');
    expect(loadDraft({ kind: 'new' })).toBe('');
    saveDraft({ kind: 'session', sessionId: 'a' }, 'Sent');
    clearDraft({ kind: 'session', sessionId: 'a' });
    expect(loadDraft({ kind: 'session', sessionId: 'a' })).toBe('');
  });

  it('works without storage', () => {
    vi.stubGlobal('sessionStorage', undefined);
    expect(() => saveDraft({ kind: 'new' }, 'x')).not.toThrow();
    expect(loadDraft({ kind: 'new' })).toBe('');
  });
});
