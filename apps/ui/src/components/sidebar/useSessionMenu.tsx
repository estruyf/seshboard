import { startLinkedSession } from '../newSession/linkedSession.ts';
import { restoreFrom, trashName } from '../../lib/platform.ts';
import { formatKeys, keysFor } from '../../lib/shortcuts.ts';
import { useState, type ReactNode } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { isActiveHost, useHosts } from '../../state/hostsStore.ts';
import { popOut } from '../../state/popoutsStore.ts';
import { useSessions, type SessionRowData } from '../../state/sessionsStore.ts';
import { archivesOnMiddleClick, isActive, rowStatus } from '../../state/sidebarRows.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { archiveSessions } from '../drafts/ArchiveDraftDialog.tsx';
import { keepUnread } from '../../state/keptUnread.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { startAfter } from '../../state/startAfterStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { RenameSessionDialog } from '../RenameSessionDialog.tsx';
import { useProjectIconEntries } from './ProjectMenu.tsx';
import { sessionMemorySubmenu } from '../memory/sessionMemories.tsx';
import { useProjects } from '../../state/projectsStore.ts';
import { remoteSessionEntries, setRemoteFlags } from '../computers/remoteActions.ts';
import { stopRun, usePipelines } from '../../state/pipelinesStore.ts';
import { isRunRowId } from '../../state/runSelection.ts';
import { archiveTreeLabel, runRowMenu, unarchiveTreeLabel } from '../../state/runTree.ts';
import { runPipelineSubmenu } from '../pipelines/pipelineMenu.tsx';
import { archiveTree, askDeleteTree, isTreeParent, treeSize } from '../pipelines/RunTreeDialogs.tsx';

export type FlagChange = { pinned?: boolean; archived?: boolean };
/** Archiving takes the pin away: a pinned session would stay in the main list, under Pinned. */
export const ARCHIVE: FlagChange = { archived: true, pinned: false };

