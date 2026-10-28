import { describe, expect, it } from 'vitest';
import type { PipelineRunState } from '@seshboard/protocol/client';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { QUICK_UNDO, quickActionForKey, quickActionsFor, quickActionToast, quickRowOf, type QuickActionPrefs, type QuickActionRow } from './quickActions.ts';

const row = (over: Partial<QuickActionRow> = {}): QuickActionRow => ({
  status: 'idle',
  archived: false,
  pinned: false,
  unread: false,
  flags: true,
  readable: true,
  tree: false,
  canStop: false,
  ...over,
});
const ALL: QuickActionPrefs = { quickActions: true, quickActionsShow: 'all' };
const ARCHIVE_ONLY: QuickActionPrefs = { quickActions: true, quickActionsShow: 'archive' };
const kinds = (r: QuickActionRow, prefs = ALL) => quickActionsFor(r, prefs).map((a) => a.method);

describe('quickActionsFor', () => {
  it('a read row: Mark as unread, Pin, Archive', () => {
    expect(kinds(row())).toEqual(['markUnread', 'pin', 'archive']);
    expect(kinds(row({ status: null }))).toEqual(['markUnread', 'pin', 'archive']);
  });

  it('an unread row: Mark as read first', () => {
    expect(kinds(row({ status: 'unread', unread: true }))).toEqual(['markRead', 'pin', 'archive']);
  });

  it('a pinned row: Unpin', () => {
    expect(kinds(row({ pinned: true }))).toEqual(['markUnread', 'unpin', 'archive']);
  });

  it('a working or waiting row: Pin, Stop, Archive', () => {
    expect(kinds(row({ status: 'running', canStop: true }))).toEqual(['pin', 'stop', 'archive']);
    expect(kinds(row({ status: 'needs-you', canStop: true }))).toEqual(['pin', 'stop', 'archive']);
  });

  it('a working row running in another app: no Stop (Archive asks first)', () => {
    expect(kinds(row({ status: 'running', canStop: false }))).toEqual(['pin', 'archive']);
    expect(kinds(row({ status: 'running', canStop: false }), ARCHIVE_ONLY)).toEqual(['archive']);
  });

  it('an archived row: Unarchive only', () => {
    expect(kinds(row({ archived: true }))).toEqual(['unarchive']);
    expect(kinds(row({ archived: true }), ARCHIVE_ONLY)).toEqual(['unarchive']);
  });

  it('a run row: Archive (and Stop while it goes on); it has no transcript to pin', () => {
    expect(kinds(row({ tree: true, flags: false, readable: false }))).toEqual(['archive']);
    expect(kinds(row({ tree: true, flags: false, readable: false, status: 'running', canStop: true }))).toEqual(['stop', 'archive']);
  });

  it('a pipeline parent: Pin and Archive, never read or unread', () => {
    expect(kinds(row({ tree: true }))).toEqual(['pin', 'archive']);
  });

  it('a session on another computer: Pin and Archive, no read state from here', () => {
    expect(kinds(row({ readable: false }))).toEqual(['pin', 'archive']);
  });

  it('a session still starting has nothing to keep flags against', () => {
    expect(kinds(row({ flags: false, readable: false }))).toEqual([]);
  });

  it('Archive only keeps Archive, and Stop on working rows', () => {
    expect(kinds(row(), ARCHIVE_ONLY)).toEqual(['archive']);
    expect(kinds(row({ status: 'unread', unread: true }), ARCHIVE_ONLY)).toEqual(['archive']);
    expect(kinds(row({ status: 'running', canStop: true }), ARCHIVE_ONLY)).toEqual(['stop', 'archive']);
  });

  it('off shows nothing', () => {
    expect(kinds(row(), { quickActions: false, quickActionsShow: 'all' })).toEqual([]);
  });

  it('labels and keys match the menu items and the tooltips', () => {
    expect(quickActionsFor(row({ status: 'unread', unread: true }), ALL).map((a) => [a.kind, a.label, a.shortcut])).toEqual([
      ['read', 'Mark as read', 'sidebar.quick-read'],
      ['pin', 'Pin', 'sidebar.quick-pin'],
      ['archive', 'Archive', 'sidebar.quick-archive'],
    ]);
    expect(quickActionsFor(row({ status: 'running', canStop: true }), ALL).find((a) => a.kind === 'stop')).toMatchObject({ label: 'Stop', shortcut: null });
  });
});

describe('quickActionForKey', () => {
  it('works with the buttons off, by the row’s state', () => {
    expect(quickActionForKey('archive', row())?.method).toBe('archive');
    expect(quickActionForKey('archive', row({ archived: true }))?.method).toBe('unarchive');
    expect(quickActionForKey('read', row({ status: 'unread', unread: true }))?.method).toBe('markRead');
    expect(quickActionForKey('read', row())?.method).toBe('markUnread');
    expect(quickActionForKey('pin', row({ pinned: true }))?.method).toBe('unpin');
  });

  it('does nothing a button wouldn’t', () => {
    expect(quickActionForKey('read', row({ archived: true }))).toBeNull();
    expect(quickActionForKey('read', row({ status: 'running', canStop: true }))).toBeNull();
  });
});

describe('toasts and undo', () => {
  it('says what was done', () => {
    expect(quickActionToast('archive', 'Slide transitions')).toBe('Archived “Slide transitions”');
    expect(quickActionToast('markRead', 'x')).toBe('Marked as read');
    expect(quickActionToast('pin', 'x')).toBe('Pinned');
    expect(quickActionToast('stop', 'x')).toBeNull();
  });

  it('every action but Stop has its way back, and undoing twice is where it started', () => {
    for (const [method, back] of Object.entries(QUICK_UNDO)) expect(QUICK_UNDO[back as keyof typeof QUICK_UNDO]).toBe(method);
  });
});

describe('quickRowOf', () => {
  const data = (over: Partial<SessionRowData> = {}) => ({ id: 's1', summary: {}, live: null, remote: null, pinned: false, unread: false, error: null, ...over }) as unknown as SessionRowData;
  const run = (status: string, over: Record<string, unknown> = {}) => ({ run: { id: 'run-1', status, parentSessionId: 's1', ...over }, steps: [] }) as unknown as PipelineRunState;

  it('a session here: flags, a read state, Stop only while Seshboard runs it', () => {
    expect(quickRowOf(data(), false, { hosted: false, runs: [] })).toMatchObject({ flags: true, readable: true, tree: false, canStop: false });
    expect(quickRowOf(data(), false, { hosted: true, runs: [] }).canStop).toBe(true);
  });

  it('a session still starting has no flags', () => {
    expect(quickRowOf(data({ summary: null }), false, { hosted: true, runs: [] })).toMatchObject({ flags: false, readable: false });
  });

  it('the parent of a run is a tree, stoppable while the run goes on', () => {
    expect(quickRowOf(data(), false, { hosted: false, runs: [run('running')] })).toMatchObject({ tree: true, canStop: true });
    expect(quickRowOf(data(), false, { hosted: false, runs: [run('done')] })).toMatchObject({ tree: true, canStop: false });
  });

  it('a session on another computer: flags and Stop while it is online, never a read state', () => {
    const remote = (offline: boolean) => data({ remote: { offline, status: 'running' } as unknown as SessionRowData['remote'] });
    expect(quickRowOf(remote(false), false, { hosted: false, runs: [] })).toMatchObject({ flags: true, readable: false, canStop: true, status: 'running' });
    expect(quickRowOf(remote(true), false, { hosted: false, runs: [] })).toMatchObject({ flags: false, canStop: false });
  });
});
