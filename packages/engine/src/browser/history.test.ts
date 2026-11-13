import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openCacheDatabase } from '../db/database.ts';
import { BrowserHistory } from './history.ts';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function history() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-history-')));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const cache = openCacheDatabase(join(dir, 'cache.sqlite'));
  cleanups.unshift(() => cache.close());
  return new BrowserHistory(cache.db);
}

describe('BrowserHistory', () => {
  it('counts visits, keeps the latest title and finds pages by address or title', () => {
    const pages = history();
    pages.visit('https://github.com/estruyf/seshboard', '', true, 10);
    pages.visit('https://github.com/estruyf/seshboard', 'Seshboard', false, 20);
    pages.visit('https://github.com/estruyf/seshboard', '', true, 30);
    pages.visit('https://example.com/', 'Example', true, 40);
    expect(pages.search('sesh', 10)).toEqual([{ url: 'https://github.com/estruyf/seshboard', title: 'Seshboard', visits: 2, lastVisit: 30 }]);
    // Any case, and by title.
    expect(pages.search('EXAMPLE', 10).map((e) => e.url)).toEqual(['https://example.com/']);
    // Most opened first.
    expect(pages.search('', 10).map((e) => e.visits)).toEqual([2, 1]);
  });

  it('takes % and _ as they are', () => {
    const pages = history();
    pages.visit('https://a.test/100%', 'A', true);
    pages.visit('https://b.test/', 'B', true);
    expect(pages.search('%', 10).map((e) => e.url)).toEqual(['https://a.test/100%']);
    expect(pages.search('_', 10)).toEqual([]);
  });

  it('keeps only the pages opened most recently', () => {
    const pages = history();
    for (let i = 0; i < 5; i++) pages.visit(`https://p${i}.test/`, '', true, i);
    pages.prune(2);
    expect(pages.search('', 10).map((e) => e.url).sort()).toEqual(['https://p3.test/', 'https://p4.test/']);
  });
});
