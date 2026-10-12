import { restoreFrom, trashName } from '../../lib/platform.ts';
import { useState, type ReactNode } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { isActiveHost, useHosts } from '../../state/hostsStore.ts';
import { useSessions, type SessionRowData } from '../../state/sessionsStore.ts';
import { archivesOnMiddleClick, isActive } from '../../state/sidebarRows.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { archiveSessions } from '../drafts/ArchiveDraftDialog.tsx';
import { useDrafts } from '../../state/draftsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { RenameSessionDialog } from '../RenameSessionDialog.tsx';
import { useProjectIconEntries } from './ProjectMenu.tsx';
import { sessionMemoryEntries } from '../memory/sessionMemories.tsx';

export type FlagChange = { pinned?: boolean; archived?: boolean };
/** Archiving takes the pin away: a pinned session would stay in the main list, under Pinned. */
export const ARCHIVE: FlagChange = { archived: true, pinned: false };

export interface SessionMenus {
  /** Shows a menu at a point (the session menu, or one the caller builds). */
  showMenu(menu: { x: number; y: number; entries: MenuEntry[]; label: string }): void;
  /** The menu of one session row: rename, pin, archive, open beside, project, delete. */
  openSessionMenu(at: { x: number; y: number }, data: SessionRowData): void;
  /** Sets flags on sessions that have a transcript (only those have flags). */
  flagAll(targets: SessionRowData[], change: FlagChange): void;
  /** A middle-click on a row: archives the session if it has finished, and does nothing otherwise. */
  middleClick(data: SessionRowData): void;
  /** Asks before moving sessions to the Trash. */
  requestDelete(targets: SessionRowData[]): void;
  requestRename(data: SessionRowData): void;
  /** The menu and the dialogs it opens; render once. */
  overlays: ReactNode;
}

/**
 * The context menu of a session row and the dialogs behind it, shared by the open sidebar and the
 * minimal rail so both offer the same things. `order` is the list's session order: after a delete,
 * the selection moves to the next session that stays.
 */
