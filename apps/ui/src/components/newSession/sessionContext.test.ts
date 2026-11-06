import { describe, expect, it } from 'vitest';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { contextRows, contextSections, contextState, defaultsLines } from './sessionContext.ts';

const NOW = Date.UTC(2026, 10, 6);
const DAY = 86_400_000;

function row(id: string, patch: Partial<SessionRowData> = {}): SessionRowData {
  return { id, projectRoot: '/p', title: id, updatedAt: NOW - 1000, archivedAt: null, unread: false, live: null, error: null, ...patch } as unknown as SessionRowData;
}

describe('contextSections', () => {
  const base = { mode: 'three' as const, sessions: 2, focusLimit: 3, going: 3, hasDefaults: true };

  it('shows all three, in order, when each has something', () => {
    expect(contextSections(base)).toEqual(['in-project', 'going', 'defaults']);
  });

  it('leaves out a section with nothing in it', () => {
    expect(contextSections({ ...base, sessions: 0 })).toEqual(['going', 'defaults']);
    expect(contextSections({ ...base, going: 0 })).toEqual(['in-project', 'defaults']);
    expect(contextSections({ ...base, hasDefaults: false })).toEqual(['in-project', 'going']);
    expect(contextSections({ ...base, sessions: 0, going: 0, hasDefaults: false })).toEqual([]);
  });

  it('shows Going now only with a focus limit set', () => {
    expect(contextSections({ ...base, focusLimit: null })).toEqual(['in-project', 'defaults']);
  });

  it('keeps Going now in two columns, and leaves it to the focus line when stacked', () => {
    expect(contextSections({ ...base, mode: 'two' })).toEqual(['in-project', 'going', 'defaults']);
    expect(contextSections({ ...base, mode: 'stack' })).toEqual(['in-project', 'defaults']);
  });
});

describe('contextRows', () => {
  it('lists what is open first, then the last few done, in this project only', () => {
    const rows = [
      row('old', { updatedAt: NOW - 90 * DAY }),
      row('review', { unread: true, updatedAt: NOW - 5000 }),
      row('working', { live: { status: 'running' } as SessionRowData['live'], updatedAt: NOW - 9000 }),
      row('elsewhere', { projectRoot: '/q' }),
      row('done1', { archivedAt: NOW, updatedAt: NOW - DAY }),
      row('done2', { archivedAt: NOW, updatedAt: NOW - 2 * DAY }),
      row('done3', { archivedAt: NOW, updatedAt: NOW - 3 * DAY }),
    ];
    const listed = contextRows(rows, '/p', NOW, 30);
    expect(listed.map((r) => r.row.id)).toEqual(['working', 'review', 'done1', 'done2', 'done3']);
    expect(listed.map((r) => r.label)).toEqual(['Working', 'To review', 'Done', 'Done', 'Done']);
  });

  it('shows no more than three done', () => {
    const rows = [1, 2, 3, 4].map((n) => row(`done${n}`, { archivedAt: NOW, updatedAt: NOW - n * DAY }));
    expect(contextRows(rows, '/p', NOW, 30).map((r) => r.row.id)).toEqual(['done1', 'done2', 'done3']);
  });
});

describe('contextState', () => {
  it('says each state in words', () => {
    expect(contextState(row('a', { live: { status: 'needs-you' } as SessionRowData['live'] }), false)).toEqual({ label: 'Needs you', tone: 'needs-you' });
    expect(contextState(row('a', { unread: true }), false)).toEqual({ label: 'To review', tone: 'unread' });
    expect(contextState(row('a'), false)).toEqual({ label: 'Open', tone: 'idle' });
    expect(contextState(row('a', { unread: true }), true)).toEqual({ label: 'Done', tone: 'idle' });
  });
});

describe('defaultsLines', () => {
  it('says the profile, model and mode, then where it works', () => {
    expect(defaultsLines({ profile: 'Personal', model: 'Default model', mode: 'Auto', worktree: false, branch: 'dev' })).toEqual(['Personal · Default model · Auto', 'Current checkout on dev']);
    expect(defaultsLines({ profile: null, model: 'Opus', mode: 'Plan', worktree: true, branch: 'origin/main' })).toEqual(['Opus · Plan', 'New worktree from origin/main']);
    expect(defaultsLines({ profile: 'Work', model: 'Opus', mode: 'Plan', worktree: false, branch: null })).toEqual(['Work · Opus · Plan', 'Current checkout']);
  });
});
