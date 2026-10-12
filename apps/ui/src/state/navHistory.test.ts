import { describe, expect, it } from 'vitest';
import { emptyHistory, HISTORY_LIMIT, PASSING_MS, record, step, type NavHistory, type NavPlace } from './navHistory.ts';

const session = (mainId: string | null, splitId: string | null = null, activePane: 'main' | 'split' = 'main'): NavPlace => ({ view: 'session', mainId, splitId, activePane });
const project = (root: string, tab: 'overview' | 'memory' = 'overview'): NavPlace => ({ view: 'project', root, tab });
const settings = (section: 'general' | 'memory'): NavPlace => ({ view: 'settings', section, from: 'session' });

/** Records each place a second after the previous one. */
const visit = (...places: NavPlace[]) => places.reduce<NavHistory>((h, place, i) => record(h, place, (i + 1) * 1000), emptyHistory);

describe('record', () => {
  it('adds an entry for each new place', () => {
    const h = visit(session('a'), settings('memory'), project('/p', 'memory'));
    expect(h.entries).toEqual([session('a'), settings('memory'), project('/p', 'memory')]);
    expect(h.index).toBe(2);
  });

  it('ignores the same place again', () => {
    const h = visit(session('a'));
    expect(record(h, session('a'), 5000)).toBe(h);
  });

  it('changes the entry for another tab, Settings page or active pane', () => {
    expect(record(visit(project('/p')), project('/p', 'memory'), 9000).entries).toEqual([project('/p', 'memory')]);
    expect(record(visit(settings('general')), settings('memory'), 9000).entries).toEqual([settings('memory')]);
    expect(record(visit(session('a', 'b')), session('a', 'b', 'split'), 9000).entries).toEqual([session('a', 'b', 'split')]);
  });

  it('lets a place only passed through give its entry to the next', () => {
    let h = visit(session('home'));
    h = record(h, session('a'), 5000);
    h = record(h, session('b'), 5000 + PASSING_MS - 1);
    h = record(h, session('c'), 5000 + 2 * PASSING_MS - 2);
    expect(h.entries).toEqual([session('home'), session('c')]);
  });

  it('drops what was ahead when a new place follows a step back', () => {
    const h = visit(session('a'), session('b'), session('c'));
    const back: NavHistory = { ...h, index: 0, at: 0 };
    expect(record(back, project('/p'), 9000).entries).toEqual([session('a'), project('/p')]);
  });

  it('keeps what is ahead when only the tab changes after a step back', () => {
    const h = visit(project('/p'), session('b'));
    const back: NavHistory = { ...h, index: 0, at: 0 };
    expect(record(back, project('/p', 'memory'), 9000).entries).toEqual([project('/p', 'memory'), session('b')]);
  });

  it('keeps the latest entries only', () => {
    const h = visit(...Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => session(String(i))));
    expect(h.entries).toHaveLength(HISTORY_LIMIT);
    expect(h.entries[0]).toEqual(session('5'));
    expect(h.index).toBe(HISTORY_LIMIT - 1);
  });
});

describe('step', () => {
  const h = visit(session('a'), project('/gone'), settings('memory'));

  it('goes back and forward', () => {
    expect(step(h, -1, () => true)).toBe(1);
    expect(step({ ...h, index: 0 }, 1, () => true)).toBe(1);
  });

  it('skips places that are gone', () => {
    expect(step(h, -1, (p) => !(p.view === 'project' && p.root === '/gone'))).toBe(0);
  });

  it('stops at the ends', () => {
    expect(step(h, 1, () => true)).toBeNull();
    expect(step({ ...h, index: 0 }, -1, () => true)).toBeNull();
    expect(step(emptyHistory, -1, () => true)).toBeNull();
  });
});
