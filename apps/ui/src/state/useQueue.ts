import { useEffect, useMemo, useRef } from 'react';
import { basename } from '../lib/format.ts';
import { useHosts } from './hostsStore.ts';
import { startQueued, useLater } from './laterStore.ts';
import { usePreferences } from './preferencesStore.ts';
import { useProjects } from './projectsStore.ts';
import { projectOf, queueStates, queueToast, readyTransitions, type QueueEntry, type QueueSummary } from './queue.ts';
import type { LaterItem, UsageLimitHit } from '@switchboard/protocol/client';
import { limitOf } from '../lib/usageLimit.ts';
import { useMinute } from '../components/focus/useMinute.ts';
import { useLimits } from './limitsStore.ts';
import { useProfiles } from './profilesStore.ts';
import { toRows, useSessions, type SessionRowData } from './sessionsStore.ts';
import { inScope } from './sidebarRows.ts';
import { useSidebarSections } from './sidebarSectionsStore.ts';
import { toast } from './toastStore.ts';

/** The sessions the sidebar lists, live state included: what "busy" is measured against, so the queue agrees with the sidebar. */
export function useListedRows(): SessionRowData[] {
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const hosts = useHosts((s) => s.hosts);
  const scope = usePreferences((s) => s.prefs.sessionScope);
  return useMemo(() => toRows(sessions, live, hosts).filter((row) => inScope(row, scope)), [sessions, live, hosts, scope]);
}

/** A project's name for a folder: its own name, else the folder's. */
export function useProjectName(): (root: string) => string {
  const projects = useProjects((s) => s.projects);
  return useMemo(() => (root: string) => projects.get(root)?.name ?? basename(root), [projects]);
}

/** The usage limit a queued item's Claude profile is at: its own profile, else its project's, else the default. */
function useQueueLimit(): (item: LaterItem) => UsageLimitHit | null {
  const limits = useLimits((s) => s.state);
  const projects = useProjects((s) => s.projects);
  const profiles = useProfiles((s) => s.profiles);
  const defaultId = useProfiles((s) => s.defaultId);
  return useMemo(() => {
    const exists = (id: string | null | undefined): id is string => !!id && profiles.some((p) => p.id === id);
    return (item: LaterItem) => {
      const project = projects.get(projectOf(item.cwd))?.profileId;
      const profileId = exists(item.profileId) ? item.profileId : exists(project) ? project : defaultId;
      return limitOf(limits, profileId);
    };
  }, [limits, projects, profiles, defaultId]);
}

/** The queue with every item's state (ready, waiting, queued), how many are ready, and the first of them. */
export function useQueue(rows?: readonly SessionRowData[]): QueueSummary & { rows: readonly SessionRowData[] } {
  const items = useLater((s) => s.items);
  const started = useLater((s) => s.started);
  const auto = useLater((s) => s.auto);
  const listed = useListedRows();
  const all = rows ?? listed;
  const projectName = useProjectName();
  const limitOf = useQueueLimit();
  const now = useMinute(useLimits((s) => s.state.limits.length > 0));
  // How sessions ended and what waits at the focus limit come from the engine, which decides what starts by itself.
  const engine = useMemo(() => {
    const outcomes = new Map(auto.outcomes.map((o) => [o.sessionId, o.outcome]));
    return { outcomeOf: (id: string) => outcomes.get(id) ?? null, focusHeld: new Set(auto.focusHeld) };
  }, [auto]);
  const summary = useMemo(() => queueStates({ items, started, rows: all, projectName, limitOf, now, ...engine }), [items, started, all, projectName, limitOf, now, engine]);
  return { ...summary, rows: all };
}

/**
 * One toast when queued items turn ready because a session they waited on finished: "<project> is free", with
 * Start it and Review first, or "2 queued items are ready" with Show queue. Once per item per transition; the
 * first load, items that wait for nothing and items that start by themselves (the engine starts those, and main
 * notifies) never count.
 */
export function useQueueToasts(): void {
  const { entries, rows } = useQueue();
  const projectName = useProjectName();
  const loaded = useLater((s) => s.loaded);
  const sessionsLoaded = useSessions((s) => s.loaded);
  const before = useRef<Map<string, QueueEntry> | null>(null);
  useEffect(() => {
    if (!loaded || !sessionsLoaded) return;
    const transitions = readyTransitions(before.current, entries, rows);
    before.current = new Map(entries.map((entry) => [entry.item.id, entry]));
    const message = queueToast(transitions, { rows, projectName });
    if (!message) return;
    if (message.kind === 'one') {
      const item = transitions[0]!.entry.item;
      toast(message.title, {
        tone: 'ok',
        body: message.body,
        durationMs: 12_000,
        data: { 'data-queue-toast': message.itemId },
        actions: [
          { label: 'Start it', primary: true, onSelect: () => void startQueued(item), data: { 'data-queue-toast-start': true } },
          { label: 'Review first', onSelect: () => useSessions.getState().select(message.finishedId), data: { 'data-queue-toast-review': true } },
        ],
      });
    } else {
      toast(message.title, {
        tone: 'ok',
        body: message.body,
        durationMs: 12_000,
        data: { 'data-queue-toast': message.itemIds.join(' ') },
        actions: [{ label: 'Show queue', onSelect: () => useSidebarSections.getState().showSection('queue'), data: { 'data-queue-toast-show': true } }],
      });
    }
  }, [entries, rows, loaded, sessionsLoaded, projectName]);
}