export function useSessionMenu(order: readonly string[], onDeleted?: () => void): SessionMenus {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const hosts = useHosts((s) => s.hosts);
  const selectedId = useSessions((s) => s.selectedId);
  const openIn = useOpenIn();
  const projectIcons = useProjectIconEntries();
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[]; label: string } | null>(null);
  const [deleting, setDeleting] = useState<SessionRowData[] | null>(null);
  const [renaming, setRenaming] = useState<SessionRowData | null>(null);

  // Only indexed sessions have flags; a session still starting has nothing to keep them against.
  // Archiving a session with an unsent message asks first (and discards the message).
  const flagAll = (targets: SessionRowData[], change: FlagChange) => {
    const indexed = targets.filter((target) => target.summary);
    const apply = () => {
      for (const target of indexed) void client?.call('sessions.setFlags', { sessionId: target.id, ...change });
    };
    if (change.archived) archiveSessions(indexed, apply);
    else apply();
  };

  const middleClick = (data: SessionRowData) => {
    if (archivesOnMiddleClick(data, Date.now(), usePreferences.getState().prefs.archiveAfterDays)) flagAll([data], ARCHIVE);
  };

  const openSessionMenu = (at: { x: number; y: number }, data: SessionRowData) => {
    const archivedNow = !isActive(data, Date.now(), usePreferences.getState().prefs.archiveAfterDays);
    const flag = (change: FlagChange) => flagAll([data], change);
    const cwd = data.summary?.cwd ?? data.live?.cwd ?? null;
    // Removing the project from here read as removing the session; that lives in the project menus.
    const projectEntries = projectIcons.entries(data.projectRoot, at, { remove: false });
    setMenu({
      ...at,
      label: `Session “${data.title}”`,
      entries: [
        { label: 'Rename…', hint: 'F2', onSelect: () => setRenaming(data), disabled: !data.summary, data: { 'data-rename-session': true } },
        { label: data.pinned ? 'Unpin' : 'Pin', onSelect: () => flag({ pinned: !data.pinned }), disabled: !data.summary },
        archivedNow
          ? { label: 'Unarchive', onSelect: () => flag({ archived: false }), disabled: !data.summary }
          : { label: 'Archive', hint: 'until new activity', onSelect: () => flag(ARCHIVE), disabled: !data.summary },
        { label: 'Open beside', hint: '⌥-click', onSelect: () => useSessions.getState().openBeside(data.id) },
        { label: 'Open folder in editor', onSelect: () => cwd && void openIn(cwd).catch(() => {}), disabled: !cwd },
        { label: 'Copy session ID', onSelect: () => void navigator.clipboard.writeText(data.id) },
        'separator',
        ...(projectEntries.length ? [...projectEntries, 'separator' as const] : []),
        { label: 'Delete session…', hint: '⌘⌫', danger: true, disabled: !data.summary, onSelect: () => setDeleting([data]) },
      ],
    });
    // The memories it wrote, once read: added above Delete while the menu is still this session's.
    void client?.call('memory.bySession', { sessionId: data.id }).then(
      ({ memories }) => {
        const extra = sessionMemoryEntries(memories);
        if (!extra.length) return;
        setMenu((m) => (m && m.label === `Session “${data.title}”` ? { ...m, entries: [...m.entries.slice(0, -1), ...extra, ...m.entries.slice(-1)] } : m));
      },
      () => {},
    );
  };

  const overlays = (
    <>
      {menu && <Menu x={menu.x} y={menu.y} entries={menu.entries} label={menu.label} onClose={() => setMenu(null)} />}
      {deleting && (
        <ConfirmDialog
          title={
            deleting.length === 1
              ? `Delete “${deleting[0]!.title.length > 60 ? `${deleting[0]!.title.slice(0, 59)}…` : deleting[0]!.title}”?`
              : `Delete ${deleting.length} sessions?`
          }
          danger
          confirmLabel={`Move to ${trashName()}`}
          blockedReason={
            deleting.some((target) => target.live && !isActiveHost(hosts.get(target.id)))
              ? deleting.length === 1
                ? 'This session is open in another Claude Code window. Close it there first.'
                : 'Some of these sessions are open in another Claude Code window. Close them there first.'
              : null
          }
          body={
            <>
              {deleting.length === 1 ? 'The conversation and any subagent transcripts move' : 'The conversations and any subagent transcripts move'} to the {trashName()}, so you can
              restore them {restoreFrom()}. Files Claude changed in your project are not touched.
              {deleting.some((target) => isActiveHost(hosts.get(target.id))) &&
                (deleting.length === 1 ? ' It is running in Switchboard and will be stopped first.' : ' Sessions running in Switchboard will be stopped first.')}
            </>
          }
          onConfirm={async () => {
            if (!client) throw new Error('Not connected to the engine');
            const gone = new Set(deleting.map((target) => target.id));
            // Keep the cursor in the list: the next session that stays (or the previous one at the end).
            const index = selectedId ? order.indexOf(selectedId) : -1;
            const next = index === -1 ? null : (order.slice(index + 1).find((id) => !gone.has(id)) ?? order.slice(0, index).reverse().find((id) => !gone.has(id)) ?? null);
            for (const target of deleting) {
              await client.call('session.delete', { sessionId: target.id });
              useDrafts.getState().removeDraft(target.id);
              const panes = useSessions.getState();
              // Two panes: the other one takes the full width.
              if (panes.splitId && (target.id === panes.mainId || target.id === panes.splitId)) panes.closePane(target.id === panes.mainId ? 'main' : 'split');
            }
            onDeleted?.();
            const current = useSessions.getState().selectedId;
            if (current === null ? selectedId !== null && gone.has(selectedId) : gone.has(current)) {
              if (next) useSessions.getState().select(next);
              // Nothing left to show: close the trashed session rather than keep it on screen.
              else useSessions.getState().closeSession();
            }
          }}
          onClose={() => setDeleting(null)}
        />
      )}
      {renaming && <RenameSessionDialog sessionId={renaming.id} title={renaming.title} onClose={() => setRenaming(null)} />}
      {projectIcons.overlays}
    </>
  );

  return { showMenu: setMenu, openSessionMenu, flagAll, middleClick, requestDelete: setDeleting, requestRename: setRenaming, overlays };
}
