import { describe, expect, it } from 'vitest';
import type { BrowserFavorite, BrowserHistoryEntry } from '@seshboard/protocol/client';
import { addressSuggestions, autoPick, bareAddress, matchScore } from './addressSuggestions.ts';

const visit = (url: string, title = '', visits = 1, lastVisit = 1): BrowserHistoryEntry => ({ url, title, visits, lastVisit });
const favorite = (url: string, title: string): BrowserFavorite => ({ id: url, url, title, favicon: 'data:image/png;base64,AAAA', position: 0, createdAt: 0 });
const tab = (id: string, url: string | null, title = '') => ({ id, url, title, name: null, favicon: null });

describe('bareAddress', () => {
  it('drops the scheme, www. and a trailing slash', () => {
    expect(bareAddress('https://www.GitHub.com/')).toBe('github.com');
    expect(bareAddress('http://localhost:3000/a')).toBe('localhost:3000/a');
  });
});

describe('matchScore', () => {
  it('ranks the start of the address, then the start of a word, then anywhere', () => {
    expect(matchScore('sesh', 'https://seshboard.dev/', '')).toBe(100);
    expect(matchScore('www.sesh', 'https://seshboard.dev/', '')).toBe(100);
    expect(matchScore('sesh', 'https://github.com/estruyf/seshboard', '')).toBe(60);
    expect(matchScore('board', 'https://example.com/', 'Seshboard docs')).toBe(30);
    expect(matchScore('nope', 'https://example.com/', 'Example')).toBe(0);
    expect(matchScore('  ', 'https://example.com/', 'Example')).toBe(0);
  });
});

describe('addressSuggestions', () => {
  it('shows one row per page, an open tab before a favourite before the history', () => {
    const rows = addressSuggestions('sesh', {
      tabs: [tab('t1', 'https://seshboard.dev/docs', 'Docs'), tab('current', 'https://seshboard.dev/now')],
      favorites: [favorite('https://seshboard.dev/docs#intro', 'Seshboard docs'), favorite('https://seshboard.dev/', 'Seshboard')],
      history: [visit('https://seshboard.dev/', 'Seshboard home', 3), visit('https://github.com/estruyf/seshboard', 'Repo', 9)],
      currentTabId: 'current',
    });
    expect(rows.map((r) => [r.kind, r.url])).toEqual([
      ['tab', 'https://seshboard.dev/docs'],
      ['favorite', 'https://seshboard.dev/'],
      ['history', 'https://github.com/estruyf/seshboard'],
    ]);
    expect(rows[0]).toMatchObject({ tabId: 't1', title: 'Docs', prefix: true });
    expect(rows[2]!.prefix).toBe(false);
  });

  it('puts the page opened most often first among equal matches, and stops at the limit', () => {
    const history = [visit('https://a.test/1', '', 1), visit('https://a.test/2', '', 12), visit('https://a.test/3', '', 4)];
    expect(addressSuggestions('a.test', { tabs: [], favorites: [], history }, 2).map((r) => r.url)).toEqual(['https://a.test/2', 'https://a.test/3']);
  });

  it('offers nothing for nothing typed', () => {
    expect(addressSuggestions('', { tabs: [], favorites: [], history: [visit('https://a.test/')] })).toEqual([]);
  });
});

describe('autoPick', () => {
  const rows = addressSuggestions('sesh', { tabs: [], favorites: [], history: [visit('https://seshboard.dev/')] });
  it('opens the first suggestion when its address starts with a word that is no address', () => {
    expect(autoPick(rows, false)).toBe(true);
    expect(autoPick(rows, true)).toBe(false);
    expect(autoPick([], false)).toBe(false);
  });
});
