import { describe, expect, it } from 'vitest';
import { archivedSince, DAY_MS, dueForDeletion, keepReason, listedInMainList, type DeletionState, type ListingState } from './retention.ts';

const NOW = 1_000 * DAY_MS;
const listing = (over: Partial<ListingState> = {}): ListingState => ({
  attention: false,
  working: false,
  pinned: false,
  archivedAt: null,
  restoredAt: null,
  unread: false,
  updatedAt: NOW,
  openInApp: false,
  ...over,
});
const free: DeletionState = { pinned: false, working: false, needsYou: false, openElsewhere: false, queued: false, draft: false };

describe('listedInMainList', () => {
  it('archives after the days you set', () => {
    expect(listedInMainList(listing({ updatedAt: NOW - 2 * DAY_MS }), NOW, 3)).toBe(true);
    expect(listedInMainList(listing({ updatedAt: NOW - 4 * DAY_MS }), NOW, 3)).toBe(false);
    expect(listedInMainList(listing({ updatedAt: NOW - 4 * DAY_MS }), NOW, 7)).toBe(true);
    expect(listedInMainList(listing({ updatedAt: NOW - 2 * DAY_MS }), NOW, 1)).toBe(false);
  });

  it('keeps what needs you, is pinned, unread, working or open in the app, however old', () => {
    const old = NOW - 100 * DAY_MS;
    expect(listedInMainList(listing({ updatedAt: old, attention: true }), NOW, 3)).toBe(true);
    expect(listedInMainList(listing({ updatedAt: old, pinned: true }), NOW, 3)).toBe(true);
    expect(listedInMainList(listing({ updatedAt: old, unread: true }), NOW, 3)).toBe(true);
    expect(listedInMainList(listing({ updatedAt: old, openInApp: true }), NOW, 3)).toBe(true);
    expect(listedInMainList(listing({ updatedAt: old, working: true }), NOW, 3)).toBe(true);
  });

  it('counts unarchiving by hand as activity until there is something newer', () => {
    expect(listedInMainList(listing({ updatedAt: NOW - 50 * DAY_MS, restoredAt: NOW - 40 * DAY_MS }), NOW, 3)).toBe(true);
    expect(listedInMainList(listing({ updatedAt: NOW - 40 * DAY_MS, restoredAt: NOW - 50 * DAY_MS }), NOW, 3)).toBe(false);
  });
});

describe('archivedSince', () => {
  it('is when you archived it, or the last activity plus the archive days', () => {
    expect(archivedSince(listing({ archivedAt: NOW - DAY_MS, updatedAt: NOW - 2 * DAY_MS }), NOW, 3)).toBe(NOW - DAY_MS);
    expect(archivedSince(listing({ updatedAt: NOW - 10 * DAY_MS }), NOW, 3)).toBe(NOW - 7 * DAY_MS);
    expect(archivedSince(listing({ updatedAt: NOW - DAY_MS }), NOW, 3)).toBeNull();
    // New activity after archiving: archived again only once it is quiet for the archive days.
    expect(archivedSince(listing({ archivedAt: NOW - 20 * DAY_MS, updatedAt: NOW - 10 * DAY_MS }), NOW, 3)).toBe(NOW - 7 * DAY_MS);
  });
});

describe('keepReason', () => {
  it('names the first reason to keep a session', () => {
    expect(keepReason(free)).toBeNull();
    expect(keepReason({ ...free, pinned: true })).toBe('pinned');
    expect(keepReason({ ...free, working: true })).toBe('working');
    expect(keepReason({ ...free, needsYou: true })).toBe('needs-you');
    expect(keepReason({ ...free, openElsewhere: true })).toBe('open-elsewhere');
    expect(keepReason({ ...free, queued: true })).toBe('queued');
    expect(keepReason({ ...free, draft: true })).toBe('draft');
    expect(keepReason({ ...free, draft: true, pinned: true })).toBe('pinned');
  });
});

describe('dueForDeletion', () => {
  const session = (id: string, l: Partial<ListingState>, d: Partial<DeletionState> = {}) => ({ id, listing: listing(l), deletion: { ...free, ...d } });
  const options = { now: NOW, archiveAfterDays: 3, afterDays: 30 };

  it('picks sessions archived for longer than the days you set', () => {
    const { due, kept } = dueForDeletion(
      [
        session('auto-old', { updatedAt: NOW - 34 * DAY_MS }),
        session('auto-young', { updatedAt: NOW - 32 * DAY_MS }),
        session('hand-old', { archivedAt: NOW - 31 * DAY_MS, updatedAt: NOW - 31 * DAY_MS - 1 }),
        session('hand-young', { archivedAt: NOW - 5 * DAY_MS, updatedAt: NOW - 6 * DAY_MS }),
        session('listed', { updatedAt: NOW - DAY_MS }),
      ],
      options,
    );
    expect(due.map((s) => s.id)).toEqual(['auto-old', 'hand-old']);
    expect(kept).toEqual([]);
  });

  it('follows the archive days: archived later means deleted later', () => {
    const quiet = session('quiet', { updatedAt: NOW - 35 * DAY_MS });
    expect(dueForDeletion([quiet], options).due).toHaveLength(1);
    expect(dueForDeletion([quiet], { ...options, archiveAfterDays: 7 }).due).toHaveLength(0);
  });

  it('never picks what stays in the list: pinned, working, needs you, unread, open in the app', () => {
    const old = NOW - 400 * DAY_MS;
    const { due, kept } = dueForDeletion(
      [
        session('pinned', { updatedAt: old, pinned: true }),
        session('working', { updatedAt: old, working: true }),
        session('attention', { updatedAt: old, attention: true }),
        session('unread', { updatedAt: old, unread: true }),
        session('open', { updatedAt: old, openInApp: true }),
      ],
      options,
    );
    expect(due).toEqual([]);
    expect(kept).toEqual([]);
  });

  it('keeps old archived sessions that are open elsewhere, queued, have a draft or are working', () => {
    const old = { updatedAt: NOW - 400 * DAY_MS };
    const { due, kept } = dueForDeletion(
      [
        session('elsewhere', old, { openElsewhere: true }),
        session('queued', old, { queued: true }),
        session('draft', old, { draft: true }),
        session('pinned-flag', old, { pinned: true }),
        // Archived by hand while it works: still archived, but never deleted.
        session('working', { archivedAt: NOW - 100 * DAY_MS, updatedAt: NOW, working: true }, { working: true }),
        session('needs-you', old, { needsYou: true }),
        session('gone', old),
      ],
      options,
    );
    expect(due.map((s) => s.id)).toEqual(['gone']);
    expect(kept.map((k) => [k.session.id, k.reason])).toEqual([
      ['elsewhere', 'open-elsewhere'],
      ['queued', 'queued'],
      ['draft', 'draft'],
      ['pinned-flag', 'pinned'],
      ['working', 'working'],
      ['needs-you', 'needs-you'],
    ]);
  });
});
