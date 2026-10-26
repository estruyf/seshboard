import { useEffect, useMemo } from 'react';
import type { ProjectInfo } from '@seshboard/protocol/client';
import { basename } from '../../lib/format.ts';
import { isQuestionsFolder, QUESTION_LABEL } from '../../lib/questions.ts';
import { draftList, draftListSignature, type DraftItem } from '../../state/drafts.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { useComputers } from '../../state/computersStore.ts';
import { hasRemoteNewDraft, REMOTE_DRAFTS_STORAGE_KEY, useRemoteDraftsChanged } from '../../state/remoteDrafts.ts';
import { THIS_COMPUTER } from '../../state/remoteRows.ts';
import { useRunOn } from '../../state/runOnStore.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { toRows, useSessions, type SessionRowData } from '../../state/sessionsStore.ts';

/** A draft in the Unsent list, with what its row shows. */
export interface UnsentEntry {
  item: DraftItem;
  /** "New session · worklog-web", or the session's title. */
  title: string;
  /** The project the icon shows (New session: the folder it was written for). */
  root: string | null;
  project: ProjectInfo | undefined;
  /** The session, for a session's draft. */
  row: SessionRowData | null;
}

/** Opens what a draft was written in, with the caret at the end of its text. */
export function openDraft(item: DraftItem): void {
  const drafts = useDrafts.getState();
  drafts.closeList();
  if (item.kind === 'session') useSessions.getState().select(item.sessionId);
  else {
    if (item.root) useProjects.getState().startIn(item.root);
    useSessions.getState().openNewSession();
  }
  drafts.requestFocus(item.key);
}

/**
 * Every unsent message, newest first: New session prompts and sessions' drafts. A session the app no longer
 * knows (deleted elsewhere) is left out, so the count matches the list.
 */
export function useUnsent(): UnsentEntry[] {
  const items = useDraftItems();
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const loaded = useSessions((s) => s.loaded);
  const hosts = useHosts((s) => s.hosts);
  const projects = useProjects((s) => s.projects);
  const questionsDir = useProjects((s) => s.questionsDir);
  return useMemo(() => {
    const rows = new Map(toRows(sessions, live, hosts).map((row) => [row.id, row]));
    return items.flatMap((item): UnsentEntry[] => {
      if (item.kind === 'new') {
        const project = item.root ? projects.get(item.root) : undefined;
        const name = item.root ? (project?.name ?? basename(item.root)) : null;
        const title = isQuestionsFolder(item.root, questionsDir) ? QUESTION_LABEL : name ? `New session · ${name}` : 'New session';
        return [{ item, title, root: item.root, project, row: null }];
      }
      const row = rows.get(item.sessionId) ?? null;
      if (!row && loaded) return [];
      return [{ item, title: row?.title || 'Untitled session', root: row?.projectRoot ?? null, project: row ? projects.get(row.projectRoot) : undefined, row }];
    });
  }, [items, sessions, live, hosts, projects, questionsDir, loaded]);
}

/** The drafts that count, newest first; changes only when the list would look different (not on every keystroke). */
function useDraftItems(): DraftItem[] {
  const signature = useDrafts((s) => draftListSignature(s.drafts));
  return useMemo(() => draftList(useDrafts.getState().drafts), [signature]);
}

/** The newest New session prompt that counts, for the pen on the + button (null without one). */
export function useNewSessionDraft(): { item: Extract<DraftItem, { kind: 'new' }>; name: string | null } | null {
  const items = useDraftItems();
  const projects = useProjects((s) => s.projects);
  return useMemo(() => {
    const item = items.find((d): d is Extract<DraftItem, { kind: 'new' }> => d.kind === 'new');
    if (!item) return null;
    return { item, name: item.root ? (projects.get(item.root)?.name ?? basename(item.root)) : null };
  }, [items, projects]);
}

/**
 * An unsent New session prompt for another computer, for the pen on the + button (null without one). Only the
 * computer Run on last picked counts: that is where the + opens (`newSessionTarget`).
 */
export function useRemoteNewSessionDraft(): { computerId: string; name: string } | null {
  const last = useRunOn((s) => s.last);
  const version = useRemoteDraftsChanged((s) => s.version);
  const computers = useComputers((s) => s.status?.computers);
  useEffect(() => {
    // Another window typed or sent it: localStorage is shared, the store isn't.
    const onStorage = (event: StorageEvent) => event.key === REMOTE_DRAFTS_STORAGE_KEY && useRemoteDraftsChanged.getState().bump();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return useMemo(() => {
    if (last === THIS_COMPUTER) return null;
    const computer = computers?.find((c) => c.id === last);
    return computer && hasRemoteNewDraft(last) ? { computerId: last, name: computer.name } : null;
  }, [last, version, computers]);
}
