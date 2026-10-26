import type { QuickActionsShow } from '@switchboard/protocol/bridge';
import type { PipelineRunState } from '@switchboard/protocol/client';
import type { ShortcutId } from '../../lib/shortcuts.ts';
import { runGoesOn, treeRunsOf } from '../../state/runTree.ts';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { rowStatus, type RowStatus } from '../../state/sidebarRows.ts';

// The buttons a session row shows under the pointer (Settings › Sidebar, "Quick actions on hover"), and which of the
// session menu's actions each one runs. Pure, so the rules can be tested without React or the stores.

/** A quick action, as its `data-row-action` hook names it. Read covers Mark as read and Mark as unread. */
export type QuickActionKind = 'read' | 'pin' | 'archive' | 'stop' | 'unarchive';

/** The session menu's action a button runs (`SessionMenus` in `useSessionMenu.tsx`), so there is one path for each. */
export type QuickActionMethod = 'markRead' | 'markUnread' | 'pin' | 'unpin' | 'archive' | 'unarchive' | 'stop';

/** What the rules read from a row. */
export interface QuickActionRow {
  status: RowStatus;
  /** Listed under Archived. */
  archived: boolean;
  pinned: boolean;
  unread: boolean;
  /** It can be pinned and archived: it has a transcript here, or it is on another computer that is online. */
  flags: boolean;
  /** It has a read state to change from here: a session of this computer with a transcript. */
  readable: boolean;
  /** A run row or a pipeline's parent: Archive takes its sub-sessions too. */
  tree: boolean;
  /** Stop has something to stop: a session running in Switchboard, a run that goes on, or another computer's session. */
  canStop: boolean;
}

export interface QuickActionPrefs {
  quickActions: boolean;
  quickActionsShow: QuickActionsShow;
}

export interface QuickAction {
  kind: QuickActionKind;
  method: QuickActionMethod;
  /** The menu's words for it, which the tooltip and the button's label use. */
  label: string;
  /** Its key in the sidebar, for the tooltip; Stop has none. */
  shortcut: ShortcutId | null;
}

/**
 * What the rules read from a sidebar row. `archived`: listed under Archived. `hosted`: the session runs in Switchboard
 * (`isActiveHost`), so Stop can reach it. `runs`: every pipeline run, for a run row or a pipeline's parent.
 */
export function quickRowOf(data: SessionRowData, archived: boolean, context: { hosted: boolean; runs: Iterable<PipelineRunState> }): QuickActionRow {
  const tree = treeRunsOf(context.runs, data.id);
  const remote = data.remote ?? null;
  return {
    status: rowStatus(data),
    archived,
    pinned: data.pinned,
    unread: data.unread,
    flags: remote ? !remote.offline : data.summary !== null,
    readable: !remote && data.summary !== null,
    tree: tree.length > 0,
    canStop: remote ? !remote.offline : context.hosted || tree.some(runGoesOn),
  };
}

const working = (status: RowStatus) => status === 'running' || status === 'needs-you';

/**
 * The buttons a row shows, left to right. A read row offers Mark as unread, Pin and Archive; an unread one Mark as read
 * instead; a working one (or one that needs you) Pin, Stop and Archive, where Archive asks first (Stop and archive); an
 * archived one Unarchive; a run's tree Pin and Archive. "Archive only" keeps Archive, and Stop on working rows. A row
 * working in another app has no Stop: nothing here can stop it.
 */
export function quickActionsFor(row: QuickActionRow, prefs: QuickActionPrefs): QuickAction[] {
  if (!prefs.quickActions) return [];
  const canArchive = row.flags || row.tree;
  if (row.archived) return canArchive ? [{ kind: 'unarchive', method: 'unarchive', label: 'Unarchive', shortcut: 'sidebar.quick-archive' }] : [];
  const all = prefs.quickActionsShow === 'all';
  const busy = working(row.status);
  const read: QuickAction[] =
    all && !busy && row.readable && !row.tree
      ? [row.unread ? { kind: 'read', method: 'markRead', label: 'Mark as read', shortcut: 'sidebar.quick-read' } : { kind: 'read', method: 'markUnread', label: 'Mark as unread', shortcut: 'sidebar.quick-read' }]
      : [];
  const pin: QuickAction[] = all && row.flags ? [row.pinned ? { kind: 'pin', method: 'unpin', label: 'Unpin', shortcut: 'sidebar.quick-pin' } : { kind: 'pin', method: 'pin', label: 'Pin', shortcut: 'sidebar.quick-pin' }] : [];
  const stop: QuickAction[] = busy && row.canStop ? [{ kind: 'stop', method: 'stop', label: 'Stop', shortcut: null }] : [];
  const archive: QuickAction[] = canArchive ? [{ kind: 'archive', method: 'archive', label: 'Archive', shortcut: 'sidebar.quick-archive' }] : [];
  return [...read, ...pin, ...stop, ...archive];
}

/**
 * What a key in the sidebar does to a row (E, U or P), or null when the row has nothing for it. It goes by the row's
 * state, not by which buttons the setting shows: the keys work with the buttons off.
 */
export function quickActionForKey(key: 'archive' | 'read' | 'pin', row: QuickActionRow): QuickAction | null {
  const every = quickActionsFor(row, { quickActions: true, quickActionsShow: 'all' });
  if (key === 'archive') return every.find((action) => action.kind === 'archive' || action.kind === 'unarchive') ?? null;
  // The keys do what the buttons would, never more: on an archived row only E works (Unarchive).
  return every.find((action) => action.kind === key) ?? null;
}

/** The toast after a quick action: what was done, in the words of its menu item. Stop has none. */
export function quickActionToast(method: QuickActionMethod, title: string): string | null {
  switch (method) {
    case 'markRead':
      return 'Marked as read';
    case 'markUnread':
      return 'Marked as unread';
    case 'pin':
      return 'Pinned';
    case 'unpin':
      return 'Unpinned';
    case 'archive':
      return `Archived “${title}”`;
    case 'unarchive':
      return `Unarchived “${title}”`;
    case 'stop':
      return null;
  }
}

/** The action that takes one back: Undo after a quick action. */
export const QUICK_UNDO: Record<Exclude<QuickActionMethod, 'stop'>, QuickActionMethod> = {
  markRead: 'markUnread',
  markUnread: 'markRead',
  pin: 'unpin',
  unpin: 'pin',
  archive: 'unarchive',
  unarchive: 'archive',
};