export interface SessionMenus {
  /** Shows a menu at a point (the session menu, or one the caller builds). */
  showMenu(menu: { x: number; y: number; entries: MenuEntry[]; label: string }): void;
  /** The menu of one session row: rename, pin, archive, open beside, the project and memories (in submenus), delete. */
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
  const projects = useProjects((s) => s.projects);
  const pipelines = usePipelines((s) => s.pipelines);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[]; label: string } | null>(null);
  const [deleting, setDeleting] = useState<SessionRowData[] | null>(null);
  const [renaming, setRenaming] = useState<SessionRowData | null>(null);

  // Only indexed sessions have flags; a session still starting has nothing to keep them against.
  // Archiving a session with an unsent message asks first (and discards the message). The parent of a pipeline run
  // (#179) archives and unarchives with its sub-sessions, as one tree.
  const flagAll = (targets: SessionRowData[], change: FlagChange) => {
    const trees = change.archived !== undefined ? targets.filter((target) => isTreeParent(target.id)) : [];
    for (const target of trees) archiveTree(target.id, change.archived!, target.title);
    const indexed = targets.filter((target) => target.summary && !trees.includes(target));
    const apply = () => {
      for (const target of indexed) void client?.call('sessions.setFlags', { sessionId: target.id, ...change });
    };
    if (change.archived) archiveSessions(indexed, apply);
    else apply();
  };

  const middleClick = (data: SessionRowData) => {
    // A run row archives as a tree once its run has finished, as a session does.
    if (isRunRowId(data.id)) {
      const status = rowStatus(data);
      if ((status === null || status === 'idle' || status === 'unread') && isActive(data, Date.now(), usePreferences.getState().prefs.archiveAfterDays)) archiveTree(data.id, true, data.title);
      return;
    }
    if (!archivesOnMiddleClick(data, Date.now(), usePreferences.getState().prefs.archiveAfterDays)) return;
    // A session on another computer is archived there, through its own contract.
    if (data.remote) return setRemoteFlags(client, data.remote.computerId, data.remote.sessionId, ARCHIVE);
    flagAll([data], ARCHIVE);
  };

  // At once in the list (the same as the catch-up's Mark as read), then in the engine.
  const markRead = (data: SessionRowData) => {
    useSessions.getState().patchSummary(data.id, { unread: false, viewedAt: Date.now() });
    void client?.call('sessions.markViewed', { sessionId: data.id }).catch(() => {});
  };

  const markUnread = (data: SessionRowData) => {
    keepUnread(data.id);
    useSessions.getState().patchSummary(data.id, { unread: true });
    void client?.call('sessions.markUnviewed', { sessionId: data.id }).catch(() => {});
  };

  const openSessionMenu = (at: { x: number; y: number }, data: SessionRowData) => {
    // A session on another computer: only what its remote contract offers (no rename, delete or folder here).
    if (data.remote) {
      const { computerId, computerName, offline, sessionId, projectId, projectName } = data.remote;
      const computer = { id: computerId, name: computerName, state: offline ? ('offline' as const) : ('connected' as const) };
      const session = { id: sessionId, title: data.title, pinned: data.pinned, projectId, projectName };
      setMenu({ ...at, label: `Session “${data.title}” on ${computerName}`, entries: remoteSessionEntries(client, computer, session, { open: true }) });
      return;
    }
    const archivedNow = !isActive(data, Date.now(), usePreferences.getState().prefs.archiveAfterDays);
    const flag = (change: FlagChange) => flagAll([data], change);
    // A run row (#179) isn't a session: it opens, stops, archives or deletes as one tree with its sub-sessions.
    const runState = isRunRowId(data.id) ? usePipelines.getState().runs.get(data.id) : undefined;
    if (runState) {
      const act = { open: () => useSessions.getState().select(data.id), stop: () => void stopRun(data.id), archive: () => archiveTree(data.id, true, data.title), unarchive: () => archiveTree(data.id, false, data.title), delete: () => askDeleteTree(data.id, data.title) };
      setMenu({
        ...at,
        label: `Pipeline run “${data.title}”`,
        entries: runRowMenu(runState, { archived: archivedNow, sessions: treeSize(data.id) }).flatMap((item): MenuEntry[] => [
          ...(item.action === 'delete' ? ['separator' as const] : []),
          { label: item.label, danger: item.action === 'delete', onSelect: act[item.action], data: { 'data-run-row-action': item.action } },
        ]),
      });
      return;
    }
    // The parent of a run: Archive and Delete… take its sub-sessions too.
    const tree = isTreeParent(data.id) ? treeSize(data.id) : null;
    const cwd = data.summary?.cwd ?? data.live?.cwd ?? null;
    // Removing the project from here read as removing the session; that lives in the project menus.
    const projectEntries = projectIcons.entries(data.projectRoot, at, { remove: false, nested: true });
    const projectName = projects.get(data.projectRoot)?.name ?? data.projectRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? data.projectRoot;
    // The project's choices in one submenu, so the session's own items stay in view.
    const projectMenu: MenuEntry[] = projectEntries.length
      ? [{ label: 'Project', hint: projectName, submenu: [{ title: projectName, detail: data.projectRoot }, ...projectEntries], data: { 'data-session-project-menu': true } }]
      : [];
    setMenu({
      ...at,
      label: `Session “${data.title}”`,
      entries: [
        { label: 'Rename…', hint: 'F2', onSelect: () => setRenaming(data), disabled: !data.summary, data: { 'data-rename-session': true } },
        ...(data.summary
          ? [data.unread
              ? ({ label: 'Mark as read', onSelect: () => markRead(data), data: { 'data-mark-read': true } } satisfies MenuEntry)
              : ({ label: 'Mark as unread', onSelect: () => markUnread(data), data: { 'data-mark-unread': true } } satisfies MenuEntry)]
          : []),
        { label: data.pinned ? 'Unpin' : 'Pin', onSelect: () => flag({ pinned: !data.pinned }), disabled: !data.summary },
        archivedNow
          ? { label: tree !== null ? unarchiveTreeLabel(tree) : 'Unarchive', onSelect: () => flag({ archived: false }), disabled: !data.summary, data: { 'data-session-archive': 'unarchive' } }
          : { label: tree !== null ? archiveTreeLabel(tree) : 'Archive', hint: 'until new activity', onSelect: () => flag(ARCHIVE), disabled: !data.summary, data: { 'data-session-archive': 'archive' } },
        'separator',
        { label: 'Open beside', hint: '⌥-click', onSelect: () => useSessions.getState().openBeside(data.id) },
        { label: 'Open in new window', hint: formatKeys(keysFor('session.new-window')), onSelect: () => popOut(data.id) },
        { label: 'New session linked to this one', onSelect: () => data.summary && startLinkedSession({ id: data.id, title: data.title, projectRoot: data.summary.projectRoot }), disabled: !data.summary, data: { 'data-new-linked-session': true } },
        // A run row (#179) has no conversation to be the parent of another run.
        ...(isRunRowId(data.id) ? [] : [runPipelineSubmenu(pipelines, { id: data.id, projectRoot: data.projectRoot })]),
        { label: 'Start after this one…', onSelect: () => startAfter({ id: data.id, projectRoot: data.projectRoot }), data: { 'data-start-after': true } },
        { label: 'Open folder in editor', onSelect: () => cwd && void openIn(cwd).catch(() => {}), disabled: !cwd },
        { label: 'Copy session ID', onSelect: () => void navigator.clipboard.writeText(data.id) },
        'separator',
        ...(projectMenu.length ? [...projectMenu, 'separator' as const] : []),
        tree !== null
          ? { label: 'Delete…', hint: '⌘⌫', danger: true, onSelect: () => askDeleteTree(data.id, data.title), data: { 'data-delete-tree': true } }
          : { label: 'Delete session…', hint: '⌘⌫', danger: true, disabled: !data.summary, onSelect: () => setDeleting([data]) },
      ],
    });
    // The memories it wrote, once read: added under Project while the menu is still this session's.
    void client?.call('memory.bySession', { sessionId: data.id }).then(
      ({ memories }) => {
        const extra = sessionMemorySubmenu(memories);
        if (!extra) return;
        // Under Project, or in a group of its own above Delete when there is none.
        const [index, insert]: [number, MenuEntry[]] = projectMenu.length ? [-2, [extra]] : [-1, [extra, 'separator']];
        setMenu((m) => (m && m.label === `Session “${data.title}”` ? { ...m, entries: [...m.entries.slice(0, index), ...insert, ...m.entries.slice(index)] } : m));
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
              // Its pane closes and the others take the space.
              useSessions.getState().closeSessions([target.id]);
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
